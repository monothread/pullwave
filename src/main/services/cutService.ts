import { spawn } from 'node:child_process';
import { constants as osConstants, cpus, setPriority } from 'node:os';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_CUT_SEGMENTS, type CutChooseResponse, type CutMedia, type CutRequest, type CutRun, type CutSegment, type CutSegmentState, type CutStartResponse } from '@shared/cut';
import type { AudioFormat } from '@shared/types';
import { buildCutArgs, freePath, mediaOf, outputFormat, parseMediaProbe, parseProgressSeconds, partFileName, safeName } from './cutArgs';

export interface FfmpegOutcome {
    // Null when ffmpeg could not be started or was ended by a signal.
    code: number | null;
    // What it printed (the end of it).
    output: string;
}

export interface FfmpegRun {
    args: string[];
    signal: AbortSignal;
    // Called with what ffmpeg prints as it works.
    onOutput?: (chunk: string) => void;
}

export type RunFfmpeg = (run: FfmpegRun) => Promise<FfmpegOutcome>;

const MAX_OUTPUT = 20_000;
// The screen is told about the progress at most this often, and only when the percentage changed: the updates must not take the time
// the window needs to draw its animations.
export const PROGRESS_INTERVAL_MS = 250;

// Runs ffmpeg as a process of its own (so it never blocks the app), at a low priority, and kills it when the signal is aborted.
export function createFfmpegRunner(binary: string): RunFfmpeg {
    return ({ args, signal, onOutput }) => {
        return new Promise((resolve) => {
            const child = spawn(binary, args, { windowsHide: true });
            let output = '';
            if (child.pid !== undefined) {
                try {
                    setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL);
                } catch {
                    // The system did not let the priority change: it runs as it is.
                }
            }
            const onAbort = (): void => {
                child.kill();
            };
            if (signal.aborted) {
                onAbort();
            }
            signal.addEventListener('abort', onAbort, { once: true });
            child.stderr.on('data', (chunk: Buffer) => {
                const text = chunk.toString('utf-8');
                output = (output + text).slice(-MAX_OUTPUT);
                onOutput?.(text);
            });
            child.on('error', (error) => {
                signal.removeEventListener('abort', onAbort);
                resolve({ code: null, output: error.message });
            });
            child.on('close', (code) => {
                signal.removeEventListener('abort', onAbort);
                resolve({ code, output });
            });
        });
    };
}

export interface CutServiceDependencies {
    runFfmpeg: () => RunFfmpeg | null;
    // The window of the files: the path that was chosen, or null.
    chooseFile: () => Promise<string | null>;
    // The folder of the downloads, where the folder of each cut is made.
    outputRoot: () => string;
    audioFormat: () => AudioFormat;
    send: (run: CutRun) => void;
    threads?: () => number;
    now?: () => number;
    // The names of the files in a folder (the tests replace it).
    listDirectory?: (directory: string) => Promise<string[]>;
    makeDirectory?: (directory: string) => Promise<void>;
}

function defaultThreads(): number {
    return Math.max(1, cpus().length - 1);
}

function lastLine(output: string): string {
    const lines = output
        .split(/\r|\n/)
        .map((line) => {
            return line.trim();
        })
        .filter((line) => {
            return line.length > 0 && !line.startsWith('size=') && !line.includes('time=');
        });
    return lines.at(-1) ?? '';
}

// Whether the parts are inside the file and in order that makes sense; the request comes from the window, so nothing is trusted.
function validSegments(segments: unknown, durationSeconds: number): segments is CutSegment[] {
    return (
        Array.isArray(segments) &&
        segments.length > 0 &&
        segments.length <= MAX_CUT_SEGMENTS &&
        segments.every((segment: unknown) => {
            const { start, end } = (segment ?? {}) as Partial<CutSegment>;
            return typeof start === 'number' && typeof end === 'number' && Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && end <= durationSeconds + 0.5;
        })
    );
}

// Cuts a video or audio file into the parts the user marked, one file for each, one after the other.
export class CutService {
    private run: CutRun | null = null;
    private controller: AbortController | null = null;
    private nextId = 1;

    constructor(private readonly deps: CutServiceDependencies) {}

    current(): CutRun | null {
        return this.run;
    }

    // Reads the file: how long it is and whether it has a picture (a video) or only sound.
    async probe(path: string): Promise<CutChooseResponse> {
        const runFfmpeg = this.deps.runFfmpeg();
        if (runFfmpeg === null) {
            return { ok: false, reason: 'no-ffmpeg' };
        }
        const outcome = await runFfmpeg({ args: ['-hide_banner', '-nostdin', '-i', path], signal: new AbortController().signal });
        if (outcome.code === null) {
            return { ok: false, reason: 'no-ffmpeg' };
        }
        const probe = parseMediaProbe(outcome.output);
        return probe === null ? { ok: false, reason: 'unreadable' } : { ok: true, media: mediaOf(path, probe) };
    }

    async choose(): Promise<CutChooseResponse> {
        const path = await this.deps.chooseFile();
        return path === null ? { ok: false, reason: 'cancelled' } : this.probe(path);
    }

    async start(request: CutRequest): Promise<CutStartResponse> {
        if (this.run?.status === 'running') {
            return { ok: false, reason: 'busy' };
        }
        const runFfmpeg = this.deps.runFfmpeg();
        if (runFfmpeg === null) {
            return { ok: false, reason: 'no-ffmpeg' };
        }
        if (typeof request?.path !== 'string' || request.path.length === 0) {
            return { ok: false, reason: 'invalid' };
        }
        const probed = await this.probe(request.path);
        if (!probed.ok) {
            return { ok: false, reason: probed.reason === 'no-ffmpeg' ? 'no-ffmpeg' : 'unreadable' };
        }
        const media = probed.media;
        if (!validSegments(request.segments, media.durationSeconds)) {
            return { ok: false, reason: 'invalid' };
        }
        const audioOnly = request.audioOnly === true && media.kind === 'video';
        const directory = join(this.deps.outputRoot(), `${safeName(media.name)} - cuts`);
        try {
            await (this.deps.makeDirectory ?? defaultMakeDirectory)(directory);
        } catch {
            return { ok: false, reason: 'folder' };
        }
        const taken = new Set(await (this.deps.listDirectory ?? defaultListDirectory)(directory).catch(() => { return []; }));
        const controller = new AbortController();
        this.controller = controller;
        const run: CutRun = {
            id: this.nextId,
            mediaName: media.name,
            outputDirectory: directory,
            audioOnly,
            status: 'running',
            segments: request.segments.map((segment): CutSegmentState => {
                return { segment: { start: segment.start, end: segment.end }, status: 'waiting', percent: 0, outputPath: null, error: null };
            })
        };
        this.nextId += 1;
        this.run = run;
        this.publish();
        // The answer is the cut as it begins (every part waiting): the first part starts as soon as the next line runs.
        const begun = structuredClone(run);
        void this.cutAll(media, audioOnly, directory, taken, controller, runFfmpeg);
        return { ok: true, run: begun };
    }

    // Ends the cut that goes on. The part being made is deleted by the end of its process (ffmpeg leaves half a file, which is removed).
    cancel(): void {
        this.controller?.abort();
    }

    private publish(): void {
        if (this.run !== null) {
            this.deps.send(structuredClone(this.run));
        }
    }

    private async cutAll(media: CutMedia, audioOnly: boolean, directory: string, taken: Set<string>, controller: AbortController, runFfmpeg: RunFfmpeg): Promise<void> {
        const run = this.run;
        if (run === null) {
            return;
        }
        const format = outputFormat(media, audioOnly, this.deps.audioFormat());
        const threads = (this.deps.threads ?? defaultThreads)();
        for (let index = 0; index < run.segments.length; index += 1) {
            const state = run.segments[index]!;
            if (controller.signal.aborted) {
                state.status = 'cancelled';
                continue;
            }
            const name = partFileName(safeName(media.name), index, run.segments.length, state.segment.start, state.segment.end, format.extension);
            const output = freePath(join(directory, name), (candidate) => {
                return taken.has(candidate);
            });
            taken.add(output);
            state.status = 'cutting';
            this.publish();
            await this.cutOne(state, { input: media.path, output, start: state.segment.start, end: state.segment.end, format, threads }, controller.signal, runFfmpeg);
            this.publish();
        }
        run.status = controller.signal.aborted ? 'cancelled' : 'done';
        this.publish();
        if (this.controller === controller) {
            this.controller = null;
        }
    }

    private async cutOne(state: CutSegmentState, command: Parameters<typeof buildCutArgs>[0], signal: AbortSignal, runFfmpeg: RunFfmpeg): Promise<void> {
        const length = command.end - command.start;
        const now = this.deps.now ?? Date.now;
        let lastSent = 0;
        const outcome = await runFfmpeg({
            args: buildCutArgs(command),
            signal,
            onOutput: (chunk) => {
                const seconds = parseProgressSeconds(chunk);
                if (seconds === null) {
                    return;
                }
                const percent = Math.min(99, Math.max(0, Math.floor((seconds / length) * 100)));
                const moment = now();
                if (percent !== state.percent && moment - lastSent >= PROGRESS_INTERVAL_MS) {
                    state.percent = percent;
                    lastSent = moment;
                    this.publish();
                }
            }
        });
        if (signal.aborted) {
            state.status = 'cancelled';
            state.percent = 0;
            await removeQuietly(command.output);
            return;
        }
        if (outcome.code === 0) {
            state.status = 'done';
            state.percent = 100;
            state.outputPath = command.output;
            return;
        }
        state.status = 'error';
        state.error = lastLine(outcome.output) || (outcome.code === null ? 'ffmpeg could not be started' : `ffmpeg ended with code ${outcome.code}`);
        await removeQuietly(command.output);
    }
}

async function defaultMakeDirectory(directory: string): Promise<void> {
    await mkdir(directory, { recursive: true });
}

async function defaultListDirectory(directory: string): Promise<string[]> {
    return (await readdir(directory)).map((name) => {
        return join(directory, name);
    });
}

async function removeQuietly(path: string): Promise<void> {
    await rm(path, { force: true }).catch(() => {
        // Nothing to remove, or it could not be: the file is left as it is.
    });
}
