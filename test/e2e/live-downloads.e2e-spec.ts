import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import './display';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Runs the real yt-dlp (the one in resources/bin) against archive.org and the real ani-cli against its source: pausing, closing the app
// with downloads going on, resuming after opening it again, and how many downloads run at a time. It needs the network and
// `npm run fetch-binaries`, and can fail because of the sources, so it is left out unless PULLWAVE_LIVE=1.
const ROOT = resolve(__dirname, '../..');
const ELECTRON_PATH = createRequire(__filename)('electron') as unknown as string;
const EXE = process.platform === 'win32' ? '.exe' : '';
const HAS_TOOLS = [join('ani', `busybox${EXE}`), join('ani', `curl${EXE}`), join('ani', 'ani-cli'), `yt-dlp${EXE}`, `ffmpeg${EXE}`].every((name) => {
    return existsSync(join(ROOT, 'resources', 'bin', name));
});

test.skip(process.env.PULLWAVE_LIVE !== '1' || !HAS_TOOLS, 'set PULLWAVE_LIVE=1 (needs the network and `npm run fetch-binaries`)');
test.describe.configure({ mode: 'serial' });
test.setTimeout(240000);

// Public-domain films of the Internet Archive: two short ones (about 26 MB) and a long one, which only has to be started.
const SHORT_A = 'https://archive.org/details/Popeye_forPresident';
const SHORT_B = 'https://archive.org/details/Popeye_Nearlyweds';
const LONG = 'https://archive.org/details/BigBuckBunny_328';
// The Internet Archive chooses the format of the file, so the name of the finished one is found by its beginning.
const SHORT_A_PREFIX = 'Popeye for President [Popeye_forPresident].';
const ANIME = 'Cyberpunk: Edgerunners';
const ANIME_FOLDER = 'Cyberpunk_ Edgerunners';
// Slow enough to be paused or closed while it runs, in a film of 26 MB.
const SLOW = '300K';
const FAST = '8M';

interface Running {
    app: ElectronApplication;
    page: Page;
}

let workDir: string;
let userData: string;
let downloadDir: string;
let animeDir: string;

function writeSettings(settings: Record<string, unknown>): void {
    mkdirSync(userData, { recursive: true });
    writeFileSync(
        join(userData, 'settings.json'),
        JSON.stringify({ language: 'en', checkUpdatesOnStart: false, verifyLiveEnd: false, animeQuality: 'worst', downloadDir, animeDownloadDir: animeDir, ...settings })
    );
}

async function open(): Promise<Running> {
    const app = await electron.launch({ executablePath: ELECTRON_PATH, args: [ROOT, '--no-sandbox', `--user-data-dir=${userData}`] });
    const page = await app.firstWindow();
    await page.waitForSelector('.logo');
    await expect(page.getByText('// BOOTING SYSTEMS…')).toBeHidden({ timeout: 60000 });
    return { app, page };
}

test.beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'pullwave-live-downloads-'));
    userData = join(workDir, 'user-data');
    downloadDir = join(workDir, 'downloads');
    animeDir = join(workDir, 'anime');
    mkdirSync(downloadDir, { recursive: true });
});

test.afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
});

function filesIn(folder: string): string[] {
    return existsSync(folder) ? readdirSync(folder).sort() : [];
}

function unfinishedIn(folder: string): string[] {
    return filesIn(folder).filter((name) => {
        return /\.(part|ytdl)$|\.part-Frag\d+/.test(name);
    });
}

// The finished file of the film, or an empty text while there is none.
function finishedFileIn(folder: string): string {
    return (
        filesIn(folder).find((name) => {
            return name.startsWith(SHORT_A_PREFIX) && !/\.(part|ytdl)$|\.part-Frag\d+/.test(name);
        }) ?? ''
    );
}

function sizeOf(path: string): number {
    return existsSync(path) ? statSync(path).size : 0;
}

async function submitUrl(page: Page, url: string): Promise<void> {
    await page.getByLabel('Link 1', { exact: true }).fill(url);
    await page.getByRole('button', { name: 'DOWNLOAD', exact: true }).click();
}

// The first unfinished file of the downloads folder once it has something in it: the download is under way.
async function waitForBytes(folder: string): Promise<string> {
    let found = '';
    await expect
        .poll(
            () => {
                found =
                    unfinishedIn(folder).find((name) => {
                        return sizeOf(join(folder, name)) > 100_000;
                    }) ?? '';
                return found;
            },
            { timeout: 90000, intervals: [500] }
        )
        .not.toBe('');
    return found;
}

function pausedList(): Array<{ job: { url: string; status: string } }> {
    return JSON.parse(readFileSync(join(userData, 'paused.json'), 'utf-8')) as Array<{ job: { url: string; status: string } }>;
}

test.describe('video downloads with the real yt-dlp', () => {
    test('closing the app cancels a download that is running and deletes its unfinished files', async () => {
        writeSettings({ rateLimit: SLOW, deletePartialsOnFailure: false });
        const { app, page } = await open();
        await submitUrl(page, SHORT_A);
        await expect(page.getByTestId('job-card').locator('.badge')).toHaveText('DOWNLOADING');
        await waitForBytes(downloadDir);

        await app.close();

        expect(filesIn(downloadDir)).toEqual([]);
        expect(existsSync(join(userData, 'paused.json'))).toBe(false);

        writeSettings({ rateLimit: SLOW, deletePartialsOnFailure: false });
        const again = await open();
        await expect(again.page.getByTestId('job-card')).toHaveCount(0);
        await again.app.close();
    });

    test('a paused download survives closing the app, and goes on from its partial file when it is resumed', async () => {
        writeSettings({ rateLimit: SLOW });
        const first = await open();
        await submitUrl(first.page, SHORT_A);
        const partial = await waitForBytes(downloadDir);
        await first.page.getByTestId('job-card').getByRole('button', { name: 'PAUSE' }).click();
        await expect(first.page.getByTestId('job-card').locator('.badge')).toHaveText('PAUSED');
        const sizeWhenPaused = sizeOf(join(downloadDir, partial));
        expect(sizeWhenPaused).toBeGreaterThan(100_000);
        expect(pausedList()).toMatchObject([{ job: { url: SHORT_A, status: 'paused' } }]);

        await first.app.close();

        // The pause is kept, with its unfinished file, and nothing is deleted.
        expect(sizeOf(join(downloadDir, partial))).toBe(sizeWhenPaused);
        expect(pausedList()).toMatchObject([{ job: { url: SHORT_A, status: 'paused' } }]);

        writeSettings({ rateLimit: FAST });
        const second = await open();
        const card = second.page.getByTestId('job-card');
        await expect(card.locator('.badge')).toHaveText('PAUSED');
        await expect(card.getByText('unfinished files were not found')).toHaveCount(0);

        await card.getByRole('button', { name: 'RESUME' }).click();

        // yt-dlp goes on from where it was: the partial file never gets smaller than it was when it was paused.
        const sizes: number[] = [];
        try {
            await expect
                .poll(
                    () => {
                        sizes.push(sizeOf(join(downloadDir, partial)));
                        return finishedFileIn(downloadDir) !== '' && unfinishedIn(downloadDir).length === 0;
                    },
                    { timeout: 120000, intervals: [100] }
                )
                .toBe(true);
        } catch (error) {
            const state = await card.allInnerTexts().catch(() => {
                return [];
            });
            throw new Error(`${String(error)}\nfiles: ${JSON.stringify(filesIn(downloadDir))}\ncard: ${JSON.stringify(state)}\npartial: ${partial}\nlast sizes: ${JSON.stringify(sizes.slice(-5))}`, { cause: error });
        }
        const whileDownloading = sizes.filter((size) => {
            return size > 0;
        });
        expect(whileDownloading.length).toBeGreaterThan(0);
        expect(Math.min(...whileDownloading)).toBeGreaterThanOrEqual(sizeWhenPaused);
        expect(sizeOf(join(downloadDir, finishedFileIn(downloadDir)))).toBeGreaterThan(20_000_000);
        await expect(second.page.getByTestId('job-card')).toHaveCount(0);
        await second.app.close();
    });

    test('closing the app right after pausing keeps the download as paused', async () => {
        writeSettings({ rateLimit: SLOW });
        const first = await open();
        await submitUrl(first.page, SHORT_A);
        const partial = await waitForBytes(downloadDir);
        await first.page.getByTestId('job-card').getByRole('button', { name: 'PAUSE' }).click();

        // Not waiting for the card to say PAUSED: the app is closed while the process is still being ended.
        await first.app.close();

        expect(pausedList()).toMatchObject([{ job: { url: SHORT_A, status: 'paused' } }]);
        expect(sizeOf(join(downloadDir, partial))).toBeGreaterThan(100_000);

        writeSettings({ rateLimit: SLOW });
        const second = await open();
        await expect(second.page.getByTestId('job-card').locator('.badge')).toHaveText('PAUSED');
        await expect(second.page.getByTestId('job-card').getByRole('button', { name: 'RESUME' })).toBeVisible();
        await second.app.close();
    });

    test('a paused download whose partial file was deleted says that RESUME starts it over', async () => {
        writeSettings({ rateLimit: SLOW });
        const first = await open();
        await submitUrl(first.page, SHORT_A);
        await waitForBytes(downloadDir);
        await first.page.getByTestId('job-card').getByRole('button', { name: 'PAUSE' }).click();
        await expect(first.page.getByTestId('job-card').locator('.badge')).toHaveText('PAUSED');
        await first.app.close();
        unfinishedIn(downloadDir).forEach((name) => {
            rmSync(join(downloadDir, name));
        });

        const second = await open();

        await expect(second.page.getByTestId('job-card').locator('.badge')).toHaveText('PAUSED');
        await expect(second.page.getByText('The unfinished files were not found: RESUME starts this download over.')).toBeVisible();
        await second.app.close();
    });

    test('runs two downloads at a time and keeps the third waiting, and closing the app deletes the files of the two', async () => {
        writeSettings({ rateLimit: SLOW });
        const { app, page } = await open();
        await submitUrl(page, SHORT_A);
        await submitUrl(page, SHORT_B);
        await submitUrl(page, LONG);

        const badges = page.getByTestId('job-card').locator('.badge');
        await expect(badges).toHaveText(['DOWNLOADING', 'DOWNLOADING', 'QUEUED']);
        await expect
            .poll(
                () => {
                    return unfinishedIn(downloadDir).filter((name) => {
                        return sizeOf(join(downloadDir, name)) > 0 && /\.part$/.test(name);
                    }).length;
                },
                { timeout: 90000, intervals: [500] }
            )
            .toBe(2);

        await app.close();

        expect(filesIn(downloadDir)).toEqual([]);
    });
});

test.describe('anime downloads with the real ani-cli', () => {
    async function openFirstEpisodes(page: Page, episodes: number): Promise<void> {
        await page.getByRole('button', { name: 'ANIME', exact: true }).click();
        await page.getByRole('navigation', { name: 'Anime' }).getByRole('button', { name: 'SEARCH', exact: true }).click();
        await page.getByLabel('Anime name').fill('cyberpunk edgerunners');
        await page.getByLabel('Anime name').press('Enter');
        await page.getByRole('button', { name: `OPEN: ${ANIME}`, exact: true }).click({ timeout: 60000 });
        await expect(page.getByRole('button', { name: 'EP 1', exact: true })).toBeVisible({ timeout: 60000 });
        // The episodes are asked for in the library, where the anime goes first.
        await page.getByRole('button', { name: 'ADD TO LIBRARY', exact: true }).click();
        await page.getByRole('button', { name: 'CONFIRM' }).click();
        await page.getByRole('button', { name: 'VIEW IN LIBRARY', exact: true }).click();
        await page.getByRole('button', { name: `SHOW EPISODES: ${ANIME}`, exact: true }).click();
        for (let episode = 1; episode <= episodes; episode += 1) {
            await page.getByRole('button', { name: `DOWNLOAD: ${ANIME} EP ${episode}`, exact: true }).click();
        }
        await page.getByRole('button', { name: /^DOWNLOADS \(\d+\)$/ }).click();
    }

    function episodeFolder(episode: number): string {
        return join(animeDir, ANIME_FOLDER, 'Season 1', `Episode ${episode}`);
    }

    async function waitForAnyBytes(folder: string): Promise<void> {
        await expect
            .poll(
                () => {
                    return filesIn(folder).reduce((total, name) => {
                        return total + sizeOf(join(folder, name));
                    }, 0);
                },
                { timeout: 120000, intervals: [500] }
            )
            .toBeGreaterThan(100_000);
    }

    async function openLibraryEpisode(page: Page): Promise<void> {
        await page.getByRole('button', { name: 'ANIME', exact: true }).click();
        await page.getByRole('navigation', { name: 'Anime' }).getByRole('button', { name: 'LIBRARY', exact: true }).click();
        await page.getByRole('button', { name: `OPEN SERIES: ${ANIME}` }).click();
        await page.getByRole('button', { name: `SHOW EPISODES: ${ANIME}`, exact: true }).click();
    }

    test('runs two downloads at a time, and closing the app cancels them and deletes the folder of each episode', async () => {
        writeSettings({});
        const { app, page } = await open();
        await openFirstEpisodes(page, 3);

        const jobs = page.getByTestId('anime-job');
        await expect(jobs).toHaveCount(3);
        await expect(jobs.locator('.badge--running')).toHaveCount(2, { timeout: 90000 });
        await expect(jobs.locator('.badge--queued')).toHaveCount(1);
        await waitForAnyBytes(episodeFolder(1));
        await waitForAnyBytes(episodeFolder(2));

        await app.close();

        expect(existsSync(episodeFolder(1))).toBe(false);
        expect(existsSync(episodeFolder(2))).toBe(false);
        expect(existsSync(episodeFolder(3))).toBe(false);

        const again = await open();
        await openLibraryEpisode(again.page);
        await expect(again.page.getByTestId('anime-episode').locator('.history__meta').filter({ hasText: 'CANCELLED' })).toHaveCount(2);
        await again.app.close();
    });

    test('a paused episode survives closing the app, and goes on and finishes when it is resumed', async () => {
        writeSettings({});
        const first = await open();
        await openFirstEpisodes(first.page, 1);
        const job = first.page.getByTestId('anime-job');
        await expect(job.locator('.badge--running')).toBeVisible({ timeout: 90000 });
        await waitForAnyBytes(episodeFolder(1));
        await job.getByRole('button', { name: 'PAUSE' }).click();
        await expect(job.locator('.badge--paused')).toHaveText('PAUSED');
        const keptWhenPaused = filesIn(episodeFolder(1));
        expect(keptWhenPaused.length).toBeGreaterThan(0);

        await first.app.close();

        expect(filesIn(episodeFolder(1))).toEqual(keptWhenPaused);

        const second = await open();
        await openLibraryEpisode(second.page);
        await expect(second.page.getByTestId('anime-episode').locator('.history__meta').first()).toHaveText('PAUSED');
        await second.page.getByRole('button', { name: `RESUME: ${ANIME} EP 1` }).click();
        // A finished download leaves the downloads screen and is told by a toast.
        await expect(second.page.locator('.toast').filter({ hasText: `Download complete: ${ANIME} · EP 1` })).toBeVisible({ timeout: 200000 });

        expect(sizeOf(join(episodeFolder(1), `${ANIME_FOLDER} Episode 1.mp4`))).toBeGreaterThan(10_000_000);
        await second.app.close();
    });

    test('closing the app right after pausing keeps the episode as paused', async () => {
        writeSettings({});
        const first = await open();
        await openFirstEpisodes(first.page, 1);
        const job = first.page.getByTestId('anime-job');
        await expect(job.locator('.badge--running')).toBeVisible({ timeout: 90000 });
        await waitForAnyBytes(episodeFolder(1));
        await job.getByRole('button', { name: 'PAUSE' }).click();

        await first.app.close();

        expect(filesIn(episodeFolder(1)).length).toBeGreaterThan(0);
        const second = await open();
        await openLibraryEpisode(second.page);
        await expect(second.page.getByTestId('anime-episode').locator('.history__meta').first()).toHaveText('PAUSED');
        await second.app.close();
    });
});
