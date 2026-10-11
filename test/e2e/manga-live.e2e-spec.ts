import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import './display';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readZipEntries } from '../helpers/zipEntries';

// Runs the real app with the real Suwayomi, a real extension from a real store, and an origin server (another Suwayomi) behind the extension.
// It needs the network and a server to read from, so it only runs when asked:
//   PULLWAVE_LIVE_MANGA=1
//   PULLWAVE_MANGA_ORIGIN=http://127.0.0.1:14570      a Suwayomi with a manga "Sample Manga" in its library (2 chapters, 4 pages each)
//   PULLWAVE_MANGA_TOOLS=<dir>                         a `tools` folder that has Suwayomi in it already (so it is not downloaded again)
const ROOT = resolve(__dirname, '../..');
const ELECTRON_PATH = createRequire(__filename)('electron') as unknown as string;
const ORIGIN = process.env.PULLWAVE_MANGA_ORIGIN ?? '';
const TOOLS = process.env.PULLWAVE_MANGA_TOOLS ?? '';
const STORE_URL = 'https://raw.githubusercontent.com/suwayomi/tachiyomi-extension/repo/index.min.json';

test.skip(process.env.PULLWAVE_LIVE_MANGA !== '1' || ORIGIN === '' || !existsSync(TOOLS), 'set PULLWAVE_LIVE_MANGA=1, PULLWAVE_MANGA_ORIGIN and PULLWAVE_MANGA_TOOLS to run this');
test.setTimeout(240000);

let workDir: string;
let app: ElectronApplication;
let page: Page;

async function originPage(chapterId: number, index: number): Promise<Buffer> {
    const response = await fetch(`${ORIGIN}/api/v1/manga/1/chapter/${chapterId}/page/${index}`);
    expect(response.status).toBe(200);
    return Buffer.from(await response.arrayBuffer());
}

test.beforeEach(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'pullwave-manga-live-'));
    const userData = join(workDir, 'userData');
    mkdirSync(join(userData, 'manga'), { recursive: true });
    // The program is shared, not copied: it is large and nothing here changes it.
    symlinkSync(TOOLS, join(userData, 'manga', 'tools'));
    writeFileSync(join(userData, 'settings.json'), JSON.stringify({ language: 'en', checkUpdatesOnStart: false, downloadDir: join(workDir, 'downloads'), mangaDirectory: join(workDir, 'manga') }));
    app = await electron.launch({ executablePath: ELECTRON_PATH, args: [ROOT, '--no-sandbox', `--user-data-dir=${userData}`], env: { ...process.env, PULLWAVE_E2E_LIVE: '1' } });
    page = await app.firstWindow();
    await page.waitForSelector('.logo');
    await expect(page.getByText('// BOOTING SYSTEMS…')).toBeHidden({ timeout: 60000 });
});

test.afterEach(async () => {
    await app.close();
    rmSync(workDir, { recursive: true, force: true });
});

test('installs the Suwayomi extension from its store, sets its source up and downloads a manga through it', async () => {
    await page.getByRole('button', { name: 'MANGA', exact: true }).click();
    // The program is there already, so the section opens on the browse (no preparation screen).
    await expect(page.getByText('PREPARING THE MANGA SERVER')).toHaveCount(0);
    const nav = page.getByRole('navigation', { name: 'Manga' });

    // The store and the extension.
    await nav.getByRole('button', { name: 'EXTENSIONS', exact: true }).click();
    await page.getByLabel('Address of a store (index.min.json)').fill(STORE_URL);
    await page.getByRole('button', { name: 'ADD', exact: true }).click();
    await expect(page.getByText('Suwayomi Extension Repo')).toBeVisible({ timeout: 90000 });
    await page.getByRole('button', { name: 'INSTALL: Suwayomi', exact: true }).click();
    await expect(page.getByText('INSTALLED', { exact: true })).toBeVisible({ timeout: 90000 });

    // The source of the extension is in the list of sources. It has nothing to show until it is told which server to read: the error says so.
    await nav.getByRole('button', { name: 'BROWSE', exact: true }).click();
    await expect(page.getByTestId('manga-source')).toContainText('Suwayomi');
    await page.getByRole('button', { name: /^POPULAR: Suwayomi/ }).click();
    await expect(page.getByRole('alert')).toHaveText('The site or the extension reported an error.', { timeout: 60000 });
    await expect(page.getByText('This source may need to be set up first: open SOURCE SETTINGS.')).toBeVisible();

    // The settings of the source are a screen of their own, reached by the gear of its page.
    await page.getByRole('button', { name: 'SOURCE SETTINGS' }).click();
    const address = page.getByLabel('Server URL Address');
    await expect(address).toBeVisible();
    await expect(address).toHaveValue('');
    await address.fill(ORIGIN);
    await address.press('Enter');
    await expect(address).toHaveValue(ORIGIN);
    await page.getByRole('button', { name: 'CLOSE' }).click();
    await expect(page.getByRole('button', { name: 'Open: Sample Manga' })).toBeVisible({ timeout: 60000 });
    await expect(page.getByRole('alert')).toHaveCount(0);

    // The manga, newest chapter first.
    await page.getByRole('button', { name: 'Open: Sample Manga' }).click();
    await expect(page.getByText('Chapters (2)')).toBeVisible({ timeout: 60000 });
    const chapters = page.locator('.manga__chapters label.toggle');
    await expect(chapters).toHaveText(['Chapter 2', 'Chapter 1']);
    await page.getByRole('button', { name: 'ALL' }).click();
    await page.getByRole('button', { name: 'DOWNLOAD SELECTED (2)' }).click();
    await expect(page.getByRole('button', { name: 'DOWNLOADS (0)' })).toBeVisible({ timeout: 120000 });

    // What was made: a CBZ per chapter with the four pages, byte for byte what the origin gave, and the ComicInfo.
    const folder = join(workDir, 'manga', 'Sample Manga');
    await expect.poll(() => {return (existsSync(folder) ? readdirSync(folder).sort() : [])}).toEqual(['Chapter 1.cbz', 'Chapter 2.cbz']);
    for (const [chapterNumber, chapterId] of [
        [1, 1],
        [2, 2]
    ] as const) {
        const entries = readZipEntries(readFileSync(join(folder, `Chapter ${chapterNumber}.cbz`)));
        expect(entries.map((entry) => {return entry.name})).toEqual(['001.png', '002.png', '003.png', '004.png', 'ComicInfo.xml']);
        for (let index = 0; index < 4; index += 1) {
            expect(entries[index]!.data.equals(await originPage(chapterId, index))).toBe(true);
        }
        const info = entries[4]!.data.toString('utf-8');
        expect(info).toContain('<Series>Sample Manga</Series>');
        expect(info).toContain(`<Number>${chapterNumber}</Number>`);
        expect(info).toContain('<PageCount>4</PageCount>');
    }
    expect(readdirSync(folder).some((name) => {return name.endsWith('.part') || name.endsWith('.tmp')})).toBe(false);

    // The library has it, with the cover from the server.
    await nav.getByRole('button', { name: 'LIBRARY', exact: true }).click();
    const entry = page.getByTestId('manga-entry');
    await expect(entry.getByRole('heading', { name: 'Sample Manga' })).toBeVisible();
    await expect(entry.getByText('2 of 2 downloaded')).toBeVisible();
    // The cover is an image the page could load (the policy of the page lets the manga server's images in).
    const cover = entry.locator('img.cover');
    await expect(cover).toBeVisible();
    await expect.poll(() => {return cover.evaluate((image: HTMLImageElement) => {return image.complete && image.naturalWidth > 0})}).toBe(true);
});
