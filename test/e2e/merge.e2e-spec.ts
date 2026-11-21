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
let clipA: string;
let clipB: string;
let differentSilentClip: string;

function ffmpeg(args: string[]): void {
    execFileSync(FFMPEG, ['-hide_banner', '-v', 'error', '-y', ...args], { stdio: 'pipe' });
}

function probe(path: string): { seconds: number; hasVideo: boolean; hasAudio: boolean } {
    let output = '';
    try {
        execFileSync(FFMPEG, ['-hide_banner', '-i', path], { stdio: 'pipe' });
    } catch (error) {
        output = String((error as { stderr?: Buffer }).stderr);
    }
    const duration = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(output);
    return {
        seconds: duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : -1,
        hasVideo: /Stream #\d+:\d+[^\n]*: Video:/.test(output),
        hasAudio: /Stream #\d+:\d+[^\n]*: Audio:/.test(output)
    };
}

async function launch(files: string[]): Promise<void> {
    mkdirSync(join(workDir, 'user-data'), { recursive: true });
    writeFileSync(join(workDir, 'user-data', 'settings.json'), JSON.stringify({ language: 'en', checkUpdatesOnStart: false, downloadDir: downloads, videoContainer: 'mp4' }));
    app = await electron.launch({
        executablePath: ELECTRON_PATH,
        args: [ROOT, '--no-sandbox', `--user-data-dir=${join(workDir, 'user-data')}`],
        env: { ...process.env, ...installedProgramsEnv(workDir), PULLWAVE_MERGE_FILES: files.join(delimiter) } as Record<string, string>
    });
    page = await app.firstWindow();
    await page.setViewportSize({ width: 1100, height: 780 });
    await page.waitForSelector('.logo');
    await expect(page.getByText('// BOOTING SYSTEMS…')).toBeHidden({ timeout: 60000 });
    await leaveHome(page);
    await page.getByRole('navigation', { name: 'Video downloader' }).getByRole('button', { name: 'TOOLS' }).click();
    await page.getByRole('tab', { name: 'MERGE' }).click();
}

test.skip(!HAS_FFMPEG, 'needs the real ffmpeg of resources/bin (node scripts/fetch-binaries.mjs)');

test.beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), 'pullwave-merge-e2e-'));
    downloads = join(workDir, 'downloads');
    mkdirSync(downloads, { recursive: true });
    clipA = join(workDir, 'PartOne.mp4');
    clipB = join(workDir, 'PartTwo.mp4');
    differentSilentClip = join(workDir, 'Different.mp4');
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x240:rate=15', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clipA]);
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc=duration=4:size=320x240:rate=15', '-f', 'lavfi', '-i', 'sine=frequency=523:duration=4', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clipB]);
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=duration=2:size=640x360:rate=24', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', differentSilentClip]);
});

test.afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
});

test.afterEach(async () => {
    await app.close();
    rmSync(downloads, { recursive: true, force: true });
    mkdirSync(downloads, { recursive: true });
});

test('reorders compatible videos and merges them quickly via fast copy', async () => {
    await launch([clipA, clipB]);
    await expect(page.getByRole('region', { name: 'Merge videos' })).toBeVisible();
    await page.getByRole('button', { name: 'CHOOSE VIDEOS' }).click();

    await expect(page.getByTestId('merge-item')).toHaveCount(2, { timeout: 20000 });
    await page.getByRole('button', { name: 'Move up: PartTwo.mp4' }).click();
    await expect(page.getByTestId('merge-item').first()).toContainText('PartTwo.mp4');

    await page.getByRole('button', { name: 'MERGE (2)' }).click();
    await expect(page.getByText('Done: PartTwo - merged.mp4 saved.')).toBeVisible({ timeout: 60000 });
    await expect(page.getByText('FAST COPY')).toBeVisible();

    expect(readdirSync(downloads).sort()).toEqual(['PartTwo - merged.mp4']);
    const info = probe(join(downloads, 'PartTwo - merged.mp4'));
    expect(info.hasVideo).toBe(true);
    expect(info.hasAudio).toBe(true);
    expect(info.seconds).toBeGreaterThan(6.5);
    expect(info.seconds).toBeLessThan(7.5);
});

test('automatically re-encodes incompatible videos and saves with custom name in source folder', async () => {
    const sourceDir = join(workDir, 'mixed-source');
    mkdirSync(sourceDir, { recursive: true });
    const first = join(sourceDir, 'Intro.mp4');
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x240:rate=15', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', first]);

    await launch([first, differentSilentClip]);
    await page.getByRole('button', { name: 'CHOOSE VIDEOS' }).click();
    await expect(page.getByTestId('merge-item')).toHaveCount(2, { timeout: 20000 });

    await page.getByLabel('Output file name').fill('FullReel');
    await page.getByLabel('Save to').selectOption('source');
    await page.getByRole('button', { name: 'MERGE (2)' }).click();

    await expect(page.getByText('Done: FullReel.mp4 saved.')).toBeVisible({ timeout: 60000 });
    await expect(page.getByText('RE-ENCODE')).toBeVisible();

    const mergedPath = join(sourceDir, 'FullReel.mp4');
    expect(existsSync(mergedPath)).toBe(true);
    const info = probe(mergedPath);
    expect(info.hasVideo).toBe(true);
    expect(info.hasAudio).toBe(true);
    expect(info.seconds).toBeGreaterThan(4.5);
    expect(info.seconds).toBeLessThan(5.6);
});
