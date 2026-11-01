import { buildCutArgs, clockForName, freePath, mediaOf, outputFormat, parseMediaProbe, parseProgressSeconds, partFileName, safeName } from '@main/services/cutArgs';

const VIDEO_PROBE = `Input #0, matroska,webm, from 'a.mkv':
  Duration: 00:02:30.04, start: 0.000000, bitrate: 1200 kb/s
  Stream #0:0: Video: h264 (High), yuv420p, 1280x720, 30 fps
  Stream #0:1(eng): Audio: aac (LC), 48000 Hz, stereo, fltp
At least one output file must be specified`;

const AUDIO_PROBE = `Input #0, mp3, from 'a.mp3':
  Duration: 01:02:03.50, start: 0.025057, bitrate: 128 kb/s
  Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 128 kb/s
At least one output file must be specified`;

const COVER_PROBE = `Input #0, mp3, from 'a.mp3':
  Duration: 00:03:00.00, start: 0.000000, bitrate: 192 kb/s
  Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 192 kb/s
  Stream #0:1: Video: mjpeg (Baseline), yuvj420p(pc, bt470bg/unknown/unknown), 500x500 [SAR 1:1 DAR 1:1], 90k tbr, 90k tbn (attached pic)
At least one output file must be specified`;

describe('parseMediaProbe', () => {
    it('reads the length and says a file with a picture is a video', () => {
        expect(parseMediaProbe(VIDEO_PROBE)).toEqual({ durationSeconds: 150.04, kind: 'video' });
    });

    it('reads hours, minutes and fractions of a second, and says a file with only sound is an audio', () => {
        expect(parseMediaProbe(AUDIO_PROBE)).toEqual({ durationSeconds: 3723.5, kind: 'audio' });
    });

    it('does not take the cover of an audio file for a video', () => {
        expect(parseMediaProbe(COVER_PROBE)).toEqual({ durationSeconds: 180, kind: 'audio' });
    });

    it('is a video when it has a picture and no sound', () => {
        const silent = `  Duration: 00:00:10.00, start: 0.000000\n  Stream #0:0: Video: h264, yuv420p, 640x360`;
        expect(parseMediaProbe(silent)).toEqual({ durationSeconds: 10, kind: 'video' });
    });

    it('is nothing when ffmpeg did not say how long the file is, or found nothing to play', () => {
        expect(parseMediaProbe('x.txt: Invalid data found when processing input')).toBeNull();
        expect(parseMediaProbe('  Duration: N/A, bitrate: N/A\n  Stream #0:0: Video: h264')).toBeNull();
        expect(parseMediaProbe('  Duration: 00:00:05.00, start: 0\n  Stream #0:0: Data: bin_data')).toBeNull();
        expect(parseMediaProbe('')).toBeNull();
    });
});

describe('parseProgressSeconds', () => {
    it('gives the last time ffmpeg printed', () => {
        expect(parseProgressSeconds('size=       0kB time=00:00:01.50 bitrate=   0.0kbits/s\rsize=      64kB time=00:01:02.25 bitrate= 8.4kbits/s')).toBe(62.25);
    });

    it('reads hours', () => {
        expect(parseProgressSeconds('time=01:00:00.00')).toBe(3600);
    });

    it('is nothing while ffmpeg prints something else', () => {
        expect(parseProgressSeconds('Stream mapping:\n  Stream #0:0 -> #0:0')).toBeNull();
        expect(parseProgressSeconds('')).toBeNull();
    });
});

describe('mediaOf', () => {
    it('gives the name without the folder and the extension, the extension in lower case, the kind and the length', () => {
        expect(mediaOf('/home/me/Videos/My Clip.final.MP4', { durationSeconds: 90, kind: 'video' })).toEqual({
            path: '/home/me/Videos/My Clip.final.MP4',
            name: 'My Clip.final',
            extension: '.mp4',
            kind: 'video',
            durationSeconds: 90
        });
    });

    it('gives an empty extension for a file that has none', () => {
        expect(mediaOf('/tmp/recording', { durationSeconds: 5, kind: 'audio' })).toMatchObject({ name: 'recording', extension: '' });
    });
});

describe('outputFormat', () => {
    it.each([
        ['.mp4', ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart']],
        ['.m4v', ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart']],
        ['.mov', ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', '-b:a', '192k']],
        ['.mkv', ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', '-b:a', '192k']],
        ['.webm', ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32', '-row-mt', '1', '-c:a', 'libopus']]
    ])('keeps the format of a video %s, with the encoders that fit it', (extension, codecArgs) => {
        expect(outputFormat({ extension, kind: 'video' }, false, 'mp3')).toEqual({ extension, dropVideo: false, codecArgs });
    });

    it('leaves the encoders to ffmpeg for a video format that is not listed', () => {
        expect(outputFormat({ extension: '.avi', kind: 'video' }, false, 'mp3')).toEqual({ extension: '.avi', dropVideo: false, codecArgs: [] });
    });

    it.each([
        ['.mp3', ['-c:a', 'libmp3lame', '-q:a', '2']],
        ['.m4a', ['-c:a', 'aac', '-b:a', '192k']],
        ['.aac', ['-c:a', 'aac', '-b:a', '192k']],
        ['.opus', ['-c:a', 'libopus', '-b:a', '128k']],
        ['.ogg', ['-c:a', 'libvorbis', '-q:a', '5']],
        ['.oga', ['-c:a', 'libvorbis', '-q:a', '5']],
        ['.flac', ['-c:a', 'flac']],
        ['.wav', ['-c:a', 'pcm_s16le']]
    ])('keeps the format of an audio %s, without the cover', (extension, codecArgs) => {
        expect(outputFormat({ extension, kind: 'audio' }, false, 'opus')).toEqual({ extension, dropVideo: true, codecArgs });
    });

    it('leaves the encoders to ffmpeg for an audio format that is not listed', () => {
        expect(outputFormat({ extension: '.wma', kind: 'audio' }, false, 'mp3')).toEqual({ extension: '.wma', dropVideo: true, codecArgs: [] });
    });

    it.each([
        ['mp3', '.mp3', ['-c:a', 'libmp3lame', '-q:a', '2']],
        ['m4a', '.m4a', ['-c:a', 'aac', '-b:a', '192k']],
        ['opus', '.opus', ['-c:a', 'libopus', '-b:a', '128k']]
    ] as const)('turns a video into %s audio when only the audio is wanted', (audioFormat, extension, codecArgs) => {
        expect(outputFormat({ extension: '.mp4', kind: 'video' }, true, audioFormat)).toEqual({ extension, dropVideo: true, codecArgs });
    });

    it('ignores the audio-only choice for a file that is already audio', () => {
        expect(outputFormat({ extension: '.flac', kind: 'audio' }, true, 'mp3')).toEqual({ extension: '.flac', dropVideo: true, codecArgs: ['-c:a', 'flac'] });
    });
});

describe('buildCutArgs', () => {
    it('seeks before the input, takes the length after it, never writes over a file and limits the threads', () => {
        expect(
            buildCutArgs({
                input: '/in/a.mp4',
                output: '/out/a - 01.mp4',
                start: 10,
                end: 14.5,
                format: { extension: '.mp4', dropVideo: false, codecArgs: ['-c:v', 'libx264'] },
                threads: 3
            })
        ).toEqual(['-hide_banner', '-nostdin', '-n', '-v', 'error', '-stats', '-ss', '10', '-i', '/in/a.mp4', '-t', '4.5', '-c:v', 'libx264', '-threads', '3', '/out/a - 01.mp4']);
    });

    it('drops the picture for an audio file, and rounds the length to the thousandth', () => {
        const args = buildCutArgs({
            input: '/in/a.mp4',
            output: '/out/a.mp3',
            start: 0.1,
            end: 0.4,
            format: { extension: '.mp3', dropVideo: true, codecArgs: ['-c:a', 'libmp3lame'] },
            threads: 2
        });
        expect(args).toEqual(['-hide_banner', '-nostdin', '-n', '-v', 'error', '-stats', '-ss', '0.1', '-i', '/in/a.mp4', '-t', '0.3', '-vn', '-c:a', 'libmp3lame', '-threads', '2', '/out/a.mp3']);
    });

    it('uses at least one thread, and a whole number', () => {
        const base = { input: 'i', output: 'o', start: 0, end: 1, format: { extension: '.x', dropVideo: false, codecArgs: [] } };
        expect(buildCutArgs({ ...base, threads: 0 }).at(-2)).toBe('1');
        expect(buildCutArgs({ ...base, threads: 2.9 }).at(-2)).toBe('2');
    });
});

describe('clockForName', () => {
    it.each([
        [0, '0m00s'],
        [5, '0m05s'],
        [65, '1m05s'],
        [599.9, '9m59s'],
        [3600, '1h00m00s'],
        [3725, '1h02m05s']
    ])('writes %s seconds as %s', (seconds, expected) => {
        expect(clockForName(seconds)).toBe(expected);
    });
});

describe('partFileName', () => {
    it('writes the number with two digits and the times of the part', () => {
        expect(partFileName('Talk', 0, 3, 10, 14, '.mp4')).toBe('Talk - 01 (0m10s-0m14s).mp4');
        expect(partFileName('Talk', 1, 3, 94, 103, '.mp4')).toBe('Talk - 02 (1m34s-1m43s).mp4');
    });

    it('widens the number when there are a hundred parts or more', () => {
        expect(partFileName('Talk', 99, 100, 1, 2, '.mp3')).toBe('Talk - 100 (0m01s-0m02s).mp3');
        expect(partFileName('Talk', 0, 100, 1, 2, '.mp3')).toBe('Talk - 001 (0m01s-0m02s).mp3');
    });
});

describe('safeName', () => {
    it('replaces what a system does not accept in a name', () => {
        expect(safeName('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
    });

    it('replaces the control characters too', () => {
        expect(safeName('a\u0001b\u001fc')).toBe('a_b_c');
    });

    it('trims blanks and the dots at the ends, and folds spaces', () => {
        expect(safeName('  ..My   Talk..  ')).toBe('My Talk');
    });

    it('gives a name when nothing is left, and keeps a name to 120 characters', () => {
        expect(safeName('...')).toBe('cut');
        expect(safeName('')).toBe('cut');
        expect(safeName('x'.repeat(300))).toHaveLength(120);
    });
});

describe('freePath', () => {
    it('is the path itself when it is free', () => {
        expect(freePath('/out/a.mp4', () => { return false; })).toBe('/out/a.mp4');
    });

    it('puts a number before the extension until the path is free', () => {
        const taken = new Set(['/out/a.mp4', '/out/a (2).mp4']);
        expect(freePath('/out/a.mp4', (candidate) => { return taken.has(candidate); })).toBe('/out/a (3).mp4');
    });

    it('works for a name with no extension', () => {
        expect(freePath('/out/a', (candidate) => { return candidate === '/out/a'; })).toBe('/out/a (2)');
    });
});
