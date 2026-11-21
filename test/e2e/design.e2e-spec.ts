import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import './display';
import { leaveHome } from './startScreen';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installedProgramsEnv } from './programs';
import { THEME_STYLES, THEMES } from '../../src/shared/constants';
import { themeScheme } from '../../src/shared/themeChoice';
import { showTheme } from './showTheme';
import type { ThemeName } from '../../src/shared/types';

const ROOT = resolve(__dirname, '../..');
const ELECTRON_PATH = createRequire(__filename)('electron') as unknown as string;
const FAKE_ANI_CLI = resolve(__dirname, 'fixtures/fake-ani-cli.sh');
const FAKE_YTDLP = resolve(__dirname, 'fixtures/fake-yt-dlp.js');
const SIZES: Array<[number, number]> = [[480, 800], [1024, 768], [1080, 1850], [1366, 768], [1920, 1050], [3440, 1400]];
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
const MIN_CONTRAST = 3;
const LONG_TITLE = 'A video with a title long enough to need more than one line on a narrow window, to see how it wraps or is cut';

test.setTimeout(600000);

interface Session {
    app: ElectronApplication;
    page: Page;
    work: string;
}

async function launch(): Promise<Session> {
    const work = mkdtempSync(join(tmpdir(), 'pullwave-design-'));
    const userData = join(work, 'user-data');
    mkdirSync(userData, { recursive: true });
    writeFileSync(
        join(userData, 'settings.json'),
        JSON.stringify({ language: 'en', checkUpdatesOnStart: false, verifyLiveEnd: false, ytdlpPath: FAKE_YTDLP, downloadDir: join(work, 'd'), animeDownloadDir: join(work, 'anime') })
    );
    writeFileSync(
        join(userData, 'history.json'),
        JSON.stringify([
            { id: 'a', url: 'https://x/1', title: LONG_TITLE, filePath: join(work, 'a.mp4'), status: 'done', errorTitle: null, finishedAt: 1700000000000 },
            { id: 'b', url: 'https://x/2', title: 'Short', filePath: null, status: 'error', errorTitle: 'Video unavailable', finishedAt: 1700000000000 },
            { id: 'c', url: 'https://x/3', title: 'Third', filePath: join(work, 'c.mp4'), status: 'done', errorTitle: null, finishedAt: 1700000000000 }
        ])
    );
    const app = await electron.launch({
        executablePath: ELECTRON_PATH,
        args: [ROOT, '--no-sandbox', `--user-data-dir=${userData}`],
        env: { ...process.env, ...installedProgramsEnv(work), PULLWAVE_ANI_CLI: FAKE_ANI_CLI, PULLWAVE_ANILIST_URL: 'http://127.0.0.1:9/graphql', PULLWAVE_COVER_FALLBACK_URL: 'http://127.0.0.1:9', FAKE_YTDLP_LOG: join(work, 'y.log') }
    });
    const page = await app.firstWindow();
    await page.waitForSelector('.logo');
    await expect(page.getByText('// BOOTING SYSTEMS…')).toBeHidden({ timeout: 60000 });
    return { app, page, work };
}

async function resize(session: Session, width: number, height: number): Promise<void> {
    await session.app.evaluate(({ BrowserWindow, screen }, [w, h]) => {
        const display = screen.getPrimaryDisplay();
        BrowserWindow.getAllWindows()[0]?.setBounds({ x: display.workArea.x, y: display.workArea.y, width: w as number, height: h as number });
    }, [width, height]);
    await session.page.waitForTimeout(350);
}

function expectedAurora(theme: ThemeName): string {
    if (['amoled', 'amoled-light', 'high-contrast', 'high-contrast-light'].includes(theme)) {
        return '0';
    }
    if (themeScheme(theme) === 'light') {
        return '0.35';
    }
    return THEME_STYLES[theme] === 'neon' ? '0.8' : '0.55';
}

async function geometry(page: Page, label: string): Promise<string[]> {
    return page.evaluate((where) => {
        const problems: string[] = [];
        const name = (element: Element): string => {
            const text = (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 24);
            return `${element.tagName.toLowerCase()}.${(element.getAttribute('class') ?? '').split(' ')[0]}[${text}]`;
        };
        const width = window.innerWidth;
        if (document.documentElement.scrollWidth > width + 1) {
            problems.push(`${where}: the page scrolls sideways (${document.documentElement.scrollWidth} > ${width})`);
        }
        const visible = Array.from(document.querySelectorAll<HTMLElement>('.app *')).filter((element) => {
            const box = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && !element.closest('.toast');
        });
        visible.forEach((element) => {
            const box = element.getBoundingClientRect();
            if (box.right > width + 1 || box.left < -1) {
                problems.push(`${where}: ${name(element)} is outside the window (${Math.round(box.left)}..${Math.round(box.right)} of ${width})`);
            }
            const parent = element.parentElement;
            if (parent && parent.closest('.app')) {
                const holder = parent.getBoundingClientRect();
                const position = getComputedStyle(element).position;
                if (getComputedStyle(parent).overflowX === 'visible' && box.right > holder.right + 2 && position !== 'absolute' && position !== 'fixed' && !element.classList.contains('logo')) {
                    problems.push(`${where}: ${name(element)} goes past its box ${name(parent)} by ${Math.round(box.right - holder.right)}px`);
                }
            }
        });
        visible
            .filter((element) => {
                return element.matches('button, .badge, .chip, .tab, label, .field__label, .section-label, .topbar__clock, .tab__label');
            })
            .forEach((element) => {
                if (getComputedStyle(element).clipPath === 'inset(50%)') {
                    return;
                }
                if (element.scrollWidth > element.clientWidth + 1 && getComputedStyle(element).overflowX !== 'visible') {
                    problems.push(`${where}: the text of ${name(element)} is cut`);
                }
            });
        const rows = new Map<Element, HTMLElement[]>();
        visible
            .filter((element) => {
                return element.matches('.btn');
            })
            .forEach((element) => {
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
                    problems.push(`${where}: the buttons of ${name(holder)} on one line have different heights (${heights.join(', ')})`);
                }
            });
        });
        return problems;
    }, label);
}

async function alignment(page: Page, label: string): Promise<string[]> {
    return page.evaluate((where) => {
        const problems: string[] = [];
        const box = (selector: string): DOMRect | null => {
            const element = document.querySelector<HTMLElement>(selector);
            if (element === null || getComputedStyle(element).display === 'none') {
                return null;
            }
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 ? rect : null;
        };
        const overlap = (a: DOMRect, b: DOMRect): boolean => {
            return a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
        };
        const header = box('.app__header');
        const brand = box('.app__header .brand');
        const end = box('.app__header .topbar__end');
        const clock = box('.topbar__clock');
        if (header === null || brand === null || end === null || clock === null) {
            problems.push(`${where}: the top bar is missing a part`);
            return problems;
        }
        if (overlap(brand, end)) {
            problems.push(`${where}: the name of the app and the clock overlap`);
        }
        const sameLine = Math.abs(brand.top - end.top) < brand.height;
        if (sameLine && Math.abs(brand.top + brand.height / 2 - (clock.top + clock.height / 2)) > 6) {
            problems.push(`${where}: the clock is not centred on the line of the name (${Math.round(brand.top + brand.height / 2)} vs ${Math.round(clock.top + clock.height / 2)})`);
        }
        if (clock.right > header.right + 1) {
            problems.push(`${where}: the clock goes past the top bar`);
        }
        document.querySelectorAll<HTMLElement>('.binary-status .chip').forEach((chip) => {
            if (overlap(chip.getBoundingClientRect(), clock)) {
                problems.push(`${where}: a chip of the programs overlaps the clock`);
            }
        });
        const rail = document.querySelector<HTMLElement>('.sidenav');
        if (rail === null) {
            problems.push(`${where}: the menu of the sections is missing`);
            return problems;
        }
        const docked = getComputedStyle(rail).flexDirection === 'row';
        const tabs = Array.from(rail.querySelectorAll<HTMLElement>(':scope > .tab')).map((tab) => {
            return tab.getBoundingClientRect();
        });
        const lined = new Set(
            tabs.map((tab) => {
                return Math.round(docked ? tab.top : tab.left);
            })
        );
        if (lined.size > 1) {
            problems.push(`${where}: the sections are not on one ${docked ? 'row' : 'column'} (${[...lined].join(', ')})`);
        }
        tabs.forEach((tab, index) => {
            const next = tabs[index + 1];
            if (next !== undefined && overlap(tab, next)) {
                problems.push(`${where}: section ${index + 1} overlaps the next one`);
            }
            if (tab.bottom > window.innerHeight + 1) {
                problems.push(`${where}: section ${index + 1} is below the bottom of the window`);
            }
        });
        const active = rail.querySelector<HTMLElement>(':scope > .tab--active');
        if (active !== null) {
            const tab = active.getBoundingClientRect();
            const mark = getComputedStyle(active, '::before');
            const start = parseFloat(docked ? mark.left : mark.top);
            const end = parseFloat(docked ? mark.right : mark.bottom);
            if (start < 0 || end < 0 || start + end >= (docked ? tab.width : tab.height)) {
                problems.push(`${where}: the mark of the active section does not fit beside it`);
            }
        }
        const main = document.querySelector<HTMLElement>('.app__main')?.getBoundingClientRect();
        if (main !== undefined && overlap(rail.getBoundingClientRect(), main) && !rail.classList.contains('sidenav--open')) {
            problems.push(`${where}: the menu of the sections overlaps the page`);
        }
        document.querySelectorAll<HTMLElement>('.cover-grid, .history > .history__list').forEach((grid) => {
            if (getComputedStyle(grid).display !== 'grid') {
                return;
            }
            const widths = new Set(
                Array.from(grid.children).map((card) => {
                    return Math.round(card.getBoundingClientRect().width);
                })
            );
            if (widths.size > 1) {
                problems.push(`${where}: the tiles of a grid have different widths (${[...widths].join(', ')})`);
            }
        });
        return problems;
    }, label);
}

async function legibility(page: Page, label: string, minimum: number): Promise<string[]> {
    return page.evaluate(
        ([where, least]) => {
            const problems: string[] = [];
            const probe = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
            const parse = (value: string): [number, number, number, number] => {
                probe.clearRect(0, 0, 1, 1);
                probe.fillStyle = '#000';
                probe.fillStyle = value;
                probe.fillRect(0, 0, 1, 1);
                const [r, g, b, a] = Array.from(probe.getImageData(0, 0, 1, 1).data);
                return [(r ?? 0) / 255, (g ?? 0) / 255, (b ?? 0) / 255, (a ?? 0) / 255];
            };
            const luminance = ([r, g, b]: [number, number, number, number]): number => {
                const channel = (value: number): number => {
                    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
                };
                return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
            };
            const backgroundOf = (element: HTMLElement): [number, number, number, number] | null => {
                let current: HTMLElement | null = element;
                while (current !== null) {
                    const style = getComputedStyle(current);
                    if (style.backgroundImage !== 'none') {
                        return null;
                    }
                    const colour = parse(style.backgroundColor);
                    if (colour[3] > 0.95) {
                        return colour;
                    }
                    current = current.parentElement;
                }
                return parse(getComputedStyle(document.body).backgroundColor);
            };
            const elements = Array.from(document.querySelectorAll<HTMLElement>('.app .tab, .app .btn, .app .section-label, .app .field__label, .app .topbar__clock, .app .history__title, .app .badge, .app .empty'));
            elements.forEach((element) => {
                const rect = element.getBoundingClientRect();
                const style = getComputedStyle(element);
                if (rect.width === 0 || rect.height === 0 || style.visibility === 'hidden' || (element.textContent ?? '').trim() === '' || (element as HTMLButtonElement).disabled === true) {
                    return;
                }
                const text = parse(style.color);
                const behind = backgroundOf(element);
                if (behind === null || text[3] < 0.5) {
                    return;
                }
                const [lighter, darker] = [luminance(text), luminance(behind)].sort((a, b) => {
                    return b - a;
                });
                const ratio = ((lighter as number) + 0.05) / ((darker as number) + 0.05);
                if (ratio < least) {
                    problems.push(`${where}: ${element.tagName.toLowerCase()}.${(element.getAttribute('class') ?? '').split(' ')[0]}[${(element.textContent ?? '').trim().slice(0, 20)}] has a contrast of ${ratio.toFixed(2)}`);
                }
            });
            return problems;
        },
        [label, minimum] as const
    );
}

const FREEZE_STYLE_ID = 'design-audit-freeze';

async function freezeMotion(page: Page, frozen: boolean): Promise<void> {
    await page.evaluate(
        ([id, on]) => {
            document.getElementById(id as string)?.remove();
            if (on) {
                const style = document.createElement('style');
                style.id = id as string;
                style.textContent = '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; animation-iteration-count: 1 !important; transition: none !important; }';
                document.head.appendChild(style);
            }
        },
        [FREEZE_STYLE_ID, frozen] as const
    );
}

async function audit(session: Session, screenName: string, report: string[], matrix: AuditMatrix): Promise<void> {
    await freezeMotion(session.page, true);
    for (const [width, height] of matrix.sizes) {
        await resize(session, width, height);
        for (const theme of matrix.themes) {
            await showTheme(session.page, theme);
            const where = `${screenName} ${theme} ${width}x${height}`;
            report.push(...(await geometry(session.page, where)), ...(await alignment(session.page, where)), ...(await legibility(session.page, where, MIN_CONTRAST)));
        }
    }
    await freezeMotion(session.page, false);
}

let session: Session;

test.beforeEach(async () => {
    session = await launch();
});

test.afterEach(async () => {
    await session.app.close();
    rmSync(session.work, { recursive: true, force: true });
});

MATRICES.forEach((matrix) => {
    test(`the home screen and the open menu look right ${matrix.tag}`, async () => {
        const { page } = session;
        const report: string[] = [];
        await expect(page.getByRole('region', { name: 'Home' })).toBeVisible();
        await audit(session, 'home', report, matrix);
        await resize(session, 1366, 768);
        await page.getByRole('button', { name: 'Open the menu' }).click();
        await expect(page.locator('.sidenav--open')).toBeVisible();
        await audit(session, 'menu-open', report, matrix);
        await page.keyboard.press('Escape');
        await page.getByRole('combobox', { name: 'Search' }).fill('fake');
        await expect(page.getByRole('listbox', { name: 'Search' })).toBeVisible();
        await audit(session, 'search-open', report, matrix);
        expect(report).toEqual([]);
    });
});

MATRICES.forEach((matrix) => {
    test(`every screen of the video downloader looks right: geometry, alignment and legibility ${matrix.tag}`, async () => {
        const { page } = session;
        const report: string[] = [];
        await leaveHome(page);
        const downloads = page.getByRole('navigation', { name: 'Video downloader' });

        await page.getByLabel('Link 1', { exact: true }).fill('https://example.com/a');
        await page.getByRole('button', { name: '+ ADD LINK' }).click();
        await page.getByLabel('Link 2', { exact: true }).fill('not a link');
        await audit(session, 'queue-with-links', report, matrix);

        await downloads.getByRole('button', { name: 'HISTORY', exact: true }).click();
        await expect(page.getByText(LONG_TITLE)).toBeVisible();
        await audit(session, 'history', report, matrix);

        await downloads.getByRole('button', { name: 'TOOLS', exact: true }).click();
        await audit(session, 'tools-cut', report, matrix);
        await page.getByRole('tab', { name: 'CONVERT' }).click();
        await audit(session, 'tools-convert', report, matrix);
        await page.getByRole('tab', { name: 'MERGE' }).click();
        await audit(session, 'tools-merge', report, matrix);

        await downloads.getByRole('button', { name: 'SETTINGS', exact: true }).click();
        await audit(session, 'downloads-settings', report, matrix);

        await page.getByRole('button', { name: 'SETTINGS (GLOBAL)', exact: true }).click();
        await audit(session, 'global-settings', report, matrix);

        await page.getByRole('button', { name: 'VIDEO DOWNLOADER', exact: true }).click();
        await downloads.getByRole('button', { name: 'QUEUE', exact: true }).click();
        await page.getByRole('button', { name: 'OPTIONS' }).first().click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await audit(session, 'options-window', report, matrix);

        expect(report).toEqual([]);
    });
});

MATRICES.forEach((matrix) => {
    test(`every screen of the anime section looks right ${matrix.tag}`, async () => {
        const { page } = session;
        const report: string[] = [];
        const anime = page.getByRole('navigation', { name: 'Anime' });
        await page.getByRole('button', { name: 'ANIME', exact: true }).click();
        await audit(session, 'anime-schedule', report, matrix);

        await resize(session, 1366, 768);
        await anime.getByRole('button', { name: 'SEARCH', exact: true }).click();
        await page.getByLabel('Anime name').fill('fake');
        await page.getByLabel('Anime name').press('Enter');
        await expect(page.getByRole('button', { name: 'OPEN: Fake Anime', exact: true })).toBeVisible();
        await audit(session, 'anime-results', report, matrix);

        await page.getByRole('button', { name: 'OPEN: Fake Anime', exact: true }).click();
        await expect(page.getByRole('button', { name: 'EP 3', exact: true })).toBeVisible();
        await audit(session, 'anime-detail', report, matrix);

        await resize(session, 1366, 768);
        await anime.getByRole('button', { name: 'LIBRARY', exact: true }).click();
        await audit(session, 'anime-library', report, matrix);

        await page.evaluate(async () => {
            const api = (window as unknown as { api: { downloadAnime: (request: unknown) => Promise<unknown> } }).api;
            await api.downloadAnime({ title: 'Fake Anime', query: 'fake', index: 1, audio: 'sub', episodes: ['1'] });
            for (let order = 1; order <= 3; order++) {
                await api.downloadAnime({ title: `Long Series ${String(order)}`, query: 'fake', index: 1, audio: 'sub', episodes: ['1'], series: 'Long Series', season: order });
            }
        });
        await expect(page.getByRole('button', { name: 'DOWNLOADS (0)' })).toBeVisible({ timeout: 60000 });
        await expect(page.getByRole('button', { name: /^ALL \(\d+\)$/ })).toBeVisible();
        await audit(session, 'anime-library-grid', report, matrix);
        await page.getByRole('button', { name: /^NEW \(\d+\)$/ }).click();
        await audit(session, 'anime-library-news', report, matrix);
        await page.getByRole('button', { name: /^ALL \(\d+\)$/ }).click();

        await page.evaluate(async () => {
            const api = (window as unknown as { api: { recordAnimeHistory: (request: unknown) => Promise<unknown> } }).api;
            await api.recordAnimeHistory({ title: 'Fake Anime', query: 'fake', index: 1, audio: 'sub', episode: '1' });
        });
        await page.reload();
        await expect(page.getByRole('region', { name: 'Highlights' })).toBeVisible({ timeout: 60000 });
        await audit(session, 'home-highlights', report, matrix);
        await resize(session, 1366, 768);
        await page.getByRole('button', { name: 'ANIME', exact: true }).click();
        await anime.getByRole('button', { name: 'LIBRARY', exact: true }).click();
        await expect(page.getByRole('region', { name: 'Highlights of the library' })).toBeVisible();
        await audit(session, 'anime-library-highlights', report, matrix);
        await page.getByRole('combobox', { name: 'Sort by' }).selectOption('az');
        await page.getByRole('button', { name: 'OPEN SERIES: Long Series', exact: true }).click();
        await expect(page.getByTestId('series-view')).toBeVisible();
        await audit(session, 'anime-series-hero', report, matrix);

        expect(report).toEqual([]);
    });
});

test('the top bar has the name with its wave, the clock and the sections with their pictures', async () => {
    const { page } = session;
    await resize(session, 1366, 768);
    await expect(page.getByRole('heading', { level: 1, name: 'PULLWAVE' })).toBeVisible();
    await expect(page.locator('.brand__wave .brand__bar')).toHaveCount(5);
    const clock = page.locator('.topbar__clock');
    await expect(clock).toBeVisible();
    await expect(clock).toHaveText(/^\d{2}:\d{2}\s?(AM|PM)?$/);
    await expect(clock).toHaveAttribute('datetime', /^\d{2}:\d{2}$/);
    await expect(clock).toHaveAttribute('aria-label', /^Time: \d{2}:\d{2}\s?(AM|PM)?$/);
    const sections = page.getByRole('navigation', { name: 'Sections' });
    await expect(sections).toHaveClass('tabs tabs--main sidenav');
    expect(await sections.locator('.tab__decoration svg').count()).toBeGreaterThanOrEqual(3);
    await expect(sections.locator('.tab__label').first()).toHaveCSS('clip-path', 'inset(50%)');
    await expect(sections.getByRole('button', { name: 'VIDEO DOWNLOADER', exact: true })).toHaveText('VIDEO DOWNLOADER');
    await expect(sections.getByRole('button', { name: 'ANIME', exact: true })).toHaveText('ANIME');
    await resize(session, 480, 800);
    await expect(sections).toHaveCSS('flex-direction', 'row');
    await expect(page.getByRole('button', { name: 'Open the menu' })).toBeHidden();
    await expect(page.locator('.brand__wave')).toBeHidden();
    await expect(clock).toBeVisible();
});

test('the arrow keys move the focus along the menu and into the screen, and the focus is seen', async () => {
    const { page } = session;
    await resize(session, 1366, 768);
    await leaveHome(page);
    const sections = page.getByRole('navigation', { name: 'Sections' });
    const downloadsTab = sections.getByRole('button', { name: 'VIDEO DOWNLOADER', exact: true });
    await downloadsTab.focus();
    await page.keyboard.press('ArrowDown');
    await expect(sections.getByRole('button', { name: 'ANIME', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(downloadsTab).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(sections.getByRole('button', { name: 'HOME', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    const ring = await downloadsTab.evaluate((element) => {
        const style = getComputedStyle(element);
        return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineOffset: style.outlineOffset };
    });
    expect(ring).toEqual({ outlineStyle: 'solid', outlineWidth: '3px', outlineOffset: '3px' });
    await page.keyboard.press('ArrowRight');
    const focused = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement;
        return { inNavigation: active.closest('.sidenav') !== null, inPage: active.closest('.app__main') !== null, tag: active.tagName };
    });
    expect(focused).toEqual({ inNavigation: false, inPage: true, tag: 'BUTTON' });
    const link = page.getByLabel('Link 1', { exact: true });
    await link.fill('https://example.com/abc');
    await link.press('ArrowLeft');
    await expect(link).toBeFocused();
    expect(await link.evaluate((input) => {
        return (input as HTMLInputElement).selectionStart;
    })).toBe('https://example.com/abc'.length - 1);
});

test('the animations run, also when the system asks for less motion (D-130)', async () => {
    const { page } = session;
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const moving = await page.evaluate(() => {
        return {
            aurora: getComputedStyle(document.body, '::before').animationName,
            wave: getComputedStyle(document.querySelector('.brand__bar') as Element).animationName,
            primary: getComputedStyle(document.querySelector('.btn--primary') as Element, '::after').animationName
        };
    });
    expect(moving).toEqual({ aurora: 'bp-aurora-drift', wave: 'bp-wave-idle', primary: 'bp-sheen' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const still = await page.evaluate(() => {
        return {
            aurora: getComputedStyle(document.body, '::before').animationName,
            wave: getComputedStyle(document.querySelector('.brand__bar') as Element).animationName,
            primary: getComputedStyle(document.querySelector('.btn--primary') as Element, '::after').animationName
        };
    });
    expect(still).toEqual({ aurora: 'bp-aurora-drift', wave: 'bp-wave-idle', primary: 'bp-sheen' });
});

test('every theme keeps its own colours under the layer: background, accent of the active section and style', async () => {
    const { page } = session;
    const expected: Record<ThemeName, string> = {
        cyberpunk: 'rgb(7, 6, 15)',
        synthwave: 'rgb(18, 12, 42)',
        terminal: 'rgb(2, 10, 4)',
        'neon-tokyo': 'rgb(7, 11, 31)',
        'acid-rain': 'rgb(3, 10, 8)',
        'amber-city': 'rgb(13, 8, 5)',
        'ultraviolet': 'rgb(10, 5, 24)',
        'pink-noir': 'rgb(5, 5, 5)',
        'cyber-gold': 'rgb(8, 6, 0)',
        'ice-neon': 'rgb(2, 17, 26)',
        'neon-tokyo-light': 'rgb(243, 240, 251)',
        dark: 'rgb(22, 24, 29)',
        'tokyo-night': 'rgb(26, 27, 38)',
        nord: 'rgb(46, 52, 64)',
        dracula: 'rgb(40, 42, 54)',
        gruvbox: 'rgb(40, 40, 40)',
        amoled: 'rgb(0, 0, 0)',
        'high-contrast': 'rgb(0, 0, 0)',
        light: 'rgb(243, 244, 247)',
        sakura: 'rgb(253, 246, 248)',
        'sakura-dark': 'rgb(28, 19, 25)',
        'cyberpunk-light': 'rgb(238, 248, 251)',
        'synthwave-light': 'rgb(251, 242, 250)',
        'terminal-light': 'rgb(240, 246, 236)',
        'acid-rain-light': 'rgb(241, 248, 234)',
        'amber-city-light': 'rgb(251, 244, 236)',
        'ultraviolet-light': 'rgb(245, 240, 253)',
        'pink-noir-light': 'rgb(250, 247, 248)',
        'cyber-gold-light': 'rgb(251, 248, 233)',
        'ice-neon-light': 'rgb(238, 247, 251)',
        'tokyo-night-light': 'rgb(225, 226, 231)',
        'nord-light': 'rgb(236, 239, 244)',
        'dracula-light': 'rgb(255, 251, 235)',
        'gruvbox-light': 'rgb(251, 241, 199)',
        'amoled-light': 'rgb(255, 255, 255)',
        'high-contrast-light': 'rgb(255, 255, 255)'
    };
    for (const theme of THEMES) {
        await showTheme(page, theme);
        const look = await page.evaluate(() => {
            const active = document.querySelector('.sidenav .tab--active') as Element;
            return {
                background: getComputedStyle(document.body).backgroundColor,
                barImage: getComputedStyle(active, '::before').backgroundImage,
                aurora: getComputedStyle(document.body, '::before').opacity
            };
        });
        expect(look.background, theme).toBe(expected[theme]);
        expect(look.barImage, theme).toContain('linear-gradient');
        expect(look.aurora, theme).toBe(expectedAurora(theme));
    }
});
