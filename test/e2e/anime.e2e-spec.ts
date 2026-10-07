import { expect, test, _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import './display';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const ELECTRON_PATH = createRequire(__filename)('electron') as unknown as string;
const FAKE_ANI_CLI = resolve(__dirname, 'fixtures/fake-ani-cli.sh');
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
        env: { ...process.env, PULLWAVE_ANI_CLI: FAKE_ANI_CLI, PULLWAVE_IMPORT_DIR: animeDir, PULLWAVE_ANILIST_URL: 'http://127.0.0.1:9/graphql', ...env }
    });
    const page = await app.firstWindow();
    await page.waitForSelector('.logo');
    // The screens only show up once yt-dlp and ffmpeg were probed, which can take a while the first time on Windows.
    await expect(page.getByText('// BOOTING SYSTEMS…')).toBeHidden({ timeout: 60000 });
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
    // The settings are a gear, named for the screen readers, not a word.
    const sections = page.getByRole('navigation', { name: 'Sections' });
    await expect(sections.getByRole('button')).toHaveText(['VIDEO DOWNLOADER', 'ANIME', '\u2699\uFE0E']);
    await expect(sections.getByRole('button', { name: 'SETTINGS (GLOBAL)', exact: true })).toHaveAttribute('title', 'SETTINGS (GLOBAL)');
    await openAnimeTab(page);
    await expect(page.getByRole('button', { name: 'ANIME', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByLabel('Anime name')).toBeVisible();
    await expect(page.getByLabel('Audio')).toHaveValue('sub');
});

test('opens on the schedule, the first tab, to the left of the search', async () => {
    const { page } = session;
    await openAnimeToday(page);
    const subNav = page.getByRole('navigation', { name: 'Anime' });
    await expect(subNav.getByRole('button')).toHaveText(['SCHEDULE', 'SEARCH', 'LIBRARY', 'HISTORY', '\u2699\uFE0E']);
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

    test('checks which anime of the day the source has: the ones it has stay open, the others are faded and cannot be clicked', async () => {
        const page = await openSchedule(ITEMS);
        const items = page.getByRole('region', { name: 'Anime schedule' }).getByRole('listitem');
        await expect(page.getByText('AIRING [2]')).toBeVisible();

        await expect(items.nth(0).locator('.badge')).toHaveText('AVAILABLE');
        await expect(items.nth(1).locator('.badge')).toHaveText('NOT AVAILABLE');
        await expect(items.nth(0).getByRole('button', { name: 'OPEN: Fake Anime, EP 2', exact: true })).toBeVisible();
        await expect(items.nth(0)).not.toHaveClass(/cover-card--unavailable/);
        await expect(items.nth(1)).toHaveClass(/cover-card--unavailable/);
        await expect(items.nth(1)).toHaveAttribute('aria-disabled', 'true');
        await expect(items.nth(1)).toHaveAttribute('title', 'The source does not have this anime.');
        await expect(items.nth(1).getByRole('button')).toHaveCount(0);
        expect(await items.nth(1).evaluate((element) => {
            return Number(getComputedStyle(element).opacity);
        })).toBeLessThan(1);

        // Each anime is looked up in the source by its names (here only the romaji one, which is the title), as the day is listed.
        await expect.poll(() => {
            return calls().sort();
        }).toEqual(['sub | Dandadan', 'sub | Fake Anime']);

        // Clicking the one that is not available does nothing: the schedule stays on the screen.
        await items.nth(1).locator('.history__title').click({ force: true });
        await expect(page.getByRole('region', { name: 'Anime schedule' })).toBeVisible();
        await expect(page.getByLabel('Anime name')).toHaveCount(0);
    });

    test('keeps what it found out about the source for an hour: the app opened again does not look the same anime up again', async () => {
        const first = await openSchedule(ITEMS);
        await expect(first.locator('.badge').filter({ hasText: /^(NOT )?AVAILABLE$/ })).toHaveCount(2);
        const before = calls().sort();
        expect(before).toEqual(['sub | Dandadan', 'sub | Fake Anime']);

        const second = await openSchedule(ITEMS);

        await expect(second.locator('.badge').filter({ hasText: /^(NOT )?AVAILABLE$/ })).toHaveCount(2);
        await expect(second.getByRole('listitem').nth(1)).toHaveClass(/cover-card--unavailable/);
        expect(calls().sort()).toEqual(before);
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

    test('checks the anime of the week too once the week is shown', async () => {
        const page = await openSchedule(ITEMS);
        await expect(page.locator('.badge').filter({ hasText: /^(NOT )?AVAILABLE$/ })).toHaveCount(2);

        await page.getByLabel('View').selectOption('week');

        await expect(page.getByText('AIRING [3]')).toBeVisible();
        await expect(page.locator('.schedule__day').nth(1).locator('.badge')).toHaveText('NOT AVAILABLE');
        await expect.poll(() => {
            return calls().sort();
        }).toEqual(['sub | Blue Lock', 'sub | Dandadan', 'sub | Fake Anime']);
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
        await expect(page.getByText('AVAILABLE', { exact: true })).toBeVisible();

        await page.getByRole('button', { name: 'OPEN: Fake Anime, EP 2', exact: true }).click();

        const subNav = page.getByRole('navigation', { name: 'Anime' });
        await expect(subNav.getByRole('button', { name: 'SEARCH', exact: true })).toHaveAttribute('aria-current', 'page');
        await expect(page.getByLabel('Anime name')).toHaveValue('Fake Anime');
        await expect(page.getByRole('button', { name: 'OPEN: Fake Anime', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'OPEN: Fake Anime 2', exact: true })).toBeVisible();
        // The two looks-up of the day, and the search that the click made.
        expect(calls().sort()).toEqual(['sub | Dandadan', 'sub | Fake Anime', 'sub | Fake Anime']);
    });

    test('looks the english name up first, then the romaji one, and opens the search by the one that found the anime', async () => {
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

        await expect(page.getByText('AVAILABLE', { exact: true })).toBeVisible();
        // The english name finds nothing, the romaji one does: that is the name the card opens the search by.
        expect(calls()).toEqual(['sub | Nothing zzz', 'sub | Fake Anime']);

        await page.getByRole('button', { name: 'OPEN: Nothing zzz, EP 4', exact: true }).click();

        await expect(page.getByRole('button', { name: 'OPEN: Fake Anime', exact: true })).toBeVisible();
        await expect(page.getByLabel('Anime name')).toHaveValue('Fake Anime');
        expect(calls()).toEqual(['sub | Nothing zzz', 'sub | Fake Anime', 'sub | Fake Anime']);
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
    await expect(page.getByText('// NOTHING OPENED YET. SEARCH AN ANIME OR PLAY AN EPISODE.')).toBeVisible();
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
    await expect(reopened.getByText('// NOTHING OPENED YET. SEARCH AN ANIME OR PLAY AN EPISODE.')).toBeVisible();
});

// A real click on a point of a row that is not its title, as a user would: the area of the title button is stretched over the row.
async function clickOnRow(page: Page, part: Locator): Promise<void> {
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

    // The season starts closed (even the only one); a click on its row shows the episodes and another hides them again.
    const season = page.getByTestId('anime-season');
    await expect(season.getByTestId('anime-episode')).toHaveCount(0);
    await expect(season.getByRole('button', { name: /^SHOW EPISODES: / })).toHaveAttribute('aria-expanded', 'false');
    await clickOnRow(page, season.locator('.season__meta'));
    await expect(season.getByTestId('anime-episode')).toHaveCount(3);
    await clickOnRow(page, season.locator('.season__meta'));
    await expect(season.getByTestId('anime-episode')).toHaveCount(0);
    await clickOnRow(page, season.locator('.season__meta'));
    await expect(season.getByTestId('anime-episode')).toHaveCount(3);

    // A button of the row works on its own: it does not close the season, nor play the episode.
    await page.getByRole('button', { name: 'MARK AS WATCHED: Fake Anime EP 1' }).click();
    await expect(page.getByRole('button', { name: 'MARK AS UNWATCHED: Fake Anime EP 1' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(season.getByTestId('anime-episode')).toHaveCount(3);

    // A click on the row of the episode (its meta line) plays it.
    await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toHaveCount(0);
    await clickOnRow(page, season.getByTestId('anime-episode').locator('.history__meta').first());
    await expect(page.getByRole('dialog', { name: 'Fake Anime · EP 1' })).toBeVisible();
});

test('in fullscreen, in the cyberpunk theme, only the part of the timeline already watched has the wave and the glow @resize', async () => {
    await session.app.close();
    session = await launch(join(workDir, 'user-data'), { theme: 'cyberpunk' });
    const { page } = session;
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'cyberpunk');
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
            const seek = document.querySelector('.player__seek') as HTMLElement;
            seek.style.setProperty('--progress', '40%');
            (document.querySelector('.player__controls') as HTMLElement).setAttribute('data-playing', state);
            const style = getComputedStyle(seek);
            return {
                backgroundSize: style.backgroundSize,
                boxShadow: style.boxShadow,
                borderColor: style.borderTopColor,
                animationName: style.animationName,
                animationPlayState: style.animationPlayState,
                filter: style.filter
            };
        }, playing);
    };

    const playing = await timeline('true');
    // The wave is a layer as wide as what was watched, then a faint layer as wide as what is loaded (none here); the rest of the timeline is a plain track, and nothing glows around the whole bar.
    expect(playing.backgroundSize).toBe('40% 100%, 0% 100%, auto');
    expect(playing.boxShadow).toBe('none');
    expect(playing.borderColor).toBe('rgba(0, 0, 0, 0)');
    expect(playing.animationName).toBe('player-wave-phase, player-wave-glow-filter');
    expect(playing.animationPlayState).toBe('running');
    expect(playing.filter).toMatch(/^drop-shadow\(/);

    const paused = await timeline('false');
    expect(paused.backgroundSize).toBe('40% 100%, 0% 100%, auto');
    expect(paused.animationPlayState).toBe('paused');
});

test('searches an anime, lists the results and reports when nothing is found', async () => {
    const { page } = session;
    await openAnimeTab(page);
    await search(page, 'fake');
    await expect(page.getByText('2 RESULTS')).toBeVisible();
    await expect(page.locator('.history__title')).toHaveText(['Fake Anime', 'Fake Anime 2']);
    expect(calls()).toEqual(['sub | fake']);

    await search(page, 'zzz');
    const alert = page.getByRole('alert');
    await expect(alert).toHaveText('Nothing was found for this search.');
    await expect(alert).toHaveAttribute('title', 'No results found!');
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

test('searches with the audio that was picked', async () => {
    const { page } = session;
    await openAnimeTab(page);
    await page.getByLabel('Audio').selectOption('dub');
    await search(page, 'fake');
    await expect(page.getByText('2 RESULTS')).toBeVisible();
    expect(calls()).toEqual(['dub | fake']);
});

test('opens an anime and lists its episodes', async () => {
    const { page } = session;
    await openAnimeTab(page);
    await openFirstResult(page);
    await expect(page.getByText('3 EPISODES', { exact: true })).toBeVisible();
    await expect(page.locator('.episode-chip')).toHaveText(['EP 1', 'EP 2', 'EP 3']);
    expect(calls()).toEqual(['sub | fake', 'sub | -S 1 fake']);
    await page.getByRole('button', { name: 'BACK' }).click();
    await expect(page.getByText('2 RESULTS')).toBeVisible();
});

test('announces a finished download with a toast that takes itself away after five seconds', async () => {
    const { page } = session;
    await openAnimeTab(page);
    await openFirstResult(page);
    await downloadFromLibrary(page, [2]);

    const toast = page.locator('.toast').filter({ hasText: 'Download complete: Fake Anime · EP 2' });
    await expect(toast).toBeVisible({ timeout: 20000 });
    await expect(toast).toBeHidden({ timeout: 8000 });
});

test('downloads an episode with the quality of the settings and shows it in the library', async () => {
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

test('downloads a whole season, one episode at a time', async () => {
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

test('asks for the subtitles in the language of the app, and in another one when chosen', async () => {
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
    await page.getByRole('button', { name: 'CONFIRM' }).click();
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

test('pausing a download ends the process and keeps the episode as paused, and resuming starts it again and finishes it', async () => {
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

test('a paused episode is in the library as paused, with a button to resume it, and survives closing the app', async () => {
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
    await reopened.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
    await reopened.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
    await expect(reopened.getByTestId('anime-episode').locator('.history__meta').first()).toContainText('DOWNLOADED');
});

test('cancelling a download ends the process: the file is never finished', async () => {
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
    await expect(job.locator('.badge--cancelled')).toHaveText('CANCELLED');

    // The fake would have written the file five seconds after it started: it must not, because nothing is left running.
    await page.waitForTimeout(7000);
    expect(existsSync(join(animeDir, 'Fake Anime', 'Season 1', 'Episode 1', 'Fake Anime Episode 1.mp4'))).toBe(false);
    await expect(job.locator('.badge--cancelled')).toBeVisible();
    await backFromDownloads(page);
    await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
    await page.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
    await page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
    await expect(page.getByTestId('anime-episode').locator('.history__meta').first()).toHaveText('CANCELLED');
});

test('closing the app cancels a download that is running and deletes the folder of its episode, with the unfinished file', async () => {
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

test('closing the app with a paused episode keeps it as paused, with its unfinished file', async () => {
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

test('shows why a download failed and retries it', async () => {
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
    await expect(reason).toHaveAttribute('title', 'No sources found for sub!');

    await job.getByRole('button', { name: 'RETRY' }).click();
    await expect(job.locator('.badge--error')).toHaveText('FAILED');
    expect(
        calls().filter((line) => {
            return line.includes('-d ');
        })
    ).toHaveLength(2);
});

test('keeps the library after the app is restarted', async () => {
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

test.describe('player', () => {
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
        await expect(dialog.locator('video')).toHaveAttribute('src', 'pullwave-media://episode/1');
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

test('removes a series with its files and its folder', async () => {
    const { page, animeDir } = session;
    await downloadFirstEpisode(page);
    writeFileSync(join(animeDir, 'Fake Anime', 'leftover.part'), 'x');
    expect(existsSync(join(animeDir, 'Fake Anime'))).toBe(true);

    await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
    await page.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
    await page.getByRole('button', { name: 'Series options: Fake Anime' }).click();
    await page.getByRole('button', { name: 'REMOVE SERIES: Fake Anime' }).click();
    await page.getByRole('button', { name: 'CONFIRM' }).click();

    await expect(page.getByText('// THE LIBRARY IS EMPTY. SEARCH AN ANIME AND ADD IT TO THE LIBRARY.')).toBeVisible();
    await expect.poll(() => {
        return existsSync(join(animeDir, 'Fake Anime'));
    }).toBe(false);
    // What is outside the folder of the anime is left alone.
    expect(existsSync(animeDir)).toBe(true);
});

test.describe('library and folder in sync', () => {
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

        // The import is on the cards: the screen of the anime has a way back.
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
            'The file of this episode is not on the disk. Use IMPORT LIBRARY to point it to its new place.'
        );
        await expect(row.getByRole('button', { name: 'PLAY: Fake Anime EP 1' })).toHaveCount(0);
        // Clicking the row does not start the player.
        await row.locator('.history__meta').first().click({ force: true });
        await expect(page.getByRole('dialog')).toHaveCount(0);
    });

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

    test('saves each anime in a season folder, suggesting the series, and joins two entries by hand into one card', async () => {
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
        await dialog.getByRole('spinbutton', { name: 'Order' }).fill('1');
        // An order the series already uses is not allowed: the window says so, with the next one, and cannot be confirmed.
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

        // The order of a season is edited in its row, and a taken one is refused with the next one recommended.
        const second = page.getByTestId('anime-season').last();
        await page.getByTestId('anime-season').first().getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
        await second.getByRole('button', { name: 'SHOW EPISODES: Fake Anime 2', exact: true }).click();
        await second.getByRole('button', { name: 'EDIT SEASON: Fake Anime 2' }).click();
        await page.getByRole('spinbutton', { name: 'Order' }).fill('1');
        await page.getByRole('button', { name: 'SAVE' }).click();
        await expect(page.getByRole('alert')).toHaveText('Order 1 is already used by another anime of the series. Use 2, the next one.');
        await page.getByRole('button', { name: 'CANCEL' }).click();

        // The anime that gives its name to the series cannot be removed alone; the other one can.
        const first = page.getByTestId('anime-season').first();
        const blocked = first.getByRole('button', { name: 'REMOVE ANIME: Fake Anime' });
        await expect(blocked).toBeDisabled();
        await expect(blocked).toHaveAttribute('title', 'This anime gives its name to the series. To remove it, remove the whole series.');
        await second.getByRole('button', { name: 'REMOVE ANIME: Fake Anime 2' }).click();
        await page.getByRole('button', { name: 'CONFIRM' }).click();
        await expect(page.getByTestId('anime-season')).toHaveCount(1);
        await page.getByRole('button', { name: 'BACK TO LIBRARY', exact: true }).click();
        await expect(page.getByTestId('anime-card')).toHaveCount(1);
        await expect(page.getByTestId('anime-card').getByText('1 SEASON')).toBeVisible();
    });

    test('brings the series back when the library is rebuilt from the folder', async () => {
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

    // How the page is laid out at a size: the scale of the interface (never changed), the widest the page may be and the columns of a list.
    async function layout(page: Page, width: number, height: number): Promise<{ zoom: string; appMaxWidth: string; columns: number; overflow: boolean }> {
        await page.setViewportSize({ width, height });
        return page.evaluate(() => {
            const list = document.querySelector('.queue') as HTMLElement;
            const tracks = getComputedStyle(list).gridTemplateColumns;
            return {
                zoom: getComputedStyle(document.documentElement).zoom,
                appMaxWidth: getComputedStyle(document.querySelector('.app') as HTMLElement).maxWidth,
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

    test('grows the page with the window up to a 1920x1080 screen, and keeps it there on a bigger one', async () => {
        const { page } = session;
        await threeDownloads(page);

        expect(await layout(page, 1100, 780)).toMatchObject({ zoom: '1', appMaxWidth: '1000px', columns: 1 });
        expect(await layout(page, 1366, 768)).toMatchObject({ zoom: '1', appMaxWidth: '1240px', columns: 2 });
        expect(await layout(page, 1920, 1080)).toMatchObject({ zoom: '1', appMaxWidth: '1400px', columns: 2 });
        // Bigger screens are not a target: nothing changes there.
        expect(await layout(page, 2560, 1440)).toMatchObject({ zoom: '1', appMaxWidth: '1400px', columns: 2 });
        expect(await layout(page, 3440, 1440)).toMatchObject({ zoom: '1', appMaxWidth: '1400px', columns: 2 });
    });

    test('never needs to scroll sideways, from the smallest window up', async () => {
        const { page } = session;
        await threeDownloads(page);
        for (const [width, height] of [[480, 800], [600, 800], [768, 1024], [1024, 768], [1366, 768], [1920, 1080]]) {
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
        expect(await page.locator('.tabs').first().evaluate((tabs) => { return getComputedStyle(tabs).overflowX; })).toBe('auto');
    });
});

test('goes back to the ani-cli that ships with the app, by deleting the one an update saved', async () => {
    await session.app.close();
    const userData = join(workDir, 'user-data');
    const bundledScript = readFileSync(join(ROOT, 'resources', 'bin', 'ani', 'ani-cli'), 'utf-8');
    const bundledVersion = /version_number="([^"]*)"/.exec(bundledScript)?.[1] as string;
    const saved = join(userData, 'bin', 'ani-cli');
    mkdirSync(join(userData, 'bin'), { recursive: true });
    writeFileSync(saved, bundledScript.replace(/version_number="[^"]*"/, 'version_number="99.0.0"'), { mode: 0o755 });

    // Without the stand-in of the tests, the app uses the scripts it finds: the one an update saved is newer than the one that ships.
    session = await launch(userData, {}, { PULLWAVE_ANI_CLI: '' });
    const { page } = session;
    const chip = page.locator('.chip', { hasText: 'ani-cli' });
    await expect(chip).toHaveText('ani-cli 99.0.0');
    await expect(chip).toHaveAttribute('title', `${saved} (updated)`);
    await openAnimeSettings(page);
    await expect(page.getByText('ani-cli version: 99.0.0')).toBeVisible();

    await page.getByRole('button', { name: 'USE THE ONE THAT SHIPS WITH THE APP' }).click();

    await expect(page.locator('.toast--info .toast__message')).toHaveText('Using the ani-cli that ships with the app again.');
    await expect(page.getByText(`ani-cli version: ${bundledVersion}`)).toBeVisible();
    await expect(chip).toHaveText(`ani-cli ${bundledVersion}`);
    await expect(chip).toHaveAttribute('title', `${join(ROOT, 'resources', 'bin', 'ani', 'ani-cli')} (bundled)`);
    await expect(page.getByRole('button', { name: 'USE THE ONE THAT SHIPS WITH THE APP' })).toHaveCount(0);
    expect(existsSync(saved)).toBe(false);
    expect(readFileSync(join(ROOT, 'resources', 'bin', 'ani', 'ani-cli'), 'utf-8')).toBe(bundledScript);
});

test('shows the version of ani-cli at the top and in the settings, and does not update a script that was chosen', async () => {
    const { page } = session;
    const chip = page.locator('.chip', { hasText: 'ani-cli' });
    await expect(chip).toHaveText('ani-cli 0.0.0-fake');
    await expect(chip).toHaveClass(/chip--ok/);
    await expect(chip).toHaveAttribute('title', `${FAKE_ANI_CLI} (custom)`);

    await openAnimeSettings(page);
    await expect(page.getByText('ani-cli version: 0.0.0-fake')).toBeVisible();
    await page.getByRole('button', { name: 'UPDATE ANI-CLI' }).click();
    await expect(page.locator('.toast--error .toast__message')).toHaveText('You chose your own ani-cli in the settings, so the app does not update it.');
    await expect(page.getByRole('button', { name: 'UPDATE ANI-CLI' })).toBeEnabled();
    await expect(chip).toHaveText('ani-cli 0.0.0-fake');
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

test.describe('only anime inside the anime folder', () => {
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

test.describe('migrating the folder of the anime', () => {
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
    let searched: string[];
    let mode: 'ok' | 'error';

    async function startAniList(port = 0): Promise<void> {
        aniList = createServer((request, response) => {
            const chunks: Buffer[] = [];
            request.on('data', (chunk: Buffer) => {
                chunks.push(chunk);
            });
            request.on('end', () => {
                const search = (JSON.parse(Buffer.concat(chunks).toString('utf8')) as { variables: { search: string } }).variables.search;
                searched.push(search);
                if (mode === 'error') {
                    response.writeHead(500).end('{}');
                    return;
                }
                if (search === 'Fake Anime 2') {
                    response.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ errors: [{ status: 404 }], data: { Media: null } }));
                    return;
                }
                response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ data: { Media: { coverImage: { large: COVER } } } }));
            });
        });
        await new Promise<void>((resolveListening) => {
            aniList.listen(port, '127.0.0.1', resolveListening);
        });
        aniListUrl = `http://127.0.0.1:${(aniList.address() as AddressInfo).port}/graphql`;
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
        session = await launch(join(workDir, 'user-data'), {}, { PULLWAVE_ANILIST_URL: aniListUrl });
        return session.page;
    }

    test.beforeEach(async () => {
        searched = [];
        mode = 'ok';
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
    });

    test('shows the covers in the library and in the history too, without asking for them again', async () => {
        const { page } = session;
        await downloadFirstEpisode(page);
        // The results of the search that was made to open the anime ask for their covers too, one a second.
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

    test('keeps the covers on the disk: they are there, without asking, when the app is opened again with no network', async () => {
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

test.describe('watching without downloading', () => {
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
            const types: Record<string, string> = { '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.vtt': 'text/vtt' };
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

        await dialog.getByRole('button', { name: 'CHECK SUBTITLES' }).click();
        await expect(page.locator('.toast--info .toast__message', { hasText: 'NEW SUBTITLES' })).toHaveText('NEW SUBTITLES ADDED (3): English, Portuguese, Spanish');
        await expect(dialog.getByRole('button', { name: 'CHECK SUBTITLES' })).toBeEnabled();
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
        await dialog.getByRole('button', { name: 'Settings' }).click();
        const options = await dialog.getByRole('combobox', { name: 'Subtitles' }).locator('option').allTextContents();
        expect(options).toEqual(expect.arrayContaining(['English', 'Portuguese', 'Spanish']));

        // Asking again finds nothing new and downloads nothing.
        const asked = seen.length;
        await dialog.getByRole('button', { name: 'CHECK SUBTITLES' }).click();
        await expect(page.locator('.toast--info .toast__message')).toHaveText('NO NEW SUBTITLES: THE SOURCE OFFERS NO OTHERS.');
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
        await dialog.getByRole('button', { name: 'CHECK SUBTITLES' }).click();

        await expect(page.locator('.toast--info .toast__message', { hasText: 'NEW SUBTITLES' })).toHaveText('NEW SUBTITLES ADDED (2): Portuguese (Brazil), Spanish (Latin America)');
        await dialog.getByRole('button', { name: 'Settings' }).click();
        const options = await dialog.getByRole('combobox', { name: 'Subtitles' }).locator('option').allTextContents();
        expect(options).toEqual(expect.arrayContaining(['Portuguese (Brazil)', 'Spanish (Latin America)']));
        expect(options.some((name) => {
            return name.includes('(- ');
        })).toBe(false);
        // The files keep the name the source gave, which is also what tells the subtitles apart.
        expect(existsSync(join(folder, 'Fake Anime Episode 1.subtitle-Portuguese (- Portuguese(Brazil)).vtt'))).toBe(true);
        expect(existsSync(join(folder, 'Fake Anime Episode 1.subtitle-Spanish (- Spanish(Latin America)).vtt'))).toBe(true);
    });

    test('says so when the source offers no subtitles for the episode that was checked', async () => {
        const { page } = session;
        await downloadFirstEpisode(page);
        await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
        await page.getByRole('button', { name: 'OPEN SERIES: Fake Anime' }).click();
        await page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime', exact: true }).click();
        await page.getByRole('button', { name: 'PLAY: Fake Anime EP 1' }).click();
        const dialog = page.getByRole('dialog', { name: 'Fake Anime · EP 1' });
        await dialog.getByRole('button', { name: 'CHECK SUBTITLES' }).click();
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

        // The timeline shows how much of the episode is loaded.
        await expect.poll(async () => {
            return seek.evaluate((element: HTMLInputElement) => {
                return Number.parseFloat(element.style.getPropertyValue('--buffered'));
            });
        }).toBeGreaterThan(0);

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
        await expect(alert).toHaveAttribute('title', 'No sources found for sub!');
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toBeHidden();
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

    test('downloads everything that is missing from the screen of the series, telling each one that finishes', async () => {
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

    test('downloads only the episodes of one season, from the button of its row, leaving the other seasons of the series alone', async () => {
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

    test('downloads again, with DOWNLOAD ALL, the episode whose download failed', async () => {
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
        const badges = page.getByTestId('series-view').locator('.job__badges');
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
        await expect(page.getByText('The files are deleted from the disk too.')).toBeVisible();
        await page.getByRole('button', { name: 'CONFIRM' }).click();
        await expect(page.getByText('// THE LIBRARY IS EMPTY. SEARCH AN ANIME AND ADD IT TO THE LIBRARY.')).toBeVisible();
    });
});

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
        await expect(page.getByText('No token is saved for this provider.')).toBeVisible();
        expect(JSON.parse(readFileSync(join(userData, 'llm-tokens.json'), 'utf-8'))).toEqual({});
    });

    test('shows the cost before it starts, translates the English subtitle and offers the result in the player', async () => {
        const { page } = session;
        await saveToken(page);
        await downloadWithSubtitles(page, [1]);
        const dialog = await openPlayer(page);
        await dialog.getByRole('button', { name: 'TRANSLATE SUBTITLE' }).click();
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
        await dialog.getByRole('button', { name: 'Settings' }).click();
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
        await dialog.getByRole('button', { name: 'TRANSLATE SUBTITLE' }).click();
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
        await dialog.getByRole('button', { name: 'TRANSLATE SUBTITLE' }).click();
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
        await dialog.getByRole('button', { name: 'TRANSLATE SUBTITLE' }).click();
        const translate = page.getByRole('dialog', { name: 'Translate a subtitle' });
        await expect(translate.getByText('2 lines, 1 requests, about 160 tokens of your account.')).toBeVisible();
        await translate.getByRole('button', { name: 'TRANSLATE', exact: true }).click();
        await expect(translate.getByText('Translated 0 of 2 lines…')).toBeVisible();
        await expect(translate.getByRole('button', { name: 'CLOSE' })).toBeDisabled();
        await expect.poll(() => {
            return received.length;
        }).toBe(1);

        await translate.getByRole('button', { name: 'CANCEL TRANSLATION' }).click();
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
        await expect(page.getByText('Translate the subtitles of 2 episodes into Spanish with your account? Each episode is a request to the provider, and the cost is yours.')).toBeVisible();
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
    // audio at all, and with no subtitle.
    async function downloadWithoutSubtitle(page: Page, withAudio = true): Promise<void> {
        await openAnimeTab(page);
        await openFirstResult(page);
        await downloadFromLibrary(page, [1]);
        await waitForDownloaded(page);
        const video = readdirSync(episodeFolder()).find((name) => {
            return name.endsWith('.mp4');
        }) as string;
        const target = join(episodeFolder(), video);
        const input = withAudio ? ['-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '650', '-c:a', 'aac'] : ['-f', 'lavfi', '-i', 'testsrc=duration=2:size=64x64:rate=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p'];
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

    async function openGenerateDialog(page: Page, audio: string, subtitle: string): Promise<{ player: Locator; create: Locator }> {
        const player = await openPlayer(page);
        await expect(player.getByRole('button', { name: 'TRANSLATE SUBTITLE' })).toHaveCount(0);
        await player.getByRole('button', { name: 'CREATE SUBTITLE' }).click();
        const create = page.getByRole('dialog', { name: 'Create a subtitle' });
        await expect(create).toBeVisible();
        await create.getByLabel('Language of the audio', { exact: true }).selectOption(audio);
        await create.getByLabel('Language of the subtitle', { exact: true }).selectOption(subtitle);
        await expect(create.getByText(AUDIO_TEXT)).toBeVisible();
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

    test('asks for the two languages, says what will be sent before it starts, and transcribes the audio in parts when the subtitle is in the language that is spoken', async () => {
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
        await player.getByRole('button', { name: 'Settings' }).click();
        await expect(player.getByRole('combobox', { name: 'Subtitles' })).toHaveValue('generated-Japanese');
        await expect(player.getByRole('button', { name: 'TRANSLATE SUBTITLE' })).toBeVisible();
        await expect(player.getByRole('button', { name: 'CREATE SUBTITLE' })).toHaveCount(0);
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
        await player.getByRole('button', { name: 'CREATE SUBTITLE' }).click();
        const create = page.getByRole('dialog', { name: 'Create a subtitle' });
        await expect(create.getByText('This video has no audio to transcribe.')).toBeVisible();
        await expect(create.getByRole('button', { name: 'CREATE', exact: true })).toBeDisabled();
        expect(received).toEqual([]);
    });
});
