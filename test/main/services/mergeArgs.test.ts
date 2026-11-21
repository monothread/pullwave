import {
    buildMergeConcatList,
    buildMergeCopyArgs,
    buildMergeReencodeArgs,
    canStreamCopy,
    defaultMergeOutputName,
    isMergeOutputMode,
    isMergeVideoFormat,
    mergeMediaOf,
    parseMergeVideoProbe,
    resolveMergeOutputStem
} from '@main/services/mergeArgs';
import type { MergeMedia } from '@shared/merge';

function makeMedia(overrides: Partial<MergeMedia> = {}): MergeMedia {
    return {
        path: '/videos/clip1.mp4',
        name: 'clip1',
        extension: '.mp4',
        durationSeconds: 10,
        width: 1280,
        height: 720,
        fps: 30,
        videoCodec: 'h264',
        pixelFormat: 'yuv420p',
        videoTimebase: '15360',
        hasAudio: true,
        audioCodec: 'aac',
        audioSampleRate: 48000,
        audioChannels: 'stereo',
        streamOrder: 'va',
        ...overrides
    };
}

describe('mergeArgs validators', () => {
    it('validates supported video formats and output modes', () => {
        expect(isMergeVideoFormat('mp4')).toBe(true);
        expect(isMergeVideoFormat('mkv')).toBe(true);
        expect(isMergeVideoFormat('webm')).toBe(true);
        expect(isMergeVideoFormat('avi')).toBe(false);
        expect(isMergeVideoFormat(null)).toBe(false);

        expect(isMergeOutputMode('downloads')).toBe(true);
        expect(isMergeOutputMode('source')).toBe(true);
        expect(isMergeOutputMode('custom')).toBe(true);
        expect(isMergeOutputMode('other')).toBe(false);
        expect(isMergeOutputMode(123)).toBe(false);
    });
});

describe('parseMergeVideoProbe', () => {
    it('parses video and audio stream metadata from ffmpeg output', () => {
        const stderr = [
            'Input #0, mov,mp4,m4a,3gp,3g2,mj2, from "clip.mp4":',
            '  Duration: 00:01:23.50, start: 0.000000, bitrate: 3400 kb/s',
            '  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1920x1080 [SAR 1:1 DAR 16:9], 3200 kb/s, 29.97 fps, 29.97 tbr, 30k tbn (default)',
            '  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 192 kb/s (default)'
        ].join('\n');

        expect(parseMergeVideoProbe(stderr)).toEqual({
            ok: true,
            details: {
                durationSeconds: 83.5,
                width: 1920,
                height: 1080,
                fps: 29.97,
                videoCodec: 'h264',
                pixelFormat: 'yuv420p',
                videoTimebase: '30k',
                hasAudio: true,
                audioCodec: 'aac',
                audioSampleRate: 48000,
                audioChannels: 'stereo',
                streamOrder: 'va'
            }
        });
    });

    it('accepts a video without an audio stream', () => {
        const stderr = [
            '  Duration: 00:00:12.00, start: 0.000000',
            '  Stream #0:0: Video: vp9 (Profile 0), yuv420p(tv), 640x360, 24 fps, 24 tbr, 1k tbn'
        ].join('\n');

        expect(parseMergeVideoProbe(stderr)).toEqual({
            ok: true,
            details: {
                durationSeconds: 12,
                width: 640,
                height: 360,
                fps: 24,
                videoCodec: 'vp9',
                pixelFormat: 'yuv420p',
                videoTimebase: '1k',
                hasAudio: false,
                audioCodec: null,
                audioSampleRate: null,
                audioChannels: null,
                streamOrder: 'v'
            }
        });
    });

    it('tracks reversed audio-before-video stream order accurately', () => {
        const stderr = [
            '  Duration: 00:00:05.00, start: 0.000000',
            '  Stream #0:0: Audio: aac, 44100 Hz, mono, fltp',
            '  Stream #0:1: Video: h264 (High), yuv420p, 1280x720, 30 fps, 15360 tbn'
        ].join('\n');

        expect(parseMergeVideoProbe(stderr)).toEqual({
            ok: true,
            details: {
                durationSeconds: 5,
                width: 1280,
                height: 720,
                fps: 30,
                videoCodec: 'h264',
                pixelFormat: 'yuv420p',
                videoTimebase: '15360',
                hasAudio: true,
                audioCodec: 'aac',
                audioSampleRate: 44100,
                audioChannels: 'mono',
                streamOrder: 'av'
            }
        });
    });

    it('rejects unreadable output and audio-only files including cover art', () => {
        expect(parseMergeVideoProbe('Invalid data found')).toEqual({ ok: false, reason: 'unreadable' });

        const audioWithCover = [
            '  Duration: 00:03:00.00, start: 0.000000',
            '  Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 192 kb/s',
            '  Stream #0:1: Video: mjpeg, yuvj444p, 500x500 (attached pic)'
        ].join('\n');
        expect(parseMergeVideoProbe(audioWithCover)).toEqual({ ok: false, reason: 'not-video' });
    });

    it('builds MergeMedia metadata from path and stream details', () => {
        const media = mergeMediaOf('/dir/Movie.MKV', {
            durationSeconds: 45,
            width: 1280,
            height: 720,
            fps: 30,
            videoCodec: 'h264',
            pixelFormat: 'yuv420p',
            videoTimebase: '1k',
            hasAudio: true,
            audioCodec: 'aac',
            audioSampleRate: 48000,
            audioChannels: 'stereo',
            streamOrder: 'va'
        });
        expect(media).toEqual({
            path: '/dir/Movie.MKV',
            name: 'Movie',
            extension: '.mkv',
            durationSeconds: 45,
            width: 1280,
            height: 720,
            fps: 30,
            videoCodec: 'h264',
            pixelFormat: 'yuv420p',
            videoTimebase: '1k',
            hasAudio: true,
            audioCodec: 'aac',
            audioSampleRate: 48000,
            audioChannels: 'stereo',
            streamOrder: 'va'
        });
    });
});

describe('canStreamCopy', () => {
    it('allows stream copy only when all streams, timebases, containers, and audio specs match', () => {
        const first = makeMedia({ path: '/a.mp4' });
        const second = makeMedia({ path: '/b.mp4' });
        expect(canStreamCopy([first, second], 'mp4')).toBe(true);
        expect(canStreamCopy([first, second], 'mkv')).toBe(false);
        expect(canStreamCopy([first, second], 'webm')).toBe(false);

        const mkvA = makeMedia({ path: '/a.mkv', extension: '.mkv', videoTimebase: '1k' });
        const mkvB = makeMedia({ path: '/b.mkv', extension: '.mkv', videoTimebase: '1k' });
        expect(canStreamCopy([mkvA, mkvB], 'mkv')).toBe(true);

        const webmA = makeMedia({ path: '/a.webm', extension: '.webm', videoCodec: 'vp9', audioCodec: 'opus', videoTimebase: '1k' });
        const webmB = makeMedia({ path: '/b.webm', extension: '.webm', videoCodec: 'vp9', audioCodec: 'opus', videoTimebase: '1k' });
        expect(canStreamCopy([webmA, webmB], 'webm')).toBe(true);
        expect(canStreamCopy([webmA, webmB], 'mp4')).toBe(false);
    });

    it('disallows stream copy on mixed fps, timebases, containers, sample rates, channels, or stream orders', () => {
        const base = makeMedia();
        expect(canStreamCopy([base], 'mp4')).toBe(false);
        expect(canStreamCopy([base, makeMedia({ width: 1920, height: 1080 })], 'mp4')).toBe(false);
        expect(canStreamCopy([base, makeMedia({ videoCodec: 'hevc' })], 'mp4')).toBe(false);
        expect(canStreamCopy([base, makeMedia({ pixelFormat: 'yuv444p' })], 'mp4')).toBe(false);
        expect(canStreamCopy([base, makeMedia({ fps: 29.97 })], 'mp4')).toBe(false);
        expect(canStreamCopy([base, makeMedia({ videoTimebase: '30k' })], 'mp4')).toBe(false);
        expect(canStreamCopy([base, makeMedia({ extension: '.mkv' })], 'mp4')).toBe(false);
        expect(canStreamCopy([base, makeMedia({ hasAudio: false, audioCodec: null, audioSampleRate: null, audioChannels: null, streamOrder: 'v' })], 'mp4')).toBe(false);
        expect(canStreamCopy([base, makeMedia({ audioCodec: 'opus' })], 'mp4')).toBe(false);
        expect(canStreamCopy([base, makeMedia({ audioSampleRate: 44100 })], 'mp4')).toBe(false);
        expect(canStreamCopy([base, makeMedia({ audioChannels: 'mono' })], 'mp4')).toBe(false);
        expect(canStreamCopy([base, makeMedia({ streamOrder: 'av' })], 'mp4')).toBe(false);
        expect(canStreamCopy([makeMedia({ width: 0 }), makeMedia({ width: 0 })], 'mp4')).toBe(false);
    });
});

describe('ffmpeg merge command builders', () => {
    it('escapes single quotes in concat list files', () => {
        expect(buildMergeConcatList(["/tmp/it's a.mp4", '/tmp/b.mp4'])).toBe("file '/tmp/it'\\''s a.mp4'\nfile '/tmp/b.mp4'");
    });

    it('builds fast stream copy args with faststart for mp4 only', () => {
        expect(buildMergeCopyArgs({ listPath: '/tmp/list.txt', output: '/out/merged.mp4', format: 'mp4' })).toEqual([
            '-hide_banner',
            '-nostdin',
            '-y',
            '-v',
            'error',
            '-stats',
            '-f',
            'concat',
            '-safe',
            '0',
            '-i',
            '/tmp/list.txt',
            '-c',
            'copy',
            '-movflags',
            '+faststart',
            '/out/merged.mp4'
        ]);
        expect(buildMergeCopyArgs({ listPath: '/tmp/list.txt', output: '/out/merged.mkv', format: 'mkv' })).not.toContain('-movflags');
    });

    it('builds reencode filter_complex normalizing video and synthesizing silence for silent clips mixed with audio clips', () => {
        const withAudio = makeMedia({ path: '/a.mp4', width: 1281, height: 721, fps: 30, hasAudio: true });
        const silent = makeMedia({ path: '/b.mp4', durationSeconds: 5.5, width: 640, height: 360, fps: 15, hasAudio: false, audioCodec: null });
        const args = buildMergeReencodeArgs({ items: [withAudio, silent], output: '/out/final.mp4', format: 'mp4', threads: 4 });

        expect(args).toContain('-filter_complex');
        const filter = args[args.indexOf('-filter_complex') + 1]!;
        expect(filter).toContain('[0:v:0]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p,setpts=PTS-STARTPTS[v0]');
        expect(filter).toContain('[0:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[a0]');
        expect(filter).toContain('anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=5.5,asetpts=PTS-STARTPTS[a1]');
        expect(filter).toContain('[v0][a0][v1][a1]concat=n=2:v=1:a=1[vout][aout]');
        expect(args).toContain('-map');
        expect(args).toContain('[aout]');
        expect(args).toContain('libx264');
        expect(args).toContain('aac');
        expect(args).toContain('-movflags');
        expect(args).toContain('-threads');
        expect(args).toContain('4');
    });

    it('builds video-only reencode args when no input has audio and uses vp9/opus for webm', () => {
        const silentA = makeMedia({ path: '/a.webm', hasAudio: false, audioCodec: null });
        const silentB = makeMedia({ path: '/b.webm', hasAudio: false, audioCodec: null });
        const args = buildMergeReencodeArgs({ items: [silentA, silentB], output: '/out/final.webm', format: 'webm', threads: 2 });

        const filter = args[args.indexOf('-filter_complex') + 1]!;
        expect(filter).toContain('[v0][v1]concat=n=2:v=1:a=0[vout]');
        expect(args).not.toContain('[aout]');
        expect(args).toContain('libvpx-vp9');
        expect(args).not.toContain('libopus');
    });

    it('resolves default and custom output stems safely including names that sanitize to empty', () => {
        expect(defaultMergeOutputName('Clip 1')).toBe('Clip 1 - merged');
        expect(defaultMergeOutputName('...')).toBe('merged');
        expect(resolveMergeOutputStem('', 'Clip 1')).toBe('Clip 1 - merged');
        expect(resolveMergeOutputStem('.mp4', 'Clip 1')).toBe('Clip 1 - merged');
        expect(resolveMergeOutputStem('...', 'Clip 1')).toBe('Clip 1 - merged');
        expect(resolveMergeOutputStem('   .mkv   ', 'Clip 1')).toBe('Clip 1 - merged');
        expect(resolveMergeOutputStem('  My Compilation.mp4  ', 'Clip 1')).toBe('My Compilation');
        expect(resolveMergeOutputStem('Final:Cut?.mkv', 'Clip 1')).toBe('Final_Cut_');
    });
});
