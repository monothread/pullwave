import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import './display';
import { leaveHome } from './startScreen';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installedProgramsEnv } from './programs';

const ROOT = resolve(__dirname, '../..');
const ELECTRON_PATH = createRequire(__filename)('electron') as unknown as string;
const EXE = process.platform === 'win32' ? '.exe' : '';
const FFMPEG = join(ROOT, 'resources', 'bin', `ffmpeg${EXE}`);
const HAS_FFMPEG = existsSync(FFMPEG);

let workDir: string;
let app: ElectronApplication;
let page: Page;
let mediaDir: string;

function ffmpeg(args: string[]): void {
    execFileSync(FFMPEG, ['-hide_banner', '-v', 'error', '-y', ...args], { stdio: 'pipe' });
}

async function launch(): Promise<void> {
    mkdirSync(join(workDir, 'user-data'), { recursive: true });
    writeFileSync(join(workDir, 'user-data', 'settings.json'), JSON.stringify({ language: 'en', checkUpdatesOnStart: false, downloadDir: mediaDir, audioFormat: 'mp3' }));
    app = await electron.launch({
        executablePath: ELECTRON_PATH,
        args: [ROOT, '--no-sandbox', `--user-data-dir=${join(workDir, 'user-data')}`],
        env: { ...process.env, ...installedProgramsEnv(workDir) } as Record<string, string>
    });
    page = await app.firstWindow();
    await page.setViewportSize({ width: 1100, height: 780 });
    await page.waitForSelector('.logo');
    await expect(page.getByText('// BOOTING SYSTEMS…')).toBeHidden({ timeout: 60000 });
    await leaveHome(page);
    await page.getByRole('navigation', { name: 'Video downloader' }).getByRole('button', { name: 'EXPLORER' }).click();
}

test.skip(!HAS_FFMPEG, 'needs the real ffmpeg of resources/bin (node scripts/fetch-binaries.mjs)');

test.beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'pullwave-explorer-e2e-'));
    mediaDir = join(workDir, 'media');
    mkdirSync(join(mediaDir, 'Subfolder'), { recursive: true });
    writeFileSync(join(mediaDir, 'notes.txt'), 'hidden non-media');
    writeFileSync(join(mediaDir, 'readme.md'), 'hidden non-media');
    ffmpeg([
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=5:size=320x240:rate=15',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=5',
        '-shortest',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        join(mediaDir, 'Clip.mp4')
    ]);
    ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=523:duration=4', '-c:a', 'libmp3lame', join(mediaDir, 'Track.mp3')]);
});

test.afterEach(async () => {
    await app.close();
    rmSync(workDir, { recursive: true, force: true });
});

test('shows only folders, videos with thumbnails, and audio files, plays media by clicking the card, and supports folder creation and rename via context menu', async () => {
    await launch();
    await expect(page.getByRole('region', { name: 'Media explorer' })).toBeVisible();
    await expect(page.getByText('Clip.mp4')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Track.mp3')).toBeVisible();
    await expect(page.getByText('Subfolder')).toBeVisible();
    await expect(page.getByText('notes.txt')).toHaveCount(0);
    await expect(page.getByText('readme.md')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'OPEN FOLDER' })).toBeVisible();

    const thumb = page.locator('img.explorer__thumb-img');
    await expect(thumb).toBeVisible();
    await expect(thumb).toHaveAttribute('alt', 'Thumbnail of Clip.mp4');
    await expect(thumb).toHaveAttribute('src', /^pullwave-explorer:\/\/thumbnail\/\d+$/);
    await expect.poll(() => {
        return thumb.evaluate((img) => {
            return (img as HTMLImageElement).naturalWidth;
        });
    }, { timeout: 20000 }).toBe(320);

    await page.getByTestId('explorer-item-video').locator('.explorer__open').click();
    const player = page.getByRole('dialog', { name: 'Clip.mp4' });
    await expect(player).toBeVisible();
    await expect.poll(async () => {
        return page.getByTestId('explorer-player-video').evaluate((el) => {
            return (el as HTMLVideoElement).readyState;
        });
    }, { timeout: 15000 }).toBeGreaterThanOrEqual(2);

    await player.getByRole('button', { name: 'NEXT' }).click();
    await expect(page.getByRole('dialog', { name: 'Track.mp3' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Track.mp3' })).toHaveCount(0);

    await page.getByRole('region', { name: 'Media explorer' }).click({ button: 'right', position: { x: 20, y: 20 } });
    await page.getByRole('menu', { name: 'File actions' }).getByRole('menuitem', { name: 'New folder' }).click();
    const newFolderDialog = page.getByRole('dialog', { name: 'New folder' });
    await newFolderDialog.getByLabel('Folder name').fill('Exports');
    await newFolderDialog.getByRole('button', { name: 'CREATE' }).click();
    await expect(page.getByText('Exports')).toBeVisible();
    expect(existsSync(join(mediaDir, 'Exports'))).toBe(true);

    await page.getByTestId('explorer-item-video').click({ button: 'right' });
    await page.getByRole('menu', { name: 'File actions' }).getByRole('menuitem', { name: 'Rename' }).click();
    const renameDialog = page.getByRole('dialog', { name: 'Rename' });
    await renameDialog.getByLabel('New name').fill('RenamedClip');
    await renameDialog.getByRole('button', { name: 'RENAME' }).click();
    await expect(page.getByText('RenamedClip.mp4')).toBeVisible();
    expect(existsSync(join(mediaDir, 'RenamedClip.mp4'))).toBe(true);

    await page.getByTestId('explorer-item-video').getByRole('button', { name: 'TO AUDIO' }).click();
    await expect(page.getByRole('region', { name: 'Convert video to audio' })).toBeVisible();
    await expect(page.getByText('RenamedClip.mp4')).toBeVisible({ timeout: 20000 });
});
