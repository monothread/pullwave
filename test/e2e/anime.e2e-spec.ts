import { expect, test, _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import './display';
import { leaveHome } from './startScreen';
import { expectNoSiblingInRing, expectSiblingAfterFolder, makeFolderOnAnotherDisk } from './diskChart';
import { execFileSync, spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { installedProgramsEnv } from './programs';
import { systemPromptFor } from '../../src/main/services/subtitleTranslator';

const ROOT = resolve(__dirname, '../..');
const ELECTRON_PATH = createRequire(__filename)('electron') as unknown as string;
const FAKE_ANI_CLI = resolve(__dirname, 'fixtures/fake-ani-cli.sh');
// What some sources put in front of every segment of an episode to hide the video: a PNG of 1x1 pixel (70 bytes), the same one every time.
const HIDING_PICTURE = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8cf500f00038601805a347d6b0000000049454e44ae426082', 'hex');
// A segment as the source gives it: the picture, then the segment with its first packet 6 bytes short (as in the real file, which is why ffmpeg takes
// it for a picture and not for a transport stream).
function hiddenSegment(segment: Buffer): Buffer {
    return Buffer.concat([HIDING_PICTURE, segment.subarray(0, 1), segment.subarray(7)]);
}
const EXE = process.platform === 'win32' ? '.exe' : '';
const HAS_ANI_TOOLS = [`busybox${EXE}`, `curl${EXE}`, 'ani-cli'].every((name) => {
    return existsSync(join(ROOT, 'resources', 'bin', 'ani', name));
});

interface Session {
    app: ElectronApplication;
    page: Page;
    userData: string;
    animeDir: string;
    callsLog: string;
}

let session: Session;
let workDir: string;

async function launch(userData: string, settings: Record<string, unknown> = {}, env: Record<string, string> = {}): Promise<Session> {
    const animeDir = join(workDir, 'anime');
    mkdirSync(userData, { recursive: true });
    writeFileSync(
        join(userData, 'settings.json'),
        JSON.stringify({ language: 'en', checkUpdatesOnStart: false, downloadDir: join(workDir, 'downloads'), animeDownloadDir: animeDir, animeQuality: '720p', ...settings })
    );
    const app = await electron.launch({
        executablePath: ELECTRON_PATH,
        args: [ROOT, '--no-sandbox', `--user-data-dir=${userData}`],
        // The folder the library is rebuilt from is not asked for: there is no way to answer a dialog of the system here.
        // The schedule of the day is not asked of AniList: the address is one nobody answers at, unless a test gives its own.
        env: { ...process.env, ...installedProgramsEnv(workDir), PULLWAVE_ANI_CLI: FAKE_ANI_CLI, PULLWAVE_IMPORT_DIR: animeDir, PULLWAVE_ANILIST_URL: 'http://127.0.0.1:9/graphql', PULLWAVE_COVER_FALLBACK_URL: 'http://127.0.0.1:9', ...env }
    });
    const page = await app.firstWindow();
    await page.waitForSelector('.logo');
    // The screens only show up once yt-dlp and ffmpeg were probed, which can take a while the first time on Windows.
    await expect(page.getByText('// BOOTING SYSTEMS…')).toBeHidden({ timeout: 60000 });
    await leaveHome(page);
    return { app, page, userData, animeDir, callsLog: join(userData, 'anime', 'history', 'calls.log') };
}

function calls(): string[] {
    return readFileSync(session.callsLog, 'utf-8').split('\n').filter((line) => {
        return line.length > 0;
    });
}

// The section opens on the schedule.
async function openAnimeToday(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'ANIME', exact: true }).click();
}

// Most of what is tested here starts at the search: the tab is opened and the search is picked.
async function openAnimeTab(page: Page): Promise<void> {
    await openAnimeToday(page);
    await page.getByRole('navigation', { name: 'Anime' }).getByRole('button', { name: 'SEARCH', exact: true }).click();
}

// The settings of the anime section are a screen of the section.
async function openAnimeSettings(page: Page): Promise<void> {
    await openAnimeTab(page);
    await page.getByRole('navigation', { name: 'Anime' }).getByRole('button', { name: 'SETTINGS', exact: true }).click();
}

async function showDownloads(page: Page): Promise<void> {
    await page.getByRole('button', { name: /^DOWNLOADS \(\d+\)$/ }).click();
}

async function backFromDownloads(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'BACK' }).click();
}

// A finished download leaves the downloads screen and announces itself with a toast: wait for the first one, then for nothing to be left going
// on or waiting.
async function waitForDownloaded(page: Page): Promise<void> {
    await expect(page.locator('.toast').filter({ hasText: 'Download complete: ' }).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: 'DOWNLOADS (0)' })).toBeVisible({ timeout: 20000 });
}

// The window that asks about the series and the order when an anime is added to the library.
function addDialog(page: Page): Locator {
    return page.getByRole('dialog', { name: 'Add to the library' });
}

// Opens the window of ADD TO LIBRARY, to fill the series and the order in before confirming.
async function openAddDialog(page: Page): Promise<Locator> {
    await page.getByRole('button', { name: 'ADD TO LIBRARY', exact: true }).click();
    await expect(addDialog(page)).toBeVisible();
    return addDialog(page);
}

// Confirms the window of ADD TO LIBRARY; when it is not open yet it is opened first (with what the anime suggests), and when the anime is in
// the library already nothing is done.
async function confirmAdd(page: Page): Promise<void> {
    if (!(await addDialog(page).isVisible()) && (await page.getByRole('button', { name: 'ADD TO LIBRARY', exact: true }).isVisible())) {
        await openAddDialog(page);
    }
    if (await addDialog(page).isVisible()) {
        await addDialog(page).getByRole('button', { name: 'CONFIRM' }).click();
        await expect(addDialog(page)).toBeHidden();
    }
}

// Puts the anime that is open in the search in the library (when it is not there yet), goes to it there and asks for the given episodes, which
// is the only place a download is asked for. It leaves the screen on the search again, as a download used to.
async function downloadFromLibrary(page: Page, episodes: number[], title = 'Fake Anime'): Promise<void> {
    await confirmAdd(page);
    await page.getByRole('button', { name: 'VIEW IN LIBRARY', exact: true }).click();
    // The series opens with every season closed, also when it comes from here: the season is opened to reach its episodes.
    await page.getByRole('button', { name: `SHOW EPISODES: ${title}`, exact: true }).click();
    for (const episode of episodes) {
        await page.getByRole('button', { name: `DOWNLOAD: ${title} EP ${episode}`, exact: true }).click();
    }
    await page.getByRole('navigation', { name: 'Anime' }).getByRole('button', { name: 'SEARCH', exact: true }).click();
}

// Answers the window that asks before something is taken away (a cancel, a removal, a clear).
async function answerConfirm(page: Page, title: string, answer: string): Promise<void> {
    await page.getByRole('dialog', { name: title }).getByRole('button', { name: answer, exact: true }).click();
}

async function search(page: Page, query: string): Promise<void> {
    await page.getByLabel('Anime name').fill(query);
    await page.getByLabel('Anime name').press('Enter');
}

async function openFirstResult(page: Page): Promise<void> {
    await search(page, 'fake');
    await page.getByRole('button', { name: 'OPEN: Fake Anime', exact: true }).click();
    await expect(page.getByRole('button', { name: 'EP 3', exact: true })).toBeVisible();
}

test.skip(!['linux', 'win32'].includes(process.platform) || !HAS_ANI_TOOLS, 'the anime section exists on Linux and Windows and needs `npm run fetch-binaries`');

const PLAYER_THEMES = ['cyberpunk', 'synthwave', 'terminal', 'neon-tokyo', 'acid-rain', 'amber-city', 'ultraviolet', 'pink-noir', 'cyber-gold', 'ice-neon', 'dark', 'tokyo-night', 'nord', 'dracula', 'gruvbox', 'amoled', 'high-contrast', 'light', 'sakura', 'sakura-dark'];

test.beforeEach(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'pullwave-anime-e2e-'));
    session = await launch(join(workDir, 'user-data'));
});

test.afterEach(async () => {
    await session.app.close();
    rmSync(workDir, { recursive: true, force: true });
});

test('adds the anime tab and opens its search', async () => {
    const { page } = session;
    // The settings are the drawn gear at the bottom of the menu; their name is there for the screen readers and the open menu.
    const sections = page.getByRole('navigation', { name: 'Sections' });
    await expect(sections.getByRole('button')).toHaveText(['HOME', 'VIDEO DOWNLOADER', 'ANIME', 'MANGA', 'SETTINGS (GLOBAL)']);
    await expect(sections.getByRole('button', { name: 'SETTINGS (GLOBAL)' }).locator('svg.section-icon--settings')).toHaveCount(1);
    await openAnimeTab(page);
    await expect(page.getByRole('button', { name: 'ANIME', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByLabel('Anime name')).toBeVisible();
    await expect(page.getByLabel('Audio')).toHaveValue('sub');
});

test('opens on the schedule, the first tab, with the updates and the search after it', async () => {
    const { page } = session;
    await openAnimeToday(page);
    const subNav = page.getByRole('navigation', { name: 'Anime' });
    await expect(subNav.getByRole('button')).toHaveText(['SCHEDULE', 'UPDATES', 'SEARCH', 'LIBRARY', 'HISTORY', 'DOWNLOADS (0)', '\u2699\uFE0E']);
    await expect(subNav.getByRole('button', { name: 'SCHEDULE', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(subNav.getByRole('button', { name: 'SEARCH', exact: true })).not.toHaveAttribute('aria-current');
    await expect(page.getByRole('region', { name: 'Anime schedule' })).toBeVisible();
    await expect(page.getByLabel('Anime name')).toHaveCount(0);

    await subNav.getByRole('button', { name: 'SEARCH', exact: true }).click();
    await expect(page.getByLabel('Anime name')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Anime schedule' })).toHaveCount(0);
    await subNav.getByRole('button', { name: 'SCHEDULE', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Anime schedule' })).toBeVisible();
});

test('says that the schedule could not be had when AniList cannot be reached', async () => {
    const { page } = session;
    await openAnimeToday(page);

    await expect(page.getByRole('alert')).toHaveText('Network failure. Check your connection and try again.');
    await expect(page.getByRole('alert')).toHaveAttribute('title', /^AniList could not be reached: /);
    await expect(page.getByText('AIRING [0]')).toBeVisible();
    await expect(page.getByRole('listitem')).toHaveCount(0);
    expect(existsSync(session.callsLog) ? calls() : []).toEqual([]);
});

test.describe('the schedule', () => {
    interface AniListItem {
        id: number;
        title: string;
        episode: number;
        // Hours after the start of the stretch that was asked for.
        hours: number;
    }

    interface Asked {
        start: number;
        end: number;
        page: number;
        perPage: number;
    }

    const ITEMS: AniListItem[] = [
        { id: 1, title: 'Fake Anime', episode: 2, hours: 2 },
        { id: 2, title: 'Dandadan', episode: 3, hours: 13 },
        { id: 3, title: 'Blue Lock', episode: 5, hours: 30 }
    ];
    // A picture the page can always load (the content security policy lets it show data: addresses and the ones of AniList only).
    const COVER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

    let aniList: Server;
    let aniListUrl: string;
    let asked: Asked[];

    function answer(items: AniListItem[]): void {
        aniList.removeAllListeners('request');
        aniList.on('request', (request, response) => {
            const chunks: Buffer[] = [];
            request.on('data', (chunk: Buffer) => {
                chunks.push(chunk);
            });
            request.on('end', () => {
                const variables = (JSON.parse(Buffer.concat(chunks).toString('utf8')) as { variables: Asked }).variables;
                asked.push(variables);
                const airingSchedules = items
                    .map((item) => {
                        return { item, airingAt: variables.start + 1 + item.hours * 3600 };
                    })
                    .filter(({ airingAt }) => {
                        return airingAt > variables.start && airingAt < variables.end;
                    })
                    .map(({ item, airingAt }) => {
                        return {
                            episode: item.episode,
                            airingAt,
                            media: { id: item.id, format: 'TV', countryOfOrigin: 'JP', isAdult: false, title: { romaji: item.title, english: null }, synonyms: [], coverImage: { large: COVER } }
                        };
                    });
                response.writeHead(200, { 'Content-Type': 'application/json' });
                response.end(JSON.stringify({ data: { Page: { pageInfo: { hasNextPage: false }, airingSchedules } } }));
            });
        });
    }

    async function openSchedule(items: AniListItem[]): Promise<Page> {
        answer(items);
        await session.app.close();
        session = await launch(join(workDir, 'user-data'), {}, { PULLWAVE_ANILIST_URL: aniListUrl });
        await openAnimeToday(session.page);
        return session.page;
    }

    function localTime(seconds: number, timeZone: string): string {
        return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(seconds * 1000));
    }

    test.beforeEach(async () => {
        asked = [];
        aniList = createServer();
        await new Promise<void>((resolveListening) => {
            aniList.listen(0, '127.0.0.1', resolveListening);
        });
        aniListUrl = `http://127.0.0.1:${(aniList.address() as AddressInfo).port}/graphql`;
    });

    test.afterEach(async () => {
        aniList.closeAllConnections();
        await new Promise<void>((resolveClosed) => {
            aniList.close(() => {
                resolveClosed();
            });
        });
    });

    test('lists the day of today in the time zone of the machine, with the covers, in the order the episodes air', async () => {
        const page = await openSchedule(ITEMS);

        const items = page.getByRole('region', { name: 'Anime schedule' }).getByRole('listitem');
        await expect(page.getByText('AIRING [2]')).toBeVisible();
        await expect(items.locator('.history__title')).toHaveText(['Fake Anime', 'Dandadan']);
        await expect(items.nth(0).locator('.history__meta')).toContainText('EP 2');
        await expect(items.nth(1).locator('.history__meta')).toContainText('EP 3');
        await expect(items.locator('img')).toHaveCount(2);
        await expect(items.locator('img').first()).toHaveAttribute('src', COVER);
        await expect(page.getByRole('heading').filter({ hasText: / · TODAY$/ })).toHaveCount(1);
        await expect(page.getByLabel('View')).toHaveValue('day');
        await expect(page.getByLabel('Time zone')).toHaveValue(Intl.DateTimeFormat().resolvedOptions().timeZone);
        await expect(page.getByRole('button', { name: /^DOWNLOAD:/ })).toHaveCount(0);

        // One day, asked from one second before it starts, with the first page of fifty.
        expect(asked).toHaveLength(1);
        const [day] = asked;
        expect((day?.end ?? 0) - (day?.start ?? 0) - 1).toBeGreaterThanOrEqual(23 * 3600);
        expect((day?.end ?? 0) - (day?.start ?? 0) - 1).toBeLessThanOrEqual(25 * 3600);
        expect(localTime((day?.start ?? 0) + 1, Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe('00:00');
        expect([day?.page, day?.perPage]).toEqual([1, 50]);
    });

    test('shows every anime of the day as a card that can be clicked, with no badge about the source, and asks ani-cli for nothing by itself', async () => {
        const page = await openSchedule(ITEMS);
        const items = page.getByRole('region', { name: 'Anime schedule' }).getByRole('listitem');
        await expect(page.getByText('AIRING [2]')).toBeVisible();

        await expect(items.locator('.badge')).toHaveCount(0);
        await expect(items.nth(0).getByRole('button', { name: 'OPEN: Fake Anime, EP 2', exact: true })).toBeVisible();
        await expect(items.nth(1).getByRole('button', { name: 'OPEN: Dandadan, EP 3', exact: true })).toBeVisible();
        for (const position of [0, 1]) {
            await expect(items.nth(position)).not.toHaveClass(/cover-card--unavailable/);
            await expect(items.nth(position)).not.toHaveAttribute('aria-disabled');
            await expect(items.nth(position)).not.toHaveAttribute('title');
        }
        // Give the app the time it would have taken to look the anime up, before saying that it did not.
        await page.waitForTimeout(1500);
        expect(existsSync(session.callsLog) ? calls() : []).toEqual([]);
    });

    test('opens on the day, whatever view was picked before: the view is not kept', async () => {
        const first = await openSchedule(ITEMS);
        await first.getByLabel('View').selectOption('week');
        await expect(first.getByText('AIRING [3]')).toBeVisible();

        const second = await openSchedule(ITEMS);

        await expect(second.getByLabel('View')).toHaveValue('day');
        await expect(second.getByText('AIRING [2]')).toBeVisible();
        await expect(second.locator('.schedule__day')).toHaveCount(1);
    });

    test('asks ani-cli about the anime of the week no more than about the ones of the day: about none', async () => {
        const page = await openSchedule(ITEMS);
        await expect(page.getByText('AIRING [2]')).toBeVisible();

        await page.getByLabel('View').selectOption('week');

        await expect(page.getByText('AIRING [3]')).toBeVisible();
        await expect(page.locator('.schedule__day').nth(1).getByRole('button', { name: 'OPEN: Blue Lock, EP 5', exact: true })).toBeVisible();
        await expect(page.locator('.schedule__day .badge')).toHaveCount(0);
        await page.waitForTimeout(1500);
        expect(existsSync(session.callsLog) ? calls() : []).toEqual([]);
    });

    test('shows the week divided by days and goes back to the day', async () => {
        const page = await openSchedule(ITEMS);
        await expect(page.getByText('AIRING [2]')).toBeVisible();

        await page.getByLabel('View').selectOption('week');

        await expect(page.getByText('AIRING [3]')).toBeVisible();
        const days = page.locator('.schedule__day');
        await expect(days).toHaveCount(7);
        await expect(days.nth(0).getByRole('listitem')).toHaveCount(2);
        await expect(days.nth(1).getByRole('listitem')).toHaveCount(1);
        await expect(days.nth(1).locator('.history__title')).toHaveText(['Blue Lock']);
        await expect(days.nth(2).getByText('// NOTHING AIRS.')).toBeVisible();
        await expect(page.getByRole('heading').filter({ hasText: / · TODAY$/ })).toHaveCount(1);
        const week = asked.at(-1);
        expect((week?.end ?? 0) - (week?.start ?? 0) - 1).toBeGreaterThanOrEqual(7 * 23 * 3600);
        expect((week?.end ?? 0) - (week?.start ?? 0) - 1).toBeLessThanOrEqual(7 * 25 * 3600);

        await page.getByLabel('View').selectOption('day');
        await expect(page.locator('.schedule__day')).toHaveCount(1);
        await expect(page.getByText('AIRING [2]')).toBeVisible();
    });

    test('searches the schedule by name, shows the date of the episode and does not ask AniList again', async () => {
        const page = await openSchedule(ITEMS);
        await page.getByLabel('View').selectOption('week');
        await expect(page.getByText('AIRING [3]')).toBeVisible();
        const before = asked.length;
        const field = page.getByRole('textbox', { name: 'Search the schedule' });

        await field.fill('blue');

        await expect(page.getByText('AIRING [1]')).toBeVisible();
        const days = page.locator('.schedule__day');
        await expect(days).toHaveCount(1);
        const items = days.getByRole('listitem');
        await expect(items.locator('.history__title')).toHaveText(['Blue Lock']);
        await expect(items.locator('.history__meta')).toHaveText(/^EP 5 · [A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2} · \d{2}:\d{2}( [AP]M)?$/);
        await expect(page.getByRole('button', { name: 'OPEN: Fake Anime, EP 2' })).toHaveCount(0);

        await field.fill('naruto');

        await expect(page.getByText('// NO ANIME MATCHES "naruto".')).toBeVisible();
        await expect(page.getByText('AIRING [0]')).toBeVisible();
        await expect(page.locator('.schedule__day')).toHaveCount(0);

        await field.fill('');

        await expect(page.locator('.schedule__day')).toHaveCount(7);
        await expect(page.getByText('AIRING [3]')).toBeVisible();
        expect(asked).toHaveLength(before);
    });

    test('counts the days in the time zone that is picked', async () => {
        const page = await openSchedule(ITEMS);
        await expect(page.getByText('AIRING [2]')).toBeVisible();
        const before = asked.length;

        await page.getByLabel('Time zone').selectOption('Asia/Tokyo');

        await expect(page.getByLabel('Time zone')).toHaveValue('Asia/Tokyo');
        await expect.poll(() => {
            return asked.length;
        }).toBe(before + 1);
        const tokyo = asked.at(-1);
        // The stretch asked for starts at midnight in Tokyo.
        expect(localTime((tokyo?.start ?? 0) + 1, 'Asia/Tokyo')).toBe('00:00');
        await expect(page.locator('.schedule__day')).toHaveCount(1);
        await expect(page.getByText('AIRING [2]')).toBeVisible();
    });

    test('does not ask AniList again when the same day is shown again, and asks when REFRESH is pressed', async () => {
        const page = await openSchedule(ITEMS);
        await expect(page.getByText('AIRING [2]')).toBeVisible();
        expect(asked).toHaveLength(1);
        const subNav = page.getByRole('navigation', { name: 'Anime' });

        await subNav.getByRole('button', { name: 'SEARCH', exact: true }).click();
        await subNav.getByRole('button', { name: 'SCHEDULE', exact: true }).click();
        await expect(page.getByText('AIRING [2]')).toBeVisible();
        expect(asked).toHaveLength(1);

        await page.getByRole('button', { name: 'REFRESH', exact: true }).click();
        await expect.poll(() => {
            return asked.length;
        }).toBe(2);
        await expect(page.getByText('AIRING [2]')).toBeVisible();
    });

    test('serves the day from the week that was listed before, without asking AniList again', async () => {
        const page = await openSchedule(ITEMS);
        await expect(page.getByText('AIRING [2]')).toBeVisible();
        await page.getByLabel('View').selectOption('week');
        await expect(page.getByText('AIRING [3]')).toBeVisible();
        expect(asked).toHaveLength(2);

        await page.getByLabel('View').selectOption('day');

        await expect(page.getByText('AIRING [2]')).toBeVisible();
        await expect(page.locator('.schedule__day')).toHaveCount(1);
        expect(asked).toHaveLength(2);
    });

    test('keeps the listing for a day, so it is there when the app is opened again without asking AniList', async () => {
        const first = await openSchedule(ITEMS);
        await expect(first.getByText('AIRING [2]')).toBeVisible();
        expect(asked).toHaveLength(1);

        const second = await openSchedule(ITEMS);

        await expect(second.getByText('AIRING [2]')).toBeVisible();
        await expect(second.locator('.history__title')).toHaveText(['Fake Anime', 'Dandadan']);
        expect(asked).toHaveLength(1);
    });

    test('goes to the search and looks the anime up when its card is clicked', async () => {
        const page = await openSchedule(ITEMS);
        await expect(page.getByText('AIRING [2]')).toBeVisible();
        expect(existsSync(session.callsLog) ? calls() : []).toEqual([]);

        await page.getByRole('button', { name: 'OPEN: Fake Anime, EP 2', exact: true }).click();

        const subNav = page.getByRole('navigation', { name: 'Anime' });
        await expect(subNav.getByRole('button', { name: 'SEARCH', exact: true })).toHaveAttribute('aria-current', 'page');
        await expect(page.getByLabel('Anime name')).toHaveValue('Fake Anime');
        await expect(page.getByRole('button', { name: 'OPEN: Fake Anime', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'OPEN: Fake Anime 2', exact: true })).toBeVisible();
        // Only the search that the click made.
        expect(calls()).toEqual(['sub | Fake Anime']);
    });

    test('looks the english name up first, then the romaji one, when its card is clicked, and stops at the one that finds the anime', async () => {
        aniList.removeAllListeners('request');
        aniList.on('request', (_request, response) => {
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(
                JSON.stringify({
                    data: {
                        Page: {
                            pageInfo: { hasNextPage: false },
                            airingSchedules: [
                                {
                                    episode: 4,
                                    airingAt: Math.floor(Date.now() / 1000),
                                    media: { id: 9, format: 'TV', countryOfOrigin: 'JP', isAdult: false, title: { romaji: 'Fake Anime', english: 'Nothing zzz' }, synonyms: [], coverImage: { large: null } }
                                }
                            ]
                        }
                    }
                })
            );
        });
        await session.app.close();
        session = await launch(join(workDir, 'user-data'), {}, { PULLWAVE_ANILIST_URL: aniListUrl });
        const { page } = session;
        await openAnimeToday(page);

        await expect(page.getByRole('button', { name: 'OPEN: Nothing zzz, EP 4', exact: true })).toBeVisible();
        expect(existsSync(session.callsLog) ? calls() : []).toEqual([]);

        await page.getByRole('button', { name: 'OPEN: Nothing zzz, EP 4', exact: true }).click();

        // The english name finds nothing, the romaji one does: that is where the search stops.
        await expect(page.getByRole('button', { name: 'OPEN: Fake Anime', exact: true })).toBeVisible();
        await expect(page.getByLabel('Anime name')).toHaveValue('Fake Anime');
        expect(calls()).toEqual(['sub | Nothing zzz', 'sub | Fake Anime']);
    });

    test('says nothing airs when the day is empty', async () => {
        const page = await openSchedule([]);

        await expect(page.getByText('// NOTHING AIRS IN THIS PERIOD.')).toBeVisible();
        await expect(page.getByText('AIRING [0]')).toBeVisible();
        await expect(page.getByRole('listitem')).toHaveCount(0);
    });
});

test('keeps the anime that was opened in the history, opens it again from there and removes it', async () => {
    const { page } = session;
    await openAnimeTab(page);
    const subNav = page.getByRole('navigation', { name: 'Anime' });
    await subNav.getByRole('button', { name: 'HISTORY', exact: true }).click();
    await expect(subNav.getByRole('button', { name: 'HISTORY', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText('// NOTHING OPENED YET. SEARCH AN ANIME OR PLAY AN EPISODE.')).toBeVisible();

    await subNav.getByRole('button', { name: 'SEARCH', exact: true }).click();
    await openFirstResult(page);
    await subNav.getByRole('button', { name: 'HISTORY', exact: true }).click();
    const history = page.getByRole('region', { name: 'Anime history' });
    await expect(history.getByText('HISTORY [1]')).toBeVisible();
    await expect(history.locator('.history__title')).toHaveText(['Fake Anime']);
    await expect(history.locator('.history__meta')).toContainText('SUB');

    await history.getByRole('button', { name: 'OPEN: Fake Anime', exact: true }).click();
    await expect(page.getByRole('button', { name: 'EP 3', exact: true })).toBeVisible();

    await subNav.getByRole('button', { name: 'HISTORY', exact: true }).click();
    await history.getByRole('button', { name: 'REMOVE FROM HISTORY: Fake Anime', exact: true }).click();
    await answerConfirm(page, 'Remove "Fake Anime" from the history?', 'REMOVE');
    await expect(page.getByText('// NOTHING OPENED YET. SEARCH AN ANIME OR PLAY AN EPISODE.')).toBeVisible();
});

test('opens an anime of the history on its series in the library when it is there, and goes back to the history with the mouse', async () => {
    const { page } = session;
    const subNav = page.getByRole('navigation', { name: 'Anime' });
    await downloadFirstEpisode(page);
    await subNav.getByRole('button', { name: 'HISTORY', exact: true }).click();
    await page.getByRole('region', { name: 'Anime history' }).getByRole('button', { name: 'OPEN: Fake Anime', exact: true }).click();

    await expect(subNav.getByRole('button', { name: 'LIBRARY', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('series-view')).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Fake Anime' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'EP 3', exact: true })).toHaveCount(0);

    // Playwright cannot press the side buttons, so the events the browser sends for them are dispatched.
    await page.evaluate(() => {
        window.dispatchEvent(new MouseEvent('mouseup', { button: 3, bubbles: true, cancelable: true }));
    });
    await expect(subNav.getByRole('button', { name: 'HISTORY', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('region', { name: 'Anime history' })).toBeVisible();
});

// Playwright cannot press the side buttons of the mouse, so the events the browser sends for them are dispatched.
async function pressSideButton(page: Page, button: 3 | 4): Promise<void> {
    await page.evaluate((which) => {
        window.dispatchEvent(new MouseEvent('mouseup', { button: which, bubbles: true, cancelable: true }));
    }, button);
}

test('the buttons of the mouse go through the home screen, its blocks and the screen of a season, one page each', async () => {
    const { page } = session;
    const subNav = page.getByRole('navigation', { name: 'Anime' });
    const sections = page.getByRole('navigation', { name: 'Sections' });
    await downloadFirstEpisode(page);

    // From the home screen, a block leads to UPDATES of the anime in one page: going back is the home screen at once.
    await sections.getByRole('button', { name: 'HOME', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Home' })).toBeVisible();
    await page.getByRole('button', { name: 'UPDATES: ANIME', exact: true }).click();
    await expect(subNav.getByRole('button', { name: 'UPDATES', exact: true })).toHaveAttribute('aria-current', 'page');
    await pressSideButton(page, 3);
    await expect(sections.getByRole('button', { name: 'HOME', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('region', { name: 'Home' })).toBeVisible();
    await pressSideButton(page, 4);
    await expect(subNav.getByRole('button', { name: 'UPDATES', exact: true })).toHaveAttribute('aria-current', 'page');

    // The screen of a season is a page: going back from it is the screen of its series, then the cards of the library.
    await subNav.getByRole('button', { name: 'LIBRARY', exact: true }).click();
    await page.getByRole('button', { name: 'OPEN SERIES: Fake Anime', exact: true }).click();
    await expect(page.getByTestId('series-view')).toBeVisible();
    await page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
    await expect(page.getByTestId('season-view')).toBeVisible();
    await pressSideButton(page, 3);
    await expect(page.getByTestId('series-view')).toBeVisible();
    await expect(page.getByTestId('season-view')).toHaveCount(0);
    await pressSideButton(page, 4);
    await expect(page.getByTestId('season-view')).toBeVisible();
    await pressSideButton(page, 3);
    await pressSideButton(page, 3);
    await expect(page.getByTestId('anime-card')).toHaveCount(1);
});

test('the history of the anime survives closing the app and can be cleared', async () => {
    const { page } = session;
    await openAnimeTab(page);
    await openFirstResult(page);
    await session.app.close();

    session = await launch(join(workDir, 'user-data'));
    const reopened = session.page;
    await openAnimeTab(reopened);
    const subNav = reopened.getByRole('navigation', { name: 'Anime' });
    await subNav.getByRole('button', { name: 'HISTORY', exact: true }).click();
    await expect(reopened.locator('.history__title')).toHaveText(['Fake Anime']);

    await reopened.getByRole('button', { name: 'CLEAR HISTORY', exact: true }).click();
    await answerConfirm(reopened, 'Clear the history?', 'CLEAR HISTORY');
    await expect(reopened.getByText('// NOTHING OPENED YET. SEARCH AN ANIME OR PLAY AN EPISODE.')).toBeVisible();
});

// A real click on a point of a row that is not its title, as a user would: the area of the title button is stretched over the row.
async function clickOnRow(page: Page, part: Locator): Promise<void> {
    // The mouse clicks where the page is on the screen: what is below the fold is brought into view first.
    await part.scrollIntoViewIfNeeded();
    const box = await part.boundingBox();
    if (box === null) {
        throw new Error('The part of the row is not on the screen');
    }
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test('opens an anime from the search by clicking anywhere on its card', async () => {
    const { page } = session;
    await openAnimeTab(page);
    await search(page, 'fake');
    await expect(page.getByText('2 RESULTS')).toBeVisible();
    // No OPEN button on the cards: the whole card is the way in.
    await expect(page.getByRole('button', { name: 'OPEN', exact: true })).toHaveCount(0);

    const card = page.locator('li.history__item').filter({ hasText: 'Fake Anime 2' });
    const box = await card.boundingBox();
    await page.mouse.click((box?.x ?? 0) + (box?.width ?? 0) - 24, (box?.y ?? 0) + (box?.height ?? 0) / 2);

    await expect(page.getByRole('button', { name: 'EP 3', exact: true })).toBeVisible();
    expect(calls().some((line) => {
        return line.startsWith('sub | -S 2 ');
    })).toBe(true);
});

test('opens a series, shows its episodes and plays one by clicking on the rows, and the buttons of a row do not trigger it', async () => {
    const { page } = session;
    await downloadFirstEpisode(page);
    await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();

    // The card of the series: its badge, and not its title, is clicked.
    await expect(page.getByRole('button', { name: 'OPEN SERIES', exact: true })).toHaveCount(0);
    await clickOnRow(page, page.getByTestId('anime-card').locator('.badge'));
    await expect(page.getByTestId('series-view')).toBeVisible();

    // The season is a card (even the only one); a click on it opens the screen of the season with its episodes as cards, and BACK returns.
    const season = page.getByTestId('anime-season');
    await expect(page.getByTestId('anime-episode')).toHaveCount(0);
    await expect(season.getByRole('button', { name: /^SHOW EPISODES: / })).toBeVisible();
    await expect(season.locator('.cover')).toHaveCount(1);
    await clickOnRow(page, season.locator('.season__meta'));
    await expect(page.getByTestId('season-view')).toBeVisible();
    await expect(page.getByTestId('series-view')).toHaveCount(0);
    await expect(page.getByTestId('anime-episode')).toHaveCount(3);
    await page.getByRole('button', { name: 'BACK', exact: true }).click();
    await expect(page.getByTestId('season-view')).toHaveCount(0);
    await expect(page.getByTestId('anime-episode')).toHaveCount(0);
    await clickOnRow(page, season.locator('.season__meta'));
    await expect(page.getByTestId('anime-episode')).toHaveCount(3);

    // A button of the row works on its own: it does not close the season, nor play the episode.
    await page.getByRole('button', { name: 'MARK AS WATCHED: Fake Anime EP 1' }).click();
    await expect(page.getByRole('button', { name: 'MARK AS UNWATCHED: Fake Anime EP 1' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('anime-episode')).toHaveCount(3);

    // A click on the row of the episode (its meta line) plays it.
    await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toHaveCount(0);
    await clickOnRow(page, page.getByTestId('anime-episode').locator('.history__meta').first());
    await expect(page.getByRole('dialog', { name: 'Fake Anime · EP 1' })).toBeVisible();
});

test('the back and forward buttons of the mouse go through the series of the library in the order it was opened', async () => {
    const { page } = session;
    // Playwright cannot press the side buttons, so the events the browser sends for them are dispatched.
    const pressSideButton = async (button: 3 | 4): Promise<boolean> => {
        return page.evaluate((which) => {
            const event = new MouseEvent('mouseup', { button: which, bubbles: true, cancelable: true });
            window.dispatchEvent(event);
            return event.defaultPrevented;
        }, button);
    };
    const animeBar = page.getByRole('navigation', { name: 'Anime' });
    await downloadFirstEpisode(page);
    await animeBar.getByRole('button', { name: 'LIBRARY', exact: true }).click();
    await expect(page.getByTestId('anime-card')).toHaveCount(1);
    await page.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
    await expect(page.getByTestId('series-view')).toBeVisible();

    // Back from the series goes to the cards of the library, not past the library.
    expect(await pressSideButton(3)).toBe(true);
    await expect(page.getByTestId('series-view')).toHaveCount(0);
    await expect(page.getByTestId('anime-card')).toHaveCount(1);
    await expect(animeBar.getByRole('button', { name: 'LIBRARY', exact: true })).toHaveAttribute('aria-current', 'page');

    // Forward goes to the series again.
    expect(await pressSideButton(4)).toBe(true);
    await expect(page.getByTestId('series-view')).toBeVisible();
    await expect(page.getByRole('button', { name: 'BACK TO LIBRARY' })).toBeVisible();

    // Back twice goes through the cards and then to the view before the library.
    expect(await pressSideButton(3)).toBe(true);
    expect(await pressSideButton(3)).toBe(true);
    await expect(animeBar.getByRole('button', { name: 'SEARCH', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('series-view')).toHaveCount(0);

    // The button of the screen closes the series like the mouse does: the cards, and then forward opens it again.
    expect(await pressSideButton(4)).toBe(true);
    expect(await pressSideButton(4)).toBe(true);
    await expect(page.getByTestId('series-view')).toBeVisible();
    await page.getByRole('button', { name: 'BACK TO LIBRARY' }).click();
    await expect(page.getByTestId('anime-card')).toHaveCount(1);
    expect(await pressSideButton(3)).toBe(true);
    await expect(page.getByTestId('series-view')).toBeVisible();
});

for (const theme of PLAYER_THEMES) {
test(`in fullscreen, in the ${theme} theme, the controls float over the video and go away when the mouse is still, and only the part of the timeline already watched has the wave and the glow @resize`, async () => {
    await session.app.close();
    session = await launch(join(workDir, 'user-data'), { theme });
    const { page } = session;
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await downloadFirstEpisode(page);
    await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
    await page.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
    await page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
    await page.getByRole('button', { name: 'PLAY: Fake Anime EP 1' }).click();
    const dialog = page.getByRole('dialog', { name: 'Fake Anime · EP 1' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Fullscreen' }).click();
    await expect.poll(() => {
        return page.evaluate(() => {
            return document.fullscreenElement !== null;
        });
    }).toBe(true);

    // The fake video has no length, so the position is set by hand: 40% of the timeline watched, the video playing and then paused.
    const timeline = async (playing: 'true' | 'false') => {
        await page.mouse.move(300, 300);
        await page.mouse.move(320, 320);
        return page.evaluate((state) => {
            const box = document.querySelector('.player__timeline') as HTMLElement;
            const bar = box.querySelector('.progress__bar') as HTMLElement;
            const track = box.querySelector('.progress') as HTMLElement;
            const slider = box.querySelector('.player__seek') as HTMLElement;
            bar.style.transition = 'none';
            bar.style.width = '40%';
            (document.querySelector('.player__controls') as HTMLElement).setAttribute('data-playing', state);
            const barStyle = getComputedStyle(bar);
            const trackStyle = getComputedStyle(track);
            const sliderStyle = getComputedStyle(slider);
            const boxRect = box.getBoundingClientRect();
            const sliderRect = slider.getBoundingClientRect();
            return {
                barWidthRatio: Math.round((bar.getBoundingClientRect().width / (track.getBoundingClientRect().width - 2)) * 100),
                barBackgroundSize: barStyle.backgroundSize,
                barAnimationName: barStyle.animationName,
                barAnimationDuration: barStyle.animationDuration,
                barAnimationPlayState: barStyle.animationPlayState,
                barHasGlow: barStyle.boxShadow !== 'none' && barStyle.boxShadow.includes('rgb'),
                trackHeight: trackStyle.height,
                trackBorder: trackStyle.borderTopWidth,
                trackStyle: trackStyle.borderTopStyle,
                sliderBackground: sliderStyle.backgroundColor,
                sliderBorder: sliderStyle.borderTopWidth,
                sliderShadow: sliderStyle.boxShadow,
                sliderOverBar: Math.round(sliderRect.width) === Math.round(boxRect.width) && Math.round(sliderRect.height) === Math.round(boxRect.height)
            };
        }, playing);
    };

    const playing = await timeline('true');
    // The timeline is the bar of a download under a transparent slider: 8px with a 1px line, the fill as wide as what was watched, the wave of colours flowing and the neon glow of every bar.
    expect(playing).toEqual({
        barWidthRatio: 40,
        barBackgroundSize: '160px 100%',
        barAnimationName: 'bar-wave-flow',
        barAnimationDuration: '1.4s',
        barAnimationPlayState: 'running',
        barHasGlow: true,
        trackHeight: '8px',
        trackBorder: '1px',
        trackStyle: 'solid',
        sliderBackground: 'rgba(0, 0, 0, 0)',
        sliderBorder: '0px',
        sliderShadow: 'none',
        sliderOverBar: true
    });

    // The wave flows also when the video is paused, like the bar of a download that goes on.
    const paused = await timeline('false');
    expect(paused).toEqual(playing);

    // The bar floats over the video in every theme: it takes no room, has no background and is out of the layout of the stage.
    const controls = dialog.locator('.player__controls');
    const floating = await controls.evaluate((element) => {
        const style = getComputedStyle(element);
        return { position: style.position, bottom: style.bottom, backgroundColor: style.backgroundColor, borderTopWidth: style.borderTopWidth };
    });
    expect(floating).toEqual({ position: 'absolute', bottom: '0px', backgroundColor: 'rgba(0, 0, 0, 0)', borderTopWidth: '0px' });
    const video = await dialog.locator('.player__video').boundingBox();
    const stage = await dialog.locator('.player__stage').boundingBox();
    // The video fills the stage but for its border: the bar takes no room (it would take about 50 pixels).
    expect(stage!.height - video!.height).toBeGreaterThanOrEqual(0);
    expect(stage!.height - video!.height).toBeLessThanOrEqual(4);

    // And it goes away when the mouse stands still, taking the cursor with it, and comes back with the mouse.
    await expect(controls).toHaveAttribute('data-hidden', 'true', { timeout: 6000 });
    // The opacity goes to 0 in a transition of a quarter of a second that starts when the attribute changes: it is waited for, not read at once.
    await expect
        .poll(() => {
            return controls.evaluate((element) => {
                const style = getComputedStyle(element);
                return { opacity: style.opacity, pointerEvents: style.pointerEvents, cursor: getComputedStyle(document.querySelector('.player__video') as HTMLElement).cursor };
            });
        })
        .toEqual({ opacity: '0', pointerEvents: 'none', cursor: 'none' });
    await page.mouse.move(340, 340);
    await expect(controls).toHaveAttribute('data-hidden', 'false');
    await expect.poll(() => {
        return controls.evaluate((element) => {
            return getComputedStyle(element).opacity;
        });
    }).toBe('1');
});
}

test('shows the title of the anime the source picked on its own, not the words searched, when the script lists it', { tag: '@windows' }, async () => {
    const { page } = session;
    await openAnimeTab(page);
    await search(page, 'loneshown');
    const card = page.getByRole('listitem');
    await expect(card).toHaveCount(1);
    await expect(page.locator('.history__title')).toHaveText(['Picked Anime']);
    await expect(page.getByRole('button', { name: 'OPEN: Picked Anime', exact: true })).toBeVisible();
    await expect(page.getByTestId('anime-result-unconfirmed')).toHaveCount(0);
    await page.getByRole('button', { name: 'OPEN: Picked Anime', exact: true }).click();
    await expect(page.getByRole('button', { name: 'EP 3', exact: true })).toBeVisible();
    await expect(page.getByTestId('anime-result-unconfirmed')).toHaveCount(0);
});

test('says the name could not be confirmed, with no cover, for an anime the source picked on its own and did not name', { tag: '@windows' }, async () => {
    const { page } = session;
    await openAnimeTab(page);
    await search(page, 'loneunlisted');
    const card = page.getByRole('listitem');
    await expect(card).toHaveCount(1);
    await expect(page.locator('.history__title')).toHaveText(['loneunlisted']);
    await expect(card.getByTestId('anime-result-unconfirmed')).toHaveText('ANIME PICKED BY THE SOURCE: THE NAME COULD NOT BE CONFIRMED');
    await expect(card.locator('.cover')).toHaveText('COVER NOT FOUND');
    await expect(card.locator('img.cover')).toHaveCount(0);
    await page.getByRole('button', { name: 'OPEN: loneunlisted', exact: true }).click();
    await expect(page.getByRole('button', { name: 'EP 3', exact: true })).toBeVisible();
    await expect(page.getByTestId('anime-result-unconfirmed')).toHaveText('ANIME PICKED BY THE SOURCE: THE NAME COULD NOT BE CONFIRMED');
    await expect(page.locator('.anime__detail .series__cover .cover')).toHaveText('COVER NOT FOUND');
});

test('tells two anime that have the same title apart by the id of the source, and keeps each one with its own episodes', { tag: '@windows' }, async () => {
    const { page } = session;
    await openAnimeTab(page);
    await search(page, 'twin');
    // The source lists "Twin Anime" twice: the second is told by what its id says.
    await expect(page.locator('.history__title')).toHaveText(['Twin Anime', 'Twin Anime (season 2)']);

    await page.getByRole('button', { name: 'OPEN: Twin Anime', exact: true }).click();
    await expect(page.getByRole('button', { name: 'EP 3', exact: true })).toBeVisible();
    await confirmAdd(page);
    await expect(page.getByRole('button', { name: 'VIEW IN LIBRARY', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'BACK', exact: true }).click();
    await expect(page.locator('.history__title')).toHaveText(['Twin Anime', 'Twin Anime (season 2)']);
    await page.getByRole('button', { name: 'OPEN: Twin Anime (season 2)', exact: true }).click();
    await expect(page.getByRole('button', { name: 'EP 2', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'EP 3', exact: true })).toHaveCount(0);
    await confirmAdd(page);
    await expect(page.getByRole('button', { name: 'VIEW IN LIBRARY', exact: true })).toBeVisible();

    // Both are in the library, as two anime: the second one did not take the place of the first, and each has its own episodes.
    await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
    await expect(page.getByTestId('anime-card')).toHaveCount(2);
    await page.getByRole('button', { name: 'OPEN SERIES: Twin Anime', exact: true }).click();
    await page.getByRole('button', { name: 'SHOW EPISODES: Twin Anime', exact: true }).click();
    await expect(page.getByTestId('anime-episode')).toHaveCount(3);
    await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
    await page.getByRole('button', { name: 'OPEN SERIES: Twin Anime (season 2)', exact: true }).click();
    await page.getByRole('button', { name: 'SHOW EPISODES: Twin Anime (season 2)', exact: true }).click();
    await expect(page.getByTestId('anime-episode')).toHaveCount(2);
});

// What ani-cli was asked to read of the search in each call (see search-min.log of the fake): the number of results, and the arguments.
function searchMinCalls(userData: string, words: string): string[] {
    return readFileSync(join(userData, 'anime', 'history', 'search-min.log'), 'utf-8')
        .split('\n')
        .filter((line) => {
            return line.endsWith(` ${words}`);
        });
}

test('lists the results past the first page as the list is scrolled to its end, and opens one that is on a later page', { tag: '@windows' }, async () => {
    const { page, userData } = session;
    await openAnimeTab(page);
    await search(page, 'many');

    // The source gives 30 results to a page: the next ones come when the end of the list is reached, with no button to ask for them.
    await expect(page.getByText('30 RESULTS', { exact: true })).toBeVisible();
    await expect(page.locator('.history__title').first()).toHaveText('Many Anime 1');
    await expect(page.locator('.history__title').last()).toHaveText('Many Anime 30');
    await expect(page.getByRole('button', { name: /LOAD MORE/ })).toHaveCount(0);
    await page.getByTestId('anime-end-of-list').scrollIntoViewIfNeeded();
    await expect(page.getByText('60 RESULTS', { exact: true })).toBeVisible();
    await page.getByTestId('anime-end-of-list').scrollIntoViewIfNeeded();
    await expect(page.getByText('70 RESULTS', { exact: true })).toBeVisible();
    await expect(page.getByTestId('anime-end-of-list')).toHaveCount(0);
    await expect(page.getByTestId('anime-results-limit')).toHaveCount(0);
    await expect(page.locator('.history__title')).toHaveCount(70);
    await expect(page.locator('.history__title').nth(30)).toHaveText('Many Anime 31');
    await expect(page.locator('.history__title').last()).toHaveText('Many Anime 70');
    // Each time the list asked for one result more than it had: ani-cli read the pages until it had it.
    expect(searchMinCalls(userData, 'many')).toEqual(['1 | many', '31 | many', '61 | many']);

    // A result of the third page is opened by its position: the episodes are asked for with the search read up to it.
    await page.getByRole('button', { name: 'OPEN: Many Anime 45', exact: true }).click();
    await expect(page.getByRole('button', { name: 'EP 3', exact: true })).toBeVisible();
    expect(searchMinCalls(userData, '-S 45 many')).toEqual(['45 | -S 45 many']);
});

test('lists no more than the most results of a search and asks to make it more specific', { tag: '@windows' }, async () => {
    const { page, userData } = session;
    await openAnimeTab(page);
    await search(page, 'endless');

    await expect(page.getByText('30 RESULTS', { exact: true })).toBeVisible();
    for (const count of [60, 90]) {
        await page.getByTestId('anime-end-of-list').scrollIntoViewIfNeeded();
        await expect(page.getByText(`${String(count)} RESULTS`, { exact: true })).toBeVisible();
    }
    await expect(page.getByTestId('anime-results-limit')).toHaveCount(0);
    await page.getByTestId('anime-end-of-list').scrollIntoViewIfNeeded();

    // The source has 300, the list stops at 120 and says so; nothing more is asked for.
    await expect(page.getByText('120 RESULTS', { exact: true })).toBeVisible();
    await expect(page.getByTestId('anime-results-limit')).toHaveText('Showing the first 120 results. Make the search more specific to see the others.');
    await expect(page.getByTestId('anime-end-of-list')).toHaveCount(0);
    await expect(page.locator('.history__title')).toHaveCount(120);
    await expect(page.locator('.history__title').last()).toHaveText('Many Anime 120');
    await page.waitForTimeout(1500);
    expect(searchMinCalls(userData, 'endless')).toEqual(['1 | endless', '31 | endless', '61 | endless', '91 | endless']);
    await expect(page.locator('.history__title')).toHaveCount(120);
});

test('searches an anime, lists the results and reports when nothing is found', { tag: '@windows' }, async () => {
    const { page } = session;
    await openAnimeTab(page);
    await search(page, 'fake');
    await expect(page.getByText('2 RESULTS')).toBeVisible();
    await expect(page.locator('.history__title')).toHaveText(['Fake Anime', 'Fake Anime 2']);
    expect(calls()).toEqual(['sub | fake']);

    await search(page, 'zzz');
    const alert = page.getByRole('alert');
    await expect(alert).toHaveText('Nothing was found for this search.');
    await expect(alert).not.toHaveAttribute('title');
    await alert.getByRole('button', { name: 'Nothing was found for this search.' }).click();
    const details = page.getByRole('dialog', { name: 'ERROR DETAILS' });
    await expect(details.getByTestId('error-message')).toHaveText('No results found!');
    await expect(details.locator('.error-details__row').filter({ hasText: /^Code/ }).locator('dd')).toHaveText('NO_RESULTS');
    await details.getByRole('button', { name: 'CLOSE' }).click();
    await expect(details).toHaveCount(0);
});

test('clears the results when the name is emptied', async () => {
    const { page } = session;
    await openAnimeTab(page);
    await search(page, 'fake');
    await expect(page.getByText('2 RESULTS')).toBeVisible();
    await expect(page.locator('.history__title')).toHaveCount(2);

    await page.getByLabel('Anime name').fill('');

    await expect(page.getByText('2 RESULTS')).toBeHidden();
    await expect(page.locator('.history__title')).toHaveCount(0);
    await expect(page.getByLabel('Anime name')).toHaveValue('');
    await expect(page.getByRole('region', { name: 'Search anime' }).getByRole('button', { name: 'SEARCH', exact: true })).toBeDisabled();
    expect(calls()).toEqual(['sub | fake']);
});

test('clears the message of a search that found nothing when the name is emptied', async () => {
    const { page } = session;
    await openAnimeTab(page);
    await search(page, 'zzz');
    await expect(page.getByRole('alert')).toHaveText('Nothing was found for this search.');
    await page.getByLabel('Anime name').fill('');
    await expect(page.getByRole('alert')).toHaveCount(0);
});

test('searches with the audio that was picked', { tag: '@windows' }, async () => {
    const { page } = session;
    await openAnimeTab(page);
    await page.getByLabel('Audio').selectOption('dub');
    await search(page, 'fake');
    await expect(page.getByText('2 RESULTS')).toBeVisible();
    expect(calls()).toEqual(['dub | fake']);
});

test('opens an anime and lists its episodes', { tag: '@windows' }, async () => {
    const { page } = session;
    await openAnimeTab(page);
    await openFirstResult(page);
    await expect(page.getByText('3 EPISODES', { exact: true })).toBeVisible();
    await expect(page.locator('.episode-chip')).toHaveText(['EP 1', 'EP 2', 'EP 3']);
    expect(calls()).toEqual(['sub | fake', 'sub | -S 1 fake']);
    await page.getByRole('button', { name: 'BACK' }).click();
    await expect(page.getByText('2 RESULTS')).toBeVisible();
});

test('lists the episodes from the last one when the user chooses it, and keeps the order when the app opens again', { tag: '@windows' }, async () => {
    const { page } = session;
    await openAnimeTab(page);
    await openFirstResult(page);
    const order = page.getByRole('combobox', { name: 'Sort by' });
    await expect(order).toHaveValue('asc');
    await order.selectOption('desc');
    await expect(page.locator('.episode-chip')).toHaveText(['EP 3', 'EP 2', 'EP 1']);

    await session.app.close();
    session = await launch(session.userData);
    await openAnimeTab(session.page);
    await openFirstResult(session.page);
    await expect(session.page.getByRole('combobox', { name: 'Sort by' })).toHaveValue('desc');
    await expect(session.page.locator('.episode-chip')).toHaveText(['EP 3', 'EP 2', 'EP 1']);
});

test('announces a finished download with a toast that takes itself away after five seconds', { tag: '@windows' }, async () => {
    const { page } = session;
    await openAnimeTab(page);
    await openFirstResult(page);
    await downloadFromLibrary(page, [2]);

    const toast = page.locator('.toast').filter({ hasText: 'Download complete: Fake Anime · EP 2' });
    await expect(toast).toBeVisible({ timeout: 20000 });
    await expect(toast).toBeHidden({ timeout: 8000 });
});

test('downloads an episode with the quality of the settings and shows it in the library', { tag: '@windows' }, async () => {
    const { page, animeDir } = session;
    await openAnimeTab(page);
    await openFirstResult(page);
    await downloadFromLibrary(page, [2]);

    await waitForDownloaded(page);
    // A finished download leaves the downloads screen: it is in the library from then on.
    await showDownloads(page);
    await expect(page.getByTestId('anime-job')).toHaveCount(0);
    await expect(page.getByText('// NO DOWNLOADS YET.')).toBeVisible();
    await backFromDownloads(page);
    expect(calls().at(-1)).toBe('sub | -d -S 1 -e 2 -q 720p fake');

    const video = join(animeDir, 'Fake Anime', 'Season 1', 'Episode 2', 'Fake Anime Episode 2.mp4');
    expect(readFileSync(video, 'utf-8')).toBe('FAKEVIDEO0123456789');
    expect(readFileSync(join(animeDir, 'Fake Anime', 'Season 1', 'Episode 2', 'Fake Anime Episode 2.vtt'), 'utf-8')).toBe('WEBVTT\n');

    await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
    const card = page.getByTestId('anime-card');
    await expect(card.getByRole('heading')).toHaveText('Fake Anime');
    await expect(card.getByText('1 SEASON')).toBeVisible();
    await card.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
    await page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
    await expect(page.getByText('1/3 DOWNLOADED')).toBeVisible();
    // The episodes that were not asked for are in the library as not downloaded.
    await expect(page.getByTestId('anime-episode').locator('.history__meta')).toHaveText(['NOT DOWNLOADED', 'DOWNLOADED · 19 B', 'NOT DOWNLOADED']);
});

test('downloads a whole season, one episode at a time', { tag: '@windows' }, async () => {
    test.slow();
    const { page, animeDir } = session;
    await openAnimeTab(page);
    await openFirstResult(page);
    await downloadFromLibrary(page, [1, 2, 3]);

    // Each one is told when it finishes; how many are on the screen at once depends on how fast the machine is.
    await waitForDownloaded(page);
    await expect.poll(() => {
        return ['1', '2', '3'].every((number) => {
            return existsSync(join(animeDir, 'Fake Anime', 'Season 1', `Episode ${number}`, `Fake Anime Episode ${number}.mp4`));
        });
    }, { timeout: 90000 }).toBe(true);
    ['1', '2', '3'].forEach((number) => {
        expect(existsSync(join(animeDir, 'Fake Anime', 'Season 1', `Episode ${number}`, `Fake Anime Episode ${number}.mp4`))).toBe(true);
    });
    expect(
        calls()
            .filter((line) => {
                return line.includes('-d ');
            })
            .sort()
    ).toEqual(['sub | -d -S 1 -e 1 -q 720p fake', 'sub | -d -S 1 -e 2 -q 720p fake', 'sub | -d -S 1 -e 3 -q 720p fake']);
});

test('asks for the subtitles in the language of the app, and in another one when chosen', { tag: '@windows' }, async () => {
    const { page, userData } = session;
    await openAnimeTab(page);
    await openFirstResult(page);
    await downloadFromLibrary(page, [1]);
    await waitForDownloaded(page);
    const labels = (): string[] => {
        return readFileSync(join(userData, 'anime', 'history', 'subtitle-labels.log'), 'utf-8').split('\n').filter((line) => {
            return line.length > 0;
        });
    };
    // The app is in English: English, nothing else to fall back to.
    expect(labels().at(-1)).toBe('English');

    await openAnimeSettings(page);
    await page.getByLabel('Anime subtitles').selectOption('Spanish');
    await expect.poll(() => {
        return (JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf-8')) as Record<string, unknown>).animeSubtitles;
    }).toBe('Spanish');
    await openAnimeTab(page);
    await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
    await page.getByRole('button', { name: 'REMOVE SERIES: Fake Anime' }).click();
    await answerConfirm(page, 'Remove the series "Fake Anime"?', 'REMOVE');
    await page.getByRole('button', { name: 'SEARCH', exact: true }).first().click();
    await openFirstResult(page);
    await downloadFromLibrary(page, [1]);
    await expect.poll(() => {
        return labels().at(-1);
    }).toBe('Spanish');
});

test('shows the downloads on a screen of their own, with their number on a button, and goes back', async () => {
    const { page } = session;
    await openAnimeTab(page);
    await expect(page.getByRole('button', { name: 'DOWNLOADS (0)' })).toBeVisible();
    // The slow ones stay in the list for a while: a finished download leaves it.
    await search(page, 'slow');
    await page.getByRole('button', { name: 'OPEN: Fake Anime', exact: true }).click();
    await downloadFromLibrary(page, [1, 2, 3]);

    await showDownloads(page);
    await expect(page.getByTestId('anime-job')).toHaveCount(3);
    await expect(page.getByLabel('Anime name')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Anime' })).toHaveCount(0);
    // What finishes leaves the screen, to be told by a toast.
    await expect(page.getByTestId('anime-job')).toHaveCount(0, { timeout: 30000 });
    await expect(page.getByText('// NO DOWNLOADS YET.')).toBeVisible();
    await backFromDownloads(page);

    // Back where it was: the results of the search, with nothing finished left counted.
    await expect(page.getByRole('button', { name: 'OPEN: Fake Anime', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'DOWNLOADS (0)' })).toBeVisible();
    await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
    await showDownloads(page);
    await backFromDownloads(page);
    await expect(page.getByTestId('anime-card')).toBeVisible();
});

test('pausing a download ends the process and keeps the episode as paused, and resuming starts it again and finishes it', { tag: '@windows' }, async () => {
    const { page, animeDir } = session;
    await openAnimeTab(page);
    await search(page, 'slow');
    await page.getByRole('button', { name: 'OPEN: Fake Anime', exact: true }).click();
    await downloadFromLibrary(page, [1]);

    await showDownloads(page);
    const job = page.getByTestId('anime-job');
    await expect(job.locator('.badge--running')).toHaveText('DOWNLOADING');
    await expect(job.getByText('25.0%')).toBeVisible();
    await expect(job.getByRole('button', { name: 'RESUME' })).toHaveCount(0);
    await job.getByRole('button', { name: 'PAUSE' }).click();

    await expect(job.locator('.badge--paused')).toHaveText('PAUSED');
    await expect(job).toHaveClass(/job--paused/);
    await expect(job.getByText('25.0%')).toBeVisible();
    await expect(job.getByRole('button', { name: 'PAUSE' })).toHaveCount(0);
    await expect(job.getByRole('button', { name: 'CANCEL' })).toBeVisible();
    // The process is gone: the fake would have written the file five seconds after it started, and a paused download does not finish.
    await page.waitForTimeout(7000);
    const file = join(animeDir, 'Fake Anime', 'Season 1', 'Episode 1', 'Fake Anime Episode 1.mp4');
    expect(existsSync(file)).toBe(false);
    await expect(job.locator('.badge--paused')).toBeVisible();
    // It is not counted among the downloads that are going on or waiting.
    await backFromDownloads(page);
    await expect(page.getByRole('button', { name: 'DOWNLOADS (0)' })).toBeVisible();
    await showDownloads(page);

    await job.getByRole('button', { name: 'RESUME' }).click();
    await expect(page.locator('.toast').filter({ hasText: 'Download complete: Fake Anime · EP 1' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('anime-job')).toHaveCount(0);
    expect(existsSync(file)).toBe(true);
    // Two downloads of the same episode were asked of ani-cli: the one that was paused and the one that went on.
    expect(
        calls().filter((line) => {
            return line === 'sub | -d -S 1 -e 1 -q 720p slow';
        })
    ).toHaveLength(2);
});

test('a paused episode is in the library as paused, with a button to resume it, and survives closing the app', { tag: '@windows' }, async () => {
    const { page } = session;
    await openAnimeTab(page);
    await search(page, 'slow');
    await page.getByRole('button', { name: 'OPEN: Fake Anime', exact: true }).click();
    await downloadFromLibrary(page, [1]);
    await showDownloads(page);
    const job = page.getByTestId('anime-job');
    await expect(job.getByText('25.0%')).toBeVisible();
    await job.getByRole('button', { name: 'PAUSE' }).click();
    await expect(job.locator('.badge--paused')).toHaveText('PAUSED');
    await backFromDownloads(page);
    await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
    await page.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
    await page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
    await expect(page.getByTestId('anime-episode').locator('.history__meta').first()).toHaveText('PAUSED');
    await expect(page.getByRole('button', { name: 'RESUME: Fake Anime EP 1' })).toBeVisible();
    await session.app.close();

    session = await launch(join(workDir, 'user-data'));
    const reopened = session.page;
    await openAnimeTab(reopened);
    await reopened.getByRole('button', { name: 'LIBRARY', exact: true }).click();
    await reopened.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
    await reopened.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
    // The app does not fail what was paused when it starts, as it does with what was waiting or downloading.
    await expect(reopened.getByTestId('anime-episode').locator('.history__meta').first()).toHaveText('PAUSED');

    await reopened.getByRole('button', { name: 'RESUME: Fake Anime EP 1' }).click();
    await expect(reopened.locator('.toast').filter({ hasText: 'Download complete: Fake Anime · EP 1' })).toBeVisible({ timeout: 20000 });
    await showDownloads(reopened);
    await expect(reopened.getByTestId('anime-job')).toHaveCount(0);
    await backFromDownloads(reopened);
    // The screen of the series, with its episodes shown, is where the user was, and is where they come back to.
    const openSeries = reopened.getByRole('button', { name: 'OPEN SERIES: Fake Anime' });
    if (await openSeries.isVisible()) {
        await openSeries.click();
    }
    const showEpisodes = reopened.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true });
    if (await showEpisodes.isVisible()) {
        await showEpisodes.click();
    }
    await expect(reopened.getByTestId('anime-episode').locator('.history__meta').first()).toContainText('DOWNLOADED');
});

test('cancelling a download ends the process: the file is never finished', { tag: '@windows' }, async () => {
    const { page, animeDir } = session;
    await openAnimeTab(page);
    await search(page, 'slow');
    await page.getByRole('button', { name: 'OPEN: Fake Anime', exact: true }).click();
    await downloadFromLibrary(page, [1]);

    await showDownloads(page);
    const job = page.getByTestId('anime-job');
    await expect(job.locator('.badge--running')).toHaveText('DOWNLOADING');
    await expect(job.getByText('25.0%')).toBeVisible();
    await job.getByRole('button', { name: 'CANCEL' }).click();
    await answerConfirm(page, 'Cancel this download?', 'CANCEL');
    await expect(job.locator('.badge--cancelled')).toHaveText('CANCELLED');

    // The fake would have written the file five seconds after it started: it must not, because nothing is left running.
    await page.waitForTimeout(7000);
    expect(existsSync(join(animeDir, 'Fake Anime', 'Season 1', 'Episode 1', 'Fake Anime Episode 1.mp4'))).toBe(false);
    // The folder of the episode goes with the unfinished file in it.
    expect(existsSync(join(animeDir, 'Fake Anime', 'Season 1', 'Episode 1'))).toBe(false);
    await expect(job.locator('.badge--cancelled')).toBeVisible();
    await backFromDownloads(page);
    await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
    await page.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
    await page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
    await expect(page.getByTestId('anime-episode').locator('.history__meta').first()).toHaveText('CANCELLED');
});

test('closing the app cancels a download that is running and deletes the folder of its episode, with the unfinished file', { tag: '@windows' }, async () => {
    const { page, animeDir } = session;
    await openAnimeTab(page);
    await search(page, 'slow');
    await page.getByRole('button', { name: 'OPEN: Fake Anime', exact: true }).click();
    await downloadFromLibrary(page, [1]);
    await showDownloads(page);
    await expect(page.getByTestId('anime-job').getByText('25.0%')).toBeVisible();
    const episodeFolder = join(animeDir, 'Fake Anime', 'Season 1', 'Episode 1');
    expect(existsSync(join(episodeFolder, 'Fake Anime Episode 1.mp4.part'))).toBe(true);

    await session.app.close();

    expect(existsSync(episodeFolder)).toBe(false);
    expect(existsSync(join(animeDir, 'Fake Anime', 'Season 1'))).toBe(true);

    session = await launch(join(workDir, 'user-data'));
    await openAnimeTab(session.page);
    await session.page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
    await session.page.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
    await session.page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
    // What was cut short by closing the app is a cancelled episode in the library, which can be downloaded again.
    await expect(session.page.getByTestId('anime-episode').locator('.history__meta').first()).toHaveText('CANCELLED');
});

test('closing the app with a paused episode keeps it as paused, with its unfinished file', { tag: '@windows' }, async () => {
    const { page, animeDir } = session;
    await openAnimeTab(page);
    await search(page, 'slow');
    await page.getByRole('button', { name: 'OPEN: Fake Anime', exact: true }).click();
    await downloadFromLibrary(page, [1]);
    await showDownloads(page);
    const job = page.getByTestId('anime-job');
    await expect(job.getByText('25.0%')).toBeVisible();
    await job.getByRole('button', { name: 'PAUSE' }).click();
    await expect(job.locator('.badge--paused')).toHaveText('PAUSED');

    await session.app.close();

    expect(existsSync(join(animeDir, 'Fake Anime', 'Season 1', 'Episode 1', 'Fake Anime Episode 1.mp4.part'))).toBe(true);
    session = await launch(join(workDir, 'user-data'));
    await openAnimeTab(session.page);
    await session.page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
    await session.page.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
    await session.page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
    await expect(session.page.getByTestId('anime-episode').locator('.history__meta').first()).toHaveText('PAUSED');
});

test('an episode paused when the app was closed is in the downloads again, and cancelling it from the library deletes its unfinished file', { tag: '@windows' }, async () => {
    const { page, animeDir } = session;
    await openAnimeTab(page);
    await search(page, 'slow');
    await page.getByRole('button', { name: 'OPEN: Fake Anime', exact: true }).click();
    await downloadFromLibrary(page, [1]);
    await showDownloads(page);
    const job = page.getByTestId('anime-job');
    await expect(job.getByText('25.0%')).toBeVisible();
    await job.getByRole('button', { name: 'PAUSE' }).click();
    await expect(job.locator('.badge--paused')).toHaveText('PAUSED');
    await session.app.close();
    const episodeFolder = join(animeDir, 'Fake Anime', 'Season 1', 'Episode 1');
    expect(existsSync(join(episodeFolder, 'Fake Anime Episode 1.mp4.part'))).toBe(true);

    session = await launch(join(workDir, 'user-data'));
    const reopened = session.page;
    await openAnimeTab(reopened);
    await showDownloads(reopened);
    const restored = reopened.getByTestId('anime-job');
    await expect(restored.locator('.badge--paused')).toHaveText('PAUSED');
    await expect(restored.getByRole('button', { name: 'RESUME' })).toBeVisible();
    await expect(restored.getByRole('button', { name: 'CANCEL' })).toBeVisible();
    await backFromDownloads(reopened);

    await reopened.getByRole('button', { name: 'LIBRARY', exact: true }).click();
    await reopened.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
    await reopened.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
    await reopened.getByRole('button', { name: 'CANCEL: Fake Anime EP 1' }).click();
    await answerConfirm(reopened, 'Cancel this download?', 'CANCEL');
    await expect(reopened.getByTestId('anime-episode').locator('.history__meta').first()).toHaveText('CANCELLED');
    await expect(reopened.getByRole('button', { name: 'CANCEL: Fake Anime EP 1' })).toHaveCount(0);
    expect(existsSync(episodeFolder)).toBe(false);
});

test('shows why a download failed and retries it', { tag: '@windows' }, async () => {
    const { page } = session;
    await openAnimeTab(page);
    await search(page, 'fail');
    await page.getByRole('button', { name: 'OPEN: Fake Anime', exact: true }).click();
    await downloadFromLibrary(page, [1]);

    await showDownloads(page);
    const job = page.getByTestId('anime-job');
    await expect(job.locator('.badge--error')).toHaveText('FAILED');
    const reason = job.getByRole('alert');
    await expect(reason).toHaveText('No video source was found for this episode.');
    await expect(reason).not.toHaveAttribute('title');
    await reason.getByRole('button', { name: 'No video source was found for this episode.' }).click();
    const details = page.getByRole('dialog', { name: 'ERROR DETAILS' });
    await expect(details.getByTestId('error-message')).toHaveText('No sources found for sub!');
    await expect(details.locator('.error-details__row').filter({ hasText: /^Code/ }).locator('dd')).toHaveText('NO_SOURCES');
    await details.getByRole('button', { name: 'CLOSE' }).click();
    await expect(details).toHaveCount(0);

    await job.getByRole('button', { name: 'RETRY' }).click();
    await expect(job.locator('.badge--error')).toHaveText('FAILED');
    expect(
        calls().filter((line) => {
            return line.includes('-d ');
        })
    ).toHaveLength(2);
});


test('tries an episode again by itself when the connection drops, and finishes it with no failure on the screen', { tag: '@windows' }, async () => {
    test.slow();
    const { page, animeDir } = session;
    await openAnimeTab(page);
    await search(page, 'flaky');
    await page.getByRole('button', { name: 'OPEN: Fake Anime', exact: true }).click();
    await downloadFromLibrary(page, [1]);

    await showDownloads(page);
    await expect(page.locator('.toast').filter({ hasText: 'Download complete: Fake Anime · EP 1' })).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('anime-job')).toHaveCount(0);
    await expect(page.getByText('FAILED')).toHaveCount(0);
    expect(existsSync(join(animeDir, 'Fake Anime', 'Season 1', 'Episode 1', 'Fake Anime Episode 1.mp4'))).toBe(true);
    // ani-cli was asked twice for the same episode: the one that failed with the connection and the one the queue made by itself.
    expect(
        calls().filter((line) => {
            return line === 'sub | -d -S 1 -e 1 -q 720p flaky';
        })
    ).toHaveLength(2);
});

test('tries again every failed download with RETRY FAILED', { tag: '@windows' }, async () => {
    const { page } = session;
    await openAnimeTab(page);
    await search(page, 'fail');
    await page.getByRole('button', { name: 'OPEN: Fake Anime', exact: true }).click();
    await downloadFromLibrary(page, [1]);

    await showDownloads(page);
    const job = page.getByTestId('anime-job');
    await expect(job.locator('.badge--error')).toHaveText('FAILED');
    const downloadCalls = (): number => {
        return calls().filter((line) => {
            return line.includes('-d ');
        }).length;
    };
    // NO_SOURCES is not tried again by itself: ani-cli was asked once.
    expect(downloadCalls()).toBe(1);

    await page.getByRole('button', { name: 'RETRY FAILED (1)' }).click();

    await expect.poll(downloadCalls).toBe(2);
    await expect(job.locator('.badge--error')).toHaveText('FAILED');
    await expect(page.getByRole('button', { name: 'RETRY FAILED (1)' })).toBeVisible();
});

test('pauses everything at once with PAUSE ALL and goes on with everything with RESUME ALL', { tag: '@windows' }, async () => {
    test.slow();
    const { page, animeDir } = session;
    await openAnimeTab(page);
    await search(page, 'slow');
    await page.getByRole('button', { name: 'OPEN: Fake Anime', exact: true }).click();
    await downloadFromLibrary(page, [1, 2, 3]);

    await showDownloads(page);
    const jobs = page.getByTestId('anime-job');
    await expect(jobs.locator('.badge--running')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'RESUME ALL' })).toHaveCount(0);
    await page.getByRole('button', { name: 'PAUSE ALL' }).click();

    await expect(jobs.locator('.badge--paused')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'PAUSE ALL' })).toHaveCount(0);
    expect(existsSync(join(animeDir, 'Fake Anime', 'Season 1', 'Episode 1', 'Fake Anime Episode 1.mp4'))).toBe(false);
    await page.getByRole('button', { name: 'RESUME ALL' }).click();
    await expect(page.locator('.toast').filter({ hasText: 'Download complete: ' }).first()).toBeVisible({ timeout: 30000 });
    await expect(jobs).toHaveCount(0, { timeout: 30000 });
    for (const episode of [1, 2, 3]) {
        expect(existsSync(join(animeDir, 'Fake Anime', 'Season 1', `Episode ${String(episode)}`, `Fake Anime Episode ${String(episode)}.mp4`))).toBe(true);
    }
});

test('pauses and resumes the downloads of an anime picked in the window of MANAGE, without holding the queue', { tag: '@windows' }, async () => {
    test.slow();
    const { page, animeDir } = session;
    await openAnimeTab(page);
    await search(page, 'slow');
    await page.getByRole('button', { name: 'OPEN: Fake Anime', exact: true }).click();
    await downloadFromLibrary(page, [1, 2, 3]);

    await showDownloads(page);
    const jobs = page.getByTestId('anime-job');
    await expect(jobs.locator('.badge--running')).toHaveCount(3);
    await page.getByRole('button', { name: 'MANAGE' }).click();
    const manage = page.getByRole('dialog', { name: 'Manage downloads' });
    await expect(manage.getByRole('listitem')).toHaveText(['Fake Anime · 3 downloading · 0 waiting · 0 paused']);
    await expect(manage.getByRole('button', { name: 'PAUSE SELECTED' })).toBeDisabled();
    await manage.getByRole('checkbox', { name: 'Fake Anime' }).check();
    await expect(manage.getByRole('button', { name: 'RESUME SELECTED' })).toBeDisabled();
    await manage.getByRole('button', { name: 'PAUSE SELECTED' }).click();

    await expect(manage.getByRole('listitem')).toHaveText(['Fake Anime · 0 downloading · 0 waiting · 3 paused']);
    await manage.getByRole('button', { name: 'CLOSE' }).click();
    await expect(manage).toHaveCount(0);
    await expect(jobs.locator('.badge--paused')).toHaveCount(3);
    // Only the anime was paused: the queue itself is not held.
    await expect(page.getByText(/The downloads are paused/)).toHaveCount(0);
    expect(existsSync(join(animeDir, 'Fake Anime', 'Season 1', 'Episode 1', 'Fake Anime Episode 1.mp4'))).toBe(false);

    await page.getByRole('button', { name: 'MANAGE' }).click();
    await manage.getByRole('checkbox', { name: 'Select all' }).check();
    await expect(manage.getByRole('button', { name: 'PAUSE SELECTED' })).toBeDisabled();
    await manage.getByRole('button', { name: 'RESUME SELECTED' }).click();
    await manage.getByRole('button', { name: 'CLOSE' }).click();
    await expect(page.locator('.toast').filter({ hasText: 'Download complete: ' }).first()).toBeVisible({ timeout: 30000 });
    await expect(jobs).toHaveCount(0, { timeout: 30000 });
    for (const episode of [1, 2, 3]) {
        expect(existsSync(join(animeDir, 'Fake Anime', 'Season 1', `Episode ${String(episode)}`, `Fake Anime Episode ${String(episode)}.mp4`))).toBe(true);
    }
});

test('cancels the downloads of the anime picked in the window of MANAGE after asking, deleting what they downloaded', { tag: '@windows' }, async () => {
    const { page, animeDir } = session;
    await openAnimeTab(page);
    await search(page, 'slow');
    await page.getByRole('button', { name: 'OPEN: Fake Anime', exact: true }).click();
    await downloadFromLibrary(page, [1, 2, 3]);

    await showDownloads(page);
    const jobs = page.getByTestId('anime-job');
    await expect(jobs.locator('.badge--running')).toHaveCount(3);
    await page.getByRole('button', { name: 'MANAGE' }).click();
    const manage = page.getByRole('dialog', { name: 'Manage downloads' });
    await expect(manage.getByRole('button', { name: 'CANCEL SELECTED' })).toBeDisabled();
    await manage.getByRole('checkbox', { name: 'Select all' }).check();
    await manage.getByRole('button', { name: 'CANCEL SELECTED' }).click();
    // Going back keeps the downloads going.
    await answerConfirm(page, 'Cancel the downloads of the selected anime?', 'BACK');
    await expect(jobs.locator('.badge--running')).toHaveCount(3);

    await manage.getByRole('button', { name: 'CANCEL SELECTED' }).click();
    await expect(page.getByRole('dialog', { name: 'Cancel the downloads of the selected anime?' }).getByText('Every episode of them that is downloading, waiting or paused stops, and what it downloaded so far is deleted. You can start them again later.')).toBeVisible();
    await answerConfirm(page, 'Cancel the downloads of the selected anime?', 'CANCEL SELECTED');

    await expect(manage.getByText('No downloads to manage.')).toBeVisible();
    await manage.getByRole('button', { name: 'CLOSE' }).click();
    await expect(jobs.locator('.badge--cancelled')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'MANAGE' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'RETRY FAILED (3)' })).toBeVisible();
    // Nothing is left running to finish the files, and the folders of the episodes go with what was in them.
    await page.waitForTimeout(7000);
    for (const episode of [1, 2, 3]) {
        expect(existsSync(join(animeDir, 'Fake Anime', 'Season 1', `Episode ${String(episode)}`))).toBe(false);
    }
});

test('keeps the library after the app is restarted', { tag: '@windows' }, async () => {
    const { page, userData } = session;
    await openAnimeTab(page);
    await openFirstResult(page);
    await downloadFromLibrary(page, [1]);
    await waitForDownloaded(page);
    await session.app.close();

    session = await launch(userData);
    await openAnimeTab(session.page);
    await session.page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
    await expect(session.page.getByTestId('anime-card').getByText('1 SEASON')).toBeVisible();
    await session.page.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
    await expect(session.page.getByText('1/3 DOWNLOADED')).toBeVisible();
    await session.page.getByRole('button', { name: 'BACK TO LIBRARY', exact: true }).click();
    await showDownloads(session.page);
    await expect(session.page.getByTestId('anime-job')).toHaveCount(0);
    await expect(session.page.getByText('// NO DOWNLOADS YET.')).toBeVisible();
});

test.describe('player', { tag: '@windows' }, () => {
    async function downloadEpisode(page: Page): Promise<void> {
        await openAnimeTab(page);
        await openFirstResult(page);
        await downloadFromLibrary(page, [1]);
        await waitForDownloaded(page);
    }

    interface MediaAnswer {
        status: number;
        headers: Record<string, string>;
        body: string;
    }

    // Asked from the main process: the page itself is not allowed to fetch() this scheme (its CSP only lets media through).
    async function request(url: string, range?: string): Promise<MediaAnswer> {
        return session.app.evaluate(
            async ({ net }, [target, header]) => {
                const response = await net.fetch(target as string, header ? { headers: { Range: header } } : undefined);
                const headers: Record<string, string> = {};
                response.headers.forEach((value, key) => {
                    headers[key] = value;
                });
                return { status: response.status, headers, body: await response.text() };
            },
            [url, range ?? ''] as const
        );
    }

    test('serves the whole file, the part that is asked for and the subtitles', async () => {
        const { page } = session;
        await downloadEpisode(page);

        const whole = await request('pullwave-media://episode/1');
        expect(whole.status).toBe(200);
        expect(whole.headers).toMatchObject({ 'content-type': 'video/mp4', 'content-length': '19', 'accept-ranges': 'bytes' });
        expect(whole.body).toBe('FAKEVIDEO0123456789');

        const part = await request('pullwave-media://episode/1', 'bytes=9-13');
        expect(part.status).toBe(206);
        expect(part.headers).toMatchObject({ 'content-type': 'video/mp4', 'content-length': '5', 'content-range': 'bytes 9-13/19', 'accept-ranges': 'bytes' });
        expect(part.body).toBe('01234');

        const subtitles = await request('pullwave-media://subtitle/1');
        expect(subtitles.status).toBe(200);
        expect(subtitles.headers['content-type']).toBe('text/vtt; charset=utf-8');
        expect(subtitles.body).toBe('WEBVTT\n');
    });

    test('refuses a range past the end and what is not in the library', async () => {
        const { page } = session;
        await downloadEpisode(page);

        const past = await request('pullwave-media://episode/1', 'bytes=500-600');
        expect(past.status).toBe(416);
        expect(past.headers['content-range']).toBe('bytes */19');

        const unknown = await request('pullwave-media://episode/99');
        expect(unknown.status).toBe(404);
        expect(unknown.body).toBe('');
        expect((await request('pullwave-media://episode/abc')).status).toBe(404);
    });

    test('opens the video of a downloaded episode in a dialog and closes it', async () => {
        const { page } = session;
        await downloadEpisode(page);
        await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
        await page.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
        await page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
        await page.getByRole('button', { name: 'PLAY: Fake Anime EP 1' }).click();

        const dialog = page.getByRole('dialog', { name: 'Fake Anime · EP 1' });
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('video')).toHaveAttribute('src', /^pullwave-media:\/\/episode\/1\?v=\d+$/);
        // The control bar is the app's own, not the browser's, so it follows the theme.
        await expect(dialog.locator('video')).not.toHaveAttribute('controls');
        await expect(dialog.locator('.player__controls')).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Play' })).toBeVisible();
        await expect(dialog.getByRole('slider', { name: 'Seek' })).toBeVisible();
        await expect(dialog.getByRole('slider', { name: 'Volume' })).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Fullscreen' })).toBeVisible();
        // The fake file is not a real video: the player says so instead of staying blank.
        await expect(dialog.getByRole('alert')).toHaveText('This video could not be played. Its format may not be supported by the app.');

        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
    });
});

async function downloadFirstEpisode(page: Page): Promise<void> {
    await openAnimeTab(page);
    await openFirstResult(page);
    await downloadFromLibrary(page, [1]);
    await waitForDownloaded(page);
}

test('an episode cannot be removed: it has no remove button, only the anime and the series can', async () => {
    const { page, animeDir } = session;
    await downloadFirstEpisode(page);
    const video = join(animeDir, 'Fake Anime', 'Season 1', 'Episode 1', 'Fake Anime Episode 1.mp4');
    expect(existsSync(video)).toBe(true);

    await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
    await page.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
    await page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
    await expect(page.getByTestId('anime-episode')).toHaveCount(3);
    await expect(page.getByRole('button', { name: /^REMOVE: / })).toHaveCount(0);
    await expect(page.getByTestId('anime-episode').getByRole('button', { name: /^REMOVE/ })).toHaveCount(0);
    expect(existsSync(video)).toBe(true);
});

test('removes a series with its files and its folder', { tag: '@windows' }, async () => {
    const { page, animeDir } = session;
    await downloadFirstEpisode(page);
    writeFileSync(join(animeDir, 'Fake Anime', 'leftover.part'), 'x');
    expect(existsSync(join(animeDir, 'Fake Anime'))).toBe(true);

    await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
    await page.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
    await page.getByRole('button', { name: 'Series options: Fake Anime' }).click();
    await page.getByRole('button', { name: 'REMOVE SERIES: Fake Anime' }).click();
    await answerConfirm(page, 'Remove the series "Fake Anime"?', 'REMOVE');

    await expect(page.getByText('// THE LIBRARY IS EMPTY. SEARCH AN ANIME AND ADD IT TO THE LIBRARY.')).toBeVisible();
    await expect.poll(() => {
        return existsSync(join(animeDir, 'Fake Anime'));
    }).toBe(false);
    // What is outside the folder of the anime is left alone.
    expect(existsSync(animeDir)).toBe(true);
});

test.describe('library and folder in sync', { tag: '@windows' }, () => {
    async function openLibrary(page: Page): Promise<void> {
        await openAnimeTab(page);
        await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
    }

    test('rebuilds the library from the folder when the library was lost, with the metadata next to the video', async () => {
        const { page, userData, animeDir } = session;
        await downloadFirstEpisode(page);
        const metadata = join(animeDir, 'Fake Anime', 'Season 1', 'Episode 1', 'pullwave.json');
        expect(JSON.parse(readFileSync(metadata, 'utf-8'))).toEqual({
            version: 1,
            title: 'Fake Anime',
            query: 'fake',
            searchIndex: 1,
            audio: 'sub',
            number: '1',
            positionSeconds: 0,
            durationSeconds: 0,
            watched: false,
            series: 'Fake Anime',
            season: 1
        });
        await session.app.close();
        rmSync(join(userData, 'anime', 'anime.db'), { force: true });

        session = await launch(userData);
        await openLibrary(session.page);
        await expect(session.page.getByText('// THE LIBRARY IS EMPTY. SEARCH AN ANIME AND ADD IT TO THE LIBRARY.')).toBeVisible();
        await session.page.getByRole('button', { name: 'IMPORT LIBRARY' }).click();

        await expect(session.page.locator('.toast__message', { hasText: 'IMPORT DONE' })).toHaveText('IMPORT DONE: 1 ADDED · 0 POINTED TO A NEW PLACE · 0 ALREADY IN THE LIBRARY · 0 NOT RECOGNIZED');
        const card = session.page.getByTestId('anime-card');
        await expect(card.getByRole('heading')).toHaveText('Fake Anime');
        await expect(card.getByText('1 SEASON')).toBeVisible();
        await card.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
        // The library that is rebuilt only knows the episodes that are in the folder.
        await expect(session.page.getByText('1/1 DOWNLOADED')).toBeVisible();
        await session.page.getByRole('button', { name: 'BACK TO LIBRARY', exact: true }).click();

        // The second time everything is already there.
        await session.page.getByRole('button', { name: 'IMPORT LIBRARY' }).click();
        await expect(session.page.locator('.toast__message', { hasText: 'IMPORT DONE' })).toHaveText('IMPORT DONE: 0 ADDED · 0 POINTED TO A NEW PLACE · 1 ALREADY IN THE LIBRARY · 0 NOT RECOGNIZED');
        await expect(session.page.getByTestId('anime-card')).toHaveCount(1);
    });

    test('marks an episode whose file is gone, and the import fixes it when the folder was renamed', async () => {
        const { page, animeDir } = session;
        await downloadFirstEpisode(page);
        await openLibrary(page);
        await page.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
        await page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
        await expect(page.getByRole('img', { name: 'FILE NOT FOUND' })).toHaveCount(0);

        renameSync(join(animeDir, 'Fake Anime'), join(animeDir, 'My Renamed Folder'));
        // The library looks at the disk when it is shown.
        await page.locator('.tab', { hasText: 'SEARCH' }).click();
        await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
        await page.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
        await page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
        await expect(page.getByRole('img', { name: 'FILE NOT FOUND' })).toHaveCount(1);
        // An episode whose file is gone cannot be played: its row is not a way into the player.
        await expect(page.getByRole('button', { name: 'PLAY: Fake Anime EP 1' })).toHaveCount(0);
        await expect(page.getByTestId('anime-episode').first()).not.toHaveClass(/row--link/);

        // The import is on the cards: the screen of the season goes back to the series, and this one to the library.
        await page.getByRole('button', { name: 'BACK', exact: true }).click();
        await page.getByRole('button', { name: 'BACK TO LIBRARY', exact: true }).click();
        await page.getByRole('button', { name: 'IMPORT LIBRARY' }).click();
        await expect(page.locator('.toast__message', { hasText: 'IMPORT DONE' })).toHaveText('IMPORT DONE: 0 ADDED · 1 POINTED TO A NEW PLACE · 0 ALREADY IN THE LIBRARY · 0 NOT RECOGNIZED');
        await expect(page.getByTestId('anime-card')).toHaveCount(1);
        await page.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
        await page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
        await expect(page.getByRole('img', { name: 'FILE NOT FOUND' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'PLAY: Fake Anime EP 1' })).toBeEnabled();
        await expect(page.getByTestId('anime-episode').first()).toHaveClass(/row--link/);
    });

    test('shows the mark and does not offer the player for an episode whose file was removed from the disk', async () => {
        const { page, animeDir } = session;
        await downloadFirstEpisode(page);
        rmSync(join(animeDir, 'Fake Anime', 'Season 1', 'Episode 1', 'Fake Anime Episode 1.mp4'));

        await openLibrary(page);
        await page.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
        await page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
        const row = page.getByTestId('anime-episode');
        await expect(row.getByRole('img', { name: 'FILE NOT FOUND' })).toHaveAttribute(
            'title',
            'The file of this episode is not on the disk. Use DOWNLOAD AGAIN to get it back, or IMPORT LIBRARY if you moved it.'
        );
        await expect(row.getByRole('button', { name: 'DOWNLOAD AGAIN: Fake Anime EP 1' })).toBeEnabled();
        await expect(row.getByRole('button', { name: 'PLAY: Fake Anime EP 1' })).toHaveCount(0);
        // Clicking the row does not start the player.
        await row.locator('.history__meta').first().click({ force: true });
        await expect(page.getByRole('dialog')).toHaveCount(0);
    });

    for (const removed of ['the video', 'the whole folder of the episode']) {
        test(`downloads an episode again with DOWNLOAD AGAIN when ${removed} was removed from the disk`, async () => {
            const { page, animeDir } = session;
            await downloadFirstEpisode(page);
            const folder = join(animeDir, 'Fake Anime', 'Season 1', 'Episode 1');
            const video = join(folder, 'Fake Anime Episode 1.mp4');
            rmSync(removed === 'the video' ? video : folder, { recursive: true });
            expect(existsSync(video)).toBe(false);

            await openLibrary(page);
            await page.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
            await page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
            const row = page.getByTestId('anime-episode').first();
            await expect(row.getByRole('img', { name: 'FILE NOT FOUND' })).toHaveCount(1);
            await expect(row.getByRole('button', { name: 'RETRY: Fake Anime EP 1' })).toHaveCount(0);

            await row.getByRole('button', { name: 'DOWNLOAD AGAIN: Fake Anime EP 1' }).click();
            await waitForDownloaded(page);

            expect(existsSync(video)).toBe(true);
            await expect(row.getByRole('img', { name: 'FILE NOT FOUND' })).toHaveCount(0);
            await expect(row.getByRole('button', { name: 'DOWNLOAD AGAIN: Fake Anime EP 1' })).toHaveCount(0);
            await expect(row.getByRole('button', { name: 'PLAY: Fake Anime EP 1' })).toBeEnabled();
            await expect(row).toHaveClass(/row--link/);
            await expect(row).not.toHaveClass(/history__item--error/);
        });
    }

    test('downloads a new episode into the folder the anime was renamed to, once the library knows about it', async () => {
        const { page, animeDir } = session;
        await downloadFirstEpisode(page);
        renameSync(join(animeDir, 'Fake Anime'), join(animeDir, 'My Renamed Folder'));
        await openLibrary(page);
        await page.getByRole('button', { name: 'IMPORT LIBRARY' }).click();
        await expect(page.locator('.toast__message', { hasText: 'IMPORT DONE' })).toHaveText('IMPORT DONE: 0 ADDED · 1 POINTED TO A NEW PLACE · 0 ALREADY IN THE LIBRARY · 0 NOT RECOGNIZED');
        await page.getByRole('button', { name: 'SEARCH', exact: true }).first().click();

        await openFirstResult(page);
        await downloadFromLibrary(page, [2]);
        await waitForDownloaded(page);

        expect(existsSync(join(animeDir, 'My Renamed Folder', 'Season 1', 'Episode 2', 'Fake Anime Episode 2.mp4'))).toBe(true);
        expect(existsSync(join(animeDir, 'Fake Anime'))).toBe(false);
    });
});

test.describe('the check of the downloaded episodes', () => {
    const FFMPEG = join(ROOT, 'resources', 'bin', `ffmpeg${EXE}`);
    test.skip(!existsSync(FFMPEG), 'needs the real ffmpeg of resources/bin (node scripts/fetch-binaries.mjs)');

    // The video the fake ani-cli wrote is not a real one: it is replaced by one that has a picture and no audio.
    function replaceWithSilentVideo(video: string): void {
        execFileSync(FFMPEG, ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=64x64:rate=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', video], { stdio: 'pipe' });
    }

    async function downloadSilentEpisode(page: Page, animeDir: string): Promise<string> {
        await downloadFirstEpisode(page);
        const video = join(animeDir, 'Fake Anime', 'Season 1', 'Episode 1', 'Fake Anime Episode 1.mp4');
        replaceWithSilentVideo(video);
        return video;
    }

    test('lists the episodes with a problem from the settings, and downloads them all again', async () => {
        const { page, animeDir } = session;
        const video = await downloadSilentEpisode(page, animeDir);
        const silentSize = statSync(video).size;
        await openAnimeSettings(page);

        await page.getByRole('button', { name: 'CHECK DOWNLOADED EPISODES' }).click();

        const dialog = page.getByRole('dialog', { name: 'Downloaded episodes' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByTestId('audio-report-summary')).toContainText('COULD NOT BE READ');
        await expect(dialog.getByText('1 EPISODE(S) WITH A PROBLEM:')).toBeVisible();
        await expect(dialog.getByTestId('audio-problem')).toHaveText(['Fake Anime · EP 1 — NO AUDIO']);

        await dialog.getByRole('button', { name: 'DOWNLOAD ALL AGAIN (1)' }).click();

        await expect(dialog).toBeHidden();
        await expect(page.locator('.toast__message', { hasText: 'Queued 1 episode(s) to be downloaded again.' })).toBeVisible();
        await waitForDownloaded(page);
        // The video with no audio was deleted and the fake ani-cli wrote its own again.
        await expect.poll(() => {
            return existsSync(video) && statSync(video).size !== silentSize;
        }).toBe(true);
    });

    // The video as yt-dlp saves it when the source hides it behind pictures: a real video of 4 segments, and the picture in front of each one.
    function hiddenVideoAt(path: string): void {
        const segments = mkdtempSync(join(tmpdir(), 'pullwave-hidden-'));
        try {
            execFileSync(
                FFMPEG,
                ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=4:size=64x64:rate=10', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-force_key_frames', 'expr:gte(t,n_forced*1)', '-c:a', 'aac', '-f', 'hls', '-hls_time', '1', '-hls_playlist_type', 'vod', '-hls_segment_filename', join(segments, 'seg%d.ts'), join(segments, 'index.m3u8')],
                { stdio: 'pipe' }
            );
            const names = readdirSync(segments)
                .filter((name) => {
                    return /^seg\d+\.ts$/.test(name);
                })
                .sort((first, second) => {
                    return Number(first.replace(/\D/g, '')) - Number(second.replace(/\D/g, ''));
                });
            expect(names).toHaveLength(4);
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(
                path,
                Buffer.concat(
                    names.map((name) => {
                        return hiddenSegment(readFileSync(join(segments, name)));
                    })
                )
            );
        } finally {
            rmSync(segments, { recursive: true, force: true });
        }
    }

    // What ffmpeg says of a video: whether it reads as one, and the streams it has.
    function describeVideo(path: string): string {
        return spawnSync(FFMPEG, ['-hide_banner', '-i', path], { encoding: 'utf-8' }).stderr;
    }

    function startsAsMp4(path: string): boolean {
        return readFileSync(path).subarray(4, 8).toString('ascii') === 'ftyp';
    }

    test('lists an episode hidden behind pictures as one that could not be read, and repairs it from the window', async () => {
        const { page, animeDir } = session;
        await downloadFirstEpisode(page);
        const video = join(animeDir, 'Fake Anime', 'Season 1', 'Episode 1', 'Fake Anime Episode 1.mp4');
        hiddenVideoAt(video);
        expect(startsAsMp4(video)).toBe(false);
        expect(describeVideo(video)).not.toContain('Video: h264');
        await openAnimeSettings(page);

        await page.getByRole('button', { name: 'CHECK DOWNLOADED EPISODES' }).click();

        const dialog = page.getByRole('dialog', { name: 'Downloaded episodes' });
        await expect(dialog.getByTestId('audio-report-summary')).toContainText('1 COULD NOT BE READ');
        await expect(dialog.getByTestId('audio-problem')).toHaveText(['Fake Anime · EP 1 — COULD NOT BE READ']);
        await expect(dialog.getByRole('button', { name: 'REPAIR (1)' })).toBeEnabled();
        await expect(dialog.getByRole('button', { name: /^DOWNLOAD ALL AGAIN/ })).toHaveCount(0);

        await dialog.getByRole('button', { name: 'REPAIR (1)' }).click();

        await expect(dialog).toBeHidden();
        await expect(page.locator('.toast__message', { hasText: 'repaired' })).toHaveText('1 episode(s) repaired · 0 could not be repaired.');
        expect(startsAsMp4(video)).toBe(true);
        const repaired = describeVideo(video);
        expect(repaired).toContain('Video: h264');
        expect(repaired).toContain('Audio: aac');
        expect(repaired).toMatch(/Duration: 00:00:0[34]\./);
        expect(readdirSync(dirname(video))).not.toContainEqual(expect.stringContaining('.pullwave-repair'));
        // The check finds nothing wrong with it now.
        await page.getByRole('button', { name: 'CHECK DOWNLOADED EPISODES' }).click();
        await expect(page.getByRole('dialog', { name: 'Downloaded episodes' }).getByRole('status')).toHaveText('No problems found in the downloaded episodes.');
    });

    test('plays the episode right after it was repaired, though the same address could not be played before', async () => {
        const { page, animeDir } = session;
        await downloadFirstEpisode(page);
        hiddenVideoAt(join(animeDir, 'Fake Anime', 'Season 1', 'Episode 1', 'Fake Anime Episode 1.mp4'));
        const play = async (): Promise<Locator> => {
            await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
            const series = page.getByRole('button', { name: 'OPEN SERIES: Fake Anime' });
            if ((await series.count()) > 0) {
                await series.click();
            }
            const show = page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true });
            if ((await show.count()) > 0) {
                await show.click();
            }
            await page.getByRole('button', { name: 'PLAY: Fake Anime EP 1' }).click();
            const dialog = page.getByRole('dialog', { name: 'Fake Anime · EP 1' });
            await expect(dialog).toBeVisible();
            return dialog;
        };

        // The file is not a video yet: the player says so, and the browser learns that about its address.
        const before = await play();
        await expect(before.getByRole('alert')).toHaveText('This video could not be played. Its format may not be supported by the app.');
        await page.keyboard.press('Escape');
        await expect(before).toBeHidden();

        await openAnimeSettings(page);
        await page.getByRole('button', { name: 'CHECK DOWNLOADED EPISODES' }).click();
        const report = page.getByRole('dialog', { name: 'Downloaded episodes' });
        await report.getByRole('button', { name: 'REPAIR (1)' }).click();
        await expect(page.locator('.toast__message', { hasText: 'repaired' })).toHaveText('1 episode(s) repaired · 0 could not be repaired.');

        const after = await play();
        await expect(after.getByRole('alert')).toHaveCount(0);
        await expect.poll(() => {
            return after.locator('video').evaluate((element: HTMLVideoElement) => {
                return { duration: Math.round(element.duration), time: element.currentTime > 0.3, error: element.error === null };
            });
        }, { timeout: 20000 }).toEqual({ duration: 4, time: true, error: true });
    });

    test('repairs an episode hidden behind pictures by itself when it is downloaded, so it is never listed', async () => {
        const { page, animeDir, userData } = session;
        const source = join(workDir, 'hidden-source.mp4');
        hiddenVideoAt(source);
        mkdirSync(join(userData, 'anime', 'history'), { recursive: true });
        writeFileSync(join(userData, 'anime', 'history', 'hidden-video'), source);

        await downloadFirstEpisode(page);

        const video = join(animeDir, 'Fake Anime', 'Season 1', 'Episode 1', 'Fake Anime Episode 1.mp4');
        await expect.poll(() => {
            return startsAsMp4(video);
        }, { timeout: 30000 }).toBe(true);
        const repaired = describeVideo(video);
        expect(repaired).toContain('Video: h264');
        expect(repaired).toContain('Audio: aac');
        expect(readdirSync(dirname(video))).not.toContainEqual(expect.stringContaining('.pullwave-repair'));
        await openAnimeSettings(page);
        await page.getByRole('button', { name: 'CHECK DOWNLOADED EPISODES' }).click();
        await expect(page.getByRole('dialog', { name: 'Downloaded episodes' }).getByRole('status')).toHaveText('No problems found in the downloaded episodes.');
    });

    // The video the fake ani-cli wrote is not a real one (it would be listed as one that could not be read): an episode that is fine has a picture and audio.
    function replaceWithGoodVideo(video: string): void {
        execFileSync(FFMPEG, ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=64x64:rate=10', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video], { stdio: 'pipe' });
    }

    test('says there is no problem when the downloaded episodes are fine', async () => {
        const { page, animeDir } = session;
        await downloadFirstEpisode(page);
        replaceWithGoodVideo(join(animeDir, 'Fake Anime', 'Season 1', 'Episode 1', 'Fake Anime Episode 1.mp4'));
        await openAnimeSettings(page);

        await page.getByRole('button', { name: 'CHECK DOWNLOADED EPISODES' }).click();

        const dialog = page.getByRole('dialog', { name: 'Downloaded episodes' });
        await expect(dialog.getByRole('status')).toHaveText('No problems found in the downloaded episodes.');
        await expect(dialog.getByTestId('audio-problem')).toHaveCount(0);
        await expect(dialog.getByRole('button', { name: /^DOWNLOAD ALL AGAIN/ })).toHaveCount(0);
        await dialog.getByRole('button', { name: 'CLOSE' }).click();
        await expect(dialog).toBeHidden();
    });

    test('marks the episode in the library, and replaces its video once the user confirms', async () => {
        const { page, animeDir } = session;
        const video = await downloadSilentEpisode(page, animeDir);
        const silentSize = statSync(video).size;
        await openAnimeSettings(page);
        await page.getByRole('button', { name: 'CHECK DOWNLOADED EPISODES' }).click();
        await page.getByRole('dialog', { name: 'Downloaded episodes' }).getByRole('button', { name: 'CLOSE' }).click();

        await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
        await page.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
        await page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
        const row = page.getByTestId('anime-episode').first();
        await expect(row.getByRole('img', { name: 'NO AUDIO' })).toHaveAttribute('title', 'The video of this episode has no audio. Use DOWNLOAD AGAIN to replace it.');
        // The file is there, so the episode can still be played.
        await expect(row.getByRole('button', { name: 'PLAY: Fake Anime EP 1' })).toBeEnabled();

        await row.getByRole('button', { name: 'DOWNLOAD AGAIN: Fake Anime EP 1' }).click();
        const confirm = page.getByRole('dialog', { name: 'Download again?' });
        await expect(confirm).toBeVisible();
        expect(statSync(video).size).toBe(silentSize);
        await confirm.getByRole('button', { name: 'DOWNLOAD AGAIN' }).click();

        await waitForDownloaded(page);
        await expect.poll(() => {
            return existsSync(video) && statSync(video).size !== silentSize;
        }).toBe(true);
        await expect(row.getByRole('img', { name: 'NO AUDIO' })).toHaveCount(0);
    });
});

test.describe('the next episode that starts by itself, and the icons of the player', () => {
    // Two episodes downloaded, the first one open in the player. The fake files are not real videos: the end of one is told to the player.
    async function playFirstOfTwo(page: Page): Promise<Locator> {
        await openAnimeTab(page);
        await openFirstResult(page);
        await downloadFromLibrary(page, [1, 2]);
        await waitForDownloaded(page);
        await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
        await page.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
        await page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
        await page.getByRole('button', { name: 'PLAY: Fake Anime EP 1' }).click();
        const dialog = page.getByRole('dialog', { name: 'Fake Anime · EP 1' });
        await expect(dialog).toBeVisible();
        return dialog;
    }

    async function endEpisode(dialog: Locator): Promise<void> {
        await dialog.locator('video').evaluate((video) => {
            video.dispatchEvent(new Event('ended'));
        });
    }

    test('draws the icons of the buttons of the player at the same height, and the buttons at the same width', async () => {
        const { page } = session;
        const dialog = await playFirstOfTwo(page);
        await dialog.getByRole('button', { name: 'Settings' }).waitFor();
        const sizes = await dialog.locator('.player__controls').evaluate((controls) => {
            return Array.from(controls.querySelectorAll<HTMLElement>('.player__icon')).map((icon) => {
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d')!;
                const style = getComputedStyle(icon);
                context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
                const ink = context.measureText(icon.textContent ?? '');
                return {
                    height: ink.actualBoundingBoxAscent + ink.actualBoundingBoxDescent,
                    buttonWidth: (icon.parentElement as HTMLElement).getBoundingClientRect().width
                };
            });
        });
        // Play, sound, gear and fullscreen.
        expect(sizes).toHaveLength(4);
        const heights = sizes.map((size) => {
            return size.height;
        });
        expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(2);
        sizes.forEach((size) => {
            expect(size.buttonWidth).toBe(44);
        });
    });

    test('counts down to the next episode when one ends, over the video, and plays it by itself', async () => {
        const { page } = session;
        const dialog = await playFirstOfTwo(page);
        await endEpisode(dialog);
        const panel = dialog.getByRole('region', { name: 'NEXT EPISODE' });
        await expect(panel).toBeVisible();
        await expect(panel).toContainText('Fake Anime · EP 2');
        await expect(panel.getByRole('button', { name: 'PLAY NOW' })).toBeFocused();
        await expect(dialog.locator('.player__stage .player__auto-next')).toHaveCount(1);
        const bar = panel.getByRole('progressbar', { name: 'Time until the next episode starts' });
        await expect.poll(async () => {
            return Number(await bar.getAttribute('aria-valuenow'));
        }).toBeGreaterThan(10);
        await expect(page.getByRole('dialog', { name: 'Fake Anime · EP 2' })).toBeVisible({ timeout: 15000 });
        await expect(page.getByRole('dialog', { name: 'Fake Anime · EP 2' }).locator('video')).toHaveAttribute('src', /^pullwave-media:\/\/episode\/2\?v=\d+$/);
    });

    for (const way of ['by itself when the count is over', 'at once with PLAY NOW']) {
        test(`stays in fullscreen when the next episode starts ${way} @resize`, async () => {
            const { page } = session;
            const fullscreenOf = async (): Promise<string | null> => {
                return page.evaluate(() => {
                    return document.fullscreenElement === null ? null : document.fullscreenElement.className;
                });
            };
            // The stage is marked: it must be the very same element after the episode changes, not another one that was put in fullscreen.
            const markOfStage = (): Promise<string> => {
                return page.evaluate(() => {
                    const stage = document.fullscreenElement as HTMLElement & { pullwaveMark?: string };
                    stage.pullwaveMark = stage.pullwaveMark ?? 'same stage';
                    return stage.pullwaveMark;
                });
            };
            const dialog = await playFirstOfTwo(page);
            await dialog.getByRole('button', { name: 'Fullscreen' }).click();
            await expect.poll(fullscreenOf).toBe('player__stage');
            expect(await markOfStage()).toBe('same stage');

            await endEpisode(dialog);
            const panel = dialog.getByRole('region', { name: 'NEXT EPISODE' });
            await expect(panel).toBeVisible();
            if (way.endsWith('PLAY NOW')) {
                await panel.getByRole('button', { name: 'PLAY NOW' }).click();
            }
            const second = page.getByRole('dialog', { name: 'Fake Anime · EP 2' });
            await expect(second).toBeVisible({ timeout: 15000 });
            await expect(second.locator('video')).toHaveAttribute('src', /^pullwave-media:\/\/episode\/2\?v=\d+$/);

            // The viewer is still in fullscreen, in the same stage, with the controls of the new episode in it.
            expect(await fullscreenOf()).toBe('player__stage');
            expect(await markOfStage()).toBe('same stage');
            await expect(second.locator('.player__stage').getByRole('button', { name: 'Fullscreen' })).toBeVisible();

            // Leaving fullscreen is still up to the viewer.
            await second.getByRole('button', { name: 'Fullscreen' }).click();
            await expect.poll(fullscreenOf).toBeNull();
        });
    }

    test('plays the next episode at once with PLAY NOW, and stays with CANCEL', async () => {
        const { page } = session;
        const dialog = await playFirstOfTwo(page);
        await endEpisode(dialog);
        await dialog.getByRole('button', { name: 'CANCEL' }).click();
        await expect(dialog.getByRole('region', { name: 'NEXT EPISODE' })).toHaveCount(0);
        await page.waitForTimeout(1500);
        await expect(dialog).toBeVisible();

        await endEpisode(dialog);
        await dialog.getByRole('button', { name: 'PLAY NOW' }).click();
        await expect(page.getByRole('dialog', { name: 'Fake Anime · EP 2' })).toBeVisible();
    });

    test('presses PLAY NOW and CANCEL with the space bar and Enter, and the space bar does not start the episode that ended again', async () => {
        const { page } = session;
        const dialog = await playFirstOfTwo(page);
        await endEpisode(dialog);
        const panel = dialog.getByRole('region', { name: 'NEXT EPISODE' });
        await expect(panel.getByRole('button', { name: 'PLAY NOW' })).toBeFocused();
        // The space bar on CANCEL stays on this episode and takes the panel away; it does not play the video.
        await panel.getByRole('button', { name: 'CANCEL' }).focus();
        await page.keyboard.press('Space');
        await expect(panel).toHaveCount(0);
        await expect(dialog).toBeVisible();
        expect(await dialog.locator('video').evaluate((video: HTMLVideoElement) => { return video.paused; })).toBe(true);
        // The space bar on PLAY NOW goes to the next episode, and does not start this one again.
        await endEpisode(dialog);
        await expect(panel.getByRole('button', { name: 'PLAY NOW' })).toBeFocused();
        await page.keyboard.press('Space');
        await expect(page.getByRole('dialog', { name: 'Fake Anime · EP 2' })).toBeVisible();
    });

    test('keeps the notices of the downloads away from the panel of the next episode and from the bar of the player', async () => {
        const { page } = session;
        const dialog = await playFirstOfTwo(page);
        await endEpisode(dialog);
        const panel = dialog.getByRole('region', { name: 'NEXT EPISODE' });
        await expect(panel).toBeVisible();
        await page.evaluate(() => {
            const toasts = document.querySelector('.toasts');
            if (toasts === null) {
                const holder = document.createElement('div');
                holder.className = 'toasts';
                holder.innerHTML = '<div class="toast toast--info"><span class="toast__message">A notice</span></div>';
                document.body.appendChild(holder);
            }
        });
        const boxes = await page.evaluate(() => {
            const rect = (selector: string) => {
                const box = (document.querySelector(selector) as HTMLElement).getBoundingClientRect();
                return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
            };
            return { toast: rect('.toasts'), panel: rect('.player__auto-next'), bar: rect('.player__controls'), video: rect('.player__video') };
        });
        const crosses = (first: { left: number; right: number; top: number; bottom: number }, second: { left: number; right: number; top: number; bottom: number }): boolean => {
            return first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top;
        };
        expect(crosses(boxes.toast, boxes.panel)).toBe(false);
        expect(crosses(boxes.toast, boxes.bar)).toBe(false);
        // They are over the video, at its top.
        expect(boxes.toast.top).toBeGreaterThanOrEqual(boxes.video.top);
        expect(boxes.toast.bottom).toBeLessThan(boxes.panel.top);
    });

    test('starts the part watched of the timeline crisp at the start of the bar, with nothing of its glow out on the left', async () => {
        const { page } = session;
        const dialog = await playFirstOfTwo(page);
        const clip = await dialog.locator('.player__timeline .progress__bar').evaluate((bar) => {
            return getComputedStyle(bar).clipPath;
        });
        expect(clip).toBe('inset(-8px -14px -8px 0px)');
    });

    test('is turned off in the settings of the player, and stays off when the app opens again', async () => {
        const { page } = session;
        const dialog = await playFirstOfTwo(page);
        await dialog.getByRole('button', { name: 'Settings' }).click();
        const toggle = dialog.getByRole('switch', { name: 'Next episode automatically' });
        await expect(toggle).toBeChecked();
        await toggle.click();
        await expect(toggle).not.toBeChecked();
        await dialog.getByRole('button', { name: 'Settings' }).click();
        await endEpisode(dialog);
        await expect(dialog.getByRole('region', { name: 'NEXT EPISODE' })).toHaveCount(0);

        await session.app.close();
        session = await launch(session.userData);
        const reopened = session.page;
        await openAnimeTab(reopened);
        await reopened.getByRole('button', { name: 'LIBRARY', exact: true }).click();
        await reopened.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
        await reopened.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
        await reopened.getByRole('button', { name: 'PLAY: Fake Anime EP 1' }).click();
        const again = reopened.getByRole('dialog', { name: 'Fake Anime · EP 1' });
        await again.getByRole('button', { name: 'Settings' }).click();
        await expect(again.getByRole('switch', { name: 'Next episode automatically' })).not.toBeChecked();
    });
});

test.describe('series and seasons', () => {
    async function downloadSecondEntry(page: Page, series: string, season: string): Promise<void> {
        // Adding to the library closes the anime that was open: the results of the search are what is on the screen.
        await page.getByRole('button', { name: 'OPEN: Fake Anime 2', exact: true }).click();
        await expect(page.getByRole('button', { name: 'EP 3', exact: true })).toBeVisible();
        await openAddDialog(page);
        await page.getByRole('textbox', { name: 'Series' }).fill(series);
        await page.getByRole('spinbutton', { name: 'Order' }).fill(season);
        await downloadFromLibrary(page, [1], 'Fake Anime 2');
        await waitForDownloaded(page);
    }

    test('goes on in the player to the season that comes after (or before) in the series, with the next and the previous episode', async () => {
        const { page } = session;
        await openAnimeTab(page);
        await openFirstResult(page);
        await downloadFromLibrary(page, [1, 2, 3]);
        await waitForDownloaded(page);
        await downloadSecondEntry(page, 'Fake Anime', '2');

        await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
        await page.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
        await page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
        await page.getByRole('button', { name: 'PLAY: Fake Anime EP 3' }).click();

        // Inside the first season the buttons go from one episode to the other.
        const last = page.getByRole('dialog', { name: 'Fake Anime · EP 3' });
        await expect(last).toBeVisible();
        await expect(last.locator('video')).toHaveAttribute('src', /^pullwave-media:\/\/episode\/3\?v=\d+$/);
        await expect(last.getByRole('button', { name: 'PREVIOUS EPISODE' })).toBeVisible();
        // The last episode of the first season: NEXT EPISODE goes to the first downloaded one of the second season.
        await last.getByRole('button', { name: 'NEXT EPISODE' }).click();
        const second = page.getByRole('dialog', { name: 'Fake Anime 2 · EP 1' });
        await expect(second).toBeVisible();
        await expect(second.locator('video')).toHaveAttribute('src', /^pullwave-media:\/\/episode\/7\?v=\d+$/);
        // The second season is the last one, and its second episode is not downloaded.
        await expect(second.getByRole('button', { name: 'NEXT EPISODE' })).toHaveCount(0);

        // PREVIOUS EPISODE, at the start of the second season, goes back to the last downloaded one of the first.
        await second.getByRole('button', { name: 'PREVIOUS EPISODE' }).click();
        await expect(last).toBeVisible();
        await expect(last.locator('video')).toHaveAttribute('src', /^pullwave-media:\/\/episode\/3\?v=\d+$/);
    });

    test('saves each anime in a season folder, suggesting the series, and joins two entries by hand into one card', { tag: '@windows' }, async () => {
        const { page, animeDir } = session;
        await openAnimeTab(page);
        await openFirstResult(page);
        // The series and the order are not on the page: they are asked in the window of ADD TO LIBRARY, with what the title suggests.
        await expect(page.getByRole('textbox', { name: 'Series' })).toHaveCount(0);
        await openAddDialog(page);
        await expect(page.getByRole('textbox', { name: 'Series' })).toHaveValue('Fake Anime');
        await expect(page.getByRole('spinbutton', { name: 'Order' })).toHaveValue('1');
        await downloadFromLibrary(page, [1]);
        await waitForDownloaded(page);
        expect(existsSync(join(animeDir, 'Fake Anime', 'Season 1', 'Episode 1', 'Fake Anime Episode 1.mp4'))).toBe(true);

        await downloadSecondEntry(page, 'Fake Anime', '2');
        expect(existsSync(join(animeDir, 'Fake Anime', 'Season 2', 'Episode 1', 'Fake Anime 2 Episode 1.mp4'))).toBe(true);

        await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
        const card = page.getByTestId('anime-card');
        await expect(card).toHaveCount(1);
        await expect(card.getByRole('heading', { level: 3 })).toHaveText('Fake Anime');
        await expect(card.getByText('2 SEASONS')).toBeVisible();
        // A series with two seasons is one anime in the count.
        await expect(page.getByText('1 ANIMES')).toBeVisible();
        // The card only has the two buttons and the count of seasons.
        await expect(card.locator('.season__chip')).toHaveCount(0);
        await expect(card.getByRole('button')).toHaveText(['Fake Anime', 'REMOVE SERIES']);
        // Its own screen has the seasons with their buttons, and a way back.
        await card.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
        await expect(page.locator('.season__chip')).toHaveText(['SEASON 1', 'SEASON 2']);
        // Each season has its own cover (or the block that says there is none) in its row.
        await expect(page.getByTestId('anime-season-cover')).toHaveCount(2);
        await expect(page.getByTestId('anime-season-cover').locator('.cover')).toHaveCount(2);
        await expect(page.getByTestId('anime-season')).toHaveCount(2);
        await expect(page.getByTestId('anime-season').getByRole('heading', { level: 4 })).toHaveText(['Fake Anime', 'Fake Anime 2']);
        await page.getByRole('button', { name: 'BACK TO LIBRARY', exact: true }).click();
        await expect(page.getByTestId('anime-card')).toHaveCount(1);
    });

    test('offers the series that exist, joins them with one click and keeps a single spelling', async () => {
        const { page } = session;
        await openAnimeTab(page);
        await openFirstResult(page);
        await openAddDialog(page);
        await page.getByRole('textbox', { name: 'Series' }).fill('Frieren');
        await downloadFromLibrary(page, [1]);
        await waitForDownloaded(page);

        await page.getByRole('button', { name: 'OPEN: Fake Anime 2', exact: true }).click();
        await openAddDialog(page);
        await expect(page.getByRole('textbox', { name: 'Series' })).toHaveValue('Fake Anime 2');
        await page.getByRole('textbox', { name: 'Series' }).fill('frie');
        await page.getByRole('listbox', { name: 'In the library' }).getByRole('option', { name: 'Frieren' }).click();
        await expect(page.getByRole('textbox', { name: 'Series' })).toHaveValue('Frieren');
        // Typed with another spelling it is still the same series.
        await page.getByRole('textbox', { name: 'Series' }).fill('FRIEREN ');
        await page.getByRole('spinbutton', { name: 'Order' }).fill('2');
        await downloadFromLibrary(page, [1], 'Fake Anime 2');
        await waitForDownloaded(page);

        expect(existsSync(join(session.animeDir, 'Frieren', 'Season 1', 'Episode 1'))).toBe(true);
        expect(existsSync(join(session.animeDir, 'Frieren', 'Season 2', 'Episode 1'))).toBe(true);
        expect(readdirSync(session.animeDir)).toEqual(['Frieren']);
        await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
        await expect(page.getByTestId('anime-card')).toHaveCount(1);
        await expect(page.getByTestId('anime-card').getByRole('heading', { level: 3 })).toHaveText('Frieren');
    });

    test('shows the name given to a season instead of SEASON N, and orders the seasons by their order, not by their names', async () => {
        const { page } = session;
        await openAnimeTab(page);
        await openFirstResult(page);
        await openAddDialog(page);
        await page.getByRole('textbox', { name: 'Name shown' }).fill('Zebra');
        await downloadFromLibrary(page, [1]);
        await waitForDownloaded(page);
        await page.getByRole('button', { name: 'OPEN: Fake Anime 2', exact: true }).click();
        await openAddDialog(page);
        await page.getByRole('textbox', { name: 'Series' }).fill('Fake Anime');
        await page.getByRole('spinbutton', { name: 'Order' }).fill('2');
        await page.getByRole('textbox', { name: 'Name shown' }).fill('Apple');
        await downloadFromLibrary(page, [1], 'Fake Anime 2');
        await waitForDownloaded(page);

        await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
        await page.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
        await expect(page.locator('.season__chip')).toHaveText(['Zebra', 'Apple']);
        await expect(page.getByTestId('anime-season').getByRole('heading', { level: 4 })).toHaveText(['Fake Anime', 'Fake Anime 2']);
        // The folders follow the order, whatever the names.
        expect(existsSync(join(session.animeDir, 'Fake Anime', 'Season 1', 'Episode 1'))).toBe(true);
        expect(existsSync(join(session.animeDir, 'Fake Anime', 'Season 2', 'Episode 1'))).toBe(true);
        // Seen from the search, the anime carries the name it is shown with.
        await page.locator('.tab', { hasText: 'SEARCH' }).click();
        await expect(page.getByText('Fake Anime · Apple')).toBeVisible();
    });

    test('refuses a season that is taken, recommending the next one, and joins the anime once the order is free', async () => {
        const { page } = session;
        await openAnimeTab(page);
        await openFirstResult(page);
        await downloadFromLibrary(page, [1]);
        await waitForDownloaded(page);

        await page.getByRole('button', { name: 'OPEN: Fake Anime 2', exact: true }).click();
        const dialog = await openAddDialog(page);
        await dialog.getByRole('textbox', { name: 'Series' }).fill('Fake Anime');
        // The series uses order 1 already: the next one is put in the field, and the anime can be confirmed as it is.
        await expect(dialog.getByRole('spinbutton', { name: 'Order' })).toHaveValue('2');
        await expect(dialog.getByRole('alert')).toHaveCount(0);
        await expect(dialog.getByRole('button', { name: 'CONFIRM' })).toBeEnabled();
        await dialog.getByRole('spinbutton', { name: 'Order' }).fill('1');
        // An order the series already uses typed by hand is not allowed: the window says so, with the next one, and cannot be confirmed.
        await expect(dialog.getByRole('alert')).toHaveText('Order 1 is already used by another anime of the series. Use 2, the next one.');
        await expect(dialog.getByRole('button', { name: 'CONFIRM' })).toBeDisabled();
        await expect(page.getByRole('button', { name: 'VIEW IN LIBRARY', exact: true })).toHaveCount(0);

        await dialog.getByRole('spinbutton', { name: 'Order' }).fill('2');
        await expect(dialog.getByRole('alert')).toHaveCount(0);
        await dialog.getByRole('button', { name: 'CONFIRM' }).click();
        await expect(page.getByRole('button', { name: 'VIEW IN LIBRARY', exact: true })).toBeVisible();
        await expect(dialog).toBeHidden();
        // Once added, the series is not changed from here: it is only told.
        await expect(page.getByRole('textbox', { name: 'Series' })).toHaveCount(0);
        await expect(page.getByText('In the series "Fake Anime", order 2.')).toBeVisible();

        await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
        await expect(page.getByTestId('anime-card')).toHaveCount(1);
        await expect(page.getByTestId('anime-card').getByText('2 SEASONS')).toBeVisible();
        await page.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();

        // The anime that gives its name to the series cannot be removed alone (it is told on the screen of its season); the other one can.
        await page.getByTestId('anime-season').first().getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
        const blocked = page.getByTestId('season-view').getByRole('button', { name: 'REMOVE ANIME: Fake Anime' });
        await expect(blocked).toBeDisabled();
        await expect(blocked).toHaveAttribute('title', 'This anime gives its name to the series. To remove it, remove the whole series.');
        await page.getByRole('button', { name: 'BACK', exact: true }).click();

        // The order of a season is edited on its screen, and a taken one is refused with the next one recommended.
        await page.getByTestId('anime-season').last().getByRole('button', { name: 'SHOW EPISODES: Fake Anime 2', exact: true }).click();
        await page.getByRole('button', { name: 'EDIT SEASON: Fake Anime 2' }).click();
        await page.getByRole('spinbutton', { name: 'Order' }).fill('1');
        await page.getByRole('button', { name: 'SAVE' }).click();
        await expect(page.getByRole('alert')).toHaveText('Order 1 is already used by another anime of the series. Use 2, the next one.');
        await page.getByRole('button', { name: 'CANCEL' }).click();
        await page.getByRole('button', { name: 'REMOVE ANIME: Fake Anime 2' }).click();
        await answerConfirm(page, 'Remove "Fake Anime 2"?', 'REMOVE');
        // The season that was open is gone: the screen goes back to the series, which has one season now.
        await expect(page.getByTestId('season-view')).toHaveCount(0);
        await expect(page.getByTestId('anime-season')).toHaveCount(1);
        await page.getByRole('button', { name: 'BACK TO LIBRARY', exact: true }).click();
        await expect(page.getByTestId('anime-card')).toHaveCount(1);
        await expect(page.getByTestId('anime-card').getByText('1 SEASON')).toBeVisible();
    });

    test('brings the series back when the library is rebuilt from the folder', { tag: '@windows' }, async () => {
        const { page, userData } = session;
        await openAnimeTab(page);
        await openFirstResult(page);
        await downloadFromLibrary(page, [1]);
        await waitForDownloaded(page);
        await downloadSecondEntry(page, 'Fake Anime', '2');
        await session.app.close();
        rmSync(join(userData, 'anime', 'anime.db'), { force: true });

        session = await launch(userData);
        await openAnimeTab(session.page);
        await session.page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
        await session.page.getByRole('button', { name: 'IMPORT LIBRARY' }).click();
        await expect(session.page.locator('.toast__message', { hasText: 'IMPORT DONE' })).toHaveText('IMPORT DONE: 2 ADDED · 0 POINTED TO A NEW PLACE · 0 ALREADY IN THE LIBRARY · 0 NOT RECOGNIZED');
        const card = session.page.getByTestId('anime-card');
        await expect(card).toHaveCount(1);
        await expect(card.getByText('2 SEASONS')).toBeVisible();
        await card.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
        await expect(session.page.locator('.season__chip')).toHaveText(['SEASON 1', 'SEASON 2']);
    });
});

test.describe('layout for every size of window @resize', () => {
    // A finished download leaves the screen, so the slow ones are used: they stay in the list while the sizes are measured.
    async function threeDownloads(page: Page): Promise<void> {
        await openAnimeTab(page);
        await search(page, 'slow');
        await page.getByRole('button', { name: 'OPEN: Fake Anime', exact: true }).click();
        await expect(page.getByRole('button', { name: 'EP 3', exact: true })).toBeVisible();
        await downloadFromLibrary(page, [1, 2, 3]);
        await showDownloads(page);
        await expect(page.getByTestId('anime-job')).toHaveCount(3);
    }

    // How the page is laid out at a size: the magnification of the interface (a fifth on an ultrawide screen with 1440 lines or more), the widest the content may be (--app-max), the width of
    // the header (the content, in the middle), the width of the part that scrolls (the whole window, so the wheel works on the sides too) and
    // the columns of a list.
    async function layout(
        page: Page,
        width: number,
        height: number
    ): Promise<{ zoom: string; appMax: string; contentWidth: number; railWidth: number; scrollbar: number; scrollerWidth: number; windowWidth: number; columns: number; overflow: boolean }> {
        await page.setViewportSize({ width, height });
        return page.evaluate(() => {
            const list = document.querySelector('.queue') as HTMLElement;
            const tracks = getComputedStyle(list).gridTemplateColumns;
            return {
                zoom: getComputedStyle(document.documentElement).zoom,
                appMax: getComputedStyle(document.documentElement).getPropertyValue('--app-max').trim(),
                contentWidth: Math.round((document.querySelector('.app__main > section') as HTMLElement).getBoundingClientRect().width),
                railWidth: Math.round((document.querySelector('.sidenav') as HTMLElement).getBoundingClientRect().width),
                scrollbar: (document.querySelector('.app__main') as HTMLElement).offsetWidth - (document.querySelector('.app__main') as HTMLElement).clientWidth,
                scrollerWidth: Math.round((document.querySelector('.app__main') as HTMLElement).getBoundingClientRect().width),
                windowWidth: window.innerWidth,
                columns: getComputedStyle(list).display === 'grid' ? tracks.split(' ').length : 1,
                overflow: document.documentElement.scrollWidth > window.innerWidth
            };
        });
    }

    test('lets the window be as small as 480 pixels wide', async () => {
        const [width, height] = await session.app.evaluate(({ BrowserWindow }) => {
            return BrowserWindow.getAllWindows()[0]?.getMinimumSize() ?? [0, 0];
        });
        expect([width, height]).toEqual([480, 520]);
    });

    test('grows the page with the window: 1400 px up to a 1920x1080 screen, 2400 px on an ultrawide one, magnified a fifth from 1440 lines', async () => {
        const { page } = session;
        await threeDownloads(page);

        // The page is beside the rail of the menu (84 pixels): the part that scrolls is the rest of the window. Its sides are the gutter of
        // responsive.css (20 pixels, or what centres --app-max) and 4 more, and its scrollbar takes its own room. Measures come in screen
        // pixels, so under the magnification of the interface they are divided by it to be the pixels of the page.
        const sizes: Array<[number, number, string, number, number]> = [
            [1100, 780, '1000px', 1, 1],
            [1366, 768, '1240px', 2, 1],
            [1920, 1080, '1400px', 2, 1],
            // An ultrawide screen as tall as a 1080p one: the page grows to 2400 px, three columns, and the interface is not magnified.
            [2560, 1080, '2400px', 3, 1],
            // 1440 lines tall: the interface is magnified a fifth.
            [2560, 1440, '2400px', 3, 1.2],
            [3440, 1440, '2400px', 3, 1.2]
        ];
        for (const [width, height, appMax, columns, zoom] of sizes) {
            const measured = await layout(page, width, height);
            const area = width / zoom - 84;
            const gutter = Math.max(20, (area - parseInt(appMax, 10)) / 2 + 20);
            expect(measured).toMatchObject({ zoom: String(zoom), appMax, columns, railWidth: Math.round(84 * zoom), overflow: false });
            expect(Math.abs(measured.scrollerWidth / zoom - area)).toBeLessThanOrEqual(1);
            expect(Math.abs(measured.contentWidth / zoom - (area - 2 * (gutter + 4) - measured.scrollbar / zoom))).toBeLessThanOrEqual(1);
            // Never wider than --app-max less its sides, however big the window.
            expect(measured.contentWidth / zoom).toBeLessThanOrEqual(parseInt(appMax, 10) - 48 + 1);
        }
    });

    test('never needs to scroll sideways, from the smallest window up', async () => {
        const { page } = session;
        await threeDownloads(page);
        for (const [width, height] of [[480, 800], [600, 800], [768, 1024], [1024, 768], [1080, 1850], [1366, 768], [1920, 1080], [2560, 1080], [3440, 1440]]) {
            expect(await layout(page, width as number, height as number)).toMatchObject({ overflow: false });
        }
    });

    test('fits the controls of a narrow window: one column, the button of an episode under the title or next to it, inside the row', async () => {
        const { page } = session;
        await threeDownloads(page);
        await backFromDownloads(page);
        // The button of an episode is only there once it is downloaded.
        await expect(page.getByRole('button', { name: 'DOWNLOADS (0)' })).toBeVisible({ timeout: 30000 });
        await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
        await page.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
        await page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
        await expect(page.getByRole('button', { name: /^MARK AS/ })).toHaveCount(3);
        await page.setViewportSize({ width: 480, height: 800 });

        const row = page.getByTestId('anime-episode').first();
        const title = await row.locator('.history__main').boundingBox();
        const marked = await row.getByRole('button', { name: /^MARK AS/ }).boundingBox();
        const box = await row.boundingBox();
        // The only button of the row goes under the title or next to it when there is room, never over it, and stays inside the row.
        const underTitle = (marked?.y ?? 0) >= (title?.y ?? 0) + (title?.height ?? 0);
        const besideTitle = (marked?.x ?? 0) >= (title?.x ?? 0) + (title?.width ?? 0);
        expect(underTitle || besideTitle).toBe(true);
        expect((marked?.x ?? 0) + (marked?.width ?? 0)).toBeLessThanOrEqual((box?.x ?? 0) + (box?.width ?? 0) + 1);
        // The tabs of the section (the menu of the sections is a dock of its own here).
        expect(await page.locator('.app__main .tabs').first().evaluate((tabs) => { return getComputedStyle(tabs).overflowX; })).toBe('auto');
    });
});

test('uses the ani-cli the app installed when none is chosen, and shows it as installed in the settings', { tag: '@windows' }, async () => {
    test.skip(!HAS_ANI_TOOLS, 'needs the real ani-cli: run `node scripts/fetch-binaries.mjs`');
    await session.app.close();
    const userData = join(workDir, 'user-data');
    const script = readFileSync(join(ROOT, 'resources', 'bin', 'ani', 'ani-cli'), 'utf-8');
    const version = /version_number="([^"]*)"/.exec(script)?.[1] as string;

    // Without the stand-in of the tests, the app uses the script it installed.
    session = await launch(userData, {}, { PULLWAVE_ANI_CLI: '' });
    const { page } = session;
    const installed = join(workDir, 'tools', 'anicli');
    // Installed and running: no chip at the top, the version is in the settings.
    await expect(page.locator('.logo')).toBeVisible();
    await expect(page.locator('.binary-status .chip')).toHaveCount(0);
    await openAnimeSettings(page);
    const block = page.getByTestId('programs-block-anime');
    await expect(block.getByTestId(/^program-/)).toHaveCount(3);
    await expect(block.getByTestId('program-anicli')).toContainText(`version ${version}`);
    expect(await block.getByTestId('program-anicli').getAttribute('data-testid')).toBe('program-anicli');
    expect(readdirSync(installed).length).toBeGreaterThan(0);
    await expect(block.getByTestId('program-anicli').locator('.badge')).toHaveText('INSTALLED');
    await expect(block.getByTestId('program-busybox').locator('.badge')).toHaveText('INSTALLED');
    await expect(block.getByTestId('program-curl').locator('.badge')).toHaveText('INSTALLED');
    await expect(block.getByTestId('program-busybox')).toContainText('Stays at the version the app was made with.');
});

test('shows the ani-cli the user chose as theirs in the settings, and has no chip at the top', { tag: '@windows' }, async () => {
    const { page } = session;
    await expect(page.locator('.logo')).toBeVisible();
    await expect(page.locator('.binary-status .chip')).toHaveCount(0);

    await openAnimeSettings(page);
    const row = page.getByTestId('program-anicli');
    await expect(row).toContainText(`Using the one you chose in the settings: ${FAKE_ANI_CLI}`);
    await expect(row.locator('.badge')).toHaveText('YOURS');
    await expect(row.getByRole('button')).toHaveCount(0);
});

test('shows the anime settings and saves them', async () => {
    const { page, userData } = session;
    await openAnimeSettings(page);
    await expect(page.locator('.settings legend', { hasText: /^ANIME$/ })).toBeVisible();
    await expect(page.getByLabel('Anime quality')).toHaveValue('720p');
    await page.getByLabel('Anime quality').selectOption('worst');
    await page.getByLabel('Anime audio').selectOption('dub');
    await expect.poll(() => {
        const saved = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf-8')) as Record<string, unknown>;
        return [saved.animeQuality, saved.animeAudio];
    }).toEqual(['worst', 'dub']);
});

test('shows the name of the season on its row all the time, without the pointer on it', async () => {
    const { page } = session;
    await downloadFirstEpisode(page);
    await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
    await page.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
    await page.mouse.move(0, 0);

    const title = page.getByTestId('anime-season').locator('.season__title');
    await expect(title).toHaveText('Fake Anime');
    await expect(title).toBeVisible();
    await expect(title).toHaveCSS('opacity', '1');
});

test.describe('only anime inside the anime folder', { tag: '@windows' }, () => {
    test('does not import a folder that is outside it, and says where the anime have to be', async () => {
        const { userData, animeDir } = session;
        const outside = join(workDir, 'outside');
        mkdirSync(join(outside, 'Bleach', 'Episode 1'), { recursive: true });
        writeFileSync(join(outside, 'Bleach', 'Episode 1', 'Bleach Episode 1.mp4'), 'abc');
        await session.app.close();

        session = await launch(userData, {}, { PULLWAVE_IMPORT_DIR: outside });
        await openAnimeTab(session.page);
        await session.page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
        await session.page.getByRole('button', { name: 'IMPORT LIBRARY' }).click();

        const notice = session.page.locator('.toast--error .toast__message');
        await expect(notice).toHaveText(`Only folders inside the anime folder can be imported: ${animeDir}`);
        await expect(session.page.getByText('// THE LIBRARY IS EMPTY. SEARCH AN ANIME AND ADD IT TO THE LIBRARY.')).toBeVisible();
        expect(existsSync(join(outside, 'Bleach', 'Episode 1', 'Bleach Episode 1.mp4'))).toBe(true);
    });

    test('keeps the folder fixed in the settings while there is anime in the library', async () => {
        const { page, animeDir, userData } = session;
        await downloadFirstEpisode(page);
        await openAnimeSettings(page);

        await expect(page.getByLabel('Anime download folder')).toHaveValue(animeDir);
        await expect(page.getByLabel('Anime download folder')).toBeDisabled();
        await expect(page.getByText('With anime in the library, the folder only changes through MIGRATE FOLDER, which moves the files too.')).toBeVisible();
        await expect(page.getByRole('button', { name: 'BROWSE' })).toBeDisabled();
        await expect(page.getByRole('button', { name: 'MIGRATE FOLDER' })).toBeEnabled();
        expect((JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf-8')) as Record<string, unknown>).animeDownloadDir).toBe(animeDir);
    });

    test('leaves the folder free to change while the library is empty', async () => {
        const { page } = session;
        await openAnimeSettings(page);
        await expect(page.getByLabel('Anime download folder')).toBeEnabled();
        await expect(page.getByRole('button', { name: 'BROWSE' })).toBeEnabled();
        await expect(page.getByRole('button', { name: 'MIGRATE FOLDER' })).toBeEnabled();
    });
});

test.describe('migrating the folder of the anime', { tag: '@windows' }, () => {
    async function relaunchToMigrateTo(target: string): Promise<void> {
        const { userData } = session;
        await session.app.close();
        session = await launch(userData, {}, { PULLWAVE_MIGRATE_DIR: target });
    }

    function savedFolder(): unknown {
        return (JSON.parse(readFileSync(join(session.userData, 'settings.json'), 'utf-8')) as Record<string, unknown>).animeDownloadDir;
    }

    test('copies everything to the new folder, checks it, points the library and the settings to it and removes the old files', async () => {
        const { animeDir } = session;
        await downloadFirstEpisode(session.page);
        const target = join(workDir, 'migrated');
        await relaunchToMigrateTo(target);
        const { page } = session;

        await openAnimeSettings(page);
        await page.getByRole('button', { name: 'MIGRATE FOLDER' }).click();

        await expect(page.locator('.toast .toast__message')).toHaveText(`MIGRATION DONE: 1 EPISODES MOVED TO ${target}`);
        await expect(page.locator('.toast')).toHaveClass(/toast--info/);
        await expect(page.getByLabel('Anime download folder')).toHaveValue(target);
        await expect.poll(savedFolder).toBe(target);

        const folder = join(target, 'Fake Anime', 'Season 1', 'Episode 1');
        expect(readFileSync(join(folder, 'Fake Anime Episode 1.mp4'), 'utf-8')).toBe('FAKEVIDEO0123456789');
        expect(readFileSync(join(folder, 'Fake Anime Episode 1.vtt'), 'utf-8')).toBe('WEBVTT\n');
        expect(existsSync(join(folder, 'pullwave.json'))).toBe(true);
        expect(existsSync(animeDir)).toBe(false);

        await openAnimeTab(page);
        await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
        await page.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
        await page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
        await expect(page.getByText('1/3 DOWNLOADED')).toBeVisible();
        await expect(page.locator('.missing-mark')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'PLAY: Fake Anime EP 1' })).toBeEnabled();
    });

    test('downloads the next episodes into the new folder', async () => {
        await downloadFirstEpisode(session.page);
        const target = join(workDir, 'migrated');
        await relaunchToMigrateTo(target);
        const { page } = session;
        await openAnimeSettings(page);
        await page.getByRole('button', { name: 'MIGRATE FOLDER' }).click();
        await expect(page.locator('.toast .toast__message')).toHaveText(`MIGRATION DONE: 1 EPISODES MOVED TO ${target}`);
        await expect(page.locator('.toast')).toHaveClass(/toast--info/);

        await page.getByRole('navigation', { name: 'Anime' }).getByRole('button', { name: 'SEARCH', exact: true }).click();
        await openFirstResult(page);
        await downloadFromLibrary(page, [2]);
        // The queue lives in memory: after the restart this is its only job.
        await waitForDownloaded(page);

        expect(existsSync(join(target, 'Fake Anime', 'Season 1', 'Episode 2', 'Fake Anime Episode 2.mp4'))).toBe(true);
        expect(existsSync(session.animeDir)).toBe(false);
    });

    test('says so and changes nothing when the folder chosen is the current one', async () => {
        const { animeDir } = session;
        await downloadFirstEpisode(session.page);
        await relaunchToMigrateTo(animeDir);
        const { page } = session;

        await openAnimeSettings(page);
        await page.getByRole('button', { name: 'MIGRATE FOLDER' }).click();

        await expect(page.locator('.toast--error .toast__message')).toHaveText('That is already the anime folder.');
        await expect(page.getByLabel('Anime download folder')).toHaveValue(animeDir);
        expect(savedFolder()).toBe(animeDir);
        expect(existsSync(join(animeDir, 'Fake Anime', 'Season 1', 'Episode 1', 'Fake Anime Episode 1.mp4'))).toBe(true);
    });

    test('says so and changes nothing when the folder chosen is inside the current one', async () => {
        const { animeDir } = session;
        await downloadFirstEpisode(session.page);
        await relaunchToMigrateTo(join(animeDir, 'inner'));
        const { page } = session;

        await openAnimeSettings(page);
        await page.getByRole('button', { name: 'MIGRATE FOLDER' }).click();

        await expect(page.locator('.toast--error .toast__message')).toHaveText('Choose a folder that is not inside the current anime folder.');
        expect(savedFolder()).toBe(animeDir);
        expect(existsSync(join(animeDir, 'inner'))).toBe(false);
    });

    test('says so and keeps both folders as they were when a file of the new folder is in the way', async () => {
        const { animeDir } = session;
        await downloadFirstEpisode(session.page);
        const target = join(workDir, 'migrated');
        const inTheWay = join(target, 'Fake Anime', 'Season 1', 'Episode 1', 'Fake Anime Episode 1.mp4');
        mkdirSync(join(inTheWay, '..'), { recursive: true });
        writeFileSync(inTheWay, 'someone else');
        await relaunchToMigrateTo(target);
        const { page } = session;

        await openAnimeSettings(page);
        await page.getByRole('button', { name: 'MIGRATE FOLDER' }).click();

        await expect(page.locator('.toast--error .toast__message')).toHaveText('The new folder already has files where the anime would be copied. Choose another folder.');
        expect(readFileSync(inTheWay, 'utf-8')).toBe('someone else');
        expect(readFileSync(join(animeDir, 'Fake Anime', 'Season 1', 'Episode 1', 'Fake Anime Episode 1.mp4'), 'utf-8')).toBe('FAKEVIDEO0123456789');
        expect(savedFolder()).toBe(animeDir);
    });

    test('only changes the folder when the library is empty', async () => {
        const target = join(workDir, 'migrated');
        await relaunchToMigrateTo(target);
        const { page } = session;

        await openAnimeSettings(page);
        await page.getByRole('button', { name: 'MIGRATE FOLDER' }).click();

        await expect(page.locator('.toast--info .toast__message')).toHaveText(`MIGRATION DONE: 0 EPISODES MOVED TO ${target}`);
        await expect(page.getByLabel('Anime download folder')).toHaveValue(target);
        await expect.poll(savedFolder).toBe(target);
    });
});

test.describe('covers', () => {
    // A picture the page can always load (the content security policy lets it show data: addresses and the ones of AniList only).
    const COVER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

    let aniList: Server;
    let aniListUrl: string;
    let fallbackUrl: string;
    let searched: string[];
    // The names of each request made to AniList, and what Kitsu was asked.
    let requests: string[][];
    let kitsuAsked: string[];
    let mode: 'ok' | 'error';
    // The names AniList has no cover for.
    let withoutCover: string[];

    async function startAniList(port = 0): Promise<void> {
        aniList = createServer((request, response) => {
            // Kitsu, asked when AniList has no cover, answers here too: it has none either.
            if (request.method === 'GET') {
                kitsuAsked.push(request.url ?? '');
                response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ data: [] }));
                return;
            }
            const chunks: Buffer[] = [];
            request.on('data', (chunk: Buffer) => {
                chunks.push(chunk);
            });
            request.on('end', () => {
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { query: string; variables: Record<string, string> };
                // The schedule of the day is asked here too: nothing airs.
                if (!body.query.includes('Page(perPage: 1)')) {
                    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ data: { Page: { pageInfo: { hasNextPage: false }, airingSchedules: [] } } }));
                    return;
                }
                // The covers asked for together come in one request: a page for each name, empty for the one AniList does not know.
                const names = Object.values(body.variables);
                searched.push(...names);
                requests.push(names);
                if (mode === 'error') {
                    response.writeHead(500).end('{}');
                    return;
                }
                const data = Object.fromEntries(
                    names.map((name, index) => {
                        return [`a${String(index)}`, { media: withoutCover.includes(name) ? [] : [{ coverImage: { large: COVER } }] }];
                    })
                );
                response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ data }));
            });
        });
        await new Promise<void>((resolveListening) => {
            aniList.listen(port, '127.0.0.1', resolveListening);
        });
        aniListUrl = `http://127.0.0.1:${(aniList.address() as AddressInfo).port}/graphql`;
        fallbackUrl = `http://127.0.0.1:${(aniList.address() as AddressInfo).port}`;
    }

    async function stopAniList(): Promise<void> {
        aniList.closeAllConnections();
        await new Promise<void>((resolveClosed) => {
            aniList.close(() => {
                resolveClosed();
            });
        });
    }

    async function relaunchWithAniList(): Promise<Page> {
        await session.app.close();
        session = await launch(join(workDir, 'user-data'), {}, { PULLWAVE_ANILIST_URL: aniListUrl, PULLWAVE_COVER_FALLBACK_URL: fallbackUrl });
        return session.page;
    }

    test.beforeEach(async () => {
        searched = [];
        requests = [];
        kitsuAsked = [];
        mode = 'ok';
        withoutCover = ['Fake Anime 2'];
        await startAniList();
        await relaunchWithAniList();
    });

    test.afterEach(async () => {
        await stopAniList().catch(() => {return undefined});
    });

    test('shows the cover of each result, found by its title, and says so when there is none', async () => {
        const { page } = session;
        await openAnimeTab(page);
        await search(page, 'fake');
        await expect(page.getByRole('button', { name: 'OPEN: Fake Anime', exact: true })).toBeVisible();

        const cards = page.getByRole('listitem');
        await expect(cards.nth(0).locator('img.cover')).toHaveAttribute('src', COVER);
        await expect(cards.nth(1).locator('.cover--none')).toHaveText('COVER NOT FOUND');
        await expect(cards.nth(1).locator('img')).toHaveCount(0);
        expect([...searched].sort()).toEqual(['Fake Anime', 'Fake Anime 2']);
        // The covers of the results are asked for together, in one request; Kitsu is asked for the one AniList does not know.
        expect(requests.map((names) => {
            return [...names].sort();
        })).toEqual([['Fake Anime', 'Fake Anime 2']]);
        expect(kitsuAsked).toEqual(['/kitsu/anime?filter%5Btext%5D=Fake+Anime+2&page%5Blimit%5D=5&fields%5Banime%5D=canonicalTitle%2Ctitles%2CabbreviatedTitles%2CposterImage']);
    });

    test('shows the covers in the library and in the history too, without asking for them again', async () => {
        const { page } = session;
        await downloadFirstEpisode(page);
        // The results of the search that was made to open the anime ask for their covers too, together.
        await expect.poll(() => {
            return searched.includes('Fake Anime') && searched.includes('Fake Anime 2');
        }).toBe(true);
        await page.waitForTimeout(2500);
        const asks = searched.length;

        await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
        await expect(page.getByTestId('anime-card').locator('img.cover')).toHaveAttribute('src', COVER);
        await page.getByRole('navigation', { name: 'Anime' }).getByRole('button', { name: 'HISTORY', exact: true }).click();
        await expect(page.getByRole('region', { name: 'Anime history' }).locator('img.cover')).toHaveAttribute('src', COVER);
        expect(searched.length).toBe(asks);
    });

    test('keeps the covers on the disk: they are there, without asking, when the app is opened again with no network', { tag: '@windows' }, async () => {
        const { page } = session;
        await openAnimeTab(page);
        await search(page, 'fake');
        await expect(page.getByRole('listitem').nth(0).locator('img.cover')).toHaveAttribute('src', COVER);
        await expect(page.getByRole('listitem').nth(1).locator('.cover--none')).toHaveText('COVER NOT FOUND');
        const asks = searched.length;
        await stopAniList();

        const reopened = await relaunchWithAniList();
        await openAnimeTab(reopened);
        await search(reopened, 'fake');

        await expect(reopened.getByRole('listitem').nth(0).locator('img.cover')).toHaveAttribute('src', COVER);
        await expect(reopened.getByRole('listitem').nth(1).locator('.cover--none')).toHaveText('COVER NOT FOUND');
        expect(searched.length).toBe(asks);
    });

    test('shows, for a series whose first season has no cover, the cover of the next season on its card, and none in the hero of its screen', async () => {
        const { page } = session;
        withoutCover = ['Fake Anime'];
        await openAnimeTab(page);
        await openFirstResult(page);
        await confirmAdd(page);
        await page.getByRole('button', { name: 'VIEW IN LIBRARY', exact: true }).click();
        // The second season is added by hand to the same series, from the results of the search.
        await page.getByRole('navigation', { name: 'Anime' }).getByRole('button', { name: 'SEARCH', exact: true }).click();
        await page.getByRole('button', { name: 'OPEN: Fake Anime 2', exact: true }).click();
        await openAddDialog(page);
        await page.getByRole('textbox', { name: 'Series' }).fill('Fake Anime');
        await page.getByRole('spinbutton', { name: 'Order' }).fill('2');
        await addDialog(page).getByRole('button', { name: 'CONFIRM' }).click();
        await expect(addDialog(page)).toBeHidden();

        await page.getByRole('navigation', { name: 'Anime' }).getByRole('button', { name: 'LIBRARY', exact: true }).click();
        const card = page.getByTestId('anime-card');
        await expect(card).toHaveCount(1);
        await expect(card.getByText('2 SEASONS')).toBeVisible();
        // The first season has none (Kitsu has none either): the card shows the one of the second season.
        await expect(card.locator('img.cover')).toHaveAttribute('src', COVER);
        await expect(card.getByText('COVER NOT FOUND')).toHaveCount(0);
        expect(searched).toContain('Fake Anime');
        expect(searched).toContain('Fake Anime 2');

        await card.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
        const view = page.getByTestId('series-view');
        await expect(view).toHaveClass(/series--overview/);
        // The screen of the series has no cover of its own: the covers are the ones of the seasons, and the first says there is none.
        await expect(view.locator('.detail__art')).toHaveCount(0);
        await expect(view.locator('img.cover')).toHaveCount(1);
        const seasons = page.getByTestId('anime-season-cover');
        await expect(seasons).toHaveCount(2);
        await expect(seasons.nth(0).locator('.cover--none')).toHaveText('COVER NOT FOUND');
        await expect(seasons.nth(1).locator('img.cover')).toHaveAttribute('src', COVER);
    });

    test('says the cover was not found when AniList fails, and asks again the next time the card is shown', async () => {
        const { page } = session;
        mode = 'error';
        await openAnimeTab(page);
        await search(page, 'fake');
        await expect(page.getByRole('listitem').nth(0).locator('.cover--none')).toHaveText('COVER NOT FOUND');
        await expect(page.getByRole('listitem').nth(1).locator('.cover--none')).toHaveText('COVER NOT FOUND');

        mode = 'ok';
        const subNav = page.getByRole('navigation', { name: 'Anime' });
        await subNav.getByRole('button', { name: 'LIBRARY', exact: true }).click();
        await subNav.getByRole('button', { name: 'SEARCH', exact: true }).click();

        await expect(page.getByRole('listitem').nth(0).locator('img.cover')).toHaveAttribute('src', COVER, { timeout: 15000 });
    });
});

test.describe('watching without downloading', { tag: '@windows' }, () => {
    const REFERER = 'https://embed.example/';
    const FFMPEG = join(ROOT, 'resources', 'bin', `ffmpeg${EXE}`);
    test.skip(!existsSync(FFMPEG), 'needs the bundled ffmpeg to make a video: run `npm run fetch-binaries`');

    interface Seen {
        path: string;
        referer: string | undefined;
        origin: string | undefined;
        userAgent: string | undefined;
    }

    let hlsDir: string;
    let server: Server;
    let baseUrl: string;
    let seen: Seen[];

    test.beforeAll(async () => {
        hlsDir = mkdtempSync(join(tmpdir(), 'pullwave-hls-'));
        execFileSync(
            FFMPEG,
            ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=8:size=160x120:rate=10', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-force_key_frames', 'expr:gte(t,n_forced*2)', '-c:a', 'aac', '-f', 'hls', '-hls_time', '2', '-hls_playlist_type', 'vod', '-hls_segment_filename', join(hlsDir, 'seg%d.ts'), join(hlsDir, 'index.m3u8')]
        );
        writeFileSync(join(hlsDir, 'en.vtt'), 'WEBVTT\n\n00:00.000 --> 00:08.000\nHello from the stream\n');
        writeFileSync(join(hlsDir, 'pt.vtt'), 'WEBVTT\n\n00:00.000 --> 00:08.000\nOla do stream\n');
        writeFileSync(join(hlsDir, 'es.vtt'), 'WEBVTT\n\n00:00.000 --> 00:08.000\nHola del stream\n');
        writeFileSync(join(hlsDir, 'ar.vtt'), 'WEBVTT\n\n00:00.000 --> 00:08.000\nمرحبا من البث\n');
        // The same episode with every segment behind a picture and named like one, as the source of KAIJU GIRL CARAMELISE gives it.
        writeFileSync(join(hlsDir, 'hidden.m3u8'), readFileSync(join(hlsDir, 'index.m3u8'), 'utf-8').replace(/seg(\d+)\.ts/g, 'hseg$1.ts.jpg'));
        readdirSync(hlsDir)
            .filter((name) => {
                return /^seg\d+\.ts$/.test(name);
            })
            .forEach((name) => {
                writeFileSync(join(hlsDir, `h${name}.jpg`), hiddenSegment(readFileSync(join(hlsDir, name))));
            });
        seen = [];
        server = createServer((request, response) => {
            const path = (request.url ?? '/').split('?')[0] ?? '/';
            seen.push({ path, referer: request.headers.referer, origin: request.headers.origin, userAgent: request.headers['user-agent'] });
            // Like the real host: only the site that embeds the player may ask.
            const file = join(hlsDir, path.replace(/^\//, ''));
            if (request.headers.referer !== REFERER || !existsSync(file)) {
                response.writeHead(request.headers.referer !== REFERER ? 403 : 404).end();
                return;
            }
            const types: Record<string, string> = { '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.vtt': 'text/vtt', '.jpg': 'image/jpeg' };
            const extension = path.slice(path.lastIndexOf('.'));
            response.writeHead(200, { 'Content-Type': types[extension] ?? 'application/octet-stream' }).end(readFileSync(file));
        });
        await new Promise<void>((resolveListening) => {
            server.listen(0, '127.0.0.1', resolveListening);
        });
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    test.afterAll(async () => {
        await new Promise<void>((resolveClosed) => {
            server.close(() => {
                resolveClosed();
            });
        });
        rmSync(hlsDir, { recursive: true, force: true });
    });

    test.beforeEach(() => {
        seen.length = 0;
        const history = join(session.userData, 'anime', 'history');
        mkdirSync(history, { recursive: true });
        writeFileSync(join(history, 'stream-url'), `${baseUrl}/index.m3u8`);
        writeFileSync(join(history, 'stream-subtitles'), `${baseUrl}/en.vtt`);
    });

    async function watchEpisode(page: Page, episode: string): Promise<void> {
        await openAnimeTab(page);
        await openFirstResult(page);
        // A click on an episode of the search opens the player: there is no button to watch what was picked.
        await page.getByRole('button', { name: `EP ${episode}`, exact: true }).click();
    }

    test('plays an episode whose segments are hidden behind a picture', async () => {
        const { page, userData } = session;
        expect(HIDING_PICTURE).toHaveLength(70);
        writeFileSync(join(userData, 'anime', 'history', 'stream-url'), `${baseUrl}/hidden.m3u8`);
        await watchEpisode(page, '1');
        const dialog = page.getByRole('dialog', { name: 'Fake Anime · EP 1' });
        const video = dialog.locator('video');
        await expect(video).toBeVisible();

        await expect.poll(() => {
            return video.evaluate((element: HTMLVideoElement) => {
                return element.currentTime;
            });
        }, { timeout: 30000 }).toBeGreaterThan(0.5);
        await expect(dialog.getByRole('alert')).toHaveCount(0);
        expect(
            seen.some((request) => {
                return request.path.endsWith('.ts.jpg');
            })
        ).toBe(true);
    });

    for (const way of ['by itself when the count is over', 'at once with PLAY NOW']) {
        test(`plays the next episode ${way}, in the same stage, so a viewer in fullscreen stays in it @resize`, async () => {
            const { page } = session;
            const fullscreenOf = async (): Promise<string | null> => {
                return page.evaluate(() => {
                    return document.fullscreenElement === null ? null : document.fullscreenElement.className;
                });
            };
            // The stage is marked: it must be the very same element after the episode changes, not another one that was put in fullscreen.
            const markOfStage = (): Promise<string> => {
                return page.evaluate(() => {
                    const stage = document.fullscreenElement as HTMLElement & { pullwaveMark?: string };
                    stage.pullwaveMark = stage.pullwaveMark ?? 'same stage';
                    return stage.pullwaveMark;
                });
            };
            await watchEpisode(page, '1');
            const dialog = page.getByRole('dialog', { name: 'Fake Anime · EP 1' });
            await expect(dialog.locator('video')).toBeVisible();
            await dialog.getByRole('button', { name: 'Fullscreen' }).click();
            await expect.poll(fullscreenOf).toBe('player__stage');
            expect(await markOfStage()).toBe('same stage');

            await dialog.locator('video').evaluate((video) => {
                video.dispatchEvent(new Event('ended'));
            });
            const panel = dialog.getByRole('region', { name: 'NEXT EPISODE' });
            await expect(panel).toBeVisible();
            await expect(panel).toContainText('Fake Anime · EP 2');
            if (way.endsWith('PLAY NOW')) {
                await panel.getByRole('button', { name: 'PLAY NOW' }).click();
            }
            const second = page.getByRole('dialog', { name: 'Fake Anime · EP 2' });
            await expect(second).toBeVisible({ timeout: 20000 });
            await expect(second.locator('video')).toBeVisible();

            // Still in fullscreen, in the same stage, with the video and the controls of the new episode in it.
            expect(await fullscreenOf()).toBe('player__stage');
            expect(await markOfStage()).toBe('same stage');
            await expect(second.locator('.player__stage video')).toHaveCount(1);
            await expect(second.locator('.player__stage').getByRole('button', { name: 'Fullscreen' })).toBeVisible();

            // Leaving fullscreen is still up to the viewer.
            await second.getByRole('button', { name: 'Fullscreen' }).click();
            await expect.poll(fullscreenOf).toBeNull();
        });
    }

    test('offers every language the source lists, shows the one ani-cli picked, and only the one that is chosen', async () => {
        const { page, userData } = session;
        writeFileSync(
            join(userData, 'anime', 'history', 'stream-subtitle-list'),
            [
                `{"lang":"en","label":"Arabic","default":false,"src":"${baseUrl}/ar.vtt"}`,
                `{"lang":"en","label":"English","default":true,"src":"${baseUrl}/en.vtt"}`,
                `{"lang":"en","label":"Portuguese (- Portuguese(Brazil))","default":false,"src":"${baseUrl}/pt.vtt"}`,
                `{"lang":"en","label":"Spanish (- Spanish(Latin America))","default":false,"src":"${baseUrl}/es.vtt"}`
            ].join('\n')
        );
        await watchEpisode(page, '1');
        const dialog = page.getByRole('dialog', { name: 'Fake Anime · EP 1' });
        await expect(dialog.locator('video')).toBeVisible();
        await dialog.getByRole('button', { name: 'Settings' }).click();
        const menu = dialog.getByRole('combobox', { name: 'Subtitles' });

        await expect(menu.locator('option')).toHaveText(['Off', 'English', 'Arabic', 'Portuguese (Brazil)', 'Spanish (Latin America)']);
        await expect(menu).toHaveValue('stream-2');
        const modes = (): Promise<Array<[string, string]>> => {
            return dialog.locator('video').evaluate((video) => {
                return Array.from((video as HTMLVideoElement).textTracks).map((track) => {
                    return [track.label, track.mode] as [string, string];
                });
            });
        };
        const showing = async (): Promise<string[]> => {
            return (await modes())
                .filter(([, mode]) => {
                    return mode === 'showing';
                })
                .map(([label]) => {
                    return label;
                });
        };
        await expect.poll(showing).toEqual(['English']);

        await menu.selectOption({ label: 'Portuguese (Brazil)' });

        await expect(menu).toHaveValue('stream-3');
        await expect.poll(showing).toEqual(['Portuguese (- Portuguese(Brazil))']);
        // The subtitle of that language is fetched through the app, with the site the source expects.
        await expect.poll(() => {
            return seen.some((entry) => {
                return entry.path === '/pt.vtt' && entry.referer === REFERER;
            });
        }).toBe(true);

        // The browser may show another one by itself (by language, as it did with the Arabic): the choice is put back.
        await dialog.locator('video').evaluate((video) => {
            const arabic = Array.from((video as HTMLVideoElement).textTracks).find((track) => {
                return track.label === 'Arabic';
            });
            if (arabic) {
                arabic.mode = 'showing';
            }
        });
        await expect.poll(showing).toEqual(['Portuguese (- Portuguese(Brazil))']);

        await menu.selectOption('off');
        await expect.poll(showing).toEqual([]);
        await menu.selectOption({ label: 'Spanish (Latin America)' });
        await expect.poll(showing).toEqual(['Spanish (- Spanish(Latin America))']);
    });

    test('checks a downloaded episode for subtitles the source offers and saves only the ones it does not have', async () => {
        const { page, animeDir, userData } = session;
        await downloadFirstEpisode(page);
        const folder = join(animeDir, 'Fake Anime', 'Season 1', 'Episode 1');
        // The download saved only the one ani-cli picked; the source offers three languages.
        writeFileSync(
            join(userData, 'anime', 'history', 'stream-subtitle-list'),
            [
                `{"lang":"en","label":"English","src":"${baseUrl}/en.vtt","default":true}`,
                `{"lang":"pt","label":"Portuguese","src":"${baseUrl}/pt.vtt"}`,
                `{"lang":"es","label":"Spanish","src":"${baseUrl}/es.vtt"}`
            ].join('\n')
        );
        await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
        await page.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
        await page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
        await page.getByRole('button', { name: 'PLAY: Fake Anime EP 1' }).click();
        const dialog = page.getByRole('dialog', { name: 'Fake Anime · EP 1' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('combobox', { name: 'Subtitles' })).toHaveCount(0);
        await dialog.getByRole('button', { name: 'Settings' }).click();
        await expect(dialog.getByRole('combobox', { name: 'Subtitles' })).toBeVisible();

        await expect(dialog.getByRole('combobox', { name: 'Subtitle color' })).toHaveCount(0);
        await expect(dialog.getByRole('combobox', { name: 'Subtitle background' })).toHaveCount(0);
        const cueStyle = await page.evaluate(() => {
            const rule = Array.from(document.styleSheets).flatMap((sheet) => {
                return Array.from(sheet.cssRules);
            }).find((candidate) => {
                return candidate instanceof CSSStyleRule && candidate.selectorText === '.player__video::cue';
            });
            const { style } = rule as CSSStyleRule;
            return {
                color: style.getPropertyValue('color'),
                background: style.getPropertyValue('background-color'),
                weight: style.getPropertyValue('font-weight'),
                family: style.getPropertyValue('font-family'),
                shadowLayers: style.getPropertyValue('text-shadow').split(/,\s*(?![^(]*\))/).length
            };
        });
        expect(cueStyle).toEqual({
            color: 'rgb(246, 233, 255)',
            background: 'transparent',
            weight: '700',
            family: 'Verdana, "DejaVu Sans", "Open Sans", sans-serif',
            shadowLayers: 33
        });
        await expect(dialog.locator('video')).toHaveCSS('--subtitle-scale', '1');

        const manager = await openSubtitleManager(dialog);
        await manager.getByRole('button', { name: 'CHECK SUBTITLES' }).click();
        await expect(page.locator('.toast--info .toast__message', { hasText: 'NEW SUBTITLES' })).toHaveText('NEW SUBTITLES ADDED (3): English, Portuguese, Spanish');
        await expect(manager.getByRole('button', { name: 'CHECK SUBTITLES' })).toBeEnabled();
        expect(readFileSync(join(folder, 'Fake Anime Episode 1.subtitle-English.vtt'), 'utf-8')).toContain('Hello from the stream');
        expect(readFileSync(join(folder, 'Fake Anime Episode 1.subtitle-Portuguese.vtt'), 'utf-8')).toContain('Ola do stream');
        expect(readFileSync(join(folder, 'Fake Anime Episode 1.subtitle-Spanish.vtt'), 'utf-8')).toContain('Hola del stream');
        // The source asked for them the way ani-cli does: with the site that embeds the player.
        expect(
            seen.filter((entry) => {
                return entry.path.endsWith('.vtt');
            }).map((entry) => {
                return [entry.path, entry.referer];
            })
        ).toEqual([
            ['/en.vtt', REFERER],
            ['/pt.vtt', REFERER],
            ['/es.vtt', REFERER]
        ]);
        // The player offers them at once.
        await openPlayerSettingsAfter(manager, dialog);
        const options = await dialog.getByRole('combobox', { name: 'Subtitles' }).locator('option').allTextContents();
        expect(options).toEqual(expect.arrayContaining(['English', 'Portuguese', 'Spanish']));

        // Asking again finds nothing new and downloads nothing.
        const asked = seen.length;
        await (await openSubtitleManager(dialog)).getByRole('button', { name: 'CHECK SUBTITLES' }).click();
        await expect(page.locator('.toast--info .toast__message', { hasText: 'NO NEW SUBTITLES' })).toHaveText('NO NEW SUBTITLES: THE SOURCE OFFERS NO OTHERS.');
        expect(
            seen.slice(asked).filter((entry) => {
                return entry.path.endsWith('.vtt');
            })
        ).toEqual([]);
    });

    test('shows the names of the subtitles clean, and keeps the names of their files as the source wrote them', async () => {
        const { page, animeDir, userData } = session;
        await downloadFirstEpisode(page);
        const folder = join(animeDir, 'Fake Anime', 'Season 1', 'Episode 1');
        writeFileSync(
            join(userData, 'anime', 'history', 'stream-subtitle-list'),
            [
                `{"lang":"pt","label":"Portuguese (- Portuguese(Brazil))","src":"${baseUrl}/pt.vtt"}`,
                `{"lang":"es","label":"Spanish (- Spanish(Latin America))","src":"${baseUrl}/es.vtt"}`
            ].join('\n')
        );
        await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
        await page.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
        await page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
        await page.getByRole('button', { name: 'PLAY: Fake Anime EP 1' }).click();
        const dialog = page.getByRole('dialog', { name: 'Fake Anime · EP 1' });
        const manager = await openSubtitleManager(dialog);
        await manager.getByRole('button', { name: 'CHECK SUBTITLES' }).click();

        await expect(page.locator('.toast--info .toast__message', { hasText: 'NEW SUBTITLES' })).toHaveText('NEW SUBTITLES ADDED (2): Portuguese (Brazil), Spanish (Latin America)');
        await openPlayerSettingsAfter(manager, dialog);
        const options = await dialog.getByRole('combobox', { name: 'Subtitles' }).locator('option').allTextContents();
        expect(options).toEqual(expect.arrayContaining(['Portuguese (Brazil)', 'Spanish (Latin America)']));
        expect(options.some((name) => {
            return name.includes('(- ');
        })).toBe(false);
        // The files keep the name the source gave, which is also what tells the subtitles apart.
        expect(existsSync(join(folder, 'Fake Anime Episode 1.subtitle-Portuguese (- Portuguese(Brazil)).vtt'))).toBe(true);
        expect(existsSync(join(folder, 'Fake Anime Episode 1.subtitle-Spanish (- Spanish(Latin America)).vtt'))).toBe(true);
    });

    test('has the subtitle buttons in a window opened from the gear of the player, not in the header, and the window goes with the stage to fullscreen', async () => {
        const { page } = session;
        await downloadFirstEpisode(page);
        await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
        await page.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
        await page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
        await page.getByRole('button', { name: 'PLAY: Fake Anime EP 1' }).click();
        const dialog = page.getByRole('dialog', { name: 'Fake Anime · EP 1' });
        await expect(dialog).toBeVisible();
        for (const name of ['LOAD SUBTITLE', 'CHECK SUBTITLES', 'TRANSLATE SUBTITLE', 'CREATE SUBTITLE']) {
            await expect(dialog.getByRole('button', { name })).toHaveCount(0);
        }
        await expect(page.getByRole('dialog', { name: 'Manage subtitles' })).toHaveCount(0);

        const manager = await openSubtitleManager(dialog);
        await expect(dialog.getByRole('dialog', { name: 'Settings' })).toHaveCount(0);
        for (const name of ['LOAD SUBTITLE', 'CHECK SUBTITLES']) {
            await expect(manager.getByRole('button', { name })).toBeVisible();
        }
        // Only the buttons: the menu of the subtitles and their size are in the settings.
        await expect(manager.getByRole('combobox')).toHaveCount(0);
        await expect(manager.getByRole('group', { name: 'Subtitle size' })).toHaveCount(0);
        // It is inside the part of the player that goes to fullscreen, so it is there too.
        const insideStage = await manager.evaluate((element) => {
            return document.querySelector('video')?.parentElement?.contains(element) ?? false;
        });
        expect(insideStage).toBe(true);

        // Esc closes the window and leaves the player where it was.
        await page.keyboard.press('Escape');
        await expect(manager).toBeHidden();
        await expect(dialog).toBeVisible();

        // The size of the subtitles is in the settings.
        await expect(dialog.locator('video')).toHaveCSS('--subtitle-scale', '1');
        await dialog.getByRole('button', { name: 'Settings' }).click();
        await dialog.getByRole('button', { name: 'Larger subtitles' }).click();
        await expect(dialog.locator('video')).not.toHaveCSS('--subtitle-scale', '1');
    });

    test('says so when the source offers no subtitles for the episode that was checked', async () => {
        const { page } = session;
        await downloadFirstEpisode(page);
        await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
        await page.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
        await page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
        await page.getByRole('button', { name: 'PLAY: Fake Anime EP 1' }).click();
        const dialog = page.getByRole('dialog', { name: 'Fake Anime · EP 1' });
        const manager = await openSubtitleManager(dialog);
        await manager.getByRole('button', { name: 'CHECK SUBTITLES' }).click();
        // The message is the notice of the app, in the corner of the screen and not above the video, and it goes away by itself.
        const toast = page.locator('.toast--info').filter({ hasText: 'NO NEW SUBTITLES' });
        await expect(toast.locator('.toast__message')).toHaveText('NO NEW SUBTITLES: THE SOURCE OFFERS NO OTHERS.');
        expect(await dialog.locator('.toast').count()).toBe(0);
        await expect(toast).toBeHidden({ timeout: 8000 });
    });

    test('plays the episode without downloading it, through the app', async () => {
        const { page, animeDir, userData } = session;
        await watchEpisode(page, '2');

        const dialog = page.getByRole('dialog', { name: 'Fake Anime · EP 2' });
        await expect(dialog).toBeVisible();
        await expect.poll(async () => {
            return dialog.locator('video').evaluate((video: HTMLVideoElement) => {
                return video.readyState >= 3 ? video.duration : 0;
            });
        }, { timeout: 20000 }).toBeGreaterThan(7);

        const played = await dialog.locator('video').evaluate(async (video: HTMLVideoElement) => {
            await new Promise((resolveWaiting) => {
                setTimeout(resolveWaiting, 1500);
            });
            return { time: video.currentTime, width: video.videoWidth, height: video.videoHeight, error: video.error?.code ?? null, tracks: video.textTracks.length };
        });
        expect(played.time).toBeGreaterThan(0.5);
        expect(played).toMatchObject({ width: 160, height: 120, error: null, tracks: 1 });

        // Every request of the player reached the host as the site that embeds it, never as the app.
        expect(seen.length).toBeGreaterThan(2);
        seen.forEach((request) => {
            expect(request.referer).toBe(REFERER);
            expect(request.origin).toBe('https://embed.example');
            expect(request.userAgent).toContain('Chrome/124.0.0.0');
        });
        expect(seen.map((request) => {
            return request.path;
        })).toEqual(expect.arrayContaining(['/index.m3u8', '/seg0.ts', '/en.vtt']));

        // ani-cli was only asked for the address (debug player, no -d) and nothing was saved.
        expect(readFileSync(join(userData, 'anime', 'history', 'calls.log'), 'utf-8').trim().split('\n').at(-1)).toBe('sub | -S 1 -e 2 -q 720p fake');
        expect(readFileSync(join(userData, 'anime', 'history', 'players.log'), 'utf-8').trim().split('\n').at(-1)).toBe('debug');
        expect(existsSync(animeDir) ? readdirSync(animeDir) : []).toEqual([]);
    });

    test('seeks in the episode', async () => {
        const { page } = session;
        await watchEpisode(page, '1');
        const video = page.getByRole('dialog').locator('video');
        await expect.poll(async () => {
            return video.evaluate((element: HTMLVideoElement) => {
                return element.readyState;
            });
        }, { timeout: 20000 }).toBeGreaterThanOrEqual(3);

        // The bar knows the length of the episode a moment after the video does: a slider that is still empty would take any
        // position back to the start.
        const seek = page.getByRole('dialog').getByRole('slider', { name: 'Seek' });
        await expect.poll(async () => {
            return Number(await seek.getAttribute('max'));
        }).toBeGreaterThan(5);

        // The mouse on the timeline shows the moment under it (the episode is about 8 seconds long).
        const box = await seek.boundingBox();
        expect(box).not.toBeNull();
        const { x, y, width, height } = box as { x: number; y: number; width: number; height: number };
        await page.mouse.move(x + width / 2, y + height / 2);
        await expect(page.getByRole('dialog').getByRole('tooltip')).toHaveText(/^0:0[3-5]$/);
        await page.mouse.move(x + width / 2, y - 200);
        await expect(page.getByRole('dialog').getByRole('tooltip')).toHaveCount(0);

        await seek.fill('5');
        await expect.poll(() => {
            return seen.some((request) => {
                return request.path === '/seg2.ts' || request.path === '/seg3.ts';
            });
        }).toBe(true);
        await expect.poll(async () => {
            return video.evaluate((element: HTMLVideoElement) => {
                return element.currentTime;
            });
        }, { timeout: 15000 }).toBeGreaterThan(5);

        // The bar under the slider, the one of a download, is as wide as the part of the episode already watched.
        await expect.poll(async () => {
            return page.getByRole('dialog').locator('.player__timeline .progress__bar').evaluate((element: HTMLElement) => {
                return Number.parseFloat(element.style.width);
            });
        }).toBeGreaterThan(50);
    });

    test('closes with Escape and the stream is no longer served', async () => {
        const { page, app } = session;
        const answer = async (url: string): Promise<{ status: number; type: string | null; body: string }> => {
            return app.evaluate(async ({ net }, target) => {
                const response = await net.fetch(target);
                return { status: response.status, type: response.headers.get('content-type'), body: await response.text() };
            }, url);
        };
        await openAnimeTab(page);
        await openFirstResult(page);
        const opened = await page.evaluate(() => {
            return window.api.openAnimeStream({ query: 'fake', index: 1, audio: 'sub', episode: '1' });
        });
        expect(opened.ok).toBe(true);
        if (!opened.ok) {
            return;
        }

        const playlist = await answer(opened.stream.url);
        expect(playlist.status).toBe(200);
        expect(playlist.type).toBe('application/vnd.apple.mpegurl');
        expect(playlist.body).toContain('#EXTM3U');
        expect(playlist.body).toContain('pullwave-stream://p/');
        expect(playlist.body).not.toContain('seg0.ts\n');
        expect(opened.stream.subtitleUrl).toMatch(/^pullwave-stream:\/\/p\//);

        // A host the stream never used is refused, and so is what is not an address of the app.
        const stranger = `pullwave-stream://p/${opened.stream.sessionId}/${Buffer.from('http://127.0.0.2:1/secret').toString('base64url')}`;
        expect((await answer(stranger)).status).toBe(403);

        await page.evaluate((id) => {
            return window.api.closeAnimeStream(id);
        }, opened.stream.sessionId);
        expect((await answer(opened.stream.url)).status).toBe(404);
    });

    test('says why the video could not be found', async () => {
        const { page } = session;
        await openAnimeTab(page);
        await search(page, 'nosource');
        await page.getByRole('button', { name: 'OPEN: Fake Anime', exact: true }).click();
        await page.getByRole('button', { name: 'EP 1', exact: true }).click();

        const alert = page.getByRole('dialog').getByRole('alert');
        await expect(alert).toHaveText('No video source was found for this episode.');
        await expect(alert).not.toHaveAttribute('title');
        await alert.getByRole('button', { name: 'No video source was found for this episode.' }).click();
        const details = page.getByRole('dialog', { name: 'ERROR DETAILS' });
        await expect(details.getByTestId('error-message')).toHaveText('No sources found for sub!');
        await details.getByRole('button', { name: 'CLOSE' }).click();
        await expect(details).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toBeHidden();
    });

    test('sorts the library by the last watched with the anime that was really watched in front, not the one that was only opened or added last', async () => {
        const { page } = session;
        await openAnimeTab(page);
        await search(page, 'fake');
        // Both anime are opened, and so are in the history, when they are added; none was watched yet.
        await page.getByRole('button', { name: 'OPEN: Fake Anime', exact: true }).click();
        await expect(page.getByRole('button', { name: 'EP 3', exact: true })).toBeVisible();
        await confirmAdd(page);
        await expect(page.getByRole('button', { name: 'VIEW IN LIBRARY', exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'BACK', exact: true }).click();
        await page.getByRole('button', { name: 'OPEN: Fake Anime 2', exact: true }).click();
        await expect(page.getByRole('button', { name: 'EP 3', exact: true })).toBeVisible();
        await confirmAdd(page);
        await expect(page.getByRole('button', { name: 'VIEW IN LIBRARY', exact: true })).toBeVisible();

        // An episode of the first one is watched; then the second one is only opened again, so it was opened last.
        await page.getByRole('button', { name: 'BACK', exact: true }).click();
        await page.getByRole('button', { name: 'OPEN: Fake Anime', exact: true }).click();
        await page.getByRole('button', { name: 'EP 1', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'Fake Anime · EP 1' }).locator('video')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toBeHidden();
        await page.getByRole('button', { name: 'BACK', exact: true }).click();
        await page.getByRole('button', { name: 'OPEN: Fake Anime 2', exact: true }).click();
        await expect(page.getByRole('button', { name: 'EP 3', exact: true })).toBeVisible();

        await page.getByRole('navigation', { name: 'Anime' }).getByRole('button', { name: 'LIBRARY', exact: true }).click();
        await page.getByRole('combobox', { name: 'Sort by' }).selectOption('last');
        await expect(page.getByRole('combobox', { name: 'Sort by' })).toHaveValue('last');
        const cards = page.getByTestId('anime-card');
        await expect(cards).toHaveCount(2);
        // The one that was watched comes first, though the other was opened and added after it.
        await expect(cards.nth(0)).toHaveAttribute('aria-label', 'Fake Anime');
        await expect(cards.nth(1)).toHaveAttribute('aria-label', 'Fake Anime 2');
    });

    // The time under the mouse is a part of the box of the timeline, right above the bar, and it is centered on the mouse wherever the mouse is on the
    // bar: at the size of the window the test has, and with the interface magnified (see --ui-zoom), where the mouse and the page are measured in
    // other pixels.
    async function expectTheTimeOverTheMouse(page: Page): Promise<void> {
        await watchEpisode(page, '1');
        const dialog = page.getByRole('dialog', { name: 'Fake Anime · EP 1' });
        await expect(dialog.locator('video')).toBeVisible();
        const seek = dialog.getByRole('slider', { name: 'Seek' });
        await expect.poll(async () => {
            return Number(await seek.getAttribute('max'));
        }).toBeGreaterThan(5);
        const zoom = Number(await page.evaluate(() => {
            return getComputedStyle(document.documentElement).zoom;
        }));
        type Box = { x: number; y: number; width: number; height: number };
        // The dialog gets its height from the video once it is known, so the bar is measured again before each move (it is only 8 px thick).
        const measure = async (): Promise<{ bar: Box; line: Box }> => {
            return {
                bar: (await seek.boundingBox()) as Box,
                line: (await dialog.locator('.player__timeline').boundingBox()) as Box
            };
        };
        const tooltip = dialog.getByRole('tooltip');
        // The tooltip is a part of the box of the timeline, not of the whole bar of the controls (it would float far above the thin bar).
        const first = (await measure()).bar;
        await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
        await expect(tooltip).toBeVisible();
        expect(await tooltip.evaluate((element) => { return element.parentElement?.className; })).toBe('player__timeline');

        for (const fraction of [0.05, 0.25, 0.5, 0.75, 0.95]) {
            await expect(async () => {
                const { bar } = await measure();
                const mouseX = bar.x + bar.width * fraction;
                await page.mouse.move(mouseX, bar.y + bar.height / 2);
                await expect(tooltip).toHaveText(/^0:0\d$/, { timeout: 1000 });
                const tip = (await tooltip.boundingBox()) as Box;
                const { line } = await measure();
                // Centered on the mouse (the box is as wide as the text), and 6px of the page above the top of the timeline.
                expect(Math.abs(tip.x + tip.width / 2 - mouseX)).toBeLessThanOrEqual(1.5);
                expect(Math.abs(tip.y + tip.height - (line.y - 6 * zoom))).toBeLessThanOrEqual(1.5);
            }).toPass({ timeout: 8000 });
        }
    }

    test('puts the time under the mouse right above the timeline, centered on the mouse, wherever it is on the bar', async () => {
        await expectTheTimeOverTheMouse(session.page);
    });

    test('puts the time under the mouse over the mouse also when the interface is magnified on a wide screen, and not further to the right the further it goes @resize', async () => {
        await session.page.setViewportSize({ width: 3440, height: 1400 });
        expect(await session.page.evaluate(() => { return getComputedStyle(document.documentElement).zoom; })).toBe('1.2');
        await expectTheTimeOverTheMouse(session.page);
    });

    test('closes the player with Escape while it plays', async () => {
        const { page } = session;
        await watchEpisode(page, '1');
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toBeHidden();
        // Back on the episodes of the anime, with nothing downloaded and nothing added to the library by watching.
        await expect(page.getByRole('button', { name: 'EP 1', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'ADD TO LIBRARY', exact: true })).toBeVisible();
    });
});

test.describe('library of the search', () => {
    async function addToLibrary(page: Page): Promise<void> {
        await openAnimeTab(page);
        await openFirstResult(page);
        await openAddDialog(page);
        await addDialog(page).getByRole('button', { name: 'CONFIRM' }).click();
        await expect(page.getByRole('button', { name: 'VIEW IN LIBRARY', exact: true })).toBeVisible();
    }

    test('adds an anime to the library without downloading anything, and offers to view it there instead', async () => {
        const { page, animeDir } = session;
        await openAnimeTab(page);
        await openFirstResult(page);
        await expect(page.getByRole('button', { name: 'DOWNLOAD SELECTED (1)' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'SELECT ALL' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'WATCH', exact: true })).toHaveCount(0);
        // The series and the order are asked in the window, not on the page.
        await expect(page.getByRole('textbox', { name: 'Series' })).toHaveCount(0);
        const dialog = await openAddDialog(page);
        await expect(dialog.getByRole('textbox', { name: 'Series' })).toHaveValue('Fake Anime');
        await dialog.getByRole('button', { name: 'CONFIRM' }).click();
        await expect(page.locator('.toast__message')).toHaveText('Added to the library: Fake Anime (3 episodes).');
        await expect(page.getByRole('button', { name: 'ADD TO LIBRARY', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'VIEW IN LIBRARY', exact: true })).toBeVisible();
        await expect(page.getByRole('textbox', { name: 'Series' })).toHaveCount(0);
        await expect(page.getByText('In the series "Fake Anime", order 1.')).toBeVisible();
        // The results of the search tell it too.
        await page.getByRole('button', { name: 'BACK' }).click();
        await expect(page.getByRole('button', { name: 'VIEW IN LIBRARY: Fake Anime' })).toBeVisible();
        // Nothing was asked of ani-cli to download, and nothing is on the disk.
        expect(
            calls().filter((line) => {
                return line.includes('-d ');
            })
        ).toEqual([]);
        expect(existsSync(join(animeDir, 'Fake Anime'))).toBe(false);
        await showDownloads(page);
        await expect(page.getByText('// NO DOWNLOADS YET.')).toBeVisible();
    });

    test('adds the episodes that came out after the anime was added with one button, which is gone once the library has them all', async () => {
        const { page, userData } = session;
        await addToLibrary(page);
        // Nothing is missing yet: the button to view is the only one.
        await expect(page.getByRole('button', { name: /^ADD NEW EPISODES/ })).toHaveCount(0);

        // The source got a fourth episode: the anime is opened again from the results.
        const history = join(userData, 'anime', 'history');
        writeFileSync(join(history, 'more-episodes'), '');
        await page.getByRole('button', { name: 'BACK' }).click();
        await page.getByRole('button', { name: 'OPEN: Fake Anime', exact: true }).click();
        await expect(page.getByRole('button', { name: 'EP 4', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'ADD TO LIBRARY', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'VIEW IN LIBRARY', exact: true })).toBeVisible();

        await page.getByRole('button', { name: 'ADD NEW EPISODES (1)', exact: true }).click();
        await expect(page.locator('.toast__message')).toHaveText('Added to the library: Fake Anime (4 episodes).');
        await expect(page.getByRole('button', { name: /^ADD NEW EPISODES/ })).toHaveCount(0);
        expect(
            calls().filter((line) => {
                return line.includes('-d ');
            })
        ).toEqual([]);

        await page.getByRole('button', { name: 'VIEW IN LIBRARY', exact: true }).click();
        await page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
        await expect(page.getByText('0/4 DOWNLOADED')).toBeVisible();
        await expect(page.getByTestId('anime-episode').locator('.history__meta')).toHaveText(['NOT DOWNLOADED', 'NOT DOWNLOADED', 'NOT DOWNLOADED', 'NOT DOWNLOADED']);
    });

    test('shows the episodes that were added as not downloaded, each with its own button to download it', async () => {
        const { page } = session;
        await addToLibrary(page);
        await page.getByRole('button', { name: 'VIEW IN LIBRARY', exact: true }).click();
        // Coming from the search the series opens with its season closed.
        await expect(page.getByTestId('anime-episode')).toHaveCount(0);
        await page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();

        await expect(page.getByText('0/3 DOWNLOADED')).toBeVisible();
        await expect(page.getByTestId('anime-episode').locator('.history__meta')).toHaveText(['NOT DOWNLOADED', 'NOT DOWNLOADED', 'NOT DOWNLOADED']);
        await expect(page.getByRole('button', { name: 'DOWNLOAD: Fake Anime EP 2', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: /^REMOVE: / })).toHaveCount(0);

        await page.getByRole('button', { name: 'DOWNLOAD: Fake Anime EP 2', exact: true }).click();
        await expect(page.locator('.toast').filter({ hasText: 'Download complete: Fake Anime · EP 2' })).toBeVisible({ timeout: 20000 });
        await expect(page.getByTestId('anime-episode').locator('.history__meta').nth(1)).toHaveText('DOWNLOADED · 19 B');
        await expect(page.getByText('1/3 DOWNLOADED')).toBeVisible();
        await expect(page.getByRole('button', { name: 'DOWNLOAD: Fake Anime EP 2', exact: true })).toHaveCount(0);
    });

    test('downloads everything that is missing from the screen of the series, telling each one that finishes', { tag: '@windows' }, async () => {
        test.slow();
        const { page, animeDir } = session;
        await addToLibrary(page);
        await page.getByRole('button', { name: 'VIEW IN LIBRARY', exact: true }).click();
        // The button is on the screen of the series, and the card does not have it.
        await expect(page.getByRole('button', { name: 'DOWNLOAD ALL: Fake Anime' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'OPEN FOLDER: Fake Anime' })).toHaveCount(0);

        await page.getByRole('button', { name: 'DOWNLOAD ALL: Fake Anime' }).click();
        const toasts = page.locator('.toast').filter({ hasText: 'Download complete: ' });
        await expect(toasts.first()).toBeVisible({ timeout: 60000 });
        await expect(page.getByText('3/3 DOWNLOADED')).toBeVisible({ timeout: 90000 });
        // Every one goes away five seconds after it showed up.
        await expect(toasts).toHaveCount(0, { timeout: 15000 });
        ['1', '2', '3'].forEach((number) => {
            expect(existsSync(join(animeDir, 'Fake Anime', 'Season 1', `Episode ${number}`, `Fake Anime Episode ${number}.mp4`))).toBe(true);
        });
        // With everything downloaded there is nothing missing: the button is gone, and the folder can be opened.
        await expect(page.getByRole('button', { name: 'DOWNLOAD ALL: Fake Anime' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'OPEN FOLDER: Fake Anime' })).toBeVisible();
        await showDownloads(page);
        await expect(page.getByTestId('anime-job')).toHaveCount(0);
    });

    test('downloads only the episodes of one season, from the button of its row, leaving the other seasons of the series alone', { tag: '@windows' }, async () => {
        test.slow();
        const { page, animeDir } = session;
        await openAnimeTab(page);
        await openFirstResult(page);
        await page.getByRole('button', { name: 'ADD TO LIBRARY', exact: true }).click();
        await page.getByRole('button', { name: 'CONFIRM' }).click();
        await page.getByRole('button', { name: 'BACK' }).click();
        await page.getByRole('button', { name: 'OPEN: Fake Anime 2', exact: true }).click();
        await openAddDialog(page);
        await page.getByRole('textbox', { name: 'Series' }).fill('Fake Anime');
        await page.getByRole('spinbutton', { name: 'Order' }).fill('2');
        await page.getByRole('button', { name: 'CONFIRM' }).click();
        await page.getByRole('button', { name: 'VIEW IN LIBRARY', exact: true }).click();

        // Each season has its own button on its row, which works with the season closed and does not open it.
        await expect(page.getByTestId('anime-season')).toHaveCount(2);
        await expect(page.getByRole('button', { name: 'DOWNLOAD SEASON: Fake Anime', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'DOWNLOAD SEASON: Fake Anime 2', exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'DOWNLOAD SEASON: Fake Anime 2', exact: true }).click();

        const toasts = page.locator('.toast').filter({ hasText: 'Download complete: Fake Anime 2 · EP ' });
        await expect(toasts.first()).toBeVisible({ timeout: 60000 });
        await expect(page.getByText('3/3 DOWNLOADED')).toBeVisible({ timeout: 90000 });
        await expect(page.getByTestId('anime-episode')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'DOWNLOAD SEASON: Fake Anime 2', exact: true })).toHaveCount(0);
        // The other season is as it was: nothing downloaded, and its button is still there.
        await expect(page.getByRole('button', { name: 'DOWNLOAD SEASON: Fake Anime', exact: true })).toBeVisible();
        ['1', '2', '3'].forEach((number) => {
            expect(existsSync(join(animeDir, 'Fake Anime', 'Season 2', `Episode ${number}`, `Fake Anime 2 Episode ${number}.mp4`))).toBe(true);
        });
        expect(existsSync(join(animeDir, 'Fake Anime', 'Season 1'))).toBe(false);
        expect(
            calls()
                .filter((line) => {
                    return line.includes('-d ');
                })
                .sort()
        ).toEqual(['sub | -d -S 2 -e 1 -q 720p fake', 'sub | -d -S 2 -e 2 -q 720p fake', 'sub | -d -S 2 -e 3 -q 720p fake']);
        // The button of the series still has the other season to do.
        await expect(page.getByRole('button', { name: 'DOWNLOAD ALL: Fake Anime', exact: true })).toBeVisible();
    });

    test('downloads again, with DOWNLOAD ALL, the episode whose download failed', { tag: '@windows' }, async () => {
        const { page } = session;
        await openAnimeTab(page);
        await search(page, 'fail');
        await page.getByRole('button', { name: 'OPEN: Fake Anime', exact: true }).click();
        await downloadFromLibrary(page, [1]);
        await showDownloads(page);
        await expect(page.getByTestId('anime-job').locator('.badge--error')).toHaveText('FAILED');
        await backFromDownloads(page);
        await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
        await page.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();

        await page.getByRole('button', { name: 'DOWNLOAD ALL: Fake Anime' }).click();
        await expect
            .poll(() => {
                return calls().filter((line) => {
                    return line.includes('-d -S 1 -e 1');
                }).length;
            })
            .toBe(2);
    });

    test('renames the series from its screen, and the screen goes on with the series under the new name', async () => {
        const { page } = session;
        await addToLibrary(page);
        await page.getByRole('button', { name: 'VIEW IN LIBRARY', exact: true }).click();

        // The gear is the last element of the row, and holds the two buttons that act on the whole series.
        const badges = page.getByTestId('series-view').locator('> .job__head > .job__badges');
        await expect(badges.locator('> *').last().getByRole('button', { name: 'Series options: Fake Anime' })).toBeVisible();
        await page.getByRole('button', { name: 'Series options: Fake Anime' }).click();
        await expect(page.getByRole('group', { name: 'Series options: Fake Anime' }).getByRole('button')).toHaveText(['RENAME SERIES', 'REMOVE SERIES']);
        await page.getByRole('button', { name: 'RENAME SERIES: Fake Anime' }).click();

        await page.getByRole('textbox', { name: 'Series name' }).fill('Frieren');
        await page.getByRole('button', { name: 'SAVE' }).click();
        await expect(page.getByTestId('series-view').getByRole('heading', { level: 3 })).toHaveText('Frieren');
        await expect(page.getByRole('textbox', { name: 'Series name' })).toHaveCount(0);
        await expect(page.getByTestId('anime-season').getByRole('heading', { level: 4 })).toHaveText(['Fake Anime']);

        await page.getByRole('button', { name: 'BACK TO LIBRARY', exact: true }).click();
        await expect(page.getByTestId('anime-card').getByRole('heading', { level: 3 })).toHaveText('Frieren');
        // The anime of the search is in the series with its new name.
        await page.locator('.tab', { hasText: 'SEARCH' }).click();
        await openFirstResult(page);
        await expect(page.getByText('In the series "Frieren", order 1.')).toBeVisible();
    });

    test('refuses a series name that is empty, and keeps the series as it was', async () => {
        const { page } = session;
        await addToLibrary(page);
        await page.getByRole('button', { name: 'VIEW IN LIBRARY', exact: true }).click();
        await page.getByRole('button', { name: 'Series options: Fake Anime' }).click();
        await page.getByRole('button', { name: 'RENAME SERIES: Fake Anime' }).click();
        await page.getByRole('textbox', { name: 'Series name' }).fill('   ');
        await page.getByRole('button', { name: 'SAVE' }).click();

        await expect(page.getByRole('alert')).toHaveText('Give a series name of up to 100 characters.');
        await page.getByRole('button', { name: 'CANCEL' }).click();
        await expect(page.getByTestId('series-view').getByRole('heading', { level: 3 })).toHaveText('Fake Anime');
    });

    test('goes to the anime in the search with GO TO SOURCE, and removes the whole series from the gear', async () => {
        const { page } = session;
        await addToLibrary(page);
        await page.getByRole('button', { name: 'VIEW IN LIBRARY', exact: true }).click();
        await expect(page.getByRole('button', { name: 'GET MORE EPISODES' })).toHaveCount(0);

        await page.getByRole('button', { name: 'GO TO SOURCE: Fake Anime' }).click();
        await expect(page.getByRole('button', { name: 'EP 3', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'VIEW IN LIBRARY', exact: true })).toBeVisible();

        await page.getByRole('button', { name: 'VIEW IN LIBRARY', exact: true }).click();
        await page.getByRole('button', { name: 'Series options: Fake Anime' }).click();
        await page.getByRole('button', { name: 'REMOVE SERIES: Fake Anime' }).click();
        await expect(page.getByRole('dialog', { name: 'Remove the series "Fake Anime"?' })).toContainText('their downloaded episodes are deleted from the disk too.');
        await answerConfirm(page, 'Remove the series "Fake Anime"?', 'REMOVE');
        await expect(page.getByText('// THE LIBRARY IS EMPTY. SEARCH AN ANIME AND ADD IT TO THE LIBRARY.')).toBeVisible();
    });
});

// The window of the subtitles of the player: opened from the gear, it has the buttons that load, translate, create and check subtitles, and the
// menu with the subtitles of the episode (the gear's own menu is closed while it is open).
async function openSubtitleManager(player: Locator): Promise<Locator> {
    const gear = player.getByRole('button', { name: 'Settings' });
    if ((await gear.getAttribute('aria-expanded')) !== 'true') {
        await gear.click();
    }
    await player.getByRole('button', { name: 'MANAGE SUBTITLES' }).click();
    const manager = player.page().getByRole('dialog', { name: 'Manage subtitles' });
    await expect(manager).toBeVisible();
    return manager;
}

// Closes the window of the subtitles and opens the settings of the player, where the menu of the subtitles and their size are (the window
// covers the player while it is open).
async function openPlayerSettingsAfter(manager: Locator, player: Locator): Promise<void> {
    await manager.getByRole('button', { name: 'CLOSE' }).click();
    await expect(manager).toBeHidden();
    const gear = player.getByRole('button', { name: 'Settings' });
    if ((await gear.getAttribute('aria-expanded')) !== 'true') {
        await gear.click();
    }
}

test.describe('translating subtitles with a language model', () => {
    const TOKEN = 'sk-e2e-token';
    const ENGLISH_SUBTITLE = 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\nHello there\n\n2\n00:00:04.000 --> 00:00:06.000\nSee you\n';
    const SPANISH_SUBTITLE = 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\nES: Hello there\n\n2\n00:00:04.000 --> 00:00:06.000\nES: See you\n';

    interface LlmRequest {
        method: string | undefined;
        path: string;
        authorization: string | undefined;
        contentType: string | undefined;
        body: { model: string; messages: Array<{ role: string; content: string }> };
    }

    // The provider the app is asked to use: it speaks the protocol of OpenAI and "translates" by putting ES: before each line.
    let server: Server;
    let baseUrl: string;
    let received: LlmRequest[];
    let answerWith: number;
    let hold: boolean;

    test.beforeAll(async () => {
        received = [];
        server = createServer((request, response) => {
            const chunks: Buffer[] = [];
            request.on('data', (chunk: Buffer) => {
                chunks.push(chunk);
            });
            request.on('end', () => {
                const body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as LlmRequest['body'];
                received.push({ method: request.method, path: request.url ?? '', authorization: request.headers.authorization, contentType: request.headers['content-type'], body });
                if (hold) {
                    return;
                }
                if (answerWith !== 200) {
                    response.writeHead(answerWith, { 'Content-Type': 'text/plain' }).end('the provider says no');
                    return;
                }
                const texts = JSON.parse(body.messages[1]?.content ?? '[]') as string[];
                const translated = texts.map((text) => {
                    return `ES: ${text}`;
                });
                response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(translated) } }] }));
            });
        });
        await new Promise<void>((resolveListening) => {
            server.listen(0, '127.0.0.1', resolveListening);
        });
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    test.afterAll(async () => {
        server.closeAllConnections();
        await new Promise<void>((resolveClosed) => {
            server.close(() => {
                resolveClosed();
            });
        });
    });

    test.beforeEach(async () => {
        received.length = 0;
        answerWith = 200;
        hold = false;
        // The keyring of the machine is not used: the tokens are kept the plain way, which only this variable allows.
        const { userData } = session;
        await session.app.close();
        session = await launch(userData, { translateProvider: 'custom', translateModel: 'fake-model', translateBaseUrl: `${baseUrl}/v1`, translateLanguage: 'Spanish' }, { PULLWAVE_FAKE_SECRETS: '1' });
    });

    function episodeFolder(episode: number): string {
        return join(session.animeDir, 'Fake Anime', 'Season 1', `Episode ${episode}`);
    }

    function translatedFile(episode: number): string {
        return join(episodeFolder(episode), `Fake Anime Episode ${episode}.translated-Spanish.vtt`);
    }

    // Downloads the episodes and gives each one an English subtitle with two lines (the fake ani-cli saves an empty one).
    async function downloadWithSubtitles(page: Page, episodes: number[]): Promise<void> {
        await openAnimeTab(page);
        await openFirstResult(page);
        await downloadFromLibrary(page, episodes);
        await waitForDownloaded(page);
        episodes.forEach((episode) => {
            writeFileSync(join(episodeFolder(episode), `Fake Anime Episode ${episode}.subtitle-English.vtt`), ENGLISH_SUBTITLE);
        });
    }

    async function showEpisodes(page: Page): Promise<void> {
        await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
        await page.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
        await page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
    }

    async function openPlayer(page: Page): Promise<Locator> {
        await showEpisodes(page);
        await page.getByRole('button', { name: 'PLAY: Fake Anime EP 1' }).click();
        const dialog = page.getByRole('dialog', { name: 'Fake Anime · EP 1' });
        await expect(dialog).toBeVisible();
        return dialog;
    }

    async function saveToken(page: Page): Promise<void> {
        await openAnimeSettings(page);
        await expect(page.getByLabel('Provider', { exact: true })).toHaveValue('custom');
        await expect(page.getByLabel('Model', { exact: true })).toHaveValue('fake-model');
        await expect(page.getByLabel('Address (optional)', { exact: true })).toHaveValue(`${baseUrl}/v1`);
        await expect(page.getByLabel('Default language', { exact: true })).toHaveValue('Spanish');
        await expect(page.getByText('No token is saved for this provider.')).toBeVisible();
        await expect(page.getByLabel('Token (API key)', { exact: true })).toHaveAttribute('type', 'password');
        await page.getByLabel('Token (API key)', { exact: true }).fill(TOKEN);
        await page.getByRole('button', { name: 'SAVE TOKEN' }).click();
        await expect(page.getByText('A token is saved for this provider.')).toBeVisible();
    }

    async function mediaRequest(url: string): Promise<{ status: number; headers: Record<string, string>; body: string }> {
        return session.app.evaluate(async ({ net }, target) => {
            const response = await net.fetch(target);
            const headers: Record<string, string> = {};
            response.headers.forEach((value, key) => {
                headers[key] = value;
            });
            return { status: response.status, headers, body: await response.text() };
        }, url);
    }

    test('keeps the token in the main process, encrypted apart from the settings, and never shows it again', async () => {
        const { page, userData } = session;
        await saveToken(page);
        await expect(page.getByLabel('Token (API key)', { exact: true })).toHaveValue('');
        await expect(page.getByRole('button', { name: 'REMOVE TOKEN' })).toBeVisible();
        const tokens = JSON.parse(readFileSync(join(userData, 'llm-tokens.json'), 'utf-8')) as Record<string, string>;
        expect(Object.keys(tokens)).toEqual(['custom']);
        expect(Buffer.from(tokens.custom as string, 'base64').toString('utf-8')).toBe(TOKEN);
        await expect.poll(() => {
            return readFileSync(join(userData, 'settings.json'), 'utf-8');
        }).not.toContain(TOKEN);

        await page.getByRole('button', { name: 'REMOVE TOKEN' }).click();
        await answerConfirm(page, 'Remove the token?', 'REMOVE TOKEN');
        await expect(page.getByText('No token is saved for this provider.')).toBeVisible();
        expect(JSON.parse(readFileSync(join(userData, 'llm-tokens.json'), 'utf-8'))).toEqual({});
    });

    test('shows the cost before it starts, translates the English subtitle and offers the result in the player', async () => {
        const { page } = session;
        await saveToken(page);
        await downloadWithSubtitles(page, [1]);
        const dialog = await openPlayer(page);
        await (await openSubtitleManager(dialog)).getByRole('button', { name: 'TRANSLATE SUBTITLE' }).click();
        const translate = page.getByRole('dialog', { name: 'Translate a subtitle' });
        await expect(translate).toBeVisible();
        await expect(translate.getByText('Provider: Other (OpenAI-compatible) · Model: fake-model')).toBeVisible();
        await expect(translate.getByLabel('Translate into')).toHaveValue('Spanish');
        await expect(translate.getByLabel('Translate from')).toHaveValue('auto');
        // Nothing is asked of the provider before the user confirms.
        await expect(translate.getByText('2 lines, 1 requests, about 160 tokens of your account.')).toBeVisible();
        expect(received).toEqual([]);

        await translate.getByRole('button', { name: 'TRANSLATE', exact: true }).click();
        await expect(translate).toBeHidden();
        await expect(page.locator('.toast--info .toast__message', { hasText: 'SUBTITLE TRANSLATED' })).toHaveText('SUBTITLE TRANSLATED INTO Spanish.');

        expect(received).toHaveLength(1);
        const [sent] = received as [LlmRequest];
        expect({ method: sent.method, path: sent.path, authorization: sent.authorization, contentType: sent.contentType, model: sent.body.model }).toEqual({
            method: 'POST',
            path: '/v1/chat/completions',
            authorization: `Bearer ${TOKEN}`,
            contentType: 'application/json',
            model: 'fake-model'
        });
        expect(sent.body.messages.map((message) => {
            return message.role;
        })).toEqual(['system', 'user']);
        expect(sent.body.messages[0]?.content).toContain('Translate each string into Spanish.');
        expect(sent.body.messages[1]?.content).toBe('["Hello there","See you"]');
        expect(readFileSync(translatedFile(1), 'utf-8')).toBe(SPANISH_SUBTITLE);
        // The subtitle it started from is as it was.
        expect(readFileSync(join(episodeFolder(1), 'Fake Anime Episode 1.subtitle-English.vtt'), 'utf-8')).toBe(ENGLISH_SUBTITLE);

        // The player has it, shows it, and the app serves it like any other subtitle of the episode.
        await openPlayerSettingsAfter(page.getByRole('dialog', { name: 'Manage subtitles' }), dialog);
        const menu = dialog.getByRole('combobox', { name: 'Subtitles' });
        await expect(menu).toHaveValue('translated-Spanish');
        expect(await menu.locator('option').allTextContents()).toEqual(expect.arrayContaining(['English', 'Spanish']));
        const served = await mediaRequest('pullwave-media://subtitle/1/translated-Spanish');
        expect(served.status).toBe(200);
        expect(served.headers['content-type']).toBe('text/vtt; charset=utf-8');
        expect(served.body).toBe(SPANISH_SUBTITLE);
    });

    test('says the settings have no token, and asks the provider for nothing', async () => {
        const { page } = session;
        await downloadWithSubtitles(page, [1]);
        const dialog = await openPlayer(page);
        await (await openSubtitleManager(dialog)).getByRole('button', { name: 'TRANSLATE SUBTITLE' }).click();
        const translate = page.getByRole('dialog', { name: 'Translate a subtitle' });
        await expect(translate.getByText('2 lines, 1 requests, about 160 tokens of your account.')).toBeVisible();
        await translate.getByRole('button', { name: 'TRANSLATE', exact: true }).click();
        await expect(translate.getByRole('alert')).toHaveText('There is no token for this provider. Add one in the anime settings.');
        await expect(translate.getByRole('button', { name: 'TRANSLATE', exact: true })).toBeEnabled();
        expect(received).toEqual([]);
        expect(existsSync(translatedFile(1))).toBe(false);
    });

    test('says what went wrong when the provider does not accept the token, and saves nothing', async () => {
        const { page } = session;
        answerWith = 401;
        await saveToken(page);
        await downloadWithSubtitles(page, [1]);
        const dialog = await openPlayer(page);
        await (await openSubtitleManager(dialog)).getByRole('button', { name: 'TRANSLATE SUBTITLE' }).click();
        const translate = page.getByRole('dialog', { name: 'Translate a subtitle' });
        await expect(translate.getByText('2 lines, 1 requests, about 160 tokens of your account.')).toBeVisible();
        await translate.getByRole('button', { name: 'TRANSLATE', exact: true }).click();
        await expect(translate.getByRole('alert')).toHaveText('The translation failed. The provider did not accept the token. Check it in the anime settings.');
        expect(received).toHaveLength(1);
        expect(received[0]?.authorization).toBe(`Bearer ${TOKEN}`);
        expect(existsSync(translatedFile(1))).toBe(false);
        // The notices of the downloads are still there: only the one that says the subtitle was made must not be.
        await expect(page.locator('.toast--info', { hasText: 'SUBTITLE TRANSLATED' })).toHaveCount(0);
    });

    test('shows the progress and stops when the user cancels, without saving anything', async () => {
        const { page } = session;
        hold = true;
        await saveToken(page);
        await downloadWithSubtitles(page, [1]);
        const dialog = await openPlayer(page);
        await (await openSubtitleManager(dialog)).getByRole('button', { name: 'TRANSLATE SUBTITLE' }).click();
        const translate = page.getByRole('dialog', { name: 'Translate a subtitle' });
        await expect(translate.getByText('2 lines, 1 requests, about 160 tokens of your account.')).toBeVisible();
        await translate.getByRole('button', { name: 'TRANSLATE', exact: true }).click();
        await expect(translate.getByText('Translated 0 of 2 lines…')).toBeVisible();
        await expect(translate.getByRole('button', { name: 'CLOSE' })).toBeDisabled();
        await expect.poll(() => {
            return received.length;
        }).toBe(1);

        await translate.getByRole('button', { name: 'CANCEL TRANSLATION' }).click();
        await answerConfirm(page, 'Cancel the translation?', 'CANCEL TRANSLATION');
        await expect(translate.getByRole('button', { name: 'TRANSLATE', exact: true })).toBeEnabled();
        await expect(translate.getByRole('alert')).toHaveCount(0);
        expect(existsSync(translatedFile(1))).toBe(false);
        await translate.getByRole('button', { name: 'CLOSE' }).click();
        await expect(translate).toBeHidden();
    });

    test('translates the subtitles of a whole season, only after the user confirms', async () => {
        const { page } = session;
        await saveToken(page);
        await downloadWithSubtitles(page, [1, 2]);
        await showEpisodes(page);
        await page.getByRole('button', { name: 'TRANSLATE SUBTITLES: Fake Anime' }).click();
        await expect(page.getByText('Translate the subtitles of up to 2 episodes into Spanish with your account? The ones that already have the subtitle in this language are skipped. Each episode translated is a request to the provider, and the cost is yours.')).toBeVisible();
        expect(received).toEqual([]);

        await page.getByRole('button', { name: 'CANCEL', exact: true }).click();
        await expect(page.getByRole('button', { name: 'TRANSLATE SUBTITLES: Fake Anime' })).toBeVisible();
        expect(received).toEqual([]);

        await page.getByRole('button', { name: 'TRANSLATE SUBTITLES: Fake Anime' }).click();
        await page.getByRole('button', { name: 'CONFIRM', exact: true }).click();
        await expect.poll(() => {
            return existsSync(translatedFile(1)) && existsSync(translatedFile(2));
        }, { timeout: 20000 }).toBe(true);
        expect(readFileSync(translatedFile(1), 'utf-8')).toBe(SPANISH_SUBTITLE);
        expect(readFileSync(translatedFile(2), 'utf-8')).toBe(SPANISH_SUBTITLE);
        expect(received).toHaveLength(2);
        expect(received.map((request) => {
            return [request.path, request.authorization, request.body.messages[1]?.content];
        })).toEqual([
            ['/v1/chat/completions', `Bearer ${TOKEN}`, '["Hello there","See you"]'],
            ['/v1/chat/completions', `Bearer ${TOKEN}`, '["Hello there","See you"]']
        ]);
        await expect(page.getByRole('button', { name: 'TRANSLATE SUBTITLES: Fake Anime' })).toBeVisible();
        await expect(page.getByRole('alert')).toHaveCount(0);
    });

    const OLD_SPANISH_SUBTITLE = 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\nHola de antes\n';

    test('translates again in the player an episode that has the subtitle in the language already, and replaces it', async () => {
        const { page } = session;
        await saveToken(page);
        await downloadWithSubtitles(page, [1]);
        writeFileSync(translatedFile(1), OLD_SPANISH_SUBTITLE);
        const dialog = await openPlayer(page);
        await (await openSubtitleManager(dialog)).getByRole('button', { name: 'TRANSLATE SUBTITLE' }).click();
        const translate = page.getByRole('dialog', { name: 'Translate a subtitle' });
        await expect(translate.getByLabel('Translate into')).toHaveValue('Spanish');
        await expect(translate.getByTestId('translate-replace-note')).toHaveText('This episode already has the subtitle in this language. Translating again replaces it.');
        await expect(translate.getByText('2 lines, 1 requests, about 160 tokens of your account.')).toBeVisible();
        expect(readFileSync(translatedFile(1), 'utf-8')).toBe(OLD_SPANISH_SUBTITLE);
        await translate.getByRole('button', { name: 'TRANSLATE', exact: true }).click();

        await expect(translate).toBeHidden();
        await expect(page.locator('.toast--info .toast__message', { hasText: 'SUBTITLE TRANSLATED' })).toHaveText('SUBTITLE TRANSLATED INTO Spanish.');
        expect(received).toHaveLength(1);
        expect(received.map((request) => {
            return [request.path, request.authorization, request.body.messages[1]?.content];
        })).toEqual([['/v1/chat/completions', `Bearer ${TOKEN}`, '["Hello there","See you"]']]);
        expect(readFileSync(translatedFile(1), 'utf-8')).toBe(SPANISH_SUBTITLE);
    });

    test('translates only the episodes of a season that do not have the subtitle in the language yet, and says how many were skipped', async () => {
        const { page } = session;
        await saveToken(page);
        await downloadWithSubtitles(page, [1, 2]);
        writeFileSync(translatedFile(1), OLD_SPANISH_SUBTITLE);
        await showEpisodes(page);
        await page.getByRole('button', { name: 'TRANSLATE SUBTITLES: Fake Anime' }).click();
        await page.getByRole('button', { name: 'CONFIRM', exact: true }).click();

        await expect.poll(() => {
            return existsSync(translatedFile(2));
        }, { timeout: 20000 }).toBe(true);
        await expect(page.getByTestId('season-translation-skipped')).toHaveText('1 episodes already had the subtitle in Spanish and were skipped.');
        expect(readFileSync(translatedFile(2), 'utf-8')).toBe(SPANISH_SUBTITLE);
        expect(readFileSync(translatedFile(1), 'utf-8')).toBe(OLD_SPANISH_SUBTITLE);
        expect(received).toHaveLength(1);
        expect(received.map((request) => {
            return [request.path, request.authorization, request.body.messages[1]?.content];
        })).toEqual([['/v1/chat/completions', `Bearer ${TOKEN}`, '["Hello there","See you"]']]);
        await expect(page.getByRole('button', { name: 'TRANSLATE SUBTITLES: Fake Anime' })).toBeVisible();
        await expect(page.getByRole('alert')).toHaveCount(0);
    });

    test('asks the provider for nothing when every episode of a season has the subtitle in the language already', async () => {
        const { page } = session;
        await saveToken(page);
        await downloadWithSubtitles(page, [1, 2]);
        writeFileSync(translatedFile(1), OLD_SPANISH_SUBTITLE);
        writeFileSync(translatedFile(2), OLD_SPANISH_SUBTITLE);
        await showEpisodes(page);
        await page.getByRole('button', { name: 'TRANSLATE SUBTITLES: Fake Anime' }).click();
        await page.getByRole('button', { name: 'CONFIRM', exact: true }).click();

        await expect(page.getByTestId('season-translation-skipped')).toHaveText('2 episodes already had the subtitle in Spanish and were skipped.');
        expect(received).toEqual([]);
        expect(readFileSync(translatedFile(1), 'utf-8')).toBe(OLD_SPANISH_SUBTITLE);
        expect(readFileSync(translatedFile(2), 'utf-8')).toBe(OLD_SPANISH_SUBTITLE);
        await expect(page.getByRole('alert')).toHaveCount(0);
    });
});

test.describe('creating the subtitle of an episode from its audio', () => {
    const SPEECH_TOKEN = 'sk-e2e-speech';
    const TRANSLATION_TOKEN = 'sk-e2e-translation';
    const FFMPEG = join(ROOT, 'resources', 'bin', `ffmpeg${EXE}`);
    test.skip(!existsSync(FFMPEG), 'needs the bundled ffmpeg to make a video: run `npm run fetch-binaries`');

    interface SpeechRequest {
        method: string | undefined;
        path: string;
        authorization: string | undefined;
        contentType: string | undefined;
        // The form as text (the file in it is binary: only what is around it is read).
        form: string;
        fileStart: number[];
    }

    interface ChatRequest {
        path: string;
        authorization: string | undefined;
        body: { model: string; messages: Array<{ role: string; content: string }> };
    }

    interface GeminiRequest {
        path: string;
        key: string | undefined;
        body: { contents: Array<{ parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }> };
    }

    const FIRST_PART = 'WEBVTT\n\n00:01.000 --> 00:03.000\nPart one\n';
    const SECOND_PART = 'WEBVTT\n\n00:02.000 --> 00:04.000\nPart two\n';
    const TRANSCRIBED = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nPart one\n\n00:10:02.000 --> 00:10:04.000\nPart two\n';
    const TRANSLATED = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nES: Part one\n\n00:10:02.000 --> 00:10:04.000\nES: Part two\n';
    const AUDIO_TEXT = /^11 min · about 2\.5 MiB · 2 requests$/;

    // The services the app is asked to use: one that speaks the protocol of OpenAI for the speech to text (the transcriptions and the
    // translations into English) and for the language model, which "translates" by putting ES: before each line.
    let server: Server;
    let baseUrl: string;
    let received: SpeechRequest[];
    let chats: ChatRequest[];
    let geminis: GeminiRequest[];
    let answerWith: number;
    let refuseTranslations: boolean;
    // The service answers as gpt-transcribe does: no WebVTT (400) and no endpoint of translations (404).
    let noTimestamps: boolean;
    let hold: boolean;
    let holdChat: boolean;

    test.beforeAll(async () => {
        received = [];
        chats = [];
        geminis = [];
        server = createServer((request, response) => {
            const chunks: Buffer[] = [];
            request.on('data', (chunk: Buffer) => {
                chunks.push(chunk);
            });
            request.on('end', () => {
                const body = Buffer.concat(chunks);
                const path = request.url ?? '';
                if (path.startsWith('/v1beta/models/') && path.endsWith(':generateContent')) {
                    geminis.push({ path, key: request.headers['x-goog-api-key'] as string | undefined, body: JSON.parse(body.toString('utf-8')) as GeminiRequest['body'] });
                    const segments = geminis.length === 1 ? '[{"start":1,"end":3,"text":"Parte um"}]' : '[{"start":2,"end":4,"text":"Parte dois"}]';
                    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ candidates: [{ content: { parts: [{ text: segments }] } }] }));
                    return;
                }
                if (path === '/v1/chat/completions') {
                    const parsed = JSON.parse(body.toString('utf-8')) as ChatRequest['body'];
                    chats.push({ path, authorization: request.headers.authorization, body: parsed });
                    if (holdChat) {
                        return;
                    }
                    const texts = JSON.parse(parsed.messages[1]?.content ?? '[]') as string[];
                    const translated = texts.map((text) => {
                        return `ES: ${text}`;
                    });
                    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(translated) } }] }));
                    return;
                }
                const form = body.toString('latin1');
                const marker = 'Content-Type: audio/mpeg\r\n\r\n';
                const fileStart = form.indexOf(marker);
                received.push({
                    method: request.method,
                    path,
                    authorization: request.headers.authorization,
                    contentType: request.headers['content-type'],
                    form: fileStart === -1 ? form : form.slice(0, fileStart + marker.length) + form.slice(form.indexOf('\r\n--', fileStart)),
                    fileStart: fileStart === -1 ? [] : [...body.subarray(fileStart + marker.length, fileStart + marker.length + 3)]
                });
                if (hold) {
                    return;
                }
                // A piece cut at the pauses, asked by the app of OpenAI in JSON (gpt-transcribe): "Line N" for piece-N.mp3.
                const piece = /name="response_format"\r\n\r\njson/.test(form) ? /filename="piece-(\d+)\.mp3"/.exec(form) : null;
                if (piece !== null) {
                    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ text: `Line ${piece[1]}`, usage: { type: 'duration', seconds: 3 } }));
                    return;
                }
                if (noTimestamps) {
                    const translations = path === '/v1/audio/translations';
                    const message = translations
                        ? { error: { message: 'Invalid URL (POST /v1/audio/translations)', type: 'invalid_request_error' } }
                        : { error: { message: "response_format 'vtt' is not compatible with model 'gpt-transcribe-api-ev3'. Use 'json' or 'text' instead.", type: 'invalid_request_error', param: 'response_format', code: 'unsupported_value' } };
                    response.writeHead(translations ? 404 : 400, { 'Content-Type': 'application/json' }).end(JSON.stringify(message));
                    return;
                }
                if (answerWith !== 200 || (refuseTranslations && path === '/v1/audio/translations')) {
                    response.writeHead(answerWith === 200 ? 400 : answerWith, { 'Content-Type': 'text/plain' }).end('the service says no');
                    return;
                }
                const answered = received.filter((entry) => {
                    return entry.path === path;
                }).length;
                response.writeHead(200, { 'Content-Type': 'text/vtt' }).end(answered === 1 ? FIRST_PART : SECOND_PART);
            });
        });
        await new Promise<void>((resolveListening) => {
            server.listen(0, '127.0.0.1', resolveListening);
        });
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    test.afterAll(async () => {
        server.closeAllConnections();
        await new Promise<void>((resolveClosed) => {
            server.close(() => {
                resolveClosed();
            });
        });
    });

    test.beforeEach(async () => {
        received.length = 0;
        chats.length = 0;
        geminis.length = 0;
        answerWith = 200;
        refuseTranslations = false;
        noTimestamps = false;
        hold = false;
        holdChat = false;
        const { userData } = session;
        await session.app.close();
        session = await launch(
            userData,
            {
                transcribeProvider: 'custom',
                transcribeModel: 'whisper-1',
                transcribeBaseUrl: `${baseUrl}/v1`,
                translateProvider: 'custom',
                translateModel: 'fake-model',
                translateBaseUrl: `${baseUrl}/v1`,
                translateLanguage: 'Spanish'
            },
            { PULLWAVE_FAKE_SECRETS: '1' }
        );
    });

    function episodeFolder(): string {
        return join(session.animeDir, 'Fake Anime', 'Season 1', 'Episode 1');
    }

    function generatedFile(language: string): string {
        return join(episodeFolder(), `Fake Anime Episode 1.generated-${language}.vtt`);
    }

    // Downloads the episode and makes its video a real one (the fake ani-cli writes a file that is not a video): 11 minutes of silence, or with no
    // audio at all, or (`lines`) 10 seconds with three lines (a tone from 1 s to 3 s, from 4 s to 6 s and from 7 s to 9 s), and with no subtitle.
    async function downloadWithoutSubtitle(page: Page, withAudio = true, lines = false): Promise<void> {
        await openAnimeTab(page);
        await openFirstResult(page);
        await downloadFromLibrary(page, [1]);
        await waitForDownloaded(page);
        const video = readdirSync(episodeFolder()).find((name) => {
            return name.endsWith('.mp4');
        }) as string;
        const target = join(episodeFolder(), video);
        const silent = ['-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '650', '-c:a', 'aac'];
        const spoken = ['-f', 'lavfi', '-i', 'aevalsrc=0.25*sin(2*PI*1000*t)*gte(mod(t\\,3)\\,1):s=16000:d=10', '-c:a', 'aac'];
        const input = withAudio ? (lines ? spoken : silent) : ['-f', 'lavfi', '-i', 'testsrc=duration=2:size=64x64:rate=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p'];
        execFileSync(FFMPEG, ['-y', '-loglevel', 'error', ...input, target]);
        readdirSync(episodeFolder()).filter((name) => {
            return name.endsWith('.vtt');
        }).forEach((name) => {
            rmSync(join(episodeFolder(), name));
        });
    }

    async function openPlayer(page: Page): Promise<Locator> {
        await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
        await page.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
        await page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
        await page.getByRole('button', { name: 'PLAY: Fake Anime EP 1' }).click();
        const dialog = page.getByRole('dialog', { name: 'Fake Anime · EP 1' });
        await expect(dialog).toBeVisible();
        return dialog;
    }

    // Saves the token of the speech to text and, when the subtitle is translated afterwards, the one of the translation.
    async function saveTokens(page: Page, translation = false): Promise<void> {
        await openAnimeSettings(page);
        await expect(page.getByLabel('Speech-to-text service', { exact: true })).toHaveValue('custom');
        await expect(page.getByLabel('Speech-to-text model', { exact: true })).toHaveValue('whisper-1');
        await expect(page.getByLabel('Speech-to-text address (optional)', { exact: true })).toHaveValue(`${baseUrl}/v1`);
        // The language that is spoken is asked for in the window that makes the subtitle, not here.
        await expect(page.getByLabel('Language spoken in the audio', { exact: true })).toHaveCount(0);
        await expect(page.getByText('No token is saved for this service.')).toBeVisible();
        await expect(page.getByLabel('Speech-to-text token (API key)', { exact: true })).toHaveAttribute('type', 'password');
        await page.getByLabel('Speech-to-text token (API key)', { exact: true }).fill(SPEECH_TOKEN);
        await page.getByRole('button', { name: 'SAVE SPEECH TOKEN' }).click();
        await expect(page.getByText('A token is saved for this service.')).toBeVisible();
        if (translation) {
            await page.getByLabel('Token (API key)', { exact: true }).fill(TRANSLATION_TOKEN);
            await page.getByRole('button', { name: 'SAVE TOKEN' }).click();
            await expect(page.getByText('A token is saved for this provider.')).toBeVisible();
        }
    }

    async function openGenerateDialog(page: Page, audio: string, subtitle: string, audioText: RegExp = AUDIO_TEXT): Promise<{ player: Locator; create: Locator }> {
        const player = await openPlayer(page);
        const manager = await openSubtitleManager(player);
        await expect(manager.getByRole('button', { name: 'TRANSLATE SUBTITLE' })).toHaveCount(0);
        await manager.getByRole('button', { name: 'CREATE SUBTITLE' }).click();
        const create = page.getByRole('dialog', { name: 'Create a subtitle' });
        await expect(create).toBeVisible();
        await create.getByLabel('Language of the audio', { exact: true }).selectOption(audio);
        await create.getByLabel('Language of the subtitle', { exact: true }).selectOption(subtitle);
        await expect(create.getByText(audioText)).toBeVisible();
        return { player, create };
    }

    test('keeps the token of the speech to text apart from the one of the translation, encrypted, and never shows it again', async () => {
        const { page, userData } = session;
        await saveTokens(page);
        await expect(page.getByLabel('Speech-to-text token (API key)', { exact: true })).toHaveValue('');
        await expect(page.getByRole('button', { name: 'REMOVE SPEECH TOKEN' })).toBeVisible();
        // The token of the translation was not touched.
        await expect(page.getByText('No token is saved for this provider.')).toBeVisible();
        const tokens = JSON.parse(readFileSync(join(userData, 'llm-tokens.json'), 'utf-8')) as Record<string, string>;
        expect(Object.keys(tokens)).toEqual(['speech-custom']);
        expect(Buffer.from(tokens['speech-custom'] as string, 'base64').toString('utf-8')).toBe(SPEECH_TOKEN);
        await expect.poll(() => {
            return readFileSync(join(userData, 'settings.json'), 'utf-8');
        }).not.toContain(SPEECH_TOKEN);
    });

    test('asks for the two languages, says what will be sent before it starts, and transcribes the audio in parts when the subtitle is in the language that is spoken', { tag: '@windows' }, async () => {
        const { page } = session;
        await saveTokens(page);
        await downloadWithoutSubtitle(page);
        const { player, create } = await openGenerateDialog(page, 'Japanese', 'Japanese');
        await expect(create.getByTestId('generate-plan')).toHaveText('The audio is transcribed in Japanese.');
        const facts = create.getByRole('region', { name: 'What will be sent' });
        await expect(facts.getByText('Only the audio of the episode is sent, never the video.')).toBeVisible();
        await expect(facts.getByText('Other (OpenAI-compatible) · whisper-1')).toBeVisible();
        await expect(facts.getByText('Translation (the text only)')).toHaveCount(0);
        // Nothing is sent before the user confirms.
        expect(received).toEqual([]);

        await create.getByRole('button', { name: 'CREATE', exact: true }).click();
        await expect(create).toBeHidden({ timeout: 60000 });
        await expect(page.locator('.toast--info .toast__message', { hasText: 'SUBTITLE CREATED' })).toHaveText('SUBTITLE CREATED IN Japanese.');

        expect(received).toHaveLength(2);
        received.forEach((request, index) => {
            expect({ method: request.method, path: request.path, authorization: request.authorization }).toEqual({
                method: 'POST',
                path: '/v1/audio/transcriptions',
                authorization: `Bearer ${SPEECH_TOKEN}`
            });
            expect(request.contentType?.startsWith('multipart/form-data; boundary=')).toBe(true);
            expect(request.form).toContain('name="model"\r\n\r\nwhisper-1');
            expect(request.form).toContain('name="language"\r\n\r\nja');
            expect(request.form).toContain('name="response_format"\r\n\r\nvtt');
            expect(request.form).toContain(`name="file"; filename="part-${index}.mp3"`);
            // What was sent is an MP3: it starts with an ID3 tag or with the sync of a frame.
            expect(request.fileStart[0] === 0x49 || request.fileStart[0] === 0xff).toBe(true);
        });
        expect(chats).toEqual([]);
        expect(readFileSync(generatedFile('Japanese'), 'utf-8')).toBe(TRANSCRIBED);

        // The player has it and shows it, the app serves it, and the button now offers to translate it.
        const manager = session.page.getByRole('dialog', { name: 'Manage subtitles' });
        await expect(manager.getByRole('button', { name: 'TRANSLATE SUBTITLE' })).toBeVisible();
        await expect(manager.getByRole('button', { name: 'CREATE SUBTITLE' })).toHaveCount(0);
        await openPlayerSettingsAfter(manager, player);
        await expect(player.getByRole('combobox', { name: 'Subtitles' })).toHaveValue('generated-Japanese');
        const served = await session.app.evaluate(async ({ net }, target) => {
            const response = await net.fetch(target);
            const headers: Record<string, string> = {};
            response.headers.forEach((value, key) => {
                headers[key] = value;
            });
            return { status: response.status, headers, body: await response.text() };
        }, 'pullwave-media://subtitle/1/generated-Japanese');
        expect(served.status).toBe(200);
        expect(served.headers['content-type']).toBe('text/vtt; charset=utf-8');
        expect(served.body).toBe(TRANSCRIBED);
    });

    test('has the audio translated into English at once by the speech service, without using the language model, and saves only the subtitle in English', async () => {
        const { page } = session;
        await saveTokens(page);
        await downloadWithoutSubtitle(page);
        const { create } = await openGenerateDialog(page, 'Japanese', 'English');
        await expect(create.getByTestId('generate-plan')).toHaveText('The audio, spoken in Japanese, is written in English at once by the speech service.');
        await expect(create.getByRole('region', { name: 'What will be sent' }).getByText('Translation (the text only)')).toHaveCount(0);
        await create.getByRole('button', { name: 'CREATE', exact: true }).click();
        await expect(create).toBeHidden({ timeout: 60000 });
        await expect(page.locator('.toast--info .toast__message', { hasText: 'SUBTITLE CREATED' })).toHaveText('SUBTITLE CREATED IN English.');

        expect(
            received.map((request) => {
                return request.path;
            })
        ).toEqual(['/v1/audio/translations', '/v1/audio/translations']);
        received.forEach((request) => {
            expect(request.authorization).toBe(`Bearer ${SPEECH_TOKEN}`);
            expect(request.form).toContain('name="model"\r\n\r\nwhisper-1');
            expect(request.form).toContain('name="response_format"\r\n\r\nvtt');
            // The service is not told which language is spoken: it answers in English whatever it is.
            expect(request.form).not.toContain('name="language"');
        });
        expect(chats).toEqual([]);
        expect(readFileSync(generatedFile('English'), 'utf-8')).toBe(TRANSCRIBED);
        expect(existsSync(generatedFile('Japanese'))).toBe(false);
    });

    test('transcribes the audio and has the language model translate the text for any other language, saving only the subtitle in that language', async () => {
        const { page } = session;
        await saveTokens(page, true);
        await downloadWithoutSubtitle(page);
        const { create } = await openGenerateDialog(page, 'Japanese', 'Spanish');
        await expect(create.getByTestId('generate-plan')).toHaveText('The audio is transcribed in Japanese, then the text is translated into Spanish.');
        const facts = create.getByRole('region', { name: 'What will be sent' });
        await expect(facts.getByText('Translation (the text only)')).toBeVisible();
        await expect(facts.getByText('Other (OpenAI-compatible) · fake-model')).toBeVisible();
        await create.getByRole('button', { name: 'CREATE', exact: true }).click();
        await expect(create).toBeHidden({ timeout: 60000 });
        await expect(page.locator('.toast--info .toast__message', { hasText: 'SUBTITLE CREATED' })).toHaveText('SUBTITLE CREATED IN Spanish.');

        expect(
            received.map((request) => {
                return [request.path, request.authorization];
            })
        ).toEqual([
            ['/v1/audio/transcriptions', `Bearer ${SPEECH_TOKEN}`],
            ['/v1/audio/transcriptions', `Bearer ${SPEECH_TOKEN}`]
        ]);
        expect(received[0]?.form).toContain('name="language"\r\n\r\nja');
        expect(chats).toHaveLength(1);
        expect(chats[0]?.path).toBe('/v1/chat/completions');
        expect(chats[0]?.authorization).toBe(`Bearer ${TRANSLATION_TOKEN}`);
        expect(chats[0]?.body.model).toBe('fake-model');
        expect(chats[0]?.body.messages[0]?.content).toContain('Translate each string into Spanish.');
        expect(chats[0]?.body.messages[1]?.content).toBe('["Part one","Part two"]');
        expect(readFileSync(generatedFile('Spanish'), 'utf-8')).toBe(TRANSLATED);
        // The transcription is not kept: only the subtitle that was asked for.
        expect(existsSync(generatedFile('Japanese'))).toBe(false);
    });

    // OpenAI (here, the fake server at the address of the settings) is always asked with gpt-transcribe, which gives no times: the audio is cut
    // at its pauses and each piece goes for its text.
    async function launchWithOpenAi(): Promise<Page> {
        const { userData } = session;
        await session.app.close();
        session = await launch(
            userData,
            {
                transcribeProvider: 'openai',
                transcribeModel: 'whisper-1',
                transcribeBaseUrl: `${baseUrl}/v1`,
                translateProvider: 'custom',
                translateModel: 'fake-model',
                translateBaseUrl: `${baseUrl}/v1`,
                translateLanguage: 'Spanish'
            },
            { PULLWAVE_FAKE_SECRETS: '1' }
        );
        const { page } = session;
        await openAnimeSettings(page);
        await expect(page.getByLabel('Speech-to-text service', { exact: true })).toHaveValue('openai');
        await expect(page.getByLabel('Speech-to-text service', { exact: true }).locator('option:checked')).toHaveText('OpenAI (gpt-transcribe)');
        // The model stored (whisper-1) is not used: the field shows gpt-transcribe and cannot be changed.
        await expect(page.getByLabel('Speech-to-text model', { exact: true })).toHaveValue('gpt-transcribe');
        await expect(page.getByLabel('Speech-to-text model', { exact: true })).toBeDisabled();
        await expect(page.getByText('With OpenAI the model is always gpt-transcribe: the audio is cut at its pauses and each piece is transcribed with what was said before it, so the times of the lines come from the cuts. With "Other", the model has to give the times of the lines in WebVTT, such as whisper-1. With Gemini, write the name of a Gemini model that takes audio.')).toBeVisible();
        await page.getByLabel('Speech-to-text token (API key)', { exact: true }).fill(SPEECH_TOKEN);
        await page.getByRole('button', { name: 'SAVE SPEECH TOKEN' }).click();
        await expect(page.getByText('A token is saved for this service.')).toBeVisible();
        await page.getByLabel('Token (API key)', { exact: true }).fill(TRANSLATION_TOKEN);
        await page.getByRole('button', { name: 'SAVE TOKEN' }).click();
        await expect(page.getByText('A token is saved for this provider.')).toBeVisible();
        const tokens = JSON.parse(readFileSync(join(userData, 'llm-tokens.json'), 'utf-8')) as Record<string, string>;
        expect(Object.keys(tokens).sort()).toEqual(['custom', 'speech-openai']);
        return page;
    }

    const LINES_AUDIO_TEXT = /^1 min · about 39\.1 KiB · 3 requests$/;
    const LINES_TIMES = ['00:00:00.750 --> 00:00:03.000', '00:00:03.750 --> 00:00:06.000', '00:00:06.750 --> 00:00:09.000'];

    function linesVtt(prefix: string): string {
        return `WEBVTT\n\n${LINES_TIMES.map((timing, index) => {
            return `${timing}\n${prefix}Line ${index}`;
        }).join('\n\n')}\n`;
    }

    // The three pieces were asked for their text in JSON with gpt-transcribe, the language and the name of the series, never translated.
    function expectPiecesAsked(): void {
        expect(received).toHaveLength(3);
        const names = received.map((request) => {
            return /filename="(piece-\d+\.mp3)"/.exec(request.form)?.[1];
        });
        expect([...names].sort()).toEqual(['piece-0.mp3', 'piece-1.mp3', 'piece-2.mp3']);
        received.forEach((request) => {
            expect({ method: request.method, path: request.path, authorization: request.authorization }).toEqual({
                method: 'POST',
                path: '/v1/audio/transcriptions',
                authorization: `Bearer ${SPEECH_TOKEN}`
            });
            expect(request.contentType?.startsWith('multipart/form-data; boundary=')).toBe(true);
            expect(request.form).toContain('name="model"\r\n\r\ngpt-transcribe');
            expect(request.form).toContain('name="language"\r\n\r\nja');
            expect(request.form).toContain('name="response_format"\r\n\r\njson');
            // Three pieces go in three streams of one: each one with only the name of the series.
            expect(request.form).toContain('name="prompt"\r\n\r\nFake Anime\r\n');
            expect(request.fileStart[0] === 0x49 || request.fileStart[0] === 0xff).toBe(true);
        });
    }

    test('with OpenAI, cuts the audio at its pauses, asks gpt-transcribe for the text of each piece with the name of the series, and saves the lines with the times of their speech, never translating audio spoken in the language of the subtitle', { tag: '@windows' }, async () => {
        const page = await launchWithOpenAi();
        await downloadWithoutSubtitle(page, true, true);
        const { player, create } = await openGenerateDialog(page, 'Japanese', 'Japanese', LINES_AUDIO_TEXT);
        await expect(create.getByTestId('generate-plan')).toHaveText('The audio is transcribed in Japanese.');
        const facts = create.getByRole('region', { name: 'What will be sent' });
        await expect(facts.getByText('OpenAI (gpt-transcribe) · gpt-transcribe')).toBeVisible();
        await expect(facts.getByText('Translation (the text only)')).toHaveCount(0);
        expect(received).toEqual([]);

        await create.getByRole('button', { name: 'CREATE', exact: true }).click();
        await expect(create).toBeHidden({ timeout: 30000 });
        await expect(page.locator('.toast--info .toast__message', { hasText: 'SUBTITLE CREATED' })).toHaveText('SUBTITLE CREATED IN Japanese.');
        expectPiecesAsked();
        expect(chats).toEqual([]);
        expect(readFileSync(generatedFile('Japanese'), 'utf-8')).toBe(linesVtt(''));
        await openPlayerSettingsAfter(player.page().getByRole('dialog', { name: 'Manage subtitles' }), player);
        await expect(player.getByRole('combobox', { name: 'Subtitles' })).toHaveValue('generated-Japanese');
    });

    test('with OpenAI, transcribes the audio and has the language model translate it even into English, telling it the lines were heard from the audio of the series', async () => {
        const page = await launchWithOpenAi();
        await downloadWithoutSubtitle(page, true, true);
        const { create } = await openGenerateDialog(page, 'Japanese', 'English', LINES_AUDIO_TEXT);
        await expect(create.getByTestId('generate-plan')).toHaveText('The audio is transcribed in Japanese, then the text is translated into English.');
        const facts = create.getByRole('region', { name: 'What will be sent' });
        await expect(facts.getByText('Translation (the text only)')).toBeVisible();
        await expect(facts.getByText('Other (OpenAI-compatible) · fake-model')).toBeVisible();

        await create.getByRole('button', { name: 'CREATE', exact: true }).click();
        await expect(create).toBeHidden({ timeout: 30000 });
        await expect(page.locator('.toast--info .toast__message', { hasText: 'SUBTITLE CREATED' })).toHaveText('SUBTITLE CREATED IN English.');
        // The endpoint of the translations is never asked: gpt-transcribe has none.
        expectPiecesAsked();
        expect(chats).toHaveLength(1);
        expect(chats[0]?.path).toBe('/v1/chat/completions');
        expect(chats[0]?.authorization).toBe(`Bearer ${TRANSLATION_TOKEN}`);
        expect(chats[0]?.body).toEqual({
            model: 'fake-model',
            messages: [
                { role: 'system', content: systemPromptFor('English', { title: 'Fake Anime' }) },
                { role: 'user', content: '["Line 0","Line 1","Line 2"]' }
            ]
        });
        expect(readFileSync(generatedFile('English'), 'utf-8')).toBe(linesVtt('ES: '));
        expect(existsSync(generatedFile('Japanese'))).toBe(false);
    });

    test('has Gemini write the audio in the language of the subtitle at once, in any language, without the language model', async () => {
        const { userData } = session;
        await session.app.close();
        session = await launch(
            userData,
            { transcribeProvider: 'gemini', transcribeModel: 'gem-model', transcribeBaseUrl: `${baseUrl}/v1beta`, translateLanguage: 'Portuguese (Brazil)' },
            { PULLWAVE_FAKE_SECRETS: '1' }
        );
        const { page } = session;
        await openAnimeSettings(page);
        await expect(page.getByLabel('Speech-to-text service', { exact: true })).toHaveValue('gemini');
        await expect(page.getByLabel('Speech-to-text model', { exact: true })).toHaveValue('gem-model');
        await page.getByLabel('Speech-to-text token (API key)', { exact: true }).fill('gem-key');
        await page.getByRole('button', { name: 'SAVE SPEECH TOKEN' }).click();
        await expect(page.getByText('A token is saved for this service.')).toBeVisible();
        const tokens = JSON.parse(readFileSync(join(userData, 'llm-tokens.json'), 'utf-8')) as Record<string, string>;
        expect(Object.keys(tokens)).toEqual(['speech-gemini']);

        await downloadWithoutSubtitle(page);
        const { create } = await openGenerateDialog(page, 'Japanese', 'Portuguese (Brazil)');
        await expect(create.getByTestId('generate-plan')).toHaveText('The audio, spoken in Japanese, is written in Portuguese (Brazil) at once by the speech service.');
        const facts = create.getByRole('region', { name: 'What will be sent' });
        await expect(facts.getByText('Gemini (Google) · gem-model')).toBeVisible();
        await expect(facts.getByText('Translation (the text only)')).toHaveCount(0);
        expect(geminis).toEqual([]);

        await create.getByRole('button', { name: 'CREATE', exact: true }).click();
        await expect(create).toBeHidden({ timeout: 60000 });
        await expect(page.locator('.toast--info .toast__message', { hasText: 'SUBTITLE CREATED' })).toHaveText('SUBTITLE CREATED IN Portuguese (Brazil).');

        expect(geminis).toHaveLength(2);
        geminis.forEach((request) => {
            expect(request.path).toBe('/v1beta/models/gem-model:generateContent');
            expect(request.key).toBe('gem-key');
            const [text, audio] = request.body.contents[0]?.parts ?? [];
            expect(text?.text).toContain('The audio is spoken in Japanese. Write what is said translated into Portuguese (Brazil).');
            expect(audio?.inlineData?.mimeType).toBe('audio/mp3');
            // What was sent is an MP3: it starts with an ID3 tag or with the sync of a frame.
            const first = Buffer.from(audio?.inlineData?.data ?? '', 'base64')[0];
            expect(first === 0x49 || first === 0xff).toBe(true);
        });
        expect(received).toEqual([]);
        expect(chats).toEqual([]);
        expect(readFileSync(generatedFile('Portuguese (Brazil)'), 'utf-8')).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nParte um\n\n00:10:02.000 --> 00:10:04.000\nParte dois\n');
        expect(existsSync(generatedFile('Japanese'))).toBe(false);
    });

    test('shows the steps, the parts sent and the time while it goes on, and warns when the service refuses to translate the audio at once', async () => {
        const { page } = session;
        refuseTranslations = true;
        holdChat = true;
        await saveTokens(page, true);
        await downloadWithoutSubtitle(page);
        const { create } = await openGenerateDialog(page, 'Japanese', 'English');
        await create.getByRole('button', { name: 'CREATE', exact: true }).click();
        const progress = create.getByRole('region', { name: 'Progress' });
        await expect(progress).toBeVisible();
        await expect(create.getByLabel('Language of the audio', { exact: true })).toBeDisabled();
        await expect(create.getByRole('button', { name: 'CLOSE' })).toBeDisabled();
        await expect(progress.getByRole('progressbar', { name: 'Progress of the subtitle' })).toBeVisible();

        // The service says no to the translation of the audio: it is sent again to be transcribed, and the text is translated afterwards.
        await expect(create.getByText('The service does not translate the audio directly, so it is being transcribed first and the text translated afterwards.')).toBeVisible({ timeout: 60000 });
        await expect(progress.getByText('Taking the audio out of the video')).toBeVisible();
        await expect(progress.getByText('Translating the text into English')).toBeVisible();
        await expect(create.getByRole('region', { name: 'What will be sent' }).getByText('Translation (the text only)')).toBeVisible();
        await expect(progress.getByText(/Elapsed time: \d\d:\d\d/)).toBeVisible();
        // The translation of the text is held by the test: the steps before it are done.
        await expect(progress.getByText(/Line 0 of 2/)).toBeVisible({ timeout: 60000 });
        await expect(progress.getByText(/\(Done\)/)).toHaveCount(2);
        expect(
            received.map((request) => {
                return request.path;
            })
        ).toEqual(['/v1/audio/translations', '/v1/audio/transcriptions', '/v1/audio/transcriptions']);

        await create.getByRole('button', { name: 'CANCEL', exact: true }).click();
        await answerConfirm(page, 'Cancel the subtitle?', 'CANCEL');
        await expect(create.getByRole('button', { name: 'CREATE', exact: true })).toBeEnabled();
        await expect(create.getByRole('alert')).toHaveCount(0);
        expect(existsSync(generatedFile('English'))).toBe(false);
    });

    test('says the settings have no token for the speech to text, and sends nothing', async () => {
        const { page } = session;
        await downloadWithoutSubtitle(page);
        const { create } = await openGenerateDialog(page, 'Japanese', 'Japanese');
        await create.getByRole('button', { name: 'CREATE', exact: true }).click();
        await expect(create.getByRole('alert')).toHaveText('There is no token for this service. Add one in the anime settings.');
        await expect(create.getByRole('button', { name: 'CREATE', exact: true })).toBeEnabled();
        expect(received).toEqual([]);
        expect(existsSync(generatedFile('Japanese'))).toBe(false);
    });

    test('says the translation has no token before anything is sent, when the subtitle has to be translated afterwards', async () => {
        const { page } = session;
        await saveTokens(page);
        await downloadWithoutSubtitle(page);
        const { create } = await openGenerateDialog(page, 'Japanese', 'Spanish');
        await create.getByRole('button', { name: 'CREATE', exact: true }).click();
        await expect(create.getByRole('alert')).toHaveText('There is no token for the translation. Add one in the anime settings.');
        expect(received).toEqual([]);
        expect(chats).toEqual([]);
        expect(existsSync(generatedFile('Spanish'))).toBe(false);
    });

    test('says what went wrong when the service does not accept the token, stops at the first part and saves nothing', async () => {
        const { page } = session;
        answerWith = 401;
        await saveTokens(page);
        await downloadWithoutSubtitle(page);
        const { create } = await openGenerateDialog(page, 'Japanese', 'Japanese');
        await create.getByRole('button', { name: 'CREATE', exact: true }).click();
        await expect(create.getByRole('alert')).toHaveText('The subtitle could not be created. The provider did not accept the token. Check it in the anime settings.');
        expect(received).toHaveLength(1);
        expect(existsSync(generatedFile('Japanese'))).toBe(false);
        await expect(create.getByRole('region', { name: 'Progress' })).toHaveCount(0);
        // The notices of the downloads are still there: only the one that says the subtitle was made must not be.
        await expect(page.locator('.toast--info', { hasText: 'SUBTITLE CREATED' })).toHaveCount(0);
    });

    test('says a model that gives no times of the lines (gpt-transcribe) cannot create a subtitle, and which ones can, saving nothing', async () => {
        const { page } = session;
        noTimestamps = true;
        await saveTokens(page);
        await downloadWithoutSubtitle(page);
        const { create } = await openGenerateDialog(page, 'Japanese', 'Japanese');
        await create.getByRole('button', { name: 'CREATE', exact: true }).click();
        await expect(create.getByRole('alert')).toHaveText('The subtitle could not be created. This model does not give the times of the lines, which a subtitle needs (gpt-transcribe and the gpt-4o transcription models only write the text). With "Other", use a model that writes WebVTT, such as whisper-1; or choose OpenAI (which cuts the audio at its pauses) or Gemini in the anime settings.');
        expect(
            received.map((request) => {
                return request.path;
            })
        ).toEqual(['/v1/audio/transcriptions']);
        expect(existsSync(generatedFile('Japanese'))).toBe(false);
    });

    test('goes on as a transcription when the model has no endpoint of translations, and then says it gives no times of the lines', async () => {
        const { page } = session;
        noTimestamps = true;
        await saveTokens(page, true);
        await downloadWithoutSubtitle(page);
        const { create } = await openGenerateDialog(page, 'Japanese', 'English');
        await create.getByRole('button', { name: 'CREATE', exact: true }).click();
        await expect(create.getByRole('alert')).toHaveText('The subtitle could not be created. This model does not give the times of the lines, which a subtitle needs (gpt-transcribe and the gpt-4o transcription models only write the text). With "Other", use a model that writes WebVTT, such as whisper-1; or choose OpenAI (which cuts the audio at its pauses) or Gemini in the anime settings.', { timeout: 60000 });
        expect(
            received.map((request) => {
                return request.path;
            })
        ).toEqual(['/v1/audio/translations', '/v1/audio/transcriptions']);
        expect(existsSync(generatedFile('English'))).toBe(false);
    });

    test('shows the parts that were sent and stops when the user cancels, without saving anything', async () => {
        const { page } = session;
        hold = true;
        await saveTokens(page);
        await downloadWithoutSubtitle(page);
        const { create } = await openGenerateDialog(page, 'Japanese', 'Japanese');
        await create.getByRole('button', { name: 'CREATE', exact: true }).click();
        await expect(create.getByText(/Part 0 of 2 · 0 B of .* sent/)).toBeVisible({ timeout: 30000 });
        await expect(create.getByRole('button', { name: 'CLOSE' })).toBeDisabled();
        await expect.poll(() => {
            return received.length;
        }).toBe(1);

        await create.getByRole('button', { name: 'CANCEL', exact: true }).click();
        await answerConfirm(page, 'Cancel the subtitle?', 'CANCEL');
        await expect(create.getByRole('button', { name: 'CREATE', exact: true })).toBeEnabled();
        await expect(create.getByRole('alert')).toHaveCount(0);
        expect(existsSync(generatedFile('Japanese'))).toBe(false);
        await create.getByRole('button', { name: 'CLOSE' }).click();
        await expect(create).toBeHidden();
    });

    test('says the video has no audio, and keeps CREATE off', async () => {
        const { page } = session;
        await saveTokens(page);
        await downloadWithoutSubtitle(page, false);
        const player = await openPlayer(page);
        await (await openSubtitleManager(player)).getByRole('button', { name: 'CREATE SUBTITLE' }).click();
        const create = page.getByRole('dialog', { name: 'Create a subtitle' });
        await expect(create.getByText('This video has no audio to transcribe.')).toBeVisible();
        await expect(create.getByRole('button', { name: 'CREATE', exact: true })).toBeDisabled();
        expect(received).toEqual([]);
    });
});

test.describe('the look for new episodes', () => {
    const CHECK_EVERY_MS = '1500';

    function historyFolder(): string {
        return join(session.userData, 'anime', 'history');
    }

    // How many times the episodes of the anime of the search were listed: the look for new episodes does it for each anime of the library.
    function episodeListings(): number {
        return existsSync(session.callsLog)
            ? calls().filter((line) => {
                  return line === 'sub | -S 1 fake';
              }).length
            : 0;
    }

    function savedSettings(): Record<string, unknown> {
        return JSON.parse(readFileSync(join(session.userData, 'settings.json'), 'utf-8')) as Record<string, unknown>;
    }

    async function relaunch(settings: Record<string, unknown>, env: Record<string, string>): Promise<Page> {
        await session.app.close();
        session = await launch(join(workDir, 'user-data'), settings, env);
        return session.page;
    }

    async function addFakeAnime(page: Page): Promise<void> {
        await openAnimeTab(page);
        await openFirstResult(page);
        await confirmAdd(page);
        await expect(page.getByRole('button', { name: 'VIEW IN LIBRARY', exact: true })).toBeVisible();
    }

    async function openUpdates(page: Page): Promise<void> {
        await page.getByRole('navigation', { name: 'Anime' }).getByRole('button', { name: 'UPDATES', exact: true }).click();
        await expect(page.getByRole('region', { name: 'UPDATES' })).toBeVisible();
    }

    // The first look at the anime of the library only reads its episodes, so it is waited for before the source gets a new one.
    async function waitForTheFirstReading(): Promise<void> {
        const before = episodeListings();
        await expect.poll(episodeListings, { timeout: 20000 }).toBeGreaterThan(before);
    }

    function sourceGetsAFourthEpisode(): void {
        writeFileSync(join(historyFolder(), 'more-episodes'), '');
    }

    const EMPTY = 'No new episodes yet. The check that runs every 3 hours, and the buttons that look for new episodes, list here what they find.';

    test('reads the search up to the place an anime was saved at when it looks for its new episodes, so one past the first page is found', async () => {
        const page = await relaunch({}, { PULLWAVE_ANIME_CHECK_MS: CHECK_EVERY_MS });
        await openAnimeTab(page);
        await search(page, 'many');
        await expect(page.getByText('30 RESULTS', { exact: true })).toBeVisible();
        await page.getByTestId('anime-end-of-list').scrollIntoViewIfNeeded();
        await expect(page.getByText('60 RESULTS', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'OPEN: Many Anime 45', exact: true }).click();
        await expect(page.getByRole('button', { name: 'EP 3', exact: true })).toBeVisible();
        await confirmAdd(page);
        await expect(page.getByRole('button', { name: 'VIEW IN LIBRARY', exact: true })).toBeVisible();

        // The look at the library asks for the search up to the place the anime has in it (45), and then for its episodes.
        await expect.poll(() => {
            return searchMinCalls(session.userData, 'many').filter((line) => {
                return line.startsWith('45 |');
            }).length;
        }, { timeout: 20000 }).toBeGreaterThan(0);
        await expect.poll(() => {
            return searchMinCalls(session.userData, '-S 45 many').length;
        }, { timeout: 20000 }).toBeGreaterThan(1);
        expect(searchMinCalls(session.userData, 'many')).toContain('45 | many');
        expect(new Set(searchMinCalls(session.userData, '-S 45 many'))).toEqual(new Set(['45 | -S 45 many']));
    });

    test('finds the episode the source got after the anime was added, puts it in the library without downloading it, lists it and tells the screen', async () => {
        const page = await relaunch({}, { PULLWAVE_ANIME_CHECK_MS: CHECK_EVERY_MS });
        await addFakeAnime(page);
        await waitForTheFirstReading();
        // What the source listed at the first reading is not new.
        await openUpdates(page);
        await expect(page.getByText(EMPTY)).toBeVisible();
        await expect(page.getByTestId('anime-update')).toHaveCount(0);
        await expect(page.locator('.toast').filter({ hasText: 'new episode(s) added to the library' })).toHaveCount(0);

        sourceGetsAFourthEpisode();

        await expect(page.locator('.toast').filter({ hasText: '1 new episode(s) added to the library: Fake Anime' }).first()).toBeVisible({ timeout: 20000 });
        const update = page.getByTestId('anime-update');
        await expect(update).toHaveCount(1);
        await expect(update.getByRole('button', { name: 'SHOW EPISODES: Fake Anime EP 4', exact: true })).toBeVisible();
        await expect(update.locator('.history__meta')).toHaveText(/^EP 4 · Found at \d{1,2}:\d{2}( [AP]M)?$/);
        await expect(update.locator('.badge')).toHaveText(['AUTOMATIC', 'NOT DOWNLOADED']);
        await expect(page.getByTestId('anime-update-day')).toHaveAttribute('aria-label', 'Today');
        // The episode is a card of a grid, like the ones of the library: the badges at the bottom of the card.
        await expect(page.getByTestId('anime-update-day').locator('ul.cover-grid')).toHaveCount(1);
        await expect(update).toHaveClass(/\bcover-card\b/);
        await expect(update.locator('.cover-card__body > .job__head .history__meta')).toHaveText(/^EP 4 · Found at /);
        await expect(update.locator('.cover-card__footer .job__badges .badge')).toHaveText(['AUTOMATIC', 'NOT DOWNLOADED']);
        // Nothing was downloaded.
        expect(
            calls().filter((line) => {
                return line.includes('-d ');
            })
        ).toEqual([]);
        expect(existsSync(join(session.animeDir, 'Fake Anime'))).toBe(false);
        await expect(page.getByRole('button', { name: 'DOWNLOADS (0)' })).toBeVisible();
    });

    test('says on the card of the anime in the library, and on the episode, that it is new', async () => {
        const page = await relaunch({}, { PULLWAVE_ANIME_CHECK_MS: CHECK_EVERY_MS });
        await addFakeAnime(page);
        await waitForTheFirstReading();
        sourceGetsAFourthEpisode();
        await expect(page.locator('.toast').filter({ hasText: '1 new episode(s) added to the library: Fake Anime' }).first()).toBeVisible({ timeout: 20000 });

        await page.getByRole('navigation', { name: 'Anime' }).getByRole('button', { name: 'LIBRARY', exact: true }).click();

        await expect(page.getByTestId('anime-card').getByTestId('anime-new-episodes')).toHaveText('NEW EPISODE');
        await page.getByRole('button', { name: 'OPEN SERIES: Fake Anime', exact: true }).click();
        await expect(page.getByTestId('anime-season').getByTestId('anime-new-episodes')).toHaveText('NEW EPISODE');
        await page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
        await expect(page.getByText('0/4 DOWNLOADED')).toBeVisible();
        const rows = page.getByTestId('anime-episode');
        await expect(rows).toHaveCount(4);
        await expect(page.getByTestId('anime-episode-new')).toHaveCount(1);
        await expect(rows.nth(3).getByTestId('anime-episode-new')).toHaveText('NEW');
        await expect(rows.nth(3).locator('.history__meta')).toHaveText('NOT DOWNLOADED');
    });

    test('opens the anime in the library when its name is clicked in the updates', async () => {
        const page = await relaunch({}, { PULLWAVE_ANIME_CHECK_MS: CHECK_EVERY_MS });
        await addFakeAnime(page);
        await waitForTheFirstReading();
        sourceGetsAFourthEpisode();
        await openUpdates(page);
        await expect(page.getByTestId('anime-update')).toHaveCount(1, { timeout: 20000 });

        await page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime EP 4', exact: true }).click();

        await expect(page.getByRole('navigation', { name: 'Anime' }).getByRole('button', { name: 'LIBRARY', exact: true })).toHaveAttribute('aria-current', 'page');
        await expect(page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true })).toBeVisible();
    });

    test('downloads the new episode by itself when the setting asks for it, and the list shows it as downloaded', { tag: '@windows' }, async () => {
        const page = await relaunch({ animeAutoDownloadNew: true }, { PULLWAVE_ANIME_CHECK_MS: CHECK_EVERY_MS });
        await addFakeAnime(page);
        await waitForTheFirstReading();
        // The episodes of the first reading are not downloaded.
        expect(
            calls().filter((line) => {
                return line.includes('-d ');
            })
        ).toEqual([]);

        sourceGetsAFourthEpisode();

        await waitForDownloaded(page);
        expect(
            calls().filter((line) => {
                return line.includes('-d ');
            })
        ).toEqual(['sub | -d -S 1 -e 4 -q 720p fake']);
        expect(readFileSync(join(session.animeDir, 'Fake Anime', 'Season 1', 'Episode 4', 'Fake Anime Episode 4.mp4'), 'utf-8')).toBe('FAKEVIDEO0123456789');
        await openUpdates(page);
        await expect(page.getByTestId('anime-update')).toHaveCount(1);
        await expect(page.getByTestId('anime-update').locator('.badge')).toHaveText(['AUTOMATIC', 'DOWNLOADED']);
    });

    test('does not look by itself when the setting is off, and the button looks anyway, as a manual look', async () => {
        const page = await relaunch({ animeCheckNewEpisodes: false }, { PULLWAVE_ANIME_CHECK_MS: '700' });
        await addFakeAnime(page);
        const before = episodeListings();
        await page.waitForTimeout(3000);
        expect(episodeListings()).toBe(before);

        await openUpdates(page);
        // The first look reads the episodes the anime has.
        await page.getByRole('button', { name: 'LOOK FOR NEW EPISODES', exact: true }).click();
        await expect.poll(episodeListings).toBe(before + 1);
        await expect(page.getByRole('button', { name: 'LOOK FOR NEW EPISODES', exact: true })).toBeEnabled();
        await expect(page.getByText(EMPTY)).toBeVisible();
        await expect(page.locator('.toast').filter({ hasText: 'No new episodes.' }).first()).toBeVisible();

        sourceGetsAFourthEpisode();
        await page.getByRole('button', { name: 'LOOK FOR NEW EPISODES', exact: true }).click();

        await expect(page.getByTestId('anime-update')).toHaveCount(1);
        await expect(page.getByTestId('anime-update').locator('.badge')).toHaveText(['MANUAL', 'NOT DOWNLOADED']);
        await expect(page.getByTestId('anime-update').getByRole('button', { name: 'SHOW EPISODES: Fake Anime EP 4', exact: true })).toBeVisible();
    });

    test('clears the list after asking, leaving the episode in the library', async () => {
        const page = await relaunch({ animeCheckNewEpisodes: false }, {});
        await addFakeAnime(page);
        await openUpdates(page);
        await page.getByRole('button', { name: 'LOOK FOR NEW EPISODES', exact: true }).click();
        await expect(page.getByRole('button', { name: 'LOOK FOR NEW EPISODES', exact: true })).toBeEnabled();
        sourceGetsAFourthEpisode();
        await page.getByRole('button', { name: 'LOOK FOR NEW EPISODES', exact: true }).click();
        await expect(page.getByTestId('anime-update')).toHaveCount(1);

        await page.getByRole('button', { name: 'CLEAR LIST', exact: true }).click();
        await answerConfirm(page, 'Clear the list of new episodes?', 'KEEP');
        await expect(page.getByTestId('anime-update')).toHaveCount(1);
        await page.getByRole('button', { name: 'CLEAR LIST', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'Clear the list of new episodes?' })).toContainText('Only the list goes. Nothing is removed from the library or from the disk.');
        await answerConfirm(page, 'Clear the list of new episodes?', 'CLEAR LIST');

        await expect(page.getByTestId('anime-update')).toHaveCount(0);
        await expect(page.getByText(EMPTY)).toBeVisible();
        await expect(page.getByRole('button', { name: 'CLEAR LIST', exact: true })).toHaveCount(0);
        await page.getByRole('navigation', { name: 'Anime' }).getByRole('button', { name: 'LIBRARY', exact: true }).click();
        await page.getByRole('button', { name: 'OPEN SERIES: Fake Anime', exact: true }).click();
        await page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
        await expect(page.getByText('0/4 DOWNLOADED')).toBeVisible();
    });

    test('keeps the list when the app is opened again', async () => {
        const page = await relaunch({ animeCheckNewEpisodes: false }, {});
        await addFakeAnime(page);
        await openUpdates(page);
        await page.getByRole('button', { name: 'LOOK FOR NEW EPISODES', exact: true }).click();
        await expect(page.getByRole('button', { name: 'LOOK FOR NEW EPISODES', exact: true })).toBeEnabled();
        sourceGetsAFourthEpisode();
        await page.getByRole('button', { name: 'LOOK FOR NEW EPISODES', exact: true }).click();
        await expect(page.getByTestId('anime-update')).toHaveCount(1);

        const reopened = await relaunch({ animeCheckNewEpisodes: false }, {});
        await openAnimeToday(reopened);
        await openUpdates(reopened);

        await expect(reopened.getByTestId('anime-update')).toHaveCount(1);
        await expect(reopened.getByRole('button', { name: 'SHOW EPISODES: Fake Anime EP 4', exact: true })).toBeVisible();
    });

    test('says there is nothing new, and does not list anything, when the source has no episode the library lacks', async () => {
        const page = await relaunch({ animeCheckNewEpisodes: false }, {});
        await addFakeAnime(page);
        const before = episodeListings();
        await openUpdates(page);
        await page.getByRole('button', { name: 'LOOK FOR NEW EPISODES', exact: true }).click();
        await expect.poll(episodeListings).toBe(before + 1);
        await expect(page.locator('.toast').filter({ hasText: 'No new episodes.' }).first()).toBeVisible();
        await expect(page.getByRole('button', { name: 'LOOK FOR NEW EPISODES', exact: true })).toBeEnabled();

        await page.getByRole('button', { name: 'LOOK FOR NEW EPISODES', exact: true }).click();

        await expect.poll(episodeListings).toBe(before + 2);
        await expect(page.getByRole('button', { name: 'LOOK FOR NEW EPISODES', exact: true })).toBeEnabled();
        await expect(page.getByTestId('anime-update')).toHaveCount(0);
        await expect(page.getByText(EMPTY)).toBeVisible();
    });

    test('has the two options in the settings of the anime, the first on and the second off, and saves them at once', async () => {
        const { page } = session;
        await openAnimeSettings(page);
        const look = page.getByRole('switch', { name: 'Look for new episodes every 3 hours' });
        const download = page.getByRole('switch', { name: 'Download the new episodes found' });
        await expect(look).toBeChecked();
        await expect(download).not.toBeChecked();
        await expect(page.getByText('Asks the source about the anime of the library and adds the new episodes to it. They are not downloaded.')).toBeVisible();
        await expect(page.getByText('The new episodes that the check (every 3 hours, or the button that looks for them) finds are downloaded at once, up to 24 of one anime at a time. Off: they are only added to the library.')).toBeVisible();

        await look.click();
        await download.click();

        await expect.poll(() => {
            return [savedSettings().animeCheckNewEpisodes, savedSettings().animeAutoDownloadNew];
        }).toEqual([false, true]);
        await expect(look).not.toBeChecked();
        await expect(download).toBeChecked();
    });

    test('shows the options the settings had when the app is opened again', async () => {
        const page = await relaunch({ animeCheckNewEpisodes: false, animeAutoDownloadNew: true }, {});
        await openAnimeSettings(page);

        await expect(page.getByRole('switch', { name: 'Look for new episodes every 3 hours' })).not.toBeChecked();
        await expect(page.getByRole('switch', { name: 'Download the new episodes found' })).toBeChecked();
    });

    test('blocks the button while the automatic look goes on, saying how far it is and which anime it asks about, and gives it back when it ends', async () => {
        const page = await relaunch({}, { PULLWAVE_ANIME_CHECK_MS: CHECK_EVERY_MS });
        // An anime found by a search whose answers take two seconds each: a look for new episodes lasts long enough to be seen.
        await openAnimeTab(page);
        await search(page, 'fake turtle');
        await page.getByRole('button', { name: 'OPEN: Fake Anime', exact: true }).click();
        await expect(page.getByRole('button', { name: 'EP 3', exact: true })).toBeVisible({ timeout: 15000 });
        await confirmAdd(page);
        await openUpdates(page);

        const button = page.getByRole('button', { name: /^AUTOMATIC LOOK… \d\/1$/ });
        await expect(button).toBeDisabled({ timeout: 30000 });
        await expect(button).toHaveAttribute('title', 'The automatic look is going on. Wait for it to end.');
        await expect(page.getByTestId('anime-check-current')).toHaveText(/^Now: Fake Anime( 2)?$/);
        await expect(page.getByTestId('anime-check-current')).toHaveAttribute('role', 'status');

        // It ends: the button is ready and the indicator is gone (the next look comes an interval after).
        await expect(page.getByRole('button', { name: 'LOOK FOR NEW EPISODES', exact: true })).toBeEnabled({ timeout: 30000 });
        await expect(page.getByTestId('anime-check-current')).toHaveCount(0);
    });

    // An AniList that says the status it is given for 'Fake Anime' (no other title is found), and counts what it was asked about the releases.
    interface FakeAniList {
        url: string;
        searched: () => string[];
        refreshes: () => number;
        close: () => Promise<void>;
    }

    async function startAniList(status: string): Promise<FakeAniList> {
        const searched: string[] = [];
        let refreshes = 0;
        const server = createServer((request, response) => {
            const chunks: Buffer[] = [];
            request.on('data', (chunk: Buffer) => {
                chunks.push(chunk);
            });
            request.on('end', () => {
                const { query, variables } = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { query: string; variables: Record<string, unknown> };
                const data: Record<string, unknown> = {};
                if (query.includes('SEARCH_MATCH')) {
                    Object.entries(variables).forEach(([key, value]) => {
                        searched.push(String(value));
                        data[`m${key.slice(1)}`] = {
                            media: value === 'Fake Anime' ? [{ id: 900, status, title: { romaji: 'Fake Anime', english: 'Fake Anime', native: null }, synonyms: [] }] : []
                        };
                    });
                } else if (query.includes('id_in')) {
                    refreshes += 1;
                    data.Page = {
                        media: (variables.ids as number[]).map((id) => {
                            return { id, status };
                        })
                    };
                } else {
                    // The schedule and the covers, which the screens ask AniList for too: nothing airs and nothing has a cover.
                    data.Page = { pageInfo: { hasNextPage: false }, airingSchedules: [] };
                    data.Media = null;
                }
                response.writeHead(200, { 'Content-Type': 'application/json' });
                response.end(JSON.stringify({ data }));
            });
        });
        await new Promise<void>((resolveListening) => {
            server.listen(0, '127.0.0.1', resolveListening);
        });
        return {
            url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/graphql`,
            searched: () => {
                return [...searched];
            },
            refreshes: () => {
                return refreshes;
            },
            close: () => {
                server.closeAllConnections();
                return new Promise<void>((resolveClosed) => {
                    server.close(() => {
                        resolveClosed();
                    });
                });
            }
        };
    }

    async function openFakeAnimeSeason(page: Page): Promise<void> {
        await page.getByRole('navigation', { name: 'Anime' }).getByRole('button', { name: 'LIBRARY', exact: true }).click();
        await page.getByRole('button', { name: 'OPEN SERIES: Fake Anime', exact: true }).click();
    }

    test('learns from AniList that the anime ended, marks it complete and stops asking the source about it', async () => {
        const aniList = await startAniList('FINISHED');
        try {
            const page = await relaunch({}, { PULLWAVE_ANIME_CHECK_MS: CHECK_EVERY_MS, PULLWAVE_ANILIST_URL: aniList.url });
            await addFakeAnime(page);
            await expect.poll(() => {
                return aniList.searched();
            }, { timeout: 20000 }).toContain('Fake Anime');

            await openFakeAnimeSeason(page);

            await expect(page.getByTestId('anime-season').getByTestId('anime-complete')).toHaveText('COMPLETE', { timeout: 20000 });
            // The look goes on every 1.5 s here and never asks the source about it any more; and AniList is not asked again about an anime that ended.
            const asked = episodeListings();
            await page.waitForTimeout(4500);
            expect(episodeListings()).toBe(asked);
            expect(aniList.refreshes()).toBe(0);
        } finally {
            await aniList.close();
        }
    });

    test('keeps looking at an anime that AniList says is still going on, and asks AniList about it again', async () => {
        const aniList = await startAniList('RELEASING');
        try {
            const page = await relaunch({}, { PULLWAVE_ANIME_CHECK_MS: CHECK_EVERY_MS, PULLWAVE_ANILIST_URL: aniList.url });
            await addFakeAnime(page);
            await expect.poll(() => {
                return aniList.searched();
            }, { timeout: 20000 }).toContain('Fake Anime');
            const asked = episodeListings();

            await expect.poll(episodeListings, { timeout: 20000 }).toBeGreaterThan(asked);

            await openFakeAnimeSeason(page);
            await expect(page.getByTestId('anime-season')).toBeVisible();
            await expect(page.getByTestId('anime-complete')).toHaveCount(0);
        } finally {
            await aniList.close();
        }
    });

    test('looks at the anime that have no status when AniList cannot be reached, as before', async () => {
        const page = await relaunch({}, { PULLWAVE_ANIME_CHECK_MS: CHECK_EVERY_MS });
        await addFakeAnime(page);
        const asked = episodeListings();

        await expect.poll(episodeListings, { timeout: 20000 }).toBeGreaterThan(asked);

        await openFakeAnimeSeason(page);
        await expect(page.getByTestId('anime-complete')).toHaveCount(0);
    });

    test('follows what the user says about the releases: complete stops the look for that anime, ongoing brings it back', async () => {
        const page = await relaunch({}, { PULLWAVE_ANIME_CHECK_MS: CHECK_EVERY_MS });
        await addFakeAnime(page);
        await openFakeAnimeSeason(page);
        await page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
        const releases = page.getByRole('combobox', { name: 'Releases' });
        await expect(releases).toHaveValue('auto');
        await expect(releases.locator('option')).toHaveText(['AUTOMATIC · AniList has nothing sure about it', 'COMPLETE · no more episodes', 'ONGOING · still has episodes to come']);

        await releases.selectOption('complete');

        await expect(releases).toHaveValue('complete');
        await page.getByRole('button', { name: 'BACK' }).click();
        await expect(page.getByTestId('anime-season').getByTestId('anime-complete')).toHaveText('COMPLETE');
        const asked = episodeListings();
        await page.waitForTimeout(4500);
        expect(episodeListings()).toBe(asked);

        await page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
        await page.getByRole('combobox', { name: 'Releases' }).selectOption('ongoing');
        await expect(page.getByRole('combobox', { name: 'Releases' })).toHaveValue('ongoing');

        await expect.poll(episodeListings, { timeout: 20000 }).toBeGreaterThan(asked);
        await page.getByRole('button', { name: 'BACK' }).click();
        await expect(page.getByTestId('anime-complete')).toHaveCount(0);
    });

    test('keeps what the user said about the releases when the app is opened again', async () => {
        const page = await relaunch({ animeCheckNewEpisodes: false }, {});
        await addFakeAnime(page);
        await openFakeAnimeSeason(page);
        await page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
        await page.getByRole('combobox', { name: 'Releases' }).selectOption('complete');
        await expect(page.getByRole('combobox', { name: 'Releases' })).toHaveValue('complete');

        const reopened = await relaunch({ animeCheckNewEpisodes: false }, {});
        await openAnimeToday(reopened);
        await openFakeAnimeSeason(reopened);

        await expect(reopened.getByTestId('anime-season').getByTestId('anime-complete')).toHaveText('COMPLETE');
    });

    async function openAnimeLibrary(page: Page): Promise<void> {
        await page.getByRole('navigation', { name: 'Anime' }).getByRole('button', { name: 'LIBRARY', exact: true }).click();
    }

    // The chips over the grid of the library: ALL and NEW (how many are new depends on when the episodes of the test arrived), then the ones of the releases (ONGOING before COMPLETE).
    function filterChips(complete: number, ongoing: number): Array<string | RegExp> {
        return ['ALL (1)', /^NEW \(\d+\)$/, `ONGOING (${String(ongoing)})`, `COMPLETE (${String(complete)})`];
    }

    test('filters the library by the releases: the anime AniList says ended are COMPLETE, and none is ONGOING', async () => {
        const aniList = await startAniList('FINISHED');
        try {
            const page = await relaunch({}, { PULLWAVE_ANIME_CHECK_MS: CHECK_EVERY_MS, PULLWAVE_ANILIST_URL: aniList.url });
            await addFakeAnime(page);
            await expect.poll(() => {
                return aniList.searched();
            }, { timeout: 20000 }).toContain('Fake Anime');
            await openAnimeLibrary(page);

            const chips = page.getByRole('group', { name: 'Show' });
            await expect(chips.getByRole('button')).toHaveText(filterChips(1, 0), { timeout: 20000 });
            await expect(chips.getByRole('button', { name: 'COMPLETE (1)' })).toHaveAttribute('title', 'With every season over: AniList says it ended, or you set it as complete');
            await expect(chips.getByRole('button', { name: 'ONGOING (0)' })).toHaveAttribute('title', 'Still coming out, or AniList does not know yet');

            await chips.getByRole('button', { name: 'COMPLETE (1)' }).click();
            await expect(chips.getByRole('button', { name: 'COMPLETE (1)' })).toHaveAttribute('aria-pressed', 'true');
            await expect(page.getByTestId('anime-card')).toHaveCount(1);
            await expect(page.getByTestId('anime-card')).toHaveAttribute('aria-label', 'Fake Anime');

            await chips.getByRole('button', { name: 'ONGOING (0)' }).click();
            await expect(chips.getByRole('button', { name: 'ONGOING (0)' })).toHaveAttribute('aria-pressed', 'true');
            await expect(chips.getByRole('button', { name: 'COMPLETE (1)' })).toHaveAttribute('aria-pressed', 'false');
            await expect(page.getByTestId('anime-card')).toHaveCount(0);
            await expect(page.getByText('Nothing ongoing in the library.')).toHaveClass('empty');
        } finally {
            await aniList.close();
        }
    });

    test('puts in ONGOING the anime AniList says nothing sure about, and moves it to COMPLETE when the user says it is complete', async () => {
        const page = await relaunch({ animeCheckNewEpisodes: false }, {});
        await addFakeAnime(page);
        await openAnimeLibrary(page);
        const chips = page.getByRole('group', { name: 'Show' });
        await expect(chips.getByRole('button')).toHaveText(filterChips(0, 1));

        await chips.getByRole('button', { name: 'ONGOING (1)' }).click();
        await expect(page.getByTestId('anime-card')).toHaveCount(1);
        await expect(page.getByTestId('anime-card')).toHaveAttribute('aria-label', 'Fake Anime');
        await chips.getByRole('button', { name: 'COMPLETE (0)' }).click();
        await expect(page.getByTestId('anime-card')).toHaveCount(0);
        await expect(page.getByText('Nothing complete in the library.')).toHaveClass('empty');

        await chips.getByRole('button', { name: 'ALL (1)' }).click();
        await openFakeAnimeSeason(page);
        await page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
        await page.getByRole('combobox', { name: 'Releases' }).selectOption('complete');
        await expect(page.getByRole('combobox', { name: 'Releases' })).toHaveValue('complete');
        await page.getByRole('button', { name: 'BACK', exact: true }).click();
        await page.getByRole('button', { name: 'BACK TO LIBRARY' }).click();

        await expect(chips.getByRole('button')).toHaveText(filterChips(1, 0));
        await chips.getByRole('button', { name: 'COMPLETE (1)' }).click();
        await expect(page.getByTestId('anime-card')).toHaveCount(1);
        await expect(page.getByTestId('anime-card')).toHaveAttribute('aria-label', 'Fake Anime');
    });

    test('does not show the availability of the anime of the schedule in the source any more', async () => {
        const { page } = session;
        await openAnimeToday(page);

        await expect(page.getByText('AVAILABLE', { exact: true })).toHaveCount(0);
        await expect(page.getByText('NOT AVAILABLE', { exact: true })).toHaveCount(0);
        await expect(page.getByText('CHECKING…', { exact: true })).toHaveCount(0);
    });
});

// The manga folder of the session: the settings say where it is, so the test never reads the downloads folder of the person.
function mangaFolderOf(directory: string): string {
    return join(directory, 'manga');
}

async function relaunchWithSettings(settings: Record<string, unknown>): Promise<void> {
    const { userData } = session;
    await session.app.close();
    session = await launch(userData, settings);
}

test.describe('the disk space of the anime', { tag: '@windows' }, () => {
    test('shows the disk space, what the anime folder takes and what the manga folder takes, with the numbers counting up', async () => {
        const { animeDir } = session;
        const mangaDir = mangaFolderOf(workDir);
        mkdirSync(join(animeDir, 'Some Show'), { recursive: true });
        mkdirSync(join(mangaDir, 'One Piece'), { recursive: true });
        writeFileSync(join(animeDir, 'Some Show', 'ep1.mp4'), Buffer.alloc(3 * 1024 * 1024));
        writeFileSync(join(animeDir, 'ep2.mp4'), Buffer.alloc(1024 * 1024));
        writeFileSync(join(mangaDir, 'One Piece', 'Chapter 1.cbz'), Buffer.alloc(2 * 1024 * 1024));
        await relaunchWithSettings({ mangaDirectory: mangaDir });
        const { page } = session;
        await openAnimeSettings(page);
        const chart = page.getByTestId('disk-usage-anime');
        await expect(chart.getByText('DISK SPACE')).toBeVisible();
        await expect(chart.getByTestId('disk-folder')).toHaveText('4.0 MiB', { timeout: 10000 });
        await expect(chart.getByTestId('disk-sibling')).toHaveText('2.0 MiB', { timeout: 10000 });
        await expect(chart.getByText('This folder')).toBeVisible();
        await expect(chart.getByText('Manga folder')).toBeVisible();
        await expect(chart.getByText('Anime folder')).toHaveCount(0);
        await expect(chart.getByText('Other files')).toBeVisible();
        await expect(chart.getByText('Free', { exact: true })).toBeVisible();
        await expect(chart.getByTestId('disk-sibling-note')).toHaveCount(0);
        await expect(chart.getByTestId('disk-percent')).toHaveText(/^\d+%$/);
        await expect(chart.getByTestId('disk-free')).toHaveText(/^\d+(\.\d)? (GiB|TiB|MiB)$/);
        await expect(chart.getByTestId('disk-others')).toHaveText(/^\d+(\.\d)? (B|KiB|MiB|GiB|TiB)$/);
        await expect(chart.locator('.disk__segment--folder')).toHaveAttribute('stroke-dasharray', /^\d+(\.\d+)? \d+(\.\d+)?$/);
        await expect(chart.locator('.disk__segment--sibling')).toHaveAttribute('stroke-dasharray', /^\d+(\.\d+)? \d+(\.\d+)?$/);
        await expectSiblingAfterFolder(chart);
        await expect(chart.getByRole('img')).toHaveAttribute('aria-label', /^Disk space of the folder: 4\.0 MiB in the folder, Manga folder 2\.0 MiB, .* in other files, .* free of .*$/);
        await expect(page.getByTestId('disk-usage-manga')).toHaveCount(0);

        // Files that appear later, in either folder, are counted when the disk is read again.
        writeFileSync(join(animeDir, 'ep3.mp4'), Buffer.alloc(2 * 1024 * 1024));
        writeFileSync(join(mangaDir, 'One Piece', 'Chapter 2.cbz'), Buffer.alloc(1024 * 1024));
        await chart.getByRole('button', { name: 'REFRESH' }).click();
        await expect(chart.getByTestId('disk-folder')).toHaveText('6.0 MiB', { timeout: 10000 });
        await expect(chart.getByTestId('disk-sibling')).toHaveText('3.0 MiB', { timeout: 10000 });
    });

    test('shows the manga folder as empty when it has no files yet', async () => {
        await relaunchWithSettings({ mangaDirectory: mangaFolderOf(workDir) });
        await openAnimeSettings(session.page);
        const chart = session.page.getByTestId('disk-usage-anime');
        await expect(chart.getByText('Manga folder')).toBeVisible({ timeout: 10000 });
        await expect(chart.getByTestId('disk-sibling')).toHaveText('0 B');
        await expect(chart.locator('.disk__segment--sibling')).toHaveAttribute('stroke-dasharray', '0 100');
        await expect(chart.getByTestId('disk-sibling-note')).toHaveCount(0);
    });

    test('warns that the folders overlap and counts the files once when the manga folder is inside the anime folder', async () => {
        const { animeDir } = session;
        const inside = join(animeDir, 'manga');
        mkdirSync(inside, { recursive: true });
        writeFileSync(join(animeDir, 'ep1.mp4'), Buffer.alloc(3 * 1024 * 1024));
        writeFileSync(join(inside, 'Chapter 1.cbz'), Buffer.alloc(1024 * 1024));
        await relaunchWithSettings({ mangaDirectory: inside });
        const chart = session.page.getByTestId('disk-usage-anime');
        await openAnimeSettings(session.page);
        await expect(chart.getByTestId('disk-folder')).toHaveText('4.0 MiB', { timeout: 10000 });
        await expect(chart.getByTestId('disk-sibling')).toHaveText('1.0 MiB', { timeout: 10000 });
        await expect(chart.getByTestId('disk-sibling-note')).toHaveText('The folders overlap, so these files are counted only once.');
        await expectNoSiblingInRing(chart);
    });

    test('warns that the folders overlap when both sections use the same folder', async () => {
        const { animeDir } = session;
        mkdirSync(animeDir, { recursive: true });
        writeFileSync(join(animeDir, 'ep1.mp4'), Buffer.alloc(2 * 1024 * 1024));
        await relaunchWithSettings({ mangaDirectory: animeDir });
        const chart = session.page.getByTestId('disk-usage-anime');
        await openAnimeSettings(session.page);
        await expect(chart.getByTestId('disk-folder')).toHaveText('2.0 MiB', { timeout: 10000 });
        await expect(chart.getByTestId('disk-sibling')).toHaveText('2.0 MiB', { timeout: 10000 });
        await expect(chart.getByTestId('disk-sibling-note')).toHaveText('The folders overlap, so these files are counted only once.');
        await expectNoSiblingInRing(chart);
    });

    test('warns that the manga folder is on another disk and leaves it out of the ring', async () => {
        const otherDisk = makeFolderOnAnotherDisk(workDir);
        if (otherDisk === null) {
            test.skip(true, 'needs another disk to put the manga folder on (Linux has /dev/shm)');
            return;
        }
        try {
            const mangaDir = join(otherDisk, 'manga');
            mkdirSync(mangaDir, { recursive: true });
            mkdirSync(session.animeDir, { recursive: true });
            writeFileSync(join(mangaDir, 'Chapter 1.cbz'), Buffer.alloc(2 * 1024 * 1024));
            writeFileSync(join(session.animeDir, 'ep1.mp4'), Buffer.alloc(1024 * 1024));
            await relaunchWithSettings({ mangaDirectory: mangaDir });
            const chart = session.page.getByTestId('disk-usage-anime');
            await openAnimeSettings(session.page);
            await expect(chart.getByTestId('disk-folder')).toHaveText('1.0 MiB', { timeout: 10000 });
            await expect(chart.getByTestId('disk-sibling')).toHaveText('2.0 MiB', { timeout: 10000 });
            await expect(chart.getByTestId('disk-sibling-note')).toHaveText('On another disk, so it is not part of the ring.');
            await expectNoSiblingInRing(chart);
        } finally {
            rmSync(otherDisk, { recursive: true, force: true });
        }
    });

    test('measures the new folder, and still shows the manga folder, once the anime folder is migrated', async () => {
        const mangaDir = mangaFolderOf(workDir);
        mkdirSync(mangaDir, { recursive: true });
        writeFileSync(join(mangaDir, 'Chapter 1.cbz'), Buffer.alloc(2 * 1024 * 1024));
        await relaunchWithSettings({ mangaDirectory: mangaDir });
        await downloadFirstEpisode(session.page);
        const target = join(workDir, 'migrated');
        mkdirSync(target, { recursive: true });
        writeFileSync(join(target, 'extra.bin'), Buffer.alloc(1024 * 1024));
        const { userData } = session;
        await session.app.close();
        session = await launch(userData, { mangaDirectory: mangaDir }, { PULLWAVE_MIGRATE_DIR: target });
        const { page } = session;

        await openAnimeSettings(page);
        const chart = page.getByTestId('disk-usage-anime');
        await expect(chart.getByTestId('disk-folder')).toHaveText(/^\d+(\.\d)? (B|KiB)$/, { timeout: 10000 });
        await page.getByRole('button', { name: 'MIGRATE FOLDER' }).click();
        await expect(page.locator('.toast .toast__message')).toHaveText(`MIGRATION DONE: 1 EPISODES MOVED TO ${target}`);

        // The folder that is measured is the new one (the extra file is there), and the old files are not counted anymore.
        await expect(chart.getByTestId('disk-folder')).toHaveText('1.0 MiB', { timeout: 10000 });
        await expect(chart.getByTestId('disk-sibling')).toHaveText('2.0 MiB');
        await expect(chart.getByRole('button', { name: 'REFRESH' })).toBeEnabled();
        expect(existsSync(session.animeDir)).toBe(false);
    });
});
