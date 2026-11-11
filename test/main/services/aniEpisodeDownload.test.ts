import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { AniDownloadProgress } from '@shared/anime';
import { asDownloadResult, runAniCli, type AniRunHandle } from '@main/services/aniCliRunner';
import { cleanTempDirs, makeTempDir } from '../../helpers/tempDir';

// The download of an episode whose audio is a track of its own, run for real: the busybox of the app runs pullwave-run.sh, which sources a
// script holding the `download()` function of the ani-cli the app pins (it calls ffmpeg -stats -i <picture> -i <audio> ... <file>), and the
// yt-dlp and ffmpeg of the tests download and join a picture and an audio served as HLS on 127.0.0.1. Nothing leaves the machine.

const ROOT = process.cwd();
const RUNNER = join(ROOT, 'resources', 'ani-scripts', 'pullwave-run.sh');
const BUSYBOX = join(ROOT, 'resources', 'bin', 'ani', 'busybox');
const ANI_CLI = join(ROOT, 'resources', 'bin', 'ani', 'ani-cli');
const YTDLP = join(ROOT, 'resources', 'bin', 'yt-dlp');
const FFMPEG = join(ROOT, 'resources', 'bin', 'ffmpeg');
const FFPROBE = join(ROOT, 'resources', 'bin', 'ffprobe');
const AVAILABLE = process.platform !== 'win32' && [RUNNER, BUSYBOX, ANI_CLI, YTDLP, FFMPEG, FFPROBE].every(existsSync);
// 20 s of picture at 25 frames a second, in pieces of 4 s.
const FRAMES = 500;
const TITLE = 'Kaiju Episode 1';

let hlsDir = '';
let server: Server | null = null;
let baseUrl = '';
// While set, a piece answers 500 for that many milliseconds after it is first asked for (a hiccup of the server).
let flaky: { name: string; windowMs: number; firstHitAt: number | null } | null = null;

function serve(request: IncomingMessage, response: ServerResponse): void {
    const name = (request.url ?? '/').split('?')[0]?.slice(1) ?? '';
    if (flaky !== null && name === flaky.name) {
        const now = Date.now();
        flaky.firstHitAt = flaky.firstHitAt ?? now;
        if (now - flaky.firstHitAt < flaky.windowMs) {
            response.writeHead(500);
            response.end();
            return;
        }
    }
    const file = join(hlsDir, name);
    if (!existsSync(file)) {
        response.writeHead(404);
        response.end();
        return;
    }
    response.end(readFileSync(file));
}

// The download function of the pinned ani-cli, as it is.
function downloadFunction(): string {
    const match = /^download\(\) \{\n[\s\S]*?\n\}\n/m.exec(readFileSync(ANI_CLI, 'utf-8'));
    if (match === null) {
        throw new Error('download() is not in the pinned ani-cli');
    }
    return match[0];
}

// The tools ani-cli finds, as the app links them: yt-dlp, ffmpeg, ffprobe and the applets of busybox the stand-in uses.
function toolsDir(): string {
    const tools = makeTempDir();
    symlinkSync(YTDLP, join(tools, 'yt-dlp'));
    symlinkSync(FFMPEG, join(tools, 'ffmpeg'));
    symlinkSync(FFPROBE, join(tools, 'ffprobe'));
    ['tr', 'printf', 'sed', 'mv', 'rm'].forEach((applet) => {
        symlinkSync(BUSYBOX, join(tools, applet));
    });
    return tools;
}

function script(outDir: string, picture: string, audio: string): string {
    const file = join(makeTempDir(), 'ani-cli');
    const body = ['#!/bin/sh', `download_dir="${outDir}"`, `tmp_dir="${outDir}"`, `refr="${baseUrl}/"`, `audio_link="${audio}"`, 'sub_link=""', downloadFunction(), `download "${picture}" "${TITLE}"`];
    writeFileSync(file, `${body.join('\n')}\n`);
    return file;
}

function start(outDir: string, progress: AniDownloadProgress[], picture = `${baseUrl}/v.m3u8`, audio = `${baseUrl}/a.m3u8`): AniRunHandle {
    return runAniCli({
        binary: BUSYBOX,
        args: ['sh', RUNNER, script(outDir, picture, audio)],
        env: { PATH: toolsDir(), HOME: makeTempDir() },
        onProgress: (value) => {
            progress.push(value);
        }
    });
}

function streams(file: string): { video: number; audio: number } {
    const count = (kind: 'v' | 'a'): number => {
        const output = execFileSync(FFPROBE, ['-v', 'error', '-select_streams', kind, '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf-8' });
        return Number(output.trim() || '0');
    };
    return { video: count('v'), audio: count('a') };
}

const EPISODE = (outDir: string): string => {
    return join(outDir, `${TITLE}.mp4`);
};

describe.skipIf(!AVAILABLE)('the download of an episode whose audio is a track of its own', () => {
    beforeAll(async () => {
        hlsDir = makeTempDir();
        execFileSync(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=25', '-t', '20', '-c:v', 'mpeg2video', '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod', join(hlsDir, 'v.m3u8')]);
        execFileSync(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=f=440', '-t', '20', '-c:a', 'aac', '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod', join(hlsDir, 'a.m3u8')]);
        server = createServer(serve);
        await new Promise<void>((resolve) => {
            server?.listen(0, '127.0.0.1', resolve);
        });
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => {
            server?.close(() => {
                resolve();
            });
        });
        cleanTempDirs();
    });

    afterEach(() => {
        flaky = null;
    });

    it('downloads the picture and the audio with yt-dlp, joins them into the file of the episode and leaves nothing else', async () => {
        const outDir = makeTempDir();
        const progress: AniDownloadProgress[] = [];
        const result = await start(outDir, progress).result;
        expect(result.status).toBe('done');
        const outcome = result.status === 'done' ? result.value : null;
        expect(outcome).toMatchObject({ exitCode: 0, downloadFailed: false, destination: EPISODE(outDir) });
        expect(outcome === null ? null : asDownloadResult(outcome).status).toBe('done');
        expect(streams(EPISODE(outDir))).toMatchObject({ video: FRAMES });
        expect(streams(EPISODE(outDir)).audio).toBeGreaterThan(0);
        expect(readdirSync(outDir)).toEqual([`${TITLE}.mp4`]);
        expect(progress.length).toBeGreaterThan(0);
        expect(progress.at(-1)?.percent).toBe(100);
    }, 60_000);

    it('finishes, without asking anything, when the file of the episode is already there (a try before was stopped)', async () => {
        const outDir = makeTempDir();
        writeFileSync(EPISODE(outDir), 'half of an earlier download');
        const result = await start(outDir, []).result;
        expect(result.status === 'done' && asDownloadResult(result.value).status).toBe('done');
        expect(streams(EPISODE(outDir))).toMatchObject({ video: FRAMES });
    }, 60_000);

    it('asks again for a piece of the picture the server refuses for a while, and the file has the whole picture', async () => {
        flaky = { name: 'v2.ts', windowMs: 1500, firstHitAt: null };
        const outDir = makeTempDir();
        const result = await start(outDir, []).result;
        expect(flaky.firstHitAt).not.toBeNull();
        expect(result.status === 'done' && asDownloadResult(result.value).status).toBe('done');
        expect(streams(EPISODE(outDir))).toMatchObject({ video: FRAMES });
    }, 60_000);

    it('asks again for a piece of the audio the server refuses for a while', async () => {
        flaky = { name: 'a1.ts', windowMs: 1500, firstHitAt: null };
        const outDir = makeTempDir();
        const result = await start(outDir, []).result;
        expect(flaky.firstHitAt).not.toBeNull();
        expect(result.status === 'done' && asDownloadResult(result.value).status).toBe('done');
        expect(streams(EPISODE(outDir)).audio).toBeGreaterThan(0);
    }, 60_000);

    it('says the download failed when the audio cannot be had, leaves no file of the episode and keeps the picture for the next try', async () => {
        const outDir = makeTempDir();
        const result = await start(outDir, [], `${baseUrl}/v.m3u8`, `${baseUrl}/missing.m3u8`).result;
        expect(result.status).toBe('done');
        const outcome = result.status === 'done' ? result.value : null;
        // Here the script ends with what download() gave back; the real ani-cli ends well whatever it was, so the line of the stand-in is what tells.
        expect(outcome).toMatchObject({ exitCode: 1, downloadFailed: true, destination: join(outDir, `${TITLE}.mp4.video.mp4`) });
        const checked = outcome === null ? null : asDownloadResult(outcome);
        expect(checked?.status).toBe('error');
        expect(checked?.status === 'error' ? checked.error.code : null).toBe('NETWORK');
        expect(existsSync(EPISODE(outDir))).toBe(false);
        expect(readdirSync(outDir)).toEqual([`${TITLE}.mp4.video.mp4`]);
    }, 60_000);

    it('says the download failed, and leaves no file of the episode, when an episode without an audio track of its own cannot be had', async () => {
        // ani-cli tries yt-dlp first and, when it fails, ffmpeg with the picture alone: the stand-in tries yt-dlp again and says it failed.
        const outDir = makeTempDir();
        const result = await start(outDir, [], `${baseUrl}/missing.m3u8`, '').result;
        const outcome = result.status === 'done' ? result.value : null;
        expect(outcome?.downloadFailed).toBe(true);
        const checked = outcome === null ? null : asDownloadResult(outcome);
        expect(checked?.status === 'error' ? checked.error.code : null).toBe('NETWORK');
        expect(existsSync(EPISODE(outDir))).toBe(false);
    }, 60_000);

    it('downloads an episode without an audio track of its own with the yt-dlp of ani-cli, as it is', async () => {
        const outDir = makeTempDir();
        const result = await start(outDir, [], `${baseUrl}/v.m3u8`, '').result;
        const outcome = result.status === 'done' ? result.value : null;
        expect(outcome).toMatchObject({ exitCode: 0, downloadFailed: false, destination: EPISODE(outDir) });
        expect(outcome === null ? null : asDownloadResult(outcome).status).toBe('done');
        expect(streams(EPISODE(outDir))).toMatchObject({ video: FRAMES, audio: 0 });
    }, 60_000);

    it('downloads the picture alone into the file when ffmpeg is given one input', async () => {
        const outDir = makeTempDir();
        const file = join(makeTempDir(), 'ani-cli');
        writeFileSync(file, `#!/bin/sh\nffmpeg -referer "${baseUrl}/" -loglevel error -stats -i "${baseUrl}/v.m3u8" -c copy "${EPISODE(outDir)}"\n`);
        const result = await runAniCli({ binary: BUSYBOX, args: ['sh', RUNNER, file], env: { PATH: toolsDir(), HOME: makeTempDir() } }).result;
        expect(result.status === 'done' ? result.value : null).toMatchObject({ exitCode: 0, downloadFailed: false, destination: EPISODE(outDir) });
        expect(streams(EPISODE(outDir))).toMatchObject({ video: FRAMES, audio: 0 });
    }, 60_000);
});
