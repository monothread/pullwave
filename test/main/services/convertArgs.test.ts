import { CONVERT_AUDIO_FORMATS, CONVERT_OUTPUT_MODES } from '@shared/convert';
import {
    buildConvertArgs,
    CONVERT_CODECS,
    convertMediaOf,
    isConvertAudioFormat,
    isConvertOutputMode,
    parseVideoAudioProbe
} from '@main/services/convertArgs';

describe('convertArgs', () => {
    describe('parseVideoAudioProbe', () => {
        it('returns durationSeconds for a video with audio', () => {
            const stderr = [
                '  Duration: 00:02:15.50, start: 0.000000, bitrate: 1200 kb/s',
                '  Stream #0:0(und): Video: h264, yuv420p, 1920x1080',
                '  Stream #0:1(und): Audio: aac, 48000 Hz, stereo'
            ].join('\n');
            expect(parseVideoAudioProbe(stderr)).toEqual({ ok: true, durationSeconds: 135.5 });
        });

        it('rejects files without duration as unreadable', () => {
            expect(parseVideoAudioProbe('Invalid data found when processing input')).toEqual({ ok: false, reason: 'unreadable' });
        });

        it('rejects audio-only files and audio with attached cover picture as not-video', () => {
            const audioOnly = [
                '  Duration: 00:03:00.00',
                '  Stream #0:0: Audio: mp3, 44100 Hz, stereo'
            ].join('\n');
            const withCover = [
                '  Duration: 00:03:00.00',
                '  Stream #0:0: Audio: mp3, 44100 Hz, stereo',
                '  Stream #0:1: Video: mjpeg, 500x500 (attached pic)'
            ].join('\n');
            expect(parseVideoAudioProbe(audioOnly)).toEqual({ ok: false, reason: 'not-video' });
            expect(parseVideoAudioProbe(withCover)).toEqual({ ok: false, reason: 'not-video' });
        });

        it('rejects silent videos as no-audio', () => {
            const silent = [
                '  Duration: 00:01:00.00',
                '  Stream #0:0: Video: h264, yuv420p, 1280x720'
            ].join('\n');
            expect(parseVideoAudioProbe(silent)).toEqual({ ok: false, reason: 'no-audio' });
        });
    });

    describe('validators and metadata', () => {
        it('validates audio formats and output modes', () => {
            CONVERT_AUDIO_FORMATS.forEach((format) => {
                expect(isConvertAudioFormat(format)).toBe(true);
            });
            expect(isConvertAudioFormat('ogg')).toBe(false);
            expect(isConvertAudioFormat(123)).toBe(false);

            CONVERT_OUTPUT_MODES.forEach((mode) => {
                expect(isConvertOutputMode(mode)).toBe(true);
            });
            expect(isConvertOutputMode('other')).toBe(false);
            expect(isConvertOutputMode(null)).toBe(false);
        });

        it('builds media descriptor with lowercase extension', () => {
            expect(convertMediaOf('/videos/Concert.MKV', 95.25)).toEqual({
                path: '/videos/Concert.MKV',
                name: 'Concert',
                extension: '.mkv',
                durationSeconds: 95.25
            });
        });
    });

    describe('buildConvertArgs', () => {
        it('builds ffmpeg arguments for every supported audio format and clamps threads', () => {
            CONVERT_AUDIO_FORMATS.forEach((format) => {
                const args = buildConvertArgs({
                    input: '/in/video.mp4',
                    output: `/out/video.${format}`,
                    format,
                    threads: 0
                });
                expect(args).toEqual([
                    '-hide_banner',
                    '-nostdin',
                    '-y',
                    '-v',
                    'error',
                    '-stats',
                    '-i',
                    '/in/video.mp4',
                    '-vn',
                    ...CONVERT_CODECS[format],
                    '-threads',
                    '1',
                    `/out/video.${format}`
                ]);
            });
        });
    });
});
