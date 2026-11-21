import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import './display';
import { leaveHome } from './startScreen';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { installedProgramsEnv } from './programs';

const ROOT = resolve(__dirname, '../..');
const ELECTRON_PATH = createRequire(__filename)('electron') as unknown as string;
const EXE = process.platform === 'win32' ? '.exe' : '';
const FFMPEG = join(ROOT, 'resources', 'bin', `ffmpeg${EXE}`);
const HAS_FFMPEG = existsSync(FFMPEG);

let workDir: string;
let app: ElectronApplication;
let page: Page;
let downloads: string;
let videoA: string;
let videoB: string;
let silentVideo: string;

function ffmpeg(args: string[]): void {
    execFileSync(FFMPEG, ['-hide_banner', '-v', 'error', '-y', ...args], { stdio: 'pipe' });
}

function probe(path: string): { hasVideo: boolean; hasAudio: boolean } {
    let output = '';
    try {
        execFileSync(FFMPEG, ['-hide_banner', '-i', path], { stdio: 'pipe' });
    } catch (error) {
        output = String((error as { stderr?: Buffer }).stderr);
    }
    return {
        hasVideo: /Stream #\d+:\d+[^\n]*: Video:/.test(output),
        hasAudio: /Stream #\d+:\d+[^\n]*: Audio:/.test(output)
    };
}

async function launch(files: string[]): Promise<void> {
    mkdirSync(join(workDir, 'user-data'), { recursive: true });
    writeFileSync(join(workDir, 'user-data', 'settings.json'), JSON.stringify({ language: 'en', checkUpdatesOnStart: false, downloadDir: downloads, audioFormat: 'mp3' }));
    app = await electron.launch({
        executablePath: ELECTRON_PATH,
        args: [ROOT, '--no-sandbox', `--user-data-dir=${join(workDir, 'user-data')}`],
        env: { ...process.env, ...installedProgramsEnv(workDir), PULLWAVE_CONVERT_FILES: files.join(delimiter) } as Record<string, string>
    });
    page = await app.firstWindow();
    await page.setViewportSize({ width: 1100, height: 780 });
    await page.waitForSelector('.logo');
    await expect(page.getByText('// BOOTING SYSTEMS…')).toBeHidden({ timeout: 60000 });
    await leaveHome(page);
    await page.getByRole('navigation', { name: 'Video downloader' }).getByRole('button', { name: 'TOOLS' }).click();
    await page.getByRole('tab', { name: 'CONVERT' }).click();
}

test.skip(!HAS_FFMPEG, 'needs the real ffmpeg of resources/bin (node scripts/fetch-binaries.mjs)');

test.beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), 'pullwave-convert-e2e-'));
    downloads = join(workDir, 'downloads');
    mkdirSync(downloads, { recursive: true });
    videoA = join(workDir, 'First.mp4');
    videoB = join(workDir, 'Second.mp4');
    silentVideo = join(workDir, 'Silent.mp4');
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc=duration=4:size=320x240:rate=15', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', videoA]);
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x240:rate=15', '-f', 'lavfi', '-i', 'sine=frequency=523:duration=3', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', videoB]);
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x240:rate=15', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', silentVideo]);
});

test.afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
});

test.afterEach(async () => {
    await app.close();
    rmSync(downloads, { recursive: true, force: true });
    mkdirSync(downloads, { recursive: true });
});

test('converts multiple videos to audio in the chosen format and skips non-audio videos cleanly', async () => {
    await launch([videoA, silentVideo, videoB]);
    await expect(page.getByRole('region', { name: 'Convert video to audio' })).toBeVisible();
    await page.getByRole('button', { name: 'CHOOSE VIDEOS' }).click();

    await expect(page.getByTestId('convert-item')).toHaveCount(2, { timeout: 20000 });
    await expect(page.getByText('1 file(s) could not be added (not a video with audio).')).toBeVisible();

    await page.getByLabel('Audio format').selectOption('wav');
    await page.getByRole('button', { name: 'CONVERT (2)' }).click();

    await expect(page.getByText('Done: 2 audio file(s) saved.')).toBeVisible({ timeout: 60000 });
    expect(readdirSync(downloads).sort()).toEqual(['First.wav', 'Second.wav']);
    expect(probe(join(downloads, 'First.wav'))).toEqual({ hasVideo: false, hasAudio: true });
    expect(probe(join(downloads, 'Second.wav'))).toEqual({ hasVideo: false, hasAudio: true });
});

test('saves converted audio next to the source video when source output mode is chosen', async () => {
    const sourceDir = join(workDir, 'source-folder');
    mkdirSync(sourceDir, { recursive: true });
    const clip = join(sourceDir, 'SourceClip.mp4');
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x240:rate=15', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clip]);

    await launch([clip]);
    await page.getByRole('button', { name: 'CHOOSE VIDEOS' }).click();
    await expect(page.getByTestId('convert-item')).toHaveCount(1, { timeout: 20000 });
    await page.getByLabel('Save to').selectOption('source');
    await page.getByRole('button', { name: 'CONVERT (1)' }).click();

    await expect(page.getByText('Done: 1 audio file(s) saved.')).toBeVisible({ timeout: 60000 });
    expect(readdirSync(sourceDir).sort()).toEqual(['SourceClip.mp3', 'SourceClip.mp4']);
    expect(probe(join(sourceDir, 'SourceClip.mp3'))).toEqual({ hasVideo: false, hasAudio: true });
});
