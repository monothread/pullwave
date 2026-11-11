import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import './display';
import { leaveHome } from './startScreen';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installedProgramsEnv } from './programs';

const ROOT = resolve(__dirname, '../..');

interface Session {
    app: ElectronApplication;
    page: Page;
    workDir: string;
}

interface PanelBox {
    legend: string;
    shownLegend: string;
    left: number;
    top: number;
    height: number;
}

// The settings of each section, and the blocks they have in their order (the disk space last, where it grows without moving the others).
const SECTIONS = [
    {
        name: 'downloads',
        button: 'VIDEO DOWNLOADER',
        nav: 'Video downloader',
        legends: ['OUTPUT', 'PLAYLISTS & SUBTITLES', 'Status of the programs', 'QUALITY & FORMAT', 'ADVANCED', 'LIVE STREAMS', 'BROWSER COOKIES', 'DIAGNOSTICS']
    },
    {
        name: 'anime',
        button: 'ANIME',
        nav: 'Anime',
        legends: ['FOLDER & LIBRARY', 'SUBTITLE TRANSLATION (LANGUAGE MODEL)', 'SUBTITLE CREATION (SPEECH TO TEXT)', 'Status of the programs', 'DOWNLOADS', 'NEW EPISODES', 'DIAGNOSTICS', 'DISK SPACE']
    },
    {
        name: 'manga',
        button: 'MANGA',
        nav: 'Manga',
        legends: ['FOLDER & FORMAT', 'NEW CHAPTERS', 'FlareSolverr (sites protected by Cloudflare)', 'SOURCES', 'Extension stores', 'Status of the programs', 'DIAGNOSTICS', 'DISK SPACE']
    }
];

// Two columns in a window of the default width, three on an ultrawide screen.
const SIZES = [
    { width: 1100, height: 900, columns: 2 },
    { width: 3440, height: 1400, columns: 3 }
];

let session: Session;

async function launch(): Promise<Session> {
    const workDir = mkdtempSync(join(tmpdir(), 'pullwave-settings-layout-'));
    const userData = join(workDir, 'user-data');
    mkdirSync(userData, { recursive: true });
    writeFileSync(
        join(userData, 'settings.json'),
        JSON.stringify({ language: 'en', checkUpdatesOnStart: false, downloadDir: join(workDir, 'downloads'), animeDownloadDir: join(workDir, 'anime'), mangaDirectory: join(workDir, 'manga') })
    );
    const app = await electron.launch({
        args: [ROOT, '--no-sandbox', `--user-data-dir=${userData}`],
        // The manga section is pointed at a server nobody answers: it downloads and starts nothing.
        env: { ...process.env, ...installedProgramsEnv(workDir), PULLWAVE_MANGA_URL: 'http://127.0.0.1:9', PULLWAVE_COVER_FALLBACK_URL: 'http://127.0.0.1:9' }
    });
    const page = await app.firstWindow();
    await page.waitForSelector('.logo');
    await leaveHome(page);
    return { app, page, workDir };
}

async function panelBoxes(page: Page): Promise<PanelBox[]> {
    return page.locator('.settings > .panel').evaluateAll((panels) => {
        return panels.map((panel) => {
            const rect = panel.getBoundingClientRect();
            const legend = panel.querySelector(':scope > legend');
            return {
                legend: legend?.textContent ?? '',
                shownLegend: legend instanceof HTMLElement ? legend.innerText : '',
                left: Math.round(rect.left),
                top: Math.round(rect.top + window.scrollY),
                height: Math.round(rect.height)
            };
        });
    });
}

// The boxes once they stopped moving: the disk space is measured after the screen opens, and every block ends an animation when it comes in.
async function settledBoxes(page: Page): Promise<PanelBox[]> {
    let previous = '';
    let boxes: PanelBox[] = [];
    await expect
        .poll(
            async () => {
                boxes = await panelBoxes(page);
                const current = JSON.stringify(boxes);
                const same = current === previous;
                previous = current;
                return same;
            },
            { timeout: 15000, intervals: [400] }
        )
        .toBe(true);
    return boxes;
}

function columnsOf(boxes: PanelBox[]): PanelBox[][] {
    const columns = new Map<number, PanelBox[]>();
    boxes.forEach((box) => {
        columns.set(box.left, [...(columns.get(box.left) ?? []), box]);
    });
    return [...columns.entries()]
        .sort(([first], [second]) => {
            return first - second;
        })
        .map(([, panels]) => {
            return panels;
        });
}

test.beforeEach(async () => {
    session = await launch();
});

test.afterEach(async () => {
    await session.app.close();
    rmSync(session.workDir, { recursive: true, force: true });
});

for (const size of SIZES) {
    for (const section of SECTIONS) {
        test(`the ${section.name} settings fill ${String(size.columns)} columns that start together and end close, in their order (${String(size.width)}x${String(size.height)})`, async () => {
            const { page } = session;
            await page.setViewportSize({ width: size.width, height: size.height });
            await page.getByRole('button', { name: section.button, exact: true }).click();
            await page.getByRole('navigation', { name: section.nav }).getByRole('button', { name: 'SETTINGS', exact: true }).click();
            await expect(page.locator('section.settings')).toBeVisible();
            const boxes = await settledBoxes(page);

            // Every block, in its order, each title shown in capitals.
            expect(
                boxes.map((box) => {
                    return box.legend;
                })
            ).toEqual(section.legends);
            expect(
                boxes.map((box) => {
                    return box.shownLegend;
                })
            ).toEqual(
                section.legends.map((legend) => {
                    return legend.toUpperCase();
                })
            );

            const columns = columnsOf(boxes);
            expect(columns).toHaveLength(size.columns);
            // The columns start at the same height and end no further apart than the tallest block.
            const tops = columns.map((panels) => {
                return Math.min(
                    ...panels.map((box) => {
                        return box.top;
                    })
                );
            });
            expect(new Set(tops).size).toBe(1);
            const bottoms = columns.map((panels) => {
                return Math.max(
                    ...panels.map((box) => {
                        return box.top + box.height;
                    })
                );
            });
            const tallest = Math.max(
                ...boxes.map((box) => {
                    return box.height;
                })
            );
            expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThan(tallest);
            // The disk space is the last block, at the end of the last column: nothing comes after it to move when it grows.
            if (section.legends.includes('DISK SPACE')) {
                const last = columns.at(-1) ?? [];
                expect(last.at(-1)?.legend).toBe('DISK SPACE');
            }
        });
    }
}
