import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CUT_MEDIA_SCHEME, type CutMedia, type CutMediaRoute, type CutPreviewRequest, type CutPreviewResponse, type CutSegment } from '@shared/cut';
import type { RunFfmpeg } from './cutService';
import { serveFile, type MediaFileSystem } from './mediaProtocol';

// What the cutter shows before it cuts (D-131): the file chosen, served to the player of the app, a part of it converted when the player cannot
// play it as it is, and a picture of it. The files it makes are in a folder of its own, removed when the file changes, when the panel is
// cleared and when the app starts and ends.

// The width of the picture of the file.
export const THUMBNAIL_WIDTH = 320;
// Where in a video the picture is taken: this share of its length (the very start is often black).
export const THUMBNAIL_AT = 0.1;
// Some room after the end of the file, which ffmpeg rounds.
const END_MARGIN_SECONDS = 0.5;

export interface CutPreviewDependencies {
    runFfmpeg: () => RunFfmpeg | null;
    // The folder of the files made for the preview and the picture.
    directory: string;
    makeDirectory?: (directory: string) => void;
    removeDirectory?: (directory: string) => void;
}

interface Chosen {
    token: number;
    media: CutMedia;
}

export function cutMediaUrl(route: CutMediaRoute, id: number): string {
    return `${CUT_MEDIA_SCHEME}://${route}/${String(id)}`;
}

// The route and the number of an address of the cutter, or null when it is not one.
export function parseCutMediaUrl(url: string): { route: CutMediaRoute; id: number } | null {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    const match = /^\/(\d+)$/.exec(parsed.pathname);
    if (parsed.protocol !== `${CUT_MEDIA_SCHEME}:` || match === null) {
        return null;
    }
    if (parsed.hostname !== 'media' && parsed.hostname !== 'preview' && parsed.hostname !== 'thumbnail') {
        return null;
    }
    return { route: parsed.hostname, id: Number(match[1]) };
}

// ffmpeg arguments for the picture: a frame of a video at a tenth of its length, or the cover an audio file carries.
export function buildThumbnailArgs(media: CutMedia, output: string): string[] {
    const seek = media.kind === 'video' ? ['-ss', String(Number((media.durationSeconds * THUMBNAIL_AT).toFixed(3)))] : [];
    return ['-hide_banner', '-nostdin', '-y', '-v', 'error', ...seek, '-i', media.path, '-map', '0:v:0', '-frames:v', '1', '-vf', `scale=${String(THUMBNAIL_WIDTH)}:-2`, '-q:v', '4', output];
}

// ffmpeg arguments for a part the player can play: a video as H.264 and AAC in MP4, an audio as AAC in M4A, fast more than small.
export function buildPreviewArgs(media: CutMedia, segment: CutSegment, output: string): string[] {
    const length = String(Number((segment.end - segment.start).toFixed(3)));
    const codecs =
        media.kind === 'video'
            ? ['-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart']
            : ['-vn', '-map', '0:a:0', '-c:a', 'aac', '-b:a', '192k'];
    return ['-hide_banner', '-nostdin', '-y', '-v', 'error', '-ss', String(segment.start), '-i', media.path, '-t', length, ...codecs, output];
}

function validSegment(segment: unknown, duration: number): segment is CutSegment {
    const { start, end } = (segment ?? {}) as Partial<CutSegment>;
    return typeof start === 'number' && typeof end === 'number' && Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && end <= duration + END_MARGIN_SECONDS;
}

export class CutPreview {
    private chosen: Chosen | null = null;
    private nextId = 1;
    private readonly files = new Map<string, string>();
    private conversion: AbortController | null = null;
    private thumbnailUrl: Promise<string | null> | null = null;

    constructor(private readonly deps: CutPreviewDependencies) {
        // What a run before left behind (an app that was killed) is not needed any more.
        this.removeFiles();
    }

    // The file the user chose: what was made for the one before is removed.
    select(media: CutMedia): void {
        this.reset();
        this.chosen = { token: this.take(), media };
    }

    // Forgets the file chosen and removes what was made for it.
    clear(): void {
        this.reset();
        this.chosen = null;
    }

    // The path a route serves, or null (an address of a file that is not chosen any more, or of another one).
    resolve(route: CutMediaRoute, id: number): string | null {
        if (route === 'media') {
            return this.chosen !== null && this.chosen.token === id ? this.chosen.media.path : null;
        }
        return this.files.get(`${route}/${String(id)}`) ?? null;
    }

    // The picture of the file chosen, made once; null when there is none (an audio with no cover) or it could not be made.
    thumbnail(): Promise<string | null> {
        if (this.chosen === null) {
            return Promise.resolve(null);
        }
        this.thumbnailUrl ??= this.makeThumbnail(this.chosen);
        return this.thumbnailUrl;
    }

    // Where to play a part: the file chosen itself, from the start to the end of the part, or the part made into a file the player plays.
    async preview(request: CutPreviewRequest): Promise<CutPreviewResponse> {
        const chosen = this.chosen;
        if (chosen === null) {
            return { ok: false, reason: 'no-file' };
        }
        const segment = request?.segment;
        if (!validSegment(segment, chosen.media.durationSeconds)) {
            return { ok: false, reason: 'invalid' };
        }
        if (request.convert !== true) {
            return { ok: true, url: cutMediaUrl('media', chosen.token), start: segment.start, end: segment.end, converted: false };
        }
        return this.convert(chosen, segment);
    }

    // Removes every file made, as the app ends.
    dispose(): void {
        this.reset();
    }

    private async makeThumbnail(chosen: Chosen): Promise<string | null> {
        const runFfmpeg = this.deps.runFfmpeg();
        if (runFfmpeg === null) {
            return null;
        }
        const id = this.take();
        const output = join(this.deps.directory, `thumbnail-${String(id)}.jpg`);
        this.ensureDirectory();
        const outcome = await runFfmpeg({ args: buildThumbnailArgs(chosen.media, output), signal: new AbortController().signal });
        if (outcome.code !== 0 || this.chosen?.token !== chosen.token) {
            return null;
        }
        this.files.set(`thumbnail/${String(id)}`, output);
        return cutMediaUrl('thumbnail', id);
    }

    private async convert(chosen: Chosen, segment: CutSegment): Promise<CutPreviewResponse> {
        const runFfmpeg = this.deps.runFfmpeg();
        if (runFfmpeg === null) {
            return { ok: false, reason: 'no-ffmpeg' };
        }
        // One preview is made at a time: a new one ends the one before.
        this.conversion?.abort();
        const controller = new AbortController();
        this.conversion = controller;
        const id = this.take();
        const output = join(this.deps.directory, `preview-${String(id)}${chosen.media.kind === 'video' ? '.mp4' : '.m4a'}`);
        this.ensureDirectory();
        const outcome = await runFfmpeg({ args: buildPreviewArgs(chosen.media, segment, output), signal: controller.signal });
        if (this.conversion === controller) {
            this.conversion = null;
        }
        if (controller.signal.aborted || this.chosen?.token !== chosen.token) {
            return { ok: false, reason: 'cancelled' };
        }
        if (outcome.code === null) {
            return { ok: false, reason: 'no-ffmpeg' };
        }
        if (outcome.code !== 0) {
            return { ok: false, reason: 'failed' };
        }
        this.files.set(`preview/${String(id)}`, output);
        return { ok: true, url: cutMediaUrl('preview', id), start: 0, end: Number((segment.end - segment.start).toFixed(3)), converted: true };
    }

    private take(): number {
        const id = this.nextId;
        this.nextId += 1;
        return id;
    }

    private reset(): void {
        this.conversion?.abort();
        this.conversion = null;
        this.thumbnailUrl = null;
        this.files.clear();
        this.removeFiles();
    }

    private ensureDirectory(): void {
        (this.deps.makeDirectory ?? defaultMakeDirectory)(this.deps.directory);
    }

    private removeFiles(): void {
        (this.deps.removeDirectory ?? defaultRemoveDirectory)(this.deps.directory);
    }
}

function defaultMakeDirectory(directory: string): void {
    mkdirSync(directory, { recursive: true });
}

function defaultRemoveDirectory(directory: string): void {
    try {
        rmSync(directory, { recursive: true, force: true });
    } catch {
        // A file in use (on Windows) stays until the next start.
    }
}

// Serves the files of the cutter (`pullwave-cut://<route>/<id>`), with ranges so the player can seek; 404 for any other address.
export function createCutMediaHandler(preview: Pick<CutPreview, 'resolve'>, files: MediaFileSystem): (request: Request) => Response {
    return (request) => {
        const address = parseCutMediaUrl(request.url);
        return serveFile(request, address === null ? null : preview.resolve(address.route, address.id), files);
    };
}
