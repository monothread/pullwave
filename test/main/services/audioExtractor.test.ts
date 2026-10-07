import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AUDIO_BYTES_PER_SECOND, createFfmpegRunner, defaultAudioFiles, extractAudioParts, probeAudio, type AudioFiles, type FfmpegResult, type FfmpegRunner } from '@main/services/audioExtractor';
import { cleanTempDirs, makeTempDir } from '../../helpers/tempDir';

afterEach(() => {
    cleanTempDirs();
});

const VIDEO = join('/lib', 'Naruto', 'Naruto Episode 1.mp4');

const WITH_AUDIO = [
    "Input #0, matroska,webm, from '/lib/Naruto/Naruto Episode 1.mp4':",
    '  Duration: 00:24:03.52, start: 0.000000, bitrate: 3500 kb/s',
    '  Stream #0:0: Video: h264 (High), yuv420p, 1920x1080, 23.98 fps',
    '  Stream #0:1(jpn): Audio: aac (LC), 48000 Hz, stereo, fltp',
    'At least one output file must be specified'
].join('\n');

function runner(result: FfmpegResult): ReturnType<typeof vi.fn<FfmpegRunner>> {
    return vi.fn<FfmpegRunner>(async () => {
        return result;
    });
}

describe('AUDIO_BYTES_PER_SECOND', () => {
    it('is what mono MP3 of 32 kbps takes', () => {
        expect(AUDIO_BYTES_PER_SECOND).toBe(32_000 / 8);
    });
});

describe('probeAudio', () => {
    it('reads how long the audio is from what ffmpeg says, asking it only to open the video', async () => {
        const run = runner({ code: 1, stderr: WITH_AUDIO });
        expect(await probeAudio(VIDEO, run)).toEqual({ ok: true, seconds: 24 * 60 + 3.52 });
        expect(run).toHaveBeenCalledTimes(1);
        expect(run).toHaveBeenCalledWith(['-hide_banner', '-nostdin', '-i', VIDEO]);
    });

    it('reads hours too', async () => {
        const stderr = WITH_AUDIO.replace('00:24:03.52', '02:00:00.00');
        expect(await probeAudio(VIDEO, runner({ code: 1, stderr }))).toEqual({ ok: true, seconds: 7200 });
    });

    it('says there is no audio when the video has no audio stream', async () => {
        const stderr = WITH_AUDIO.replace(/.*Audio:.*\n/, '');
        expect(await probeAudio(VIDEO, runner({ code: 1, stderr }))).toEqual({ ok: false, reason: 'no-audio' });
    });

    it('says it failed when ffmpeg could not be run', async () => {
        expect(await probeAudio(VIDEO, runner({ code: null, stderr: 'spawn ffmpeg ENOENT' }))).toEqual({ ok: false, reason: 'extract-failed' });
    });

    it.each([
        ['the duration is not known', WITH_AUDIO.replace('00:24:03.52', 'N/A')],
        ['it is not a video', 'x.mp4: Invalid data found when processing input']
    ])('says it failed when %s', async (_name, stderr) => {
        expect(await probeAudio(VIDEO, runner({ code: 1, stderr }))).toEqual({ ok: false, reason: 'extract-failed' });
    });
});

describe('extractAudioParts', () => {
    const DIRECTORY = join('/tmp', 'work');

    function audioFiles(names: string[]): AudioFiles {
        return {
            makeDirectory: vi.fn(() => {
                return DIRECTORY;
            }),
            list: vi.fn(() => {
                return names;
            }),
            read: vi.fn(() => {
                return new Uint8Array();
            }),
            size: vi.fn(() => {
                return 0;
            }),
            remove: vi.fn()
        };
    }

    it('asks ffmpeg for mono 16 kHz MP3 parts of ten minutes and gives their paths in order', async () => {
        const run = runner({ code: 0, stderr: '' });
        const files = audioFiles(['part-001.mp3', 'notes.txt', 'part-000.mp3', 'part-002.mp3', 'part-x.mp3']);
        expect(await extractAudioParts(VIDEO, DIRECTORY, run, files)).toEqual({
            ok: true,
            paths: [join(DIRECTORY, 'part-000.mp3'), join(DIRECTORY, 'part-001.mp3'), join(DIRECTORY, 'part-002.mp3')]
        });
        expect(run).toHaveBeenCalledTimes(1);
        expect(run).toHaveBeenCalledWith(
            ['-hide_banner', '-nostdin', '-y', '-v', 'error', '-i', VIDEO, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '32k', '-f', 'segment', '-segment_time', '600', '-reset_timestamps', '1', join(DIRECTORY, 'part-%03d.mp3')],
            undefined
        );
        expect(files.list).toHaveBeenCalledWith(DIRECTORY);
    });

    it('passes the signal to ffmpeg', async () => {
        const run = runner({ code: 0, stderr: '' });
        const controller = new AbortController();
        await extractAudioParts(VIDEO, DIRECTORY, run, audioFiles(['part-000.mp3']), controller.signal);
        expect(run.mock.calls[0]?.[1]).toBe(controller.signal);
    });

    it('says it failed when ffmpeg ends with an error or could not be run, without looking at the folder', async () => {
        const files = audioFiles(['part-000.mp3']);
        expect(await extractAudioParts(VIDEO, DIRECTORY, runner({ code: 1, stderr: 'boom' }), files)).toEqual({ ok: false, reason: 'extract-failed' });
        expect(await extractAudioParts(VIDEO, DIRECTORY, runner({ code: null, stderr: 'ENOENT' }), files)).toEqual({ ok: false, reason: 'extract-failed' });
        expect(files.list).not.toHaveBeenCalled();
    });

    it('says there is no audio when ffmpeg made no part', async () => {
        expect(await extractAudioParts(VIDEO, DIRECTORY, runner({ code: 0, stderr: '' }), audioFiles(['notes.txt']))).toEqual({ ok: false, reason: 'no-audio' });
    });
});

describe('createFfmpegRunner', () => {
    it('runs the program with the arguments and gives its exit code and what it wrote to stderr', async () => {
        const run = createFfmpegRunner(process.execPath);
        expect(await run(['-e', "process.stderr.write('hello'); process.exit(3)"])).toEqual({ code: 3, stderr: 'hello' });
    });

    it('gives code 0 for a program that ends well', async () => {
        const run = createFfmpegRunner(process.execPath);
        expect(await run(['-e', "process.stderr.write('ok')"])).toEqual({ code: 0, stderr: 'ok' });
    });

    it('keeps only the end of a very long output', async () => {
        const run = createFfmpegRunner(process.execPath);
        const result = await run(['-e', "process.stderr.write('a'.repeat(300000) + 'END')"]);
        expect(result.stderr).toHaveLength(200000);
        expect(result.stderr.endsWith('aaEND')).toBe(true);
    });

    it('says it could not run a program that is not there', async () => {
        const run = createFfmpegRunner(join(makeTempDir(), 'no-such-ffmpeg'));
        const result = await run(['-version']);
        expect(result.code).toBeNull();
        expect(result.stderr).toContain('ENOENT');
    });

    it('ends the program when the signal is aborted', async () => {
        const run = createFfmpegRunner(process.execPath);
        const controller = new AbortController();
        const pending = run(['-e', 'setTimeout(() => undefined, 60000)'], controller.signal);
        setTimeout(() => {
            controller.abort();
        }, 100);
        expect((await pending).code).toBeNull();
    });
});

describe('defaultAudioFiles', () => {
    it('makes a folder, lists and reads what is in it, and removes it with everything in it', () => {
        const directory = defaultAudioFiles.makeDirectory();
        expect(existsSync(directory)).toBe(true);
        expect(directory).toContain('pullwave-audio-');
        mkdirSync(join(directory, 'inner'));
        writeFileSync(join(directory, 'part-000.mp3'), Buffer.from([1, 2, 3]));
        expect(defaultAudioFiles.list(directory).sort()).toEqual(['inner', 'part-000.mp3']);
        expect(new Uint8Array(defaultAudioFiles.read(join(directory, 'part-000.mp3')))).toEqual(new Uint8Array([1, 2, 3]));
        expect(defaultAudioFiles.size(join(directory, 'part-000.mp3'))).toBe(3);
        expect(readFileSync(join(directory, 'part-000.mp3'))).toEqual(Buffer.from([1, 2, 3]));
        defaultAudioFiles.remove(directory);
        expect(existsSync(directory)).toBe(false);
    });

    it('does not fail to remove a folder that is not there', () => {
        const directory = join(makeTempDir(), 'gone');
        expect(() => {
            defaultAudioFiles.remove(directory);
        }).not.toThrow();
    });
});
