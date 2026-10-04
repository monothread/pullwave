import { expect, test, _electron as electron, type Page } from '@playwright/test';
import './display';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const ELECTRON_PATH = createRequire(__filename)('electron') as unknown as string;
const FAKE_ANI_CLI = resolve(__dirname, 'fixtures/fake-ani-cli.sh');
const FAKE_YTDLP = resolve(__dirname, 'fixtures/fake-yt-dlp.js');
// The sizes of the windows on screens of 1366x768 up to 1920x1080 (the taskbar takes some of the height), and
// narrow ones.
const SIZES: Array<[number, number]> = [[480, 800], [600, 800], [768, 1000], [1024, 768], [1366, 768], [1920, 1050]];
// Every theme: the font of the neon ones is wider than the others and their boxes are cut differently.
const THEMES = ['cyberpunk', 'synthwave', 'terminal', 'dark', 'tokyo-night', 'nord', 'dracula', 'gruvbox', 'amoled', 'high-contrast', 'light', 'sakura'];
test.setTimeout(600000);

// Everything that looks wrong from the geometry alone: the page scrolling sideways, boxes that go past the window or past the box
// that holds them, text that is cut, buttons on one line that are not the same height and the cards of a grid that are not the same
// width. It resizes the real window of the application (on the primary monitor, see createWindow) instead of emulating a size.
async function audit(page: Page, where: string): Promise<string[]> {
    return page.evaluate((label) => {
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
            const parent = element.parentElement;
            if (parent && parent !== document.body && parent.closest('.app')) {
                const holder = parent.getBoundingClientRect();
                const style = getComputedStyle(parent);
                if (style.overflowX === 'visible' && box.right > holder.right + 2 && getComputedStyle(element).position !== 'absolute' && getComputedStyle(element).position !== 'fixed' && !element.classList.contains('logo')) {
                    problems.push(`${label}: ${name(element)} goes past its box ${name(parent)} by ${Math.round(box.right - holder.right)}px`);
                }
            }
        });
        // Text that is cut where it should have wrapped (a button or a label whose words do not fit).
        visible.filter((element) => {
            return element.matches('button, .badge, .chip, .tab, label, .field__label, .section-label');
        }).forEach((element) => {
            if (element.scrollWidth > element.clientWidth + 1 && getComputedStyle(element).overflowX !== 'visible') {
                problems.push(`${label}: the text of ${name(element)} is cut`);
            }
        });
        // Buttons side by side on one line must be the same height.
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
        // Cards of a grid row share a width.
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
        // The cards of the library that are on one row are the same height, whatever is in them.
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

test('nothing is cut, misaligned or out of its box on any screen, at any size from 480 to 1920 pixels', async () => {
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
        env: { ...process.env, PULLWAVE_ANI_CLI: FAKE_ANI_CLI, PULLWAVE_ANILIST_URL: 'http://127.0.0.1:9/graphql', FAKE_YTDLP_LOG: join(work, 'y.log') }
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
    const report: string[] = [];
    const sweep = async (screenName: string): Promise<void> => {
        for (const [w, h] of SIZES) {
            await resize(w, h);
            for (const theme of THEMES) {
                await page.evaluate((name) => {
                    document.documentElement.dataset.theme = name;
                }, theme);
                report.push(...(await audit(page, `${screenName} ${theme} ${w}x${h}`)));
            }
        }
    };

    // Downloads: some links, one finished (it says so in a notice and leaves the queue)
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

    // Anime
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
    // The anime goes to the library from here, and is downloaded from there.
    await page.getByRole('button', { name: 'ADD TO LIBRARY', exact: true }).click();
    await sweep('anime-add-dialog');
    await page.getByRole('button', { name: 'CONFIRM' }).click();
    await expect(page.getByRole('button', { name: 'VIEW IN LIBRARY', exact: true })).toBeVisible();
    await sweep('anime-detail-added');
    await page.getByRole('button', { name: 'VIEW IN LIBRARY', exact: true }).click();
    await expect(page.getByRole('button', { name: 'DOWNLOAD ALL: Fake Anime' })).toBeVisible();
    await sweep('library-series-not-downloaded');
    await page.getByRole('button', { name: 'DOWNLOAD ALL: Fake Anime' }).click();
    // A finished download leaves the downloads screen and is told by a toast, one over the other when more finish together.
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
    // More anime for the library: two on their own and a series with many seasons (its list scrolls).
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
    await sweep('library-series-screen-open');
    await page.getByRole('button', { name: 'BACK' }).click();
    await page.getByRole('button', { name: 'OPEN SERIES: Zeta On Its Own' }).click();
    await sweep('library-anime-screen');
    await page.getByRole('button', { name: 'SHOW EPISODES: Zeta On Its Own', exact: true }).click();
    await page.getByRole('button', { name: /^PLAY/ }).first().click();
    await sweep('player');
    await app.close();
    expect(report).toEqual([]);
});
