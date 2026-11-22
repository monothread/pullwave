import { expect, test, _electron as electron, type Page } from '@playwright/test';
import './display';
import { leaveHome } from './startScreen';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installedProgramsEnv } from './programs';
import { THEMES } from '../../src/shared/constants';
import { showTheme } from './showTheme';
import type { ThemeName } from '../../src/shared/types';

const ROOT = resolve(__dirname, '../..');
const ELECTRON_PATH = createRequire(__filename)('electron') as unknown as string;
const FAKE_ANI_CLI = resolve(__dirname, 'fixtures/fake-ani-cli.sh');
const FAKE_YTDLP = resolve(__dirname, 'fixtures/fake-yt-dlp.js');
const SIZES: Array<[number, number]> = [[480, 800], [600, 800], [768, 1000], [1024, 768], [1080, 1850], [1366, 768], [1920, 1050], [3440, 1400]];
interface AuditMatrix {
    tag: string;
    themes: readonly ThemeName[];
    sizes: ReadonlyArray<[number, number]>;
}
const MATRICES: readonly AuditMatrix[] = [
    { tag: '(cyberpunk, light, synthwave at 480 and 1366 px)', themes: ['cyberpunk', 'light', 'synthwave'], sizes: [[480, 800], [1366, 768]] },
    { tag: '(cyberpunk, light at 1080x1850 and 3440x1400)', themes: ['cyberpunk', 'light'], sizes: [[1080, 1850], [3440, 1400]] },
    { tag: '(every theme and size) @full', themes: THEMES, sizes: SIZES }
];
test.setTimeout(600000);

async function audit(page: Page, where: string): Promise<string[]> {
    return page.evaluate((label) => {
        document.getAnimations().forEach((animation) => {
            const end = animation.effect?.getComputedTiming().endTime;
            if (typeof end === 'number' && Number.isFinite(end)) {
                animation.finish();
            }
        });
        const problems: string[] = [];
        const name = (element: Element): string => {
            const text = (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 24);
            return `${element.tagName.toLowerCase()}.${(element.getAttribute('class') ?? '').split(' ')[0]}[${text}]`;
        };
        const zoom = Number(getComputedStyle(document.documentElement).zoom) || 1;
        const width = window.innerWidth;
        if (document.documentElement.scrollWidth > width + 1) {
            problems.push(`${label}: the page scrolls sideways (${document.documentElement.scrollWidth} > ${width})`);
        }
        const visible = Array.from(document.querySelectorAll<HTMLElement>('.app *')).filter((element) => {
            const box = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && !element.closest('.toast');
        });
        visible.forEach((element) => {
            const box = element.getBoundingClientRect();
            if (box.right > width + 1 / zoom || box.left < -1) {
                problems.push(`${label}: ${name(element)} is outside the window (${Math.round(box.left)}..${Math.round(box.right)} of ${width})`);
            }
            let parent = element.parentElement;
            while (parent && getComputedStyle(parent).display === 'contents') {
                parent = parent.parentElement;
            }
            if (parent && parent !== document.body && parent.closest('.app')) {
                const holder = parent.getBoundingClientRect();
                const style = getComputedStyle(parent);
                const popped = getComputedStyle(element).transform !== 'none' && element.closest(':hover') !== null;
                if (!popped && style.overflowX === 'visible' && box.right > holder.right + 2 && getComputedStyle(element).position !== 'absolute' && getComputedStyle(element).position !== 'fixed' && !element.classList.contains('logo')) {
                    problems.push(`${label}: ${name(element)} goes past its box ${name(parent)} by ${Math.round(box.right - holder.right)}px`);
                }
            }
        });
        visible.filter((element) => {
            return element.matches('button, .badge, .chip, .tab, label, .field__label, .section-label');
        }).forEach((element) => {
            if (element.scrollWidth > element.clientWidth + 1 && getComputedStyle(element).overflowX !== 'visible') {
                problems.push(`${label}: the text of ${name(element)} is cut`);
            }
        });
        const rows = new Map<Element, HTMLElement[]>();
        visible.filter((element) => {
            return element.matches('button.btn, .btn');
        }).forEach((element) => {
            const list = rows.get(element.parentElement as Element) ?? [];
            list.push(element);
            rows.set(element.parentElement as Element, list);
        });
        rows.forEach((buttons, holder) => {
            const lines = new Map<number, number[]>();
            buttons.forEach((button) => {
                const box = button.getBoundingClientRect();
                const key = Math.round(box.top / 6);
                lines.set(key, [...(lines.get(key) ?? []), Math.round(box.height)]);
            });
            lines.forEach((heights) => {
                if (heights.length > 1 && Math.max(...heights) - Math.min(...heights) > 2) {
                    problems.push(`${label}: the buttons of ${name(holder)} on one line have different heights (${heights.join(', ')})`);
                }
            });
        });
        document.querySelectorAll<HTMLElement>('.queue, .history > .history__list').forEach((list) => {
            if (getComputedStyle(list).display !== 'grid') {
                return;
            }
            const widths = new Set(
                Array.from(list.children)
                    .filter((card) => {
                        return card.matches('article, li');
                    })
                    .map((card) => {
                        return Math.round(card.getBoundingClientRect().width);
                    })
            );
            if (widths.size > 1) {
                problems.push(`${label}: the cards of ${name(list)} have different widths (${[...widths].join(', ')})`);
            }
        });
        document.querySelectorAll<HTMLElement>('.library').forEach((library) => {
            const rowsOfCards = new Map<number, number[]>();
            Array.from(library.querySelectorAll<HTMLElement>(':scope > .library__card')).forEach((card) => {
                const box = card.getBoundingClientRect();
                const top = Math.round(box.top);
                rowsOfCards.set(top, [...(rowsOfCards.get(top) ?? []), Math.round(box.height)]);
            });
            rowsOfCards.forEach((heights) => {
                if (new Set(heights).size > 1) {
                    problems.push(`${label}: the cards of a row of the library have different heights (${heights.join(', ')})`);
                }
            });
        });
        return problems;
    }, where);
}

MATRICES.forEach((matrix) => {
    test(`nothing is cut, misaligned or out of its box on any screen ${matrix.tag}`, async () => {
        const work = mkdtempSync(join(tmpdir(), 'pullwave-audit-'));
        const userData = join(work, 'user-data');
        mkdirSync(userData, { recursive: true });
        writeFileSync(
            join(userData, 'settings.json'),
            JSON.stringify({ language: 'en', checkUpdatesOnStart: false, verifyLiveEnd: false, ytdlpPath: FAKE_YTDLP, downloadDir: join(work, 'd'), animeDownloadDir: join(work, 'anime'), animeQuality: '720p' })
        );
        const app = await electron.launch({
            executablePath: ELECTRON_PATH,
            args: [ROOT, '--no-sandbox', `--user-data-dir=${userData}`],
            env: { ...process.env, ...installedProgramsEnv(work), PULLWAVE_ANI_CLI: FAKE_ANI_CLI, PULLWAVE_ANILIST_URL: 'http://127.0.0.1:9/graphql', PULLWAVE_COVER_FALLBACK_URL: 'http://127.0.0.1:9', FAKE_YTDLP_LOG: join(work, 'y.log') }
        });
        const page = await app.firstWindow();
        const resize = async (w: number, h: number): Promise<void> => {
            await app.evaluate(({ BrowserWindow, screen }, [width, height]) => {
                const display = screen.getPrimaryDisplay();
                BrowserWindow.getAllWindows()[0]?.setBounds({ x: display.workArea.x, y: display.workArea.y, width: width as number, height: height as number });
            }, [w, h]);
            await page.waitForTimeout(350);
        };
        await page.waitForSelector('.logo');
        await expect(page.getByText('// BOOTING SYSTEMS…')).toBeHidden({ timeout: 60000 });
        await leaveHome(page);
        const report: string[] = [];
        const sweep = async (screenName: string): Promise<void> => {
            for (const [w, h] of matrix.sizes) {
                await resize(w, h);
                for (const theme of matrix.themes) {
                    await showTheme(page, theme);
                    report.push(...(await audit(page, `${screenName} ${theme} ${w}x${h}`)));
                }
            }
        };

        await resize(1366, 768);
        for (const [index, url] of ['https://example.com/ok1', 'https://example.com/ok2', 'https://example.com/ok3'].entries()) {
            if (index > 0) {
                await page.getByRole('button', { name: '+ ADD LINK' }).click();
            }
            await page.getByLabel(`Link ${index + 1}`, { exact: true }).fill(url);
        }
        await page.getByRole('button', { name: 'DOWNLOAD', exact: true }).click();
        await expect(page.locator('.toast--info').first()).toBeVisible({ timeout: 20000 });
        await sweep('downloads');
        await page.getByRole('button', { name: 'HISTORY', exact: true }).click();
        await sweep('history');
        await page.getByRole('button', { name: 'SETTINGS', exact: true }).click();
        await sweep('downloads-settings');
        await page.getByRole('button', { name: 'SETTINGS (GLOBAL)', exact: true }).click();
        await sweep('global-settings');

        await resize(1366, 768);
        await page.getByRole('button', { name: 'ANIME', exact: true }).click();
        await sweep('anime-schedule');
        await page.getByRole('navigation', { name: 'Anime' }).getByRole('button', { name: 'SEARCH', exact: true }).click();
        await sweep('anime-search-empty');
        await page.getByLabel('Anime name').fill('fake');
        await page.getByLabel('Anime name').press('Enter');
        await expect(page.getByRole('button', { name: 'OPEN: Fake Anime', exact: true })).toBeVisible();
        await sweep('anime-results');
        await page.getByRole('button', { name: 'OPEN: Fake Anime', exact: true }).click();
        await expect(page.getByRole('button', { name: 'EP 3', exact: true })).toBeVisible();
        await sweep('anime-detail');
        await page.getByRole('button', { name: 'ADD TO LIBRARY', exact: true }).click();
        await sweep('anime-add-dialog');
        await page.getByRole('button', { name: 'CONFIRM' }).click();
        await expect(page.getByRole('button', { name: 'VIEW IN LIBRARY', exact: true })).toBeVisible();
        await sweep('anime-detail-added');
        await page.getByRole('button', { name: 'VIEW IN LIBRARY', exact: true }).click();
        await expect(page.getByRole('button', { name: 'DOWNLOAD ALL: Fake Anime' })).toBeVisible();
        await sweep('library-series-not-downloaded');
        await page.getByRole('button', { name: 'DOWNLOAD ALL: Fake Anime' }).click();
        await expect(page.locator('.toast').filter({ hasText: 'Download complete: ' }).first()).toBeVisible({ timeout: 60000 });
        await sweep('toasts-stacked');
        await expect(page.getByRole('button', { name: 'DOWNLOADS (0)' })).toBeVisible({ timeout: 60000 });
        await page.getByRole('button', { name: /^DOWNLOADS \(\d+\)$/ }).click();
        await sweep('anime-downloads');
        await page.getByRole('button', { name: 'BACK' }).click();
        await page.getByRole('navigation', { name: 'Anime' }).getByRole('button', { name: 'SEARCH', exact: true }).click();
        await page.getByRole('button', { name: 'OPEN: Fake Anime 2', exact: true }).click();
        await page.getByRole('button', { name: 'ADD TO LIBRARY', exact: true }).click();
        await page.getByRole('textbox', { name: 'Series' }).fill('Fake Anime');
        await page.getByRole('spinbutton', { name: 'Order' }).fill('2');
        await page.getByRole('textbox', { name: 'Name shown' }).fill('A name that is rather long for the chip of a season');
        await page.getByRole('button', { name: 'CONFIRM' }).click();
        await page.getByRole('button', { name: 'VIEW IN LIBRARY', exact: true }).click();
        await page.getByRole('button', { name: 'SHOW EPISODES: Fake Anime 2', exact: true }).click();
        await page.getByRole('button', { name: 'DOWNLOAD: Fake Anime 2 EP 1', exact: true }).click();
        await expect(page.locator('.toast').filter({ hasText: 'Download complete: Fake Anime 2 · EP 1' })).toBeVisible({ timeout: 60000 });
        await page.evaluate(async () => {
            const api = (window as unknown as { api: { downloadAnime: (request: unknown) => Promise<unknown> } }).api;
            for (const title of ['Zeta On Its Own', 'Alpha On Its Own With A Title That Is Quite Long To See How It Is Cut']) {
                await api.downloadAnime({ title, query: 'fake', index: 1, audio: 'sub', episodes: ['1'] });
            }
            for (let order = 1; order <= 7; order++) {
                await api.downloadAnime({ title: `Long Series ${order}`, query: 'fake', index: 1, audio: 'sub', episodes: ['1'], series: 'Long Series', season: order });
            }
        });
        await expect(page.getByRole('button', { name: 'DOWNLOADS (0)' })).toBeVisible({ timeout: 60000 });
        await page.getByRole('button', { name: 'HISTORY', exact: true }).click();
        await sweep('anime-history');
        await page.getByRole('button', { name: 'SETTINGS', exact: true }).click();
        await sweep('anime-settings');
        await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
        await sweep('library-cards');
        await page.getByRole('button', { name: 'OPEN SERIES: Long Series' }).click();
        await sweep('library-series-screen');
        await page.getByTestId('anime-season').first().getByRole('button', { name: 'SHOW EPISODES' }).click();
        await page.getByRole('button', { name: /^EDIT SEASON/ }).first().click();
        await sweep('library-season-screen-edit');
        await page.getByRole('button', { name: 'BACK', exact: true }).click();
        await page.getByRole('button', { name: 'BACK TO LIBRARY', exact: true }).click();
        await page.getByRole('button', { name: 'OPEN SERIES: Zeta On Its Own' }).click();
        await sweep('library-anime-screen');
        await page.getByRole('button', { name: 'SHOW EPISODES: Zeta On Its Own', exact: true }).click();
        await sweep('library-season-screen');
        await page.getByRole('button', { name: /^PLAY/ }).first().click();
        await sweep('player');
        await app.close();
        expect(report).toEqual([]);
    });
});

test('puts the search of the top bar in the middle of the window when there is room, and never over the start or the end of the bar', async () => {
    const work = mkdtempSync(join(tmpdir(), 'pullwave-search-'));
    const userData = join(work, 'user-data');
    mkdirSync(userData, { recursive: true });
    writeFileSync(join(userData, 'settings.json'), JSON.stringify({ language: 'en', checkUpdatesOnStart: false, verifyLiveEnd: false, ytdlpPath: FAKE_YTDLP, downloadDir: join(work, 'd') }));
    const app = await electron.launch({
        executablePath: ELECTRON_PATH,
        args: [ROOT, '--no-sandbox', `--user-data-dir=${userData}`],
        env: { ...process.env, ...installedProgramsEnv(work), PULLWAVE_ANI_CLI: FAKE_ANI_CLI, PULLWAVE_ANILIST_URL: 'http://127.0.0.1:9/graphql', PULLWAVE_COVER_FALLBACK_URL: 'http://127.0.0.1:9', FAKE_YTDLP_LOG: join(work, 'y.log') }
    });
    try {
        const page = await app.firstWindow();
        await page.waitForSelector('.logo');
        await expect(page.getByText('// BOOTING SYSTEMS…')).toBeHidden({ timeout: 60000 });
        const resize = async (width: number, height: number): Promise<void> => {
            await app.evaluate(({ BrowserWindow, screen }, [w, h]) => {
                const display = screen.getPrimaryDisplay();
                BrowserWindow.getAllWindows()[0]?.setBounds({ x: display.workArea.x, y: display.workArea.y, width: w as number, height: h as number });
            }, [width, height]);
            await page.waitForTimeout(350);
        };
        const boxes = async () => {
            return page.evaluate(() => {
                const box = (selector: string) => {
                    const rect = document.querySelector(selector)!.getBoundingClientRect();
                    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
                };
                return { window: window.innerWidth, start: box('.topbar__start'), search: box('.global-search'), end: box('.topbar__end') };
            });
        };

        await resize(1920, 1050);
        const wide = await boxes();
        expect(Math.abs((wide.search.left + wide.search.right) / 2 - wide.window / 2)).toBeLessThanOrEqual(2);
        expect(wide.search.right - wide.search.left).toBeCloseTo(560, 0);
        expect(wide.search.left).toBeGreaterThanOrEqual(wide.start.right);
        expect(wide.search.right).toBeLessThanOrEqual(wide.end.left);

        await resize(1366, 768);
        const medium = await boxes();
        expect(medium.search.left).toBeGreaterThanOrEqual(medium.start.right);
        expect(medium.search.right).toBeLessThanOrEqual(medium.end.left);
        expect(medium.search.top).toBeLessThan(medium.start.bottom);

        for (const [width, height] of [[1080, 1850], [1024, 768], [1000, 768]]) {
            await resize(width as number, height as number);
            const oneLine = await boxes();
            expect(oneLine.search.left, `${String(width)}: the search is not over the start`).toBeGreaterThanOrEqual(oneLine.start.right);
            expect(oneLine.search.right, `${String(width)}: the search is not over the end`).toBeLessThanOrEqual(oneLine.end.left);
            expect(oneLine.search.top, `${String(width)}: the search is on the line of the name`).toBeLessThan(oneLine.start.bottom);
            expect(oneLine.search.right - oneLine.search.left, `${String(width)}: the search keeps its least width`).toBeGreaterThanOrEqual(160);
            expect(oneLine.end.right, `${String(width)}: the bar is inside the window`).toBeLessThanOrEqual(oneLine.window);
        }

        await resize(999, 768);
        const narrow = await boxes();
        expect(narrow.search.top).toBeGreaterThanOrEqual(narrow.start.bottom);
        expect(narrow.search.top).toBeGreaterThanOrEqual(narrow.end.bottom);
    } finally {
        await app.close();
    }
});
