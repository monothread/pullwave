import { expect, test, _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import './display';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const ELECTRON_PATH = createRequire(__filename)('electron') as unknown as string;
const FAKE_ANI_CLI = resolve(__dirname, 'fixtures/fake-ani-cli.sh');
const EXE = process.platform === 'win32' ? '.exe' : '';
const HAS_ANI_TOOLS = [`busybox${EXE}`, `curl${EXE}`, 'ani-cli'].every((name) => {
    return existsSync(join(ROOT, 'resources', 'bin', 'ani', name));
});
const LONG_TITLE = 'An extremely long title that goes on and on and on for a very long time so that it has to be cut short somewhere '.repeat(4);

let workDir: string;
let app: ElectronApplication;
let page: Page;

async function height(locator: Locator): Promise<number> {
    const box = await locator.boundingBox();
    return Math.round((box?.height ?? 0) * 10) / 10;
}

async function size(locator: Locator): Promise<{ width: number; height: number }> {
    const box = await locator.boundingBox();
    return { width: Math.round(box?.width ?? 0), height: Math.round(box?.height ?? 0) };
}

async function launch(theme: string): Promise<void> {
    workDir = mkdtempSync(join(tmpdir(), 'pullwave-buttons-e2e-'));
    const userData = join(workDir, 'user-data');
    mkdirSync(userData, { recursive: true });
    writeFileSync(join(userData, 'settings.json'), JSON.stringify({ language: 'en', theme, checkUpdatesOnStart: false }));
    writeFileSync(
        join(userData, 'history.json'),
        JSON.stringify([
            { id: 'a', url: 'https://x/1', title: LONG_TITLE, filePath: '/tmp/a.mp4', status: 'done', errorTitle: null, finishedAt: 1700000000000 },
            { id: 'b', url: 'https://x/2', title: 'Short', filePath: '/tmp/b.mp4', status: 'done', errorTitle: null, finishedAt: 1700000000000 }
        ])
    );
    app = await electron.launch({ executablePath: ELECTRON_PATH, args: [ROOT, '--no-sandbox', `--user-data-dir=${userData}`], env: { ...process.env, PULLWAVE_ANI_CLI: FAKE_ANI_CLI, PULLWAVE_ANILIST_URL: 'http://127.0.0.1:9/graphql' } });
    page = await app.firstWindow();
    await page.setViewportSize({ width: 1100, height: 780 });
    await page.waitForSelector('.logo');
    // The screens only show up once yt-dlp and ffmpeg were probed, which can take a while the first time on Windows.
    await expect(page.getByText('// BOOTING SYSTEMS…')).toBeHidden({ timeout: 60000 });
}

test.afterEach(async () => {
    await app.close();
    rmSync(workDir, { recursive: true, force: true });
});

for (const theme of ['cyberpunk', 'synthwave', 'terminal', 'dark', 'tokyo-night', 'nord', 'dracula', 'gruvbox', 'amoled', 'high-contrast', 'light', 'sakura']) {
    test.describe(`button sizes (${theme} theme)`, () => {
        test.beforeEach(async () => {
            await launch(theme);
        });

        test('the buttons beside a link are as tall as the field', async () => {
            const input = page.getByLabel('Link 1', { exact: true });
            const fieldHeight = await height(input);
            expect(fieldHeight).toBe(39);
            expect(await height(page.getByRole('button', { name: 'FOLDER' }))).toBe(fieldHeight);
            expect(await height(page.getByRole('button', { name: 'OPTIONS' }))).toBe(fieldHeight);

            await page.getByRole('button', { name: '+ ADD LINK' }).click();
            const removeButtons = await page.getByRole('button', { name: /^Remove link/ }).all();
            expect(removeButtons).toHaveLength(2);
            for (const remove of removeButtons) {
                expect(await height(remove)).toBe(fieldHeight);
            }
            expect(await height(page.getByRole('button', { name: '+ ADD LINK' }))).toBe(fieldHeight);
            expect(await height(page.getByRole('button', { name: 'DOWNLOAD', exact: true }))).toBe(fieldHeight);
        });

        test('every button of a row of the settings is as tall as the field of that row', async () => {
            await page.getByRole('button', { name: 'SETTINGS', exact: true }).click();
            const folder = page.getByLabel('Download folder', { exact: true });
            expect(await height(page.getByRole('button', { name: 'BROWSE' }).first())).toBe(await height(folder));
            const rows = await page.locator('.settings .field-row .btn').all();
            expect(rows.length).toBeGreaterThan(2);
            for (const button of rows) {
                expect(await height(button)).toBe(39);
            }
            expect(await height(page.locator('.settings select').first())).toBe(39);
        });

        test('the search of an anime lines up: field, audio and button are the same height as the tabs', async () => {
            test.skip(!HAS_ANI_TOOLS, 'the anime section needs `npm run fetch-binaries`');
            await page.getByRole('button', { name: 'ANIME', exact: true }).click();
            await page.getByRole('navigation', { name: 'Anime' }).getByRole('button', { name: 'SEARCH', exact: true }).click();
            const heights = [
                await height(page.getByLabel('Anime name')),
                await height(page.getByLabel('Audio')),
                await height(page.locator('form .btn')),
                await height(page.getByRole('button', { name: /^DOWNLOADS \(\d+\)$/ })),
                await height(page.getByRole('navigation', { name: 'Anime' }).getByRole('button').first())
            ];
            expect(new Set(heights)).toEqual(new Set([39]));
            const form = await page.locator('form .btn').boundingBox();
            const field = await page.getByLabel('Anime name').boundingBox();
            expect(form?.y).toBe(field?.y);
        });

        test('the fields of the anime settings are stacked, with the same width, and the buttons keep the height of the fields', async () => {
            test.skip(!HAS_ANI_TOOLS, 'the anime section needs `npm run fetch-binaries`');
            await page.setViewportSize({ width: 1100, height: 900 });
            await page.getByRole('button', { name: 'ANIME', exact: true }).click();
            await page.getByRole('navigation', { name: 'Anime' }).getByRole('button', { name: 'SETTINGS', exact: true }).click();
            const box = async (label: string): Promise<{ x: number; y: number; width: number; height: number }> => {
                const found = await page.getByLabel(label, { exact: true }).boundingBox();
                return { x: Math.round(found?.x ?? -1), y: Math.round(found?.y ?? -1), width: Math.round(found?.width ?? -1), height: Math.round(found?.height ?? -1) };
            };
            const quality = await box('Anime quality');
            const audio = await box('Anime audio');
            const subtitles = await box('Anime subtitles');
            // One under the other, on the same left edge and with the same width.
            expect(new Set([quality.x, audio.x, subtitles.x]).size).toBe(1);
            expect(new Set([quality.width, audio.width, subtitles.width]).size).toBe(1);
            expect(quality.y).toBeLessThan(audio.y);
            expect(audio.y).toBeLessThan(subtitles.y);
            expect(new Set([quality.height, audio.height, subtitles.height]).size).toBe(1);
            // The folder is above them, with BROWSE on its row and MIGRATE FOLDER on the row below.
            const folder = await box('Anime download folder');
            expect(folder.x).toBe(quality.x);
            expect(folder.y).toBeLessThan(quality.y);
            expect(folder.height).toBe(quality.height);
            const browse = await page.locator('.settings .panel', { hasText: 'Anime download folder' }).getByRole('button', { name: 'BROWSE' }).boundingBox();
            expect(Math.round(browse?.y ?? -1)).toBe(folder.y);
            const migrate = await page.getByRole('button', { name: 'MIGRATE FOLDER' }).boundingBox();
            expect(Math.round(migrate?.x ?? -1)).toBe(folder.x);
            expect(Math.round(migrate?.y ?? -1)).toBeGreaterThan(folder.y + folder.height);
            expect(Math.round(migrate?.y ?? -1)).toBeLessThan(quality.y);
        });

        test('the button of a history entry keeps its size however long the title is', async () => {
            await page.getByRole('button', { name: 'HISTORY', exact: true }).click();
            const buttons = page.getByRole('button', { name: 'SHOW FILE' });
            await expect(buttons).toHaveCount(2);
            const [long, short] = [await size(buttons.nth(0)), await size(buttons.nth(1))];
            expect(long).toEqual(short);
            expect(long.height).toBe(28);

            const title = page.locator('.history__title').first();
            const row = page.locator('.history__item').first();
            expect((await title.boundingBox())?.width ?? 0).toBeLessThan((await row.boundingBox())?.width ?? 0);
            expect(await title.evaluate((element) => {
                return element.scrollWidth > element.clientWidth;
            })).toBe(true);
        });
    });
}
