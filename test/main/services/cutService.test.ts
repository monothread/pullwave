import { join } from 'node:path';
import type { CutRun } from '@shared/cut';
import { createFfmpegRunner, CutService, PROGRESS_INTERVAL_MS, type CutServiceDependencies, type FfmpegOutcome, type FfmpegRun, type RunFfmpeg } from '@main/services/cutService';

const VIDEO_PROBE = `  Duration: 00:02:30.00, start: 0.000000, bitrate: 1200 kb/s
  Stream #0:0: Video: h264 (High), yuv420p, 1280x720, 30 fps
  Stream #0:1: Audio: aac (LC), 48000 Hz, stereo, fltp`;
const AUDIO_PROBE = `  Duration: 00:01:00.00, start: 0.000000, bitrate: 128 kb/s
  Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 128 kb/s`;

interface Call {
    args: string[];
    signal: AbortSignal;
}

interface Setup {
    service: CutService;
    calls: Call[];
    cuts: () => Call[];
    sent: CutRun[];
    made: string[];
    listed: string[][];
}

type CutBehaviour = (call: Call, index: number, run: FfmpegRun) => Promise<FfmpegOutcome> | FfmpegOutcome;

function setup(options: { probe?: string; probeCode?: number | null; cut?: CutBehaviour; chosen?: string | null; existing?: string[]; makeDirectory?: () => Promise<void>; deps?: Partial<CutServiceDependencies>; runner?: RunFfmpeg | null } = {}): Setup {
    const calls: Call[] = [];
    const sent: CutRun[] = [];
    const made: string[] = [];
    const listed: string[][] = [];
    let cutIndex = 0;
    const runner: RunFfmpeg = async (run) => {
        const call = { args: run.args, signal: run.signal };
        calls.push(call);
        if (!run.args.includes('-t')) {
            return { code: options.probeCode === undefined ? 1 : options.probeCode, output: options.probe ?? VIDEO_PROBE };
        }
        const index = cutIndex;
        cutIndex += 1;
        return options.cut ? options.cut(call, index, run) : { code: 0, output: '' };
    };
    const service = new CutService({
        runFfmpeg: () => {
            return options.runner === undefined ? runner : options.runner;
        },
        chooseFile: async () => {
            return options.chosen === undefined ? '/media/My Talk.mp4' : options.chosen;
        },
        outputRoot: () => {
            return '/downloads';
        },
        audioFormat: () => {
            return 'm4a';
        },
        send: (run) => {
            sent.push(run);
        },
        threads: () => {
            return 3;
        },
        now: (() => {
            let moment = 0;
            return () => {
                moment += PROGRESS_INTERVAL_MS;
                return moment;
            };
        })(),
        listDirectory: async (directory) => {
            listed.push([directory]);
            return options.existing ?? [];
        },
        makeDirectory: options.makeDirectory ?? (async (directory) => {
            made.push(directory);
        }),
        ...options.deps
    });
    return {
        service,
        calls,
        cuts: () => {
            return calls.filter((call) => {
                return call.args.includes('-t');
            });
        },
        sent,
        made,
        listed
    };
}

async function untilOver(service: CutService): Promise<CutRun> {
    await vi.waitFor(() => {
        expect(service.current()?.status).not.toBe('running');
    });
    return service.current()!;
}

describe('CutService probe and choose', () => {
    it('reads how long the file is and whether it has a picture', async () => {
        const { service, calls } = setup();
        await expect(service.probe('/media/My Talk.MP4')).resolves.toEqual({
            ok: true,
            media: { path: '/media/My Talk.MP4', name: 'My Talk', extension: '.mp4', kind: 'video', durationSeconds: 150 }
        });
        expect(calls.map((call) => { return call.args; })).toEqual([['-hide_banner', '-nostdin', '-i', '/media/My Talk.MP4']]);
    });

    it('says a file with only sound is an audio', async () => {
        const { service } = setup({ probe: AUDIO_PROBE });
        await expect(service.probe('/media/a.mp3')).resolves.toMatchObject({ ok: true, media: { kind: 'audio', durationSeconds: 60 } });
    });

    it('says ffmpeg could not be used when there is none, or it could not be started', async () => {
        await expect(setup({ runner: null }).service.probe('/a.mp4')).resolves.toEqual({ ok: false, reason: 'no-ffmpeg' });
        await expect(setup({ probeCode: null }).service.probe('/a.mp4')).resolves.toEqual({ ok: false, reason: 'no-ffmpeg' });
    });

    it('says a file that is not a video or an audio is unreadable', async () => {
        await expect(setup({ probe: 'notes.txt: Invalid data found when processing input' }).service.probe('/notes.txt')).resolves.toEqual({ ok: false, reason: 'unreadable' });
    });

    it('chooses a file and reads it', async () => {
        const { service, calls } = setup({ chosen: '/media/Clip.mkv' });
        await expect(service.choose()).resolves.toMatchObject({ ok: true, media: { path: '/media/Clip.mkv', name: 'Clip', extension: '.mkv' } });
        expect(calls).toHaveLength(1);
    });

    it('does not read anything when the window of the files is closed', async () => {
        const { service, calls } = setup({ chosen: null });
        await expect(service.choose()).resolves.toEqual({ ok: false, reason: 'cancelled' });
        expect(calls).toEqual([]);
    });
});

describe('CutService start: what it refuses', () => {
    const SEGMENT = { start: 10, end: 14 };

    it('refuses without ffmpeg', async () => {
        const { service } = setup({ runner: null });
        await expect(service.start({ path: '/a.mp4', segments: [SEGMENT], audioOnly: false })).resolves.toEqual({ ok: false, reason: 'no-ffmpeg' });
    });

    it.each([[''], [5], [null], [undefined]])('refuses the path %j', async (path) => {
        const { service, calls } = setup();
        await expect(service.start({ path: path as string, segments: [SEGMENT], audioOnly: false })).resolves.toEqual({ ok: false, reason: 'invalid' });
        expect(calls).toEqual([]);
    });

    it('refuses a file that cannot be read any more', async () => {
        const { service } = setup({ probe: 'gone: No such file or directory' });
        await expect(service.start({ path: '/gone.mp4', segments: [SEGMENT], audioOnly: false })).resolves.toEqual({ ok: false, reason: 'unreadable' });
    });

    it('says ffmpeg could not be started when the reading of the file did not start it', async () => {
        const { service } = setup({ probeCode: null });
        await expect(service.start({ path: '/a.mp4', segments: [SEGMENT], audioOnly: false })).resolves.toEqual({ ok: false, reason: 'no-ffmpeg' });
    });

    it.each([
        ['none', []],
        ['not a list', 'x'],
        ['a start before the beginning', [{ start: -1, end: 5 }]],
        ['an end that is not after the start', [{ start: 5, end: 5 }]],
        ['an end before the start', [{ start: 9, end: 5 }]],
        ['an end after the end of the file', [{ start: 140, end: 151 }]],
        ['a start that is not a number', [{ start: '1', end: 5 }]],
        ['a time that is not finite', [{ start: 0, end: Number.POSITIVE_INFINITY }]],
        ['a time that is NaN', [{ start: Number.NaN, end: 5 }]],
        ['a part that is not an object', [null]],
        ['a good part and a bad one', [SEGMENT, { start: 20, end: 10 }]],
        ['more than 200 parts', Array.from({ length: 201 }, () => { return SEGMENT; })]
    ])('refuses %s', async (_name, segments) => {
        const { service, made } = setup();
        await expect(service.start({ path: '/a.mp4', segments: segments as never, audioOnly: false })).resolves.toEqual({ ok: false, reason: 'invalid' });
        expect(made).toEqual([]);
    });

    it('accepts an end up to half a second after the end of the file, and 200 parts', async () => {
        const { service } = setup();
        const response = await service.start({ path: '/a.mp4', segments: Array.from({ length: 200 }, () => { return { start: 149.5, end: 150.5 }; }), audioOnly: false });
        expect(response.ok).toBe(true);
        service.cancel();
        await untilOver(service);
    });

    it('refuses when the folder of the parts cannot be made', async () => {
        const { service, cuts } = setup({ makeDirectory: async () => { throw new Error('EACCES'); } });
        await expect(service.start({ path: '/a.mp4', segments: [SEGMENT], audioOnly: false })).resolves.toEqual({ ok: false, reason: 'folder' });
        expect(cuts()).toEqual([]);
        expect(service.current()).toBeNull();
    });

    it('refuses a second cut while one goes on, and takes another when it is over', async () => {
        let finish: (outcome: FfmpegOutcome) => void = () => {return undefined};
        const { service } = setup({
            cut: (_call, index) => {
                if (index > 0) {
                    return { code: 0, output: '' };
                }
                return new Promise((resolve) => {
                    finish = resolve;
                });
            }
        });
        await service.start({ path: '/a.mp4', segments: [SEGMENT], audioOnly: false });
        await expect(service.start({ path: '/a.mp4', segments: [SEGMENT], audioOnly: false })).resolves.toEqual({ ok: false, reason: 'busy' });
        await vi.waitFor(() => {
            expect(service.current()?.segments[0]?.status).toBe('cutting');
        });
        finish({ code: 0, output: '' });
        await untilOver(service);
        const second = await service.start({ path: '/a.mp4', segments: [SEGMENT], audioOnly: false });
        expect(second).toMatchObject({ ok: true, run: { id: 2 } });
        await untilOver(service);
    });
});

describe('CutService start: the cut', () => {
    it('makes the folder in the downloads, cuts the parts one after the other with the format of the video, and tells each step', async () => {
        const { service, made, cuts, sent } = setup();
        const response = await service.start({
            path: '/media/My Talk.mp4',
            segments: [
                { start: 10, end: 14 },
                { start: 94, end: 103 }
            ],
            audioOnly: false
        });
        const folder = join('/downloads', 'My Talk - cuts');
        expect(response).toEqual({
            ok: true,
            run: {
                id: 1,
                mediaName: 'My Talk',
                outputDirectory: folder,
                audioOnly: false,
                status: 'running',
                segments: [
                    { segment: { start: 10, end: 14 }, status: 'waiting', percent: 0, outputPath: null, error: null },
                    { segment: { start: 94, end: 103 }, status: 'waiting', percent: 0, outputPath: null, error: null }
                ]
            }
        });
        const run = await untilOver(service);
        expect(made).toEqual([folder]);
        expect(run.status).toBe('done');
        expect(run.segments).toEqual([
            { segment: { start: 10, end: 14 }, status: 'done', percent: 100, outputPath: join(folder, 'My Talk - 01 (0m10s-0m14s).mp4'), error: null },
            { segment: { start: 94, end: 103 }, status: 'done', percent: 100, outputPath: join(folder, 'My Talk - 02 (1m34s-1m43s).mp4'), error: null }
        ]);
        expect(cuts().map((call) => { return call.args; })).toEqual([
            [
                '-hide_banner', '-nostdin', '-n', '-v', 'error', '-stats', '-ss', '10', '-i', '/media/My Talk.mp4', '-t', '4',
                '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
                '-threads', '3', join(folder, 'My Talk - 01 (0m10s-0m14s).mp4')
            ],
            [
                '-hide_banner', '-nostdin', '-n', '-v', 'error', '-stats', '-ss', '94', '-i', '/media/My Talk.mp4', '-t', '9',
                '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
                '-threads', '3', join(folder, 'My Talk - 02 (1m34s-1m43s).mp4')
            ]
        ]);
        // The screen is told when a part begins and when it ends, and when the whole is over.
        expect(
            sent.map((item) => {
                return [item.status, item.segments.map((part) => { return part.status; })];
            })
        ).toEqual([
            ['running', ['waiting', 'waiting']],
            ['running', ['cutting', 'waiting']],
            ['running', ['done', 'waiting']],
            ['running', ['done', 'cutting']],
            ['running', ['done', 'done']],
            ['done', ['done', 'done']]
        ]);
    });

    it('does not let the snapshots that were sent change afterwards', async () => {
        const { service, sent } = setup();
        await service.start({ path: '/a.mp4', segments: [{ start: 1, end: 2 }], audioOnly: false });
        await untilOver(service);
        expect(sent[0]?.segments[0]?.status).toBe('waiting');
        expect(sent[0]?.status).toBe('running');
    });

    it('turns a video into audio files of the audio format of the settings when only the audio is wanted', async () => {
        const { service, cuts } = setup();
        await service.start({ path: '/media/My Talk.mp4', segments: [{ start: 0, end: 5 }], audioOnly: true });
        const run = await untilOver(service);
        const folder = join('/downloads', 'My Talk - cuts');
        expect(run.audioOnly).toBe(true);
        expect(run.segments[0]?.outputPath).toBe(join(folder, 'My Talk - 01 (0m00s-0m05s).m4a'));
        expect(cuts()[0]?.args).toEqual([
            '-hide_banner', '-nostdin', '-n', '-v', 'error', '-stats', '-ss', '0', '-i', '/media/My Talk.mp4', '-t', '5',
            '-vn', '-c:a', 'aac', '-b:a', '192k', '-threads', '3', join(folder, 'My Talk - 01 (0m00s-0m05s).m4a')
        ]);
    });

    it('keeps the format of an audio file, and does not take the audio-only choice for anything', async () => {
        const { service, cuts } = setup({ probe: AUDIO_PROBE });
        await service.start({ path: '/music/Song.flac', segments: [{ start: 1.5, end: 3 }], audioOnly: true });
        const run = await untilOver(service);
        expect(run.audioOnly).toBe(false);
        expect(run.segments[0]?.outputPath).toBe(join('/downloads', 'Song - cuts', 'Song - 01 (0m01s-0m03s).flac'));
        expect(cuts()[0]?.args.slice(6, 12)).toEqual(['-ss', '1.5', '-i', '/music/Song.flac', '-t', '1.5']);
        expect(cuts()[0]?.args).toContain('-vn');
    });

    it('does not write over a file that is there: it takes the next free name', async () => {
        const folder = join('/downloads', 'My Talk - cuts');
        const { service } = setup({ existing: [join(folder, 'My Talk - 01 (0m10s-0m14s).mp4')] });
        await service.start({ path: '/media/My Talk.mp4', segments: [{ start: 10, end: 14 }], audioOnly: false });
        const run = await untilOver(service);
        expect(run.segments[0]?.outputPath).toBe(join(folder, 'My Talk - 01 (0m10s-0m14s) (2).mp4'));
    });

    it('does not give the same name to two parts that are the same', async () => {
        const { service } = setup();
        await service.start({ path: '/media/My Talk.mp4', segments: [{ start: 10, end: 14 }, { start: 10, end: 14 }], audioOnly: false });
        const run = await untilOver(service);
        expect(run.segments.map((part) => { return part.outputPath; })).toEqual([
            join('/downloads', 'My Talk - cuts', 'My Talk - 01 (0m10s-0m14s).mp4'),
            join('/downloads', 'My Talk - cuts', 'My Talk - 02 (0m10s-0m14s).mp4')
        ]);
    });

    it('names the folder after the file, without the characters a system does not accept', async () => {
        const { service, made } = setup();
        await service.start({ path: '/media/a:b?.mp4', segments: [{ start: 1, end: 2 }], audioOnly: false });
        await untilOver(service);
        expect(made).toEqual([join('/downloads', 'a_b_ - cuts')]);
    });

    it('asks the encoder for the threads the computer can spare', async () => {
        const { service, cuts } = setup({ deps: { threads: () => { return 7; } } });
        await service.start({ path: '/a.mp4', segments: [{ start: 1, end: 2 }], audioOnly: false });
        await untilOver(service);
        expect(cuts()[0]?.args.slice(-3, -1)).toEqual(['-threads', '7']);
    });

    it('uses one thread less than the computer has by default, and at least one', async () => {
        const { service, cuts } = setup({ deps: { threads: undefined } });
        await service.start({ path: '/a.mp4', segments: [{ start: 1, end: 2 }], audioOnly: false });
        await untilOver(service);
        const threads = Number(cuts()[0]?.args.at(-2));
        expect(Number.isInteger(threads)).toBe(true);
        expect(threads).toBeGreaterThanOrEqual(1);
    });
});

describe('CutService progress', () => {
    it('tells the percentage of the part as ffmpeg works, at most every quarter of a second, and only when it changed', async () => {
        const { service, sent } = setup({
            cut: async (_call, _index, run) => {
                run.onOutput?.('size=0kB time=00:00:01.00 bitrate=0');
                run.onOutput?.('size=0kB time=00:00:01.00 bitrate=0');
                run.onOutput?.('size=0kB time=00:00:02.00 bitrate=0');
                run.onOutput?.('Stream mapping:');
                run.onOutput?.('size=0kB time=00:00:99.00 bitrate=0');
                return { code: 0, output: '' };
            }
        });
        await service.start({ path: '/a.mp4', segments: [{ start: 0, end: 4 }], audioOnly: false });
        await untilOver(service);
        const percents = sent
            .map((item) => { return item.segments[0]!.percent; })
            .filter((percent, index, all) => { return index === 0 || percent !== all[index - 1]; });
        expect(percents).toEqual([0, 25, 50, 99, 100]);
    });

    it('does not tell a percentage twice in a row', async () => {
        const { service, sent } = setup({
            cut: async (_call, _index, run) => {
                run.onOutput?.('time=00:00:01.00');
                run.onOutput?.('time=00:00:01.00');
                return { code: 0, output: '' };
            }
        });
        await service.start({ path: '/a.mp4', segments: [{ start: 0, end: 4 }], audioOnly: false });
        await untilOver(service);
        expect(
            sent.filter((item) => { return item.segments[0]!.percent === 25; })
        ).toHaveLength(1);
    });

    it('does not tell more often than the interval, however fast ffmpeg writes', async () => {
        let moment = 1000;
        const { service, sent } = setup({
            deps: { now: () => { return moment; } },
            cut: async (_call, _index, run) => {
                run.onOutput?.('time=00:00:01.00');
                run.onOutput?.('time=00:00:02.00');
                moment += PROGRESS_INTERVAL_MS;
                run.onOutput?.('time=00:00:03.00');
                return { code: 0, output: '' };
            }
        });
        await service.start({ path: '/a.mp4', segments: [{ start: 0, end: 4 }], audioOnly: false });
        await untilOver(service);
        expect(
            sent.map((item) => { return item.segments[0]!.percent; }).filter((percent) => { return percent > 0 && percent < 100; })
        ).toEqual([25, 75]);
    });
});

describe('CutService failures and cancelling', () => {
    it('says what ffmpeg said when a part fails, goes on with the others and keeps no half file', async () => {
        const { service } = setup({
            cut: (_call, index) => {
                return index === 0 ? { code: 1, output: 'Stream mapping:\nsize=0kB time=00:00:00.50\nConversion failed!' } : { code: 0, output: '' };
            }
        });
        await service.start({ path: '/media/My Talk.mp4', segments: [{ start: 1, end: 2 }, { start: 3, end: 4 }], audioOnly: false });
        const run = await untilOver(service);
        expect(run.status).toBe('done');
        expect(run.segments[0]).toMatchObject({ status: 'error', error: 'Conversion failed!', outputPath: null });
        expect(run.segments[1]).toMatchObject({ status: 'done' });
    });

    it('says ffmpeg could not be started when it has nothing to say', async () => {
        const { service } = setup({ cut: () => { return { code: null, output: '' }; } });
        await service.start({ path: '/a.mp4', segments: [{ start: 1, end: 2 }], audioOnly: false });
        expect((await untilOver(service)).segments[0]?.error).toBe('ffmpeg could not be started');
    });

    it('gives the exit code when ffmpeg failed without a word', async () => {
        const { service } = setup({ cut: () => { return { code: 234, output: 'time=00:00:00.10\n' }; } });
        await service.start({ path: '/a.mp4', segments: [{ start: 1, end: 2 }], audioOnly: false });
        expect((await untilOver(service)).segments[0]?.error).toBe('ffmpeg ended with code 234');
    });

    it('ends the part being cut and does not make the others when it is cancelled', async () => {
        let aborted = false;
        const { service, cuts } = setup({
            cut: (call) => {
                return new Promise((resolve) => {
                    call.signal.addEventListener('abort', () => {
                        aborted = true;
                        resolve({ code: null, output: '' });
                    });
                });
            }
        });
        await service.start({ path: '/a.mp4', segments: [{ start: 1, end: 2 }, { start: 3, end: 4 }, { start: 5, end: 6 }], audioOnly: false });
        await vi.waitFor(() => {
            expect(service.current()?.segments[0]?.status).toBe('cutting');
        });
        service.cancel();
        const run = await untilOver(service);
        expect(aborted).toBe(true);
        expect(run.status).toBe('cancelled');
        expect(
            run.segments.map((part) => { return [part.status, part.percent, part.outputPath]; })
        ).toEqual([['cancelled', 0, null], ['cancelled', 0, null], ['cancelled', 0, null]]);
        expect(cuts()).toHaveLength(1);
    });

    it('keeps the parts that were done when it is cancelled later', async () => {
        const { service } = setup({
            cut: (call, index) => {
                if (index === 0) {
                    return { code: 0, output: '' };
                }
                return new Promise((resolve) => {
                    call.signal.addEventListener('abort', () => {
                        resolve({ code: null, output: '' });
                    });
                });
            }
        });
        await service.start({ path: '/media/My Talk.mp4', segments: [{ start: 1, end: 2 }, { start: 3, end: 4 }], audioOnly: false });
        await vi.waitFor(() => {
            expect(service.current()?.segments[1]?.status).toBe('cutting');
        });
        service.cancel();
        const run = await untilOver(service);
        expect(run.status).toBe('cancelled');
        expect(run.segments.map((part) => { return part.status; })).toEqual(['done', 'cancelled']);
        expect(run.segments[0]?.outputPath).toBe(join('/downloads', 'My Talk - cuts', 'My Talk - 01 (0m01s-0m02s).mp4'));
    });

    it('does nothing when there is nothing to cancel', () => {
        const { service } = setup();
        expect(() => { service.cancel(); }).not.toThrow();
        expect(service.current()).toBeNull();
    });

    it('can start another cut after one was cancelled', async () => {
        const { service } = setup({
            cut: (call, index) => {
                if (index > 0) {
                    return { code: 0, output: '' };
                }
                return new Promise((resolve) => {
                    call.signal.addEventListener('abort', () => {
                        resolve({ code: null, output: '' });
                    });
                });
            }
        });
        await service.start({ path: '/a.mp4', segments: [{ start: 1, end: 2 }], audioOnly: false });
        await vi.waitFor(() => {
            expect(service.current()?.segments[0]?.status).toBe('cutting');
        });
        service.cancel();
        await untilOver(service);
        await expect(service.start({ path: '/a.mp4', segments: [{ start: 1, end: 2 }], audioOnly: false })).resolves.toMatchObject({ ok: true });
        expect((await untilOver(service)).status).toBe('done');
    });
});

describe('createFfmpegRunner', () => {
    const NODE = process.execPath;

    it('runs the program, gives what it printed on the error output as it goes and in the end, and its exit code', async () => {
        const chunks: string[] = [];
        const outcome = await createFfmpegRunner(NODE)({
            args: ['-e', "process.stderr.write('hello'); process.exit(3)"],
            signal: new AbortController().signal,
            onOutput: (chunk) => {
                chunks.push(chunk);
            }
        });
        expect(outcome).toEqual({ code: 3, output: 'hello' });
        expect(chunks.join('')).toBe('hello');
    });

    it('gives no exit code when the program cannot be started', async () => {
        const outcome = await createFfmpegRunner('/nowhere/ffmpeg-not-here')({ args: [], signal: new AbortController().signal });
        expect(outcome.code).toBeNull();
        expect(outcome.output).toContain('ENOENT');
    });

    it('ends the process when the signal is aborted', async () => {
        const controller = new AbortController();
        const running = createFfmpegRunner(NODE)({ args: ['-e', 'setInterval(() => undefined, 1000)'], signal: controller.signal });
        setTimeout(() => {
            controller.abort();
        }, 100);
        const outcome = await running;
        expect(outcome.code).toBeNull();
    });

    it('ends the process at once when the signal was aborted before it started', async () => {
        const controller = new AbortController();
        controller.abort();
        const outcome = await createFfmpegRunner(NODE)({ args: ['-e', 'setInterval(() => undefined, 1000)'], signal: controller.signal });
        expect(outcome.code).toBeNull();
    });
});
