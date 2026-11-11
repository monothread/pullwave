import { expect, test, _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import './display';
import { leaveHome } from './startScreen';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { LogLine } from '../../src/shared/logs';
import { installedProgramsEnv } from './programs';

const ROOT = resolve(__dirname, '../..');
const FAKE_YTDLP = resolve(__dirname, 'fixtures/fake-yt-dlp.js');
// The address of a download that fails, with a secret in it that the log must hide.
const FAILING_URL = 'https://example.com/fail?token=s3cr3t';
const EMPTY_TEXT = 'Nothing recorded yet. The lines show up here as soon as the program runs.';

interface Session {
    app: ElectronApplication;
    page: Page;
    workDir: string;
    userData: string;
    downloadDir: string;
    callsLog: string;
}

let session: Session;

async function launch(): Promise<Session> {
    const workDir = mkdtempSync(join(tmpdir(), 'pullwave-logs-e2e-'));
    const userData = join(workDir, 'user-data');
    const downloadDir = join(workDir, 'downloads');
    const callsLog = join(workDir, 'ytdlp-calls.log');
    writeFileSync(callsLog, '');
    mkdirSync(userData, { recursive: true });
    writeFileSync(join(userData, 'settings.json'), JSON.stringify({ language: 'en', checkUpdatesOnStart: false, verifyLiveEnd: false, ytdlpPath: FAKE_YTDLP, downloadDir }));
    const app = await electron.launch({
        args: [ROOT, '--no-sandbox', `--user-data-dir=${userData}`],
        // The manga section is pointed at a server nobody answers: it downloads and starts nothing (no Suwayomi, no FlareSolverr).
        env: { ...process.env, ...installedProgramsEnv(workDir), FAKE_YTDLP_LOG: callsLog, PULLWAVE_MANGA_URL: 'http://127.0.0.1:9', PULLWAVE_COVER_FALLBACK_URL: 'http://127.0.0.1:9' }
    });
    const page = await app.firstWindow();
    await page.waitForSelector('.logo');
    await leaveHome(page);
    return { app, page, workDir, userData, downloadDir, callsLog };
}

// The arguments the fake yt-dlp got in each of its runs, as it wrote them down.
function ytdlpCalls(): string[][] {
    return readFileSync(session.callsLog, 'utf-8')
        .split('\n')
        .filter((line) => {
            return line.length > 0;
        })
        .map((line) => {
            return JSON.parse(line) as string[];
        });
}

// The command as the log writes it: an argument with a space between quotes.
function commandText(program: string, args: string[]): string {
    return [program, ...args]
        .map((part) => {
            return /\s/.test(part) ? JSON.stringify(part) : part;
        })
        .join(' ');
}

async function snapshot(page: Page, source: string): Promise<LogLine[]> {
    return page.evaluate((name) => {
        return (window as unknown as { api: { logs: { snapshot: (source: string) => Promise<LogLine[]> } } }).api.logs.snapshot(name);
    }, source);
}

async function waitForHistory(page: Page, status: 'done' | 'error', count = 1): Promise<void> {
    await expect
        .poll(
            async () => {
                const history = await page.evaluate(() => {
                    return (window as unknown as { api: { listHistory: () => Promise<Array<{ status: string }>> } }).api.listHistory();
                });
                return history.filter((entry) => {
                    return entry.status === status;
                }).length;
            },
            { timeout: 15000 }
        )
        .toBeGreaterThanOrEqual(count);
}

async function submitUrl(page: Page, url: string): Promise<void> {
    await page.getByLabel('Link 1', { exact: true }).fill(url);
    await page.getByRole('button', { name: 'DOWNLOAD', exact: true }).click();
}

async function openDownloadsLogs(page: Page): Promise<Locator> {
    await page.getByRole('button', { name: 'VIDEO DOWNLOADER', exact: true }).click();
    await page.getByRole('navigation', { name: 'Video downloader' }).getByRole('button', { name: 'SETTINGS', exact: true }).click();
    await page.getByRole('button', { name: 'VIEW LOGS', exact: true }).click();
    return page.getByRole('dialog', { name: 'LOGS — yt-dlp' });
}

function rowsOf(dialog: Locator): Locator {
    return dialog.locator('.log-line');
}

// What each line shows: how serious it is (its class), where it came from and its text.
async function shownRows(dialog: Locator): Promise<Array<[string | null, string | null, string]>> {
    return rowsOf(dialog).evaluateAll((rows) => {
        return rows.map((row): [string | null, string | null, string] => {
            return [row.getAttribute('class'), row.getAttribute('data-stream'), row.querySelector('.log-line__text')?.textContent ?? ''];
        });
    });
}

function expectLineShapes(lines: LogLine[]): void {
    lines.forEach((line, index) => {
        expect(Object.keys(line).sort()).toEqual(['at', 'id', 'stream', 'text']);
        expect(Number.isInteger(line.id)).toBe(true);
        expect(new Date(line.at)).toEqual(expect.any(Date));
        expect(Math.abs(Date.now() - line.at)).toBeLessThan(120000);
        if (index > 0) {
            expect(line.id).toBeGreaterThan(lines[index - 1]?.id ?? 0);
        }
    });
}

test.beforeEach(async () => {
    session = await launch();
});

test.afterEach(async () => {
    await session.app.close();
    rmSync(session.workDir, { recursive: true, force: true });
});

test('keeps the command and the output of a failed yt-dlp run in memory, with the secret hidden, and shows them colored', async () => {
    const { page } = session;
    await submitUrl(page, FAILING_URL);
    await waitForHistory(page, 'error');
    const args = ytdlpCalls().at(-1) ?? [];
    expect(args.at(-1)).toBe(FAILING_URL);
    const command = commandText(FAKE_YTDLP, args).replace('token=s3cr3t', 'token=***');

    // What the main process keeps: the command, the error and how it ended, in that order, and no secret.
    const lines = await snapshot(page, 'yt-dlp');
    expectLineShapes(lines);
    expect(
        lines.map((line) => {
            return [line.stream, line.text];
        })
    ).toEqual([
        ['command', command],
        ['stderr', 'ERROR: [youtube] abc: Video unavailable'],
        ['event', 'exited with code 1']
    ]);
    expect(JSON.stringify(lines)).not.toContain('s3cr3t');

    const dialog = await openDownloadsLogs(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog.getByRole('list', { name: 'Lines of the log of yt-dlp' })).toBeVisible();
    expect(await shownRows(dialog)).toEqual([
        ['log-line log-line--command', 'command', command],
        ['log-line log-line--error', 'stderr', 'ERROR: [youtube] abc: Video unavailable'],
        ['log-line log-line--error', 'event', 'exited with code 1']
    ]);
    await expect(dialog.getByText('3 of 3 lines')).toBeVisible();
    await expect(dialog.locator('.log-token--redacted')).toHaveText(['***']);
    await expect(dialog.locator('.log-token--tag')).toHaveText(['[youtube]']);
    await expect(dialog.locator('.log-token--level')).toHaveText(['ERROR:']);
    await expect(dialog.locator('.log-line__time').first()).toHaveText(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
    // A dark terminal in every theme, with the color of the errors.
    expect(await dialog.locator('.logs__screen').evaluate((element) => {
        return getComputedStyle(element).backgroundColor;
    })).toBe('rgb(13, 17, 23)');
    expect(await rowsOf(dialog).nth(1).locator('.log-line__text').evaluate((element) => {
        return getComputedStyle(element).color;
    })).toBe('rgb(255, 123, 114)');
    await expect(page.getByText('s3cr3t')).toHaveCount(0);
});

test('shows the new lines of yt-dlp while the window is open', async () => {
    const { page, downloadDir } = session;
    const dialog = await openDownloadsLogs(page);
    await expect(dialog.getByText(EMPTY_TEXT)).toBeVisible();
    await page.evaluate(
        ({ url, directory }) => {
            return (window as unknown as { api: { addDownload: (url: string, directory: string) => Promise<unknown> } }).api.addDownload(url, directory);
        },
        { url: 'https://example.com/unsupported', directory: downloadDir }
    );
    await expect(rowsOf(dialog)).toHaveCount(3);
    const rows = await shownRows(dialog);
    expect(rows.slice(1)).toEqual([
        ['log-line log-line--error', 'stderr', 'ERROR: Unsupported URL: https://example.com/unsupported'],
        ['log-line log-line--error', 'event', 'exited with code 1']
    ]);
    expect(rows[0]?.[0]).toBe('log-line log-line--command');
    expect(rows[0]?.[2]).toBe(commandText(FAKE_YTDLP, ytdlpCalls().at(-1) ?? []));
});

test('filters, searches and clears the log of yt-dlp', async () => {
    const { page } = session;
    await submitUrl(page, FAILING_URL);
    await waitForHistory(page, 'error');
    const dialog = await openDownloadsLogs(page);
    await expect(rowsOf(dialog)).toHaveCount(3);

    await dialog.getByLabel('Show').selectOption('errors');
    await expect(rowsOf(dialog)).toHaveCount(2);
    await expect(dialog.getByText('2 of 3 lines')).toBeVisible();
    await dialog.getByLabel('Show').selectOption('all');

    await dialog.getByLabel('Search').fill('unavailable');
    expect(await shownRows(dialog)).toEqual([['log-line log-line--error', 'stderr', 'ERROR: [youtube] abc: Video unavailable']]);
    await dialog.getByLabel('Search').fill('nothing like this');
    await expect(dialog.getByText('No line matches the filter.')).toBeVisible();
    await dialog.getByLabel('Search').fill('');

    await dialog.getByRole('button', { name: 'CLEAR', exact: true }).click();
    await expect(dialog.getByText(EMPTY_TEXT)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'COPY', exact: true })).toBeDisabled();
    expect(await snapshot(page, 'yt-dlp')).toEqual([]);

    await dialog.getByRole('button', { name: 'CLOSE', exact: true }).click();
    await expect(dialog).toBeHidden();
});

test('opens the log of ffmpeg in the settings of the whole app, and answers no lines for something that is not a program', async () => {
    const { page } = session;
    await page.getByRole('button', { name: 'SETTINGS (GLOBAL)', exact: true }).click();
    await page.getByRole('button', { name: 'VIEW LOGS', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'LOGS — ffmpeg' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('tablist')).toHaveCount(0);
    await expect(dialog.getByText(EMPTY_TEXT)).toBeVisible();
    expect(await snapshot(page, 'ffmpeg')).toEqual([]);
    expect(await snapshot(page, 'docker')).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
});

test('opens the log of ani-cli in the anime settings', async () => {
    const { page } = session;
    await page.getByRole('button', { name: 'ANIME', exact: true }).click();
    await page.getByRole('navigation', { name: 'Anime' }).getByRole('button', { name: 'SETTINGS', exact: true }).click();
    await page.getByRole('button', { name: 'VIEW LOGS', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'LOGS — ani-cli' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('tablist')).toHaveCount(0);
    await expect(dialog.getByText(EMPTY_TEXT)).toBeVisible();
});

test('opens the logs of Suwayomi and FlareSolverr in the manga settings, one tab each', async () => {
    const { page } = session;
    await page.getByRole('button', { name: 'MANGA', exact: true }).click();
    await page.getByRole('navigation', { name: 'Manga' }).getByRole('button', { name: 'SETTINGS', exact: true }).click();
    await page.getByRole('button', { name: 'VIEW LOGS', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'LOGS — Suwayomi · FlareSolverr' });
    await expect(dialog).toBeVisible();
    const tabs = dialog.getByRole('tablist', { name: 'Programs' }).getByRole('tab');
    await expect(tabs).toHaveText(['Suwayomi', 'FlareSolverr']);
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    // With the server of the section given, neither program is run: both logs are empty, in the app and in the window.
    await expect(dialog.getByText(EMPTY_TEXT)).toBeVisible();
    expect(await snapshot(page, 'suwayomi')).toEqual([]);
    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'false');
    await expect(dialog.getByText(EMPTY_TEXT)).toBeVisible();
    expect(await snapshot(page, 'flaresolverr')).toEqual([]);
    expect(existsSync(join(session.userData, 'manga', 'tools'))).toBe(false);
});
