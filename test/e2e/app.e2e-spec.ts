import { expect, test, _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import './display';
import { execFileSync, spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const ELECTRON_PATH = createRequire(__filename)('electron') as unknown as string;
const FAKE_YTDLP = resolve(__dirname, 'fixtures/fake-yt-dlp.js');
const FAKE_FFMPEG = resolve(__dirname, 'fixtures/fake-ffmpeg.js');
const BUNDLED_DIR = join(ROOT, 'resources', 'bin');
const HAS_BUNDLED_BINARIES = ['yt-dlp', 'ffmpeg', 'deno'].every((name) => {
    return existsSync(join(BUNDLED_DIR, name));
});

interface Session {
    app: ElectronApplication;
    page: Page;
    userData: string;
    downloadDir: string;
    logPath: string;
    hasExited: () => boolean;
}

let session: Session;

interface LaunchOptions {
    useFakeYtdlp?: boolean;
    settings?: Record<string, unknown>;
    env?: Record<string, string>;
    // Runs before the app starts, with the folder of its data (to leave files there, as an earlier run would have).
    prepare?: (userData: string) => void;
}

async function launch(options: LaunchOptions = {}): Promise<Session> {
    const { useFakeYtdlp = true, settings = {}, env = {}, prepare } = options;
    const workDir = mkdtempSync(join(tmpdir(), 'pullwave-e2e-'));
    const userData = join(workDir, 'user-data');
    const downloadDir = join(workDir, 'downloads');
    const logPath = join(workDir, 'ytdlp-calls.log');
    writeFileSync(logPath, '');
    mkdirSync(userData, { recursive: true });
    writeFileSync(join(userData, 'settings.json'), JSON.stringify({ language: 'en', verifyLiveEnd: false, ...(useFakeYtdlp ? { ytdlpPath: FAKE_YTDLP } : {}), downloadDir, ...settings }));
    prepare?.(userData);
    const app = await electron.launch({
        args: [ROOT, '--no-sandbox', `--user-data-dir=${userData}`],
        env: { ...process.env, FAKE_YTDLP_LOG: logPath, ...env }
    });
    let exited = false;
    app.on('close', () => {
        exited = true;
    });
    const page = await app.firstWindow();
    await page.waitForSelector('.logo');
    return {
        app,
        page,
        userData,
        downloadDir,
        logPath,
        hasExited: () => {
            return exited;
        }
    };
}

function readCalls(logPath: string): string[][] {
    return readFileSync(logPath, 'utf-8')
        .split('\n')
        .filter((line) => {
            return line.length > 0;
        })
        .map((line) => {
            return JSON.parse(line) as string[];
        });
}

async function submitUrl(page: Page, url: string): Promise<void> {
    await page.getByLabel('Link 1', { exact: true }).fill(url);
    await page.getByRole('button', { name: 'DOWNLOAD', exact: true }).click();
}

// A download that is complete says so for a few seconds and leaves the queue (it stays in the history): the history is what tells
// how many have finished.
async function expectDownloadsComplete(page: Page, count = 1, timeout = 20000): Promise<void> {
    await expect
        .poll(
            async () => {
                const history = await page.evaluate(() => {
                    return (window as unknown as { api: { listHistory: () => Promise<Array<{ status: string }>> } }).api.listHistory();
                });
                return history.filter((entry) => {
                    return entry.status === 'done';
                }).length;
            },
            { timeout }
        )
        .toBeGreaterThanOrEqual(count);
}

function readSettings(userData: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf-8')) as Record<string, unknown>;
}

// The settings are on three screens: the ones of the whole app (a tab), and the ones of the video downloader and of the anime section
// (a screen of each).
async function openGlobalSettings(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'SETTINGS (GLOBAL)', exact: true }).click();
}

async function openDownloadsSettings(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'VIDEO DOWNLOADER', exact: true }).click();
    await page.getByRole('navigation', { name: 'Video downloader' }).getByRole('button', { name: 'SETTINGS', exact: true }).click();
}

test.beforeEach(async () => {
    session = await launch();
});

test.afterEach(async () => {
    await session.app.close();
    rmSync(resolve(session.userData, '..'), { recursive: true, force: true });
});

test('shows the detected yt-dlp version and marks the custom path as its source', async () => {
    const { page } = session;
    const chip = page.locator('.chip--ok', { hasText: 'yt-dlp fake-1.0' });
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute('title', `${FAKE_YTDLP} (custom)`);
    await expect(page.locator('.chip', { hasText: 'ffmpeg' })).toBeVisible();
});

// A yt-dlp an update would have saved in the data folder, here a script that only says its version (or fails).
function saveUpdatedYtdlp(userData: string, body: string): string {
    const path = join(userData, 'bin', 'yt-dlp');
    mkdirSync(join(userData, 'bin'), { recursive: true });
    writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return path;
}

test.describe('the yt-dlp an update saved', () => {
    test.skip(!HAS_BUNDLED_BINARIES || process.platform === 'win32', 'needs `npm run fetch-binaries` and a system where a script can stand for yt-dlp');
    const bundledVersion = (): string => {
        return execFileSync(join(BUNDLED_DIR, 'yt-dlp'), ['--version'], { encoding: 'utf-8' }).trim();
    };

    async function launchWith(body: string): Promise<{ run: Session; saved: string }> {
        let saved = '';
        const run = await launch({
            useFakeYtdlp: false,
            prepare: (userData) => {
                saved = saveUpdatedYtdlp(userData, body);
            }
        });
        return { run, saved };
    }

    test('is the one in use, and a button goes back to the one that ships with the app', async () => {
        const { run, saved } = await launchWith('echo 2999.12.31');
        try {
            const chip = run.page.locator('.chip--ok', { hasText: 'yt-dlp 2999.12.31' });
            await expect(chip).toHaveAttribute('title', `${saved} (updated)`);
            await openDownloadsSettings(run.page);
            await expect(run.page.getByText('Installed version: 2999.12.31')).toBeVisible();

            await run.page.getByRole('button', { name: 'USE THE ONE THAT SHIPS WITH THE APP' }).click();

            await expect(run.page.locator('.toast--info .toast__message')).toHaveText('Using the yt-dlp that ships with the app again.');
            await expect(run.page.getByText(`Installed version: ${bundledVersion()}`)).toBeVisible();
            await expect(run.page.locator('.chip--ok', { hasText: `yt-dlp ${bundledVersion()}` })).toHaveAttribute('title', `${join(BUNDLED_DIR, 'yt-dlp')} (bundled)`);
            await expect(run.page.getByRole('button', { name: 'USE THE ONE THAT SHIPS WITH THE APP' })).toHaveCount(0);
            expect(existsSync(saved)).toBe(false);
            expect(existsSync(join(BUNDLED_DIR, 'yt-dlp'))).toBe(true);
        } finally {
            await run.app.close();
            rmSync(resolve(run.userData, '..'), { recursive: true, force: true });
        }
    });

    test('is dropped when it is older than the one that ships with the app, which is then used', async () => {
        const { run, saved } = await launchWith('echo 2020.01.01');
        try {
            await expect(run.page.locator('.chip--ok', { hasText: `yt-dlp ${bundledVersion()}` })).toHaveAttribute('title', `${join(BUNDLED_DIR, 'yt-dlp')} (bundled)`);
            await openDownloadsSettings(run.page);
            await expect(run.page.getByText(`Installed version: ${bundledVersion()}`)).toBeVisible();
            await expect(run.page.getByRole('button', { name: 'USE THE ONE THAT SHIPS WITH THE APP' })).toHaveCount(0);
            expect(existsSync(saved)).toBe(false);
        } finally {
            await run.app.close();
            rmSync(resolve(run.userData, '..'), { recursive: true, force: true });
        }
    });

    test('is dropped when it no longer runs', async () => {
        const { run, saved } = await launchWith('exit 1');
        try {
            await expect(run.page.locator('.chip--ok', { hasText: `yt-dlp ${bundledVersion()}` })).toBeVisible();
            expect(existsSync(saved)).toBe(false);
        } finally {
            await run.app.close();
            rmSync(resolve(run.userData, '..'), { recursive: true, force: true });
        }
    });

    test('is left alone when it is newer, and when a yt-dlp was chosen in the settings', async () => {
        const kept = await launchWith('echo 2999.12.31');
        try {
            await expect(kept.run.page.locator('.chip--ok', { hasText: 'yt-dlp 2999.12.31' })).toBeVisible();
            expect(existsSync(kept.saved)).toBe(true);
        } finally {
            await kept.run.app.close();
            rmSync(resolve(kept.run.userData, '..'), { recursive: true, force: true });
        }
        const own = await launch({ settings: { ytdlpPath: FAKE_YTDLP }, prepare: (userData) => { saveUpdatedYtdlp(userData, 'echo 2020.01.01'); } });
        try {
            await expect(own.page.locator('.chip--ok', { hasText: 'yt-dlp fake-1.0' })).toBeVisible();
            expect(existsSync(join(own.userData, 'bin', 'yt-dlp'))).toBe(true);
        } finally {
            await own.app.close();
            rmSync(resolve(own.userData, '..'), { recursive: true, force: true });
        }
    });
});

test.describe('bundled binaries', () => {
    test.skip(!HAS_BUNDLED_BINARIES, 'run `npm run fetch-binaries` to enable these tests');

    test('uses the bundled yt-dlp and ffmpeg by default', async () => {
        const bundled = await launch({ useFakeYtdlp: false });
        try {
            const ytdlpChip = bundled.page.locator('.chip--ok', { hasText: /^yt-dlp \d/ });
            await expect(ytdlpChip).toBeVisible();
            await expect(ytdlpChip).toHaveAttribute('title', `${join(BUNDLED_DIR, 'yt-dlp')} (bundled)`);
            const ffmpegChip = bundled.page.locator('.chip--ok', { hasText: /^ffmpeg \S+/ });
            await expect(ffmpegChip).toBeVisible();
            await expect(ffmpegChip).toHaveAttribute('title', `${join(BUNDLED_DIR, 'ffmpeg')} (bundled)`);
        } finally {
            await bundled.app.close();
            rmSync(resolve(bundled.userData, '..'), { recursive: true, force: true });
        }
    });

    test('passes the bundled ffmpeg folder to yt-dlp and puts the bundled folder first in PATH', async () => {
        const { page, logPath } = session;
        await submitUrl(page, 'https://example.com/ok');
        await expectDownloadsComplete(page);
        const args = readCalls(logPath).find((call) => {
            return call.includes('--no-playlist');
        }) ?? [];
        expect(args[args.indexOf('--ffmpeg-location') + 1]).toBe(BUNDLED_DIR);
        expect(readFileSync(`${logPath}.env`, 'utf-8').startsWith(`${BUNDLED_DIR}:`)).toBe(true);
    });
});

test('downloads a video, says it is complete for five seconds, removes its card and records history', async () => {
    const { page, downloadDir, logPath } = session;
    await submitUrl(page, 'https://example.com/watch?v=ok');

    const notice = page.locator('.toast--info .toast__message');
    await expect(notice).toHaveText('Download complete: Fake Video');
    await expect(page.locator('.toast--info')).toHaveAttribute('role', 'status');
    await expect(page.getByTestId('job-card')).toHaveCount(0);
    await expect(page.getByText('// NO ACTIVE DOWNLOADS. JACK IN A URL ABOVE.')).toBeVisible();
    const shownAt = Date.now();
    await expect(notice).toBeHidden({ timeout: 8000 });
    expect(Date.now() - shownAt).toBeGreaterThan(3500);

    const calls = readCalls(logPath).filter((args) => {
        return !args.includes('--version');
    });
    expect(calls).toHaveLength(1);
    const args = calls[0] ?? [];
    expect(args[args.indexOf('-P') + 1]).toBe(downloadDir);
    expect(args.slice(-2)).toEqual(['--', 'https://example.com/watch?v=ok']);
    expect(args).toContain('--no-playlist');

    await page.getByRole('button', { name: 'HISTORY' }).click();
    const item = page.locator('.history__item--done');
    await expect(item).toHaveCount(1);
    await expect(item).toContainText('Fake Video');
    await expect(item).toContainText('COMPLETE');
});

test('stacks the completions, newest on top, each one going away five seconds after it showed up', async () => {
    const { page } = session;
    await page.getByLabel('Link 1', { exact: true }).fill('https://example.com/ok1');
    await page.getByRole('button', { name: '+ ADD LINK' }).click();
    await page.getByLabel('Link 2', { exact: true }).fill('https://example.com/ok2');
    await page.getByRole('button', { name: 'DOWNLOAD', exact: true }).click();

    const notices = page.locator('.toast--info .toast__message', { hasText: 'Download complete: Fake Video' });
    await expect(notices.first()).toBeVisible();
    const shownAt = Date.now();
    await expectDownloadsComplete(page, 2);
    await expect(page.getByTestId('job-card')).toHaveCount(0);
    // Both are on the screen together, one over the other, and each one goes away five seconds after it showed up.
    await expect(notices).toHaveCount(2);
    await expect(notices).toHaveCount(0, { timeout: 10000 });
    expect(Date.now() - shownAt).toBeGreaterThan(4000);
    await page.getByRole('button', { name: 'HISTORY' }).click();
    await expect(page.locator('.history__item--done')).toHaveCount(2);
});

test('does not offer simultaneous downloads in the settings and always runs two at a time', async () => {
    const stale = await launch({ settings: { maxConcurrent: 5 } });
    try {
        const { page, userData } = stale;
        await openDownloadsSettings(page);
        await expect(page.locator('.settings legend', { hasText: 'ADVANCED' })).toBeVisible();
        await expect(page.getByLabel('Simultaneous downloads')).toHaveCount(0);
        await expect(page.getByText('Simultaneous downloads')).toHaveCount(0);

        // Saving anything writes the fixed value, whatever the file had.
        await page.getByLabel('Speed limit').fill('2M');
        await expect.poll(() => {
            return readSettings(userData).rateLimit;
        }).toBe('2M');
        expect(readSettings(userData).maxConcurrent).toBe(2);
    } finally {
        await stale.app.close();
        rmSync(resolve(stale.userData, '..'), { recursive: true, force: true });
    }
});

test('shows what yt-dlp is doing to the downloaded file until it is ready', async () => {
    const { page, logPath } = session;
    await submitUrl(page, 'https://example.com/convert');

    const card = page.getByTestId('job-card');
    await expect(card.locator('.badge')).toHaveText('PROCESSING');
    await expect(card).toHaveClass(/job--processing/);
    await expect(card.getByText('Converting the audio')).toBeVisible();
    await expect(card.getByRole('progressbar', { name: 'Processing the downloaded file' })).toBeVisible();
    await expect(card.getByRole('button')).toHaveCount(0);
    await expect(card.getByText('Moving the file to the folder')).toBeVisible();
    await expectDownloadsComplete(page);
    await expect(page.locator('.toast--info .toast__message')).toHaveText('Download complete: Fake Video');
    await expect(card).toHaveCount(0);

    const args = lastYtdlpCall(logPath, 'convert');
    expect(args).toContain('postprocess:CYBERPP|%(progress.status)s|%(progress.postprocessor)s');
    expect(args).not.toContain('--no-quiet');

    await page.getByRole('button', { name: 'HISTORY' }).click();
    const item = page.locator('.history__item--done');
    await expect(item).toHaveCount(1);
    await expect(item).toContainText('Fake Video');
    await expect(item).toContainText('COMPLETE');
});

test('shows a friendly error banner with details and retries the download', async () => {
    const { page } = session;
    await submitUrl(page, 'https://example.com/fail');

    const banner = page.getByRole('alert').filter({ hasText: 'Video unavailable' });
    await expect(banner).toBeVisible();
    await expect(banner.locator('.error-banner__code')).toHaveText('UNAVAILABLE');
    await expect(banner.locator('.error-banner__hint')).toHaveText('The video may be private, removed or blocked in your region.');
    await expect(page.getByTestId('job-card').locator('.badge')).toHaveText('FAILED');

    await banner.getByRole('button', { name: 'SHOW DETAILS' }).click();
    await expect(banner.locator('.error-banner__raw')).toHaveText('ERROR: [youtube] abc: Video unavailable');

    await banner.getByRole('button', { name: 'RETRY' }).click();
    await expect(page.getByTestId('job-card').locator('.badge')).toHaveText('FAILED');
    await page.getByRole('button', { name: 'HISTORY' }).click();
    await expect(page.locator('.history__item--error')).toHaveCount(2);
    await expect(page.locator('.history__item--error').first()).toContainText('FAILED — Video unavailable');
});

test('cancels a running download and lets the user remove it', async () => {
    const { page } = session;
    await submitUrl(page, 'https://example.com/slow');

    const card = page.getByTestId('job-card');
    await expect(card.locator('.badge')).toHaveText('DOWNLOADING');
    await card.getByRole('button', { name: 'CANCEL' }).click();
    await expect(card.locator('.badge')).toHaveText('CANCELLED');

    await card.getByRole('button', { name: 'REMOVE' }).click();
    await expect(page.getByTestId('job-card')).toHaveCount(0);
    await expect(page.getByText('NO ACTIVE DOWNLOADS')).toBeVisible();
});

test('pauses a running download, keeps its card as paused and goes on when it is resumed', async () => {
    const { page } = session;
    await submitUrl(page, 'https://example.com/slow');

    const card = page.getByTestId('job-card');
    await expect(card.locator('.badge')).toHaveText('DOWNLOADING');
    await expect(card.getByRole('button', { name: 'RESUME' })).toHaveCount(0);
    await expect(card.getByText('50.0%')).toBeVisible();
    await card.getByRole('button', { name: 'PAUSE' }).click();

    await expect(card.locator('.badge')).toHaveText('PAUSED');
    await expect(card.locator('.badge')).toHaveClass(/badge--paused/);
    await expect(card).toHaveClass(/job--paused/);
    await expect(card.getByText('50.0%')).toBeVisible();
    await expect(card.getByRole('button', { name: 'PAUSE' })).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'RESUME' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'CANCEL' })).toBeVisible();
    // A paused download is not over: it is not in the history, and the card stays where it is.
    await page.getByRole('button', { name: 'HISTORY' }).click();
    await expect(page.locator('.history__item')).toHaveCount(0);
    await page.getByRole('button', { name: 'QUEUE' }).click();

    await card.getByRole('button', { name: 'RESUME' }).click();
    await expect(card.locator('.badge')).toHaveText('DOWNLOADING');
    await expect(card.getByRole('button', { name: 'PAUSE' })).toBeVisible();

    await card.getByRole('button', { name: 'PAUSE' }).click();
    await expect(card.locator('.badge')).toHaveText('PAUSED');
    await card.getByRole('button', { name: 'CANCEL' }).click();
    await expect(card.locator('.badge')).toHaveText('CANCELLED');
    await card.getByRole('button', { name: 'REMOVE' }).click();
    await expect(page.getByTestId('job-card')).toHaveCount(0);
});

test('a paused download frees its place in the queue for the next one', async () => {
    const { page } = session;
    await submitUrl(page, 'https://example.com/slow-first');
    await expect(page.getByTestId('job-card').locator('.badge')).toHaveText('DOWNLOADING');
    await submitUrl(page, 'https://example.com/slow-second');
    await submitUrl(page, 'https://example.com/slow-third');
    const badges = page.getByTestId('job-card').locator('.badge');
    // The queue runs two downloads at a time: the third waits.
    await expect(badges).toHaveText(['DOWNLOADING', 'DOWNLOADING', 'QUEUED']);

    await page.getByTestId('job-card').first().getByRole('button', { name: 'PAUSE' }).click();

    // The paused one gives its place to the third, and is shown after the two that run now.
    await expect(badges).toHaveText(['DOWNLOADING', 'DOWNLOADING', 'PAUSED']);
});

test('a paused download is still there when the app is opened again, and goes on from it when it is resumed', async () => {
    const { page, userData, logPath, downloadDir } = session;
    await submitUrl(page, 'https://example.com/slow-restart');
    const card = page.getByTestId('job-card');
    await expect(card.getByText('50.0%')).toBeVisible();
    await card.getByRole('button', { name: 'PAUSE' }).click();
    await expect(card.locator('.badge')).toHaveText('PAUSED');
    await expect.poll(() => {
        return existsSync(join(userData, 'paused.json'));
    }).toBe(true);
    const kept = JSON.parse(readFileSync(join(userData, 'paused.json'), 'utf-8')) as Array<{ job: { url: string; status: string; percent: number }; extras: Record<string, unknown> }>;
    expect(kept).toHaveLength(1);
    expect(kept[0]?.job).toMatchObject({ url: 'https://example.com/slow-restart', status: 'paused', percent: 50 });
    const downloadsOf = (): string[][] => {
        return readCalls(logPath).filter((call) => {
            return call.includes('https://example.com/slow-restart');
        });
    };
    expect(downloadsOf()).toHaveLength(1);

    await session.app.close();
    const reopened = await electron.launch({ args: [ROOT, '--no-sandbox', `--user-data-dir=${userData}`], env: { ...process.env, FAKE_YTDLP_LOG: logPath } });
    try {
        const again = await reopened.firstWindow();
        await again.waitForSelector('.logo');
        const reopenedCard = again.getByTestId('job-card');
        await expect(reopenedCard).toHaveCount(1);
        await expect(reopenedCard.locator('.badge')).toHaveText('PAUSED');
        await expect(reopenedCard.getByText('50.0%')).toBeVisible();
        await expect(reopenedCard.getByRole('heading')).toBeVisible();
        await expect(reopenedCard.getByRole('button', { name: 'RESUME' })).toBeVisible();
        // Nothing was started by opening the app: the download waits for the user.
        expect(downloadsOf()).toHaveLength(1);

        await reopenedCard.getByRole('button', { name: 'RESUME' }).click();

        await expect(reopenedCard.locator('.badge')).toHaveText('DOWNLOADING');
        await expect.poll(() => {
            return downloadsOf().length;
        }).toBe(2);
        // The same address and the same folder: yt-dlp finds the partial file and goes on from it.
        const [first, second] = downloadsOf();
        expect(second).toEqual(first);
        expect(second).toContain('https://example.com/slow-restart');
        expect(second?.join(' ')).toContain(downloadDir);
        await expect.poll(() => {
            return (JSON.parse(readFileSync(join(userData, 'paused.json'), 'utf-8')) as unknown[]).length;
        }).toBe(0);
    } finally {
        await reopened.close();
    }
    // The first session is closed already: the afterEach closes it again without failing.
    session = { ...session, app: { close: async () => {return undefined} } as unknown as ElectronApplication };
});

test('a paused download that was cancelled is not there when the app is opened again', async () => {
    const { page, userData } = session;
    await submitUrl(page, 'https://example.com/slow-cancelled');
    const card = page.getByTestId('job-card');
    await expect(card.getByText('50.0%')).toBeVisible();
    await card.getByRole('button', { name: 'PAUSE' }).click();
    await expect(card.locator('.badge')).toHaveText('PAUSED');
    await card.getByRole('button', { name: 'CANCEL' }).click();
    await expect(card.locator('.badge')).toHaveText('CANCELLED');
    await expect.poll(() => {
        return (JSON.parse(readFileSync(join(userData, 'paused.json'), 'utf-8')) as unknown[]).length;
    }).toBe(0);
});

test.describe('closing the app with downloads going on', () => {
    const PARTIAL_NAMES = ['Slow Partial [abc].mp4.part', 'Slow Partial [abc].mp4.ytdl'];

    function present(downloadDir: string, names: string[]): string[] {
        return names.filter((name) => {
            return existsSync(join(downloadDir, name));
        });
    }

    test('cancels a download that is running and deletes its unfinished files, and only its own', async () => {
        const own = await launch({ settings: { deletePartialsOnFailure: false } });
        try {
            await submitUrl(own.page, 'https://example.com/slowpartial');
            await expect(own.page.getByTestId('job-card').getByText('50.0%')).toBeVisible();
            expect(present(own.downloadDir, PARTIAL_NAMES)).toEqual(PARTIAL_NAMES);

            await own.app.close();

            expect(present(own.downloadDir, PARTIAL_NAMES)).toEqual([]);
            expect(readFileSync(join(own.downloadDir, 'Other Video [xyz].mp4.part'), 'utf-8')).toBe('belongs to another download');
            // A download that was cut short by closing the app is not kept for the next run.
            expect(existsSync(join(own.userData, 'paused.json'))).toBe(false);
        } finally {
            rmSync(resolve(own.userData, '..'), { recursive: true, force: true });
        }
    });

    test('keeps a download that was paused, with its files, and still deletes the ones of the download that runs', async () => {
        const own = await launch({ settings: { deletePartialsOnFailure: false } });
        try {
            await submitUrl(own.page, 'https://example.com/slow-paused');
            const paused = own.page.getByTestId('job-card').first();
            await expect(paused.getByText('50.0%')).toBeVisible();
            await paused.getByRole('button', { name: 'PAUSE' }).click();
            await expect(paused.locator('.badge')).toHaveText('PAUSED');
            await submitUrl(own.page, 'https://example.com/slowpartial');
            await expect(own.page.getByTestId('job-card').nth(1).getByText('50.0%')).toBeVisible();

            await own.app.close();

            expect(present(own.downloadDir, PARTIAL_NAMES)).toEqual([]);
            const kept = JSON.parse(readFileSync(join(own.userData, 'paused.json'), 'utf-8')) as Array<{ job: { url: string; status: string } }>;
            expect(kept).toHaveLength(1);
            expect(kept[0]?.job).toMatchObject({ url: 'https://example.com/slow-paused', status: 'paused' });
        } finally {
            rmSync(resolve(own.userData, '..'), { recursive: true, force: true });
        }
    });
});

test('shows the error on the link row for an invalid URL, keeps it for editing and does not create a job', async () => {
    const { page } = session;
    await submitUrl(page, 'not-a-url');
    await expect(page.getByRole('alert').filter({ hasText: 'Invalid URL. Use an http(s) link.' })).toBeVisible();
    await expect(page.getByLabel('Link 1', { exact: true })).toHaveValue('not-a-url');
    await expect(page.getByLabel('Link 1', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('job-card')).toHaveCount(0);

    await page.getByLabel('Link 1', { exact: true }).fill('https://example.com/ok');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: 'DOWNLOAD', exact: true }).click();
    await expectDownloadsComplete(page);
});

test('explains an HTTP 403 in plain words, keeps the raw error on demand and does not offer FIND STREAM', async () => {
    const { page } = session;
    await submitUrl(page, 'https://cdn.example.test/forbidden/videoplayback?id=1&sig=abc');
    const banner = page.getByRole('alert').filter({ hasText: 'Access refused by the server' });
    await expect(banner).toBeVisible();
    await expect(banner.locator('.error-banner__code')).toHaveText('FORBIDDEN');
    await expect(banner.locator('.error-banner__hint')).toContainText('The link may have expired or may only work for the original session, network or browser');
    await expect(page.locator('.badge', { hasText: 'FAILED' })).toBeVisible();
    await expect(banner.getByRole('button', { name: 'FIND STREAM' })).toHaveCount(0);
    await banner.getByRole('button', { name: 'SHOW DETAILS' }).click();
    await expect(banner.locator('.error-banner__raw')).toContainText('HTTP Error 403: Forbidden');
});

test('asks for a link when every row is empty', async () => {
    const { page } = session;
    await page.getByRole('button', { name: 'DOWNLOAD', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Paste at least one video URL.' })).toBeVisible();
    await expect(page.getByTestId('job-card')).toHaveCount(0);
});

test('adds several links with the add button, queues them all and resets the rows', async () => {
    const { page } = session;
    await page.getByLabel('Link 1', { exact: true }).fill('https://example.com/ok1');
    await page.getByRole('button', { name: '+ ADD LINK' }).click();
    await expect(page.getByLabel('Link 2', { exact: true })).toBeFocused();
    await page.getByLabel('Link 2', { exact: true }).fill('https://example.com/ok2');
    await page.getByRole('button', { name: '+ ADD LINK' }).click();
    await page.getByLabel('Link 3', { exact: true }).fill('https://example.com/ok3');
    await page.getByRole('button', { name: 'DOWNLOAD', exact: true }).click();

    await expect(page.getByTestId('job-card')).toHaveCount(3);
    await expectDownloadsComplete(page, 3);
    await expect(page.getByLabel('Link 1', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Link 2', { exact: true })).toHaveCount(0);
});

test('removes a link row with its remove button', async () => {
    const { page } = session;
    await page.getByRole('button', { name: '+ ADD LINK' }).click();
    await page.getByLabel('Link 1', { exact: true }).fill('https://example.com/first');
    await page.getByLabel('Link 2', { exact: true }).fill('https://example.com/second');
    await page.getByRole('button', { name: 'Remove link 1' }).click();
    await expect(page.getByLabel('Link 2', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Link 1', { exact: true })).toHaveValue('https://example.com/second');
    await expect(page.getByRole('button', { name: /Remove link/ })).toHaveCount(0);
});

test('queues the valid links and keeps only the invalid one with its error', async () => {
    const { page } = session;
    await page.getByLabel('Link 1', { exact: true }).fill('https://example.com/ok1');
    await page.getByRole('button', { name: '+ ADD LINK' }).click();
    await page.getByLabel('Link 2', { exact: true }).fill('not-a-url');
    await page.getByRole('button', { name: '+ ADD LINK' }).click();
    await page.getByLabel('Link 3', { exact: true }).fill('https://example.com/ok3');
    await page.getByRole('button', { name: 'DOWNLOAD', exact: true }).click();

    await expect(page.getByTestId('job-card')).toHaveCount(2);
    await expect(page.getByLabel('Link 2', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Link 1', { exact: true })).toHaveValue('not-a-url');
    await expect(page.getByRole('alert').filter({ hasText: 'Invalid URL. Use an http(s) link.' })).toBeVisible();
});

test('handles a very long link without resizing the field or overflowing the page', async () => {
    const { page, logPath } = session;
    const longUrl = `https://example.com/watch?v=abc&list=${'x'.repeat(1500)}`;
    const field = page.getByLabel('Link 1', { exact: true });
    await field.fill(longUrl);

    const before = await field.boundingBox();
    expect(before).not.toBeNull();
    expect(await field.evaluate((element: HTMLInputElement) => {
        return element.tagName === 'INPUT' && element.scrollWidth > element.clientWidth;
    })).toBe(true);
    expect(await page.evaluate(() => {
        return document.documentElement.scrollWidth <= window.innerWidth;
    })).toBe(true);
    await expect(field).toHaveValue(longUrl);

    await page.getByRole('button', { name: 'DOWNLOAD', exact: true }).click();
    await expectDownloadsComplete(page);
    const after = await field.boundingBox();
    expect(after?.width).toBe(before?.width);
    expect(after?.height).toBe(before?.height);
    const args = readCalls(logPath).find((call) => {
        return call.includes('--no-playlist');
    }) ?? [];
    expect(args.at(-1)).toBe(longUrl);
});

test('the back and forward buttons of the mouse move through the tabs that were visited', async () => {
    const { page } = session;
    // Playwright cannot press the side buttons, so the events the browser sends for them are dispatched.
    const pressSideButton = async (button: 3 | 4): Promise<boolean> => {
        return page.evaluate((which) => {
            const event = new MouseEvent('mouseup', { button: which, bubbles: true, cancelable: true });
            window.dispatchEvent(event);
            return event.defaultPrevented;
        }, button);
    };
    const tab = (name: string) => {
        return page.getByRole('button', { name, exact: true });
    };
    await page.getByRole('button', { name: 'VIDEO DOWNLOADER' }).click();
    await tab('HISTORY').click();
    await tab('SETTINGS (GLOBAL)').click();
    await expect(page.getByText('Changes are saved automatically.')).toBeVisible();

    expect(await pressSideButton(3)).toBe(true);
    await expect(tab('HISTORY')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText('// HISTORY IS EMPTY.')).toBeVisible();

    expect(await pressSideButton(3)).toBe(true);
    await expect(tab('VIDEO DOWNLOADER')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByLabel('Link 1', { exact: true })).toBeVisible();

    expect(await pressSideButton(4)).toBe(true);
    expect(await pressSideButton(4)).toBe(true);
    await expect(tab('SETTINGS (GLOBAL)')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText('Changes are saved automatically.')).toBeVisible();
});

test('the settings tabs are a gear at the right end of their bar, in the app and in the video downloader', async () => {
    const { page } = session;
    // The gear sits against the right end of its bar and every other tab keeps to the left.
    const gearAtTheEnd = async (bar: Locator, gear: Locator): Promise<void> => {
        await expect(gear).toHaveText('\u2699\uFE0E');
        const barBox = await bar.boundingBox();
        const gearBox = await gear.boundingBox();
        const tabs = await bar.getByRole('button').evaluateAll((buttons) => {
            return buttons.map((button) => {
                return Math.round(button.getBoundingClientRect().right);
            });
        });
        expect(Math.round((barBox?.x ?? 0) + (barBox?.width ?? 0)) - Math.round((gearBox?.x ?? 0) + (gearBox?.width ?? 0))).toBeLessThanOrEqual(1);
        expect(Math.max(...tabs.slice(0, -1))).toBeLessThan(Math.round(gearBox?.x ?? 0));
    };
    const sections = page.getByRole('navigation', { name: 'Sections' });
    await gearAtTheEnd(sections, sections.getByRole('button', { name: 'SETTINGS (GLOBAL)', exact: true }));
    const downloads = page.getByRole('navigation', { name: 'Video downloader' });
    await gearAtTheEnd(downloads, downloads.getByRole('button', { name: 'SETTINGS', exact: true }));
});

test('settings have no save button and are saved automatically', async () => {
    const { page, userData } = session;
    await openDownloadsSettings(page);
    await expect(page.getByRole('button', { name: 'SAVE SETTINGS' })).toHaveCount(0);
    await expect(page.getByText('Changes are saved automatically.')).toBeVisible();

    await page.getByLabel('Video container').selectOption('mkv');
    await expect(page.getByText('All changes saved.')).toBeVisible();
    expect(readSettings(userData).videoContainer).toBe('mkv');

    await page.getByLabel('Max title length (characters)').fill('66');
    await expect(page.getByText('Unsaved changes…')).toBeVisible();
    expect(readSettings(userData).maxTitleLength).toBe(80);
    await expect(page.getByText('All changes saved.')).toBeVisible({ timeout: 6000 });
    expect(readSettings(userData).maxTitleLength).toBe(66);
});

test('pending text edits are saved when leaving the settings of the video downloader', async () => {
    const { page, userData } = session;
    await openDownloadsSettings(page);
    await page.getByLabel('Subtitle languages').fill('fr,de');
    await page.getByRole('button', { name: 'QUEUE', exact: true }).click();
    await expect.poll(() => {
        return readSettings(userData).subtitleLangs;
    }).toBe('fr,de');
});

test('persists edited settings to disk and passes them to yt-dlp', async () => {
    const { page, userData, logPath, downloadDir } = session;
    await openDownloadsSettings(page);
    await page.getByLabel('Max title length (characters)').fill('55');
    await page.getByLabel('Video quality').selectOption('720');
    await page.getByLabel('Video container').selectOption('mkv');
    await page.getByLabel('Use cookies from my browser').check();
    await page.getByLabel('Download whole playlist').check();
    await page.getByLabel('JavaScript runtime').fill('node');
    await expect(page.getByText('All changes saved.')).toBeVisible({ timeout: 6000 });

    expect(readSettings(userData)).toMatchObject({
        maxTitleLength: 55,
        maxResolution: '720',
        videoContainer: 'mkv',
        useBrowserCookies: true,
        cookiesBrowser: 'firefox',
        downloadPlaylist: true,
        jsRuntime: 'node',
        downloadDir,
        ytdlpPath: FAKE_YTDLP
    });

    await page.getByRole('button', { name: 'QUEUE', exact: true }).click();
    await submitUrl(page, 'https://example.com/ok');
    await expectDownloadsComplete(page);
    const args = readCalls(logPath).find((call) => {
        return call.includes('--yes-playlist');
    }) ?? [];
    expect(args[args.indexOf('-o') + 1]).toBe('%(title).55s [%(id)s].%(ext)s');
    expect(args[args.indexOf('-f') + 1]).toBe('bv*[height<=720]+ba/b[height<=720]');
    expect(args[args.indexOf('--merge-output-format') + 1]).toBe('mkv');
    expect(args[args.indexOf('--cookies-from-browser') + 1]).toBe('firefox');
    expect(args[args.indexOf('--js-runtimes') + 1]).toBe('node');
});

test('auto-generated subtitles are saved and passed to yt-dlp together with the chosen languages', async () => {
    const { page, userData, logPath } = session;
    await openDownloadsSettings(page);
    await page.getByLabel('Download subtitles').check();
    await page.getByLabel('Include auto-generated subtitles').check();
    await page.getByLabel('Subtitle languages').fill('ja');
    await expect(page.getByText('All changes saved.')).toBeVisible({ timeout: 6000 });
    expect(readSettings(userData)).toMatchObject({ writeSubtitles: true, autoSubtitles: true, subtitleLangs: 'ja' });

    await page.getByRole('button', { name: 'QUEUE', exact: true }).click();
    await submitUrl(page, 'https://example.com/ok');
    await expectDownloadsComplete(page);
    const args = readCalls(logPath).find((call) => {
        return call.includes('--write-auto-subs');
    }) ?? [];
    expect(args).toEqual(expect.arrayContaining(['--write-subs', '--write-auto-subs', '--sub-langs', 'ja']));
    expect(args[args.indexOf('--sub-langs') + 1]).toBe('ja');
    expect(args).not.toContain('--embed-subs');
});

test('embedding subtitles passes --embed-subs instead of --write-subs so no separate subtitle file is left', async () => {
    const { page, userData, logPath } = session;
    await openDownloadsSettings(page);
    await page.getByLabel('Download subtitles').check();
    await page.getByLabel('Include auto-generated subtitles').check();
    await page.getByLabel('Embed subtitles in the video').check();
    await page.getByLabel('Subtitle languages').fill('ja');
    await expect(page.getByText('All changes saved.')).toBeVisible({ timeout: 6000 });
    expect(readSettings(userData)).toMatchObject({ writeSubtitles: true, autoSubtitles: true, embedSubtitles: true, subtitleLangs: 'ja' });

    await page.getByRole('button', { name: 'QUEUE', exact: true }).click();
    await submitUrl(page, 'https://example.com/ok');
    await expectDownloadsComplete(page);
    const args = readCalls(logPath).find((call) => {
        return call.includes('--embed-subs');
    }) ?? [];
    expect(args).toEqual(expect.arrayContaining(['--embed-subs', '--write-auto-subs', '--sub-langs', 'ja']));
    expect(args[args.indexOf('--sub-langs') + 1]).toBe('ja');
    expect(args).not.toContain('--write-subs');
});

test('auto-generated subtitles without a language warn in the settings and block the download', async () => {
    const { page, logPath } = session;
    const message =
        'Auto-generated subtitles need a language. Fill in "Subtitle languages" in Settings (e.g. ja), or turn off "Include auto-generated subtitles".';
    await openDownloadsSettings(page);
    await page.getByLabel('Subtitle languages').fill('');
    await page.getByLabel('Download subtitles').check();
    await page.getByLabel('Include auto-generated subtitles').check();
    await expect(page.getByRole('alert')).toHaveText(message);
    await expect(page.getByText('All changes saved.')).toBeVisible({ timeout: 6000 });

    await page.getByRole('button', { name: 'QUEUE', exact: true }).click();
    await submitUrl(page, 'https://example.com/ok');
    await expect(page.getByText(message)).toBeVisible();
    await expect(page.locator('.badge')).toHaveCount(0);
    expect(readCalls(logPath).filter((call) => {
        return call.includes('--write-auto-subs');
    })).toEqual([]);

    await openDownloadsSettings(page);
    await page.getByLabel('Subtitle languages').fill('ja');
    await expect(page.getByRole('alert')).toHaveCount(0);
});

test.describe('partial files', () => {
    const PARTIAL_URL = 'https://example.com/partialfail';
    const LIVE_URL = 'https://example.com/livefail';
    const FAILED_BADGE = (page: Page) => {
        return page.locator('.badge', { hasText: 'FAILED' });
    };

    function leftovers(downloadDir: string): string[] {
        return ['Partial Fail [abc].mp4.part', 'Partial Fail [abc].f137.mp4.part', 'Partial Fail [abc].mp4.ytdl'].filter((name) => {
            return existsSync(join(downloadDir, name));
        });
    }

    test('deletes what a failed download left behind, by default, and only that download\'s files', async () => {
        const { page, downloadDir } = session;
        await submitUrl(page, PARTIAL_URL);
        await expect(FAILED_BADGE(page)).toBeVisible();
        await expect(page.getByRole('button', { name: 'CLEAR PARTIAL FILES' })).toHaveCount(0);
        expect(leftovers(downloadDir)).toEqual([]);
        expect(readFileSync(join(downloadDir, 'Other Video [xyz].mp4.part'), 'utf-8')).toBe('belongs to another download');
        expect(readFileSync(join(downloadDir, 'Finished [fin].mp4'), 'utf-8')).toBe('complete file');
    });

    test('keeps the files when the setting is off and clears them from the card on request', async () => {
        const own = await launch({ settings: { deletePartialsOnFailure: false } });
        try {
            await submitUrl(own.page, PARTIAL_URL);
            await expect(FAILED_BADGE(own.page)).toBeVisible();
            expect(leftovers(own.downloadDir)).toEqual(['Partial Fail [abc].mp4.part', 'Partial Fail [abc].f137.mp4.part', 'Partial Fail [abc].mp4.ytdl']);

            await own.page.getByRole('button', { name: 'CLEAR PARTIAL FILES' }).click();
            await expect(own.page.getByRole('button', { name: 'CLEAR PARTIAL FILES' })).toHaveCount(0);
            expect(leftovers(own.downloadDir)).toEqual([]);
            await expect(FAILED_BADGE(own.page)).toBeVisible();
            expect(existsSync(join(own.downloadDir, 'Other Video [xyz].mp4.part'))).toBe(true);
        } finally {
            await closeQuietly(own);
        }
    });

    test('removing a failed download deletes what it left behind', async () => {
        const own = await launch({ settings: { deletePartialsOnFailure: false } });
        try {
            await submitUrl(own.page, PARTIAL_URL);
            await expect(own.page.getByRole('button', { name: 'CLEAR PARTIAL FILES' })).toBeVisible();
            await own.page.getByRole('button', { name: 'REMOVE' }).click();
            await expect(own.page.getByTestId('job-card')).toHaveCount(0);
            expect(leftovers(own.downloadDir)).toEqual([]);
            expect(existsSync(join(own.downloadDir, 'Finished [fin].mp4'))).toBe(true);
        } finally {
            await closeQuietly(own);
        }
    });

    test('keeps the recording of a live stream that failed, even with the setting on', async () => {
        const { page, downloadDir } = session;
        await submitUrl(page, LIVE_URL);
        await expect(FAILED_BADGE(page)).toBeVisible();
        await expect(page.getByRole('button', { name: 'CLEAR PARTIAL FILES' })).toBeVisible();
        expect(readFileSync(join(downloadDir, 'Live Fail [abc].mp4.part'), 'utf-8')).toBe('unfinished');
    });

    test('asks before deleting a live recording and keeps it when the user declines', async () => {
        const { page, downloadDir } = session;
        await submitUrl(page, LIVE_URL);
        await expect(page.getByRole('button', { name: 'CLEAR PARTIAL FILES' })).toBeVisible();
        const messages: string[] = [];
        page.once('dialog', async (dialog) => {
            messages.push(dialog.message());
            await dialog.dismiss();
        });
        await page.getByRole('button', { name: 'CLEAR PARTIAL FILES' }).click();
        await expect.poll(() => {
            return messages;
        }).toEqual(['This live recording was not saved. Deleting it cannot be undone. Delete it?']);
        expect(existsSync(join(downloadDir, 'Live Fail [abc].mp4.part'))).toBe(true);
        await expect(page.getByRole('button', { name: 'CLEAR PARTIAL FILES' })).toBeVisible();
    });

    test('deletes a live recording once the user confirms, on removing the card', async () => {
        const { page, downloadDir } = session;
        await submitUrl(page, LIVE_URL);
        await expect(page.getByRole('button', { name: 'CLEAR PARTIAL FILES' })).toBeVisible();
        page.once('dialog', async (dialog) => {
            await dialog.accept();
        });
        await page.getByRole('button', { name: 'REMOVE' }).click();
        await expect(page.getByTestId('job-card')).toHaveCount(0);
        expect(existsSync(join(downloadDir, 'Live Fail [abc].mp4.part'))).toBe(false);
    });

    test('CLEAR FINISHED removes the cards and leaves a live recording in the folder', async () => {
        const { page, downloadDir } = session;
        await submitUrl(page, LIVE_URL);
        await expect(FAILED_BADGE(page)).toBeVisible();
        await page.getByRole('button', { name: 'CLEAR FINISHED' }).click();
        await expect(page.getByTestId('job-card')).toHaveCount(0);
        expect(existsSync(join(downloadDir, 'Live Fail [abc].mp4.part'))).toBe(true);
    });

    test('the setting is on by default and is saved when turned off', async () => {
        const { page, userData } = session;
        await openDownloadsSettings(page);
        const toggle = page.getByLabel('Delete partial files when a download fails or is cancelled');
        await expect(toggle).toBeChecked();
        await toggle.uncheck();
        await expect(page.getByText('All changes saved.')).toBeVisible({ timeout: 6000 });
        expect(readSettings(userData)).toMatchObject({ deletePartialsOnFailure: false });
    });
});

const ORIGIN_FOLDER = ['.config', 'BraveSoftware', 'Brave-Origin'];
const FIREFOX_FOLDER = ['.config', 'mozilla', 'firefox'];

function addChromiumBrowser(home: string, folder: string[], profileNames: Record<string, string> = { Default: 'Default' }, firstRun = true): string {
    const dataDir = join(home, ...folder);
    Object.keys(profileNames).forEach((profile) => {
        mkdirSync(join(dataDir, profile), { recursive: true });
        writeFileSync(join(dataDir, profile, 'Cookies'), '');
    });
    const infoCache = Object.fromEntries(
        Object.entries(profileNames).map(([profile, name]) => {
            return [profile, { name }];
        })
    );
    writeFileSync(join(dataDir, 'Local State'), JSON.stringify({ profile: { info_cache: infoCache } }));
    if (firstRun) {
        writeFileSync(join(dataDir, 'First Run'), '');
    }
    return dataDir;
}

function addFirefox(home: string): string {
    const dataDir = join(home, ...FIREFOX_FOLDER);
    mkdirSync(join(dataDir, 'abcd.default-release'), { recursive: true });
    writeFileSync(join(dataDir, 'profiles.ini'), '[Profile0]\nName=default-release\nIsRelative=1\nPath=abcd.default-release\n');
    writeFileSync(join(dataDir, 'abcd.default-release', 'cookies.sqlite'), '');
    return dataDir;
}

function browserOptions(page: Page): Promise<Array<string | null>> {
    return page.getByLabel('Browser', { exact: true }).locator('option').allTextContents();
}

test.describe('browser detection', () => {
    let fakeHome: string;
    let fakeApps: string;
    let own: Session;

    // The .desktop entries of the real system are replaced by the ones in fakeApps, so the result does not depend on what is installed.
    function launchOnFakeHome(settings: Record<string, unknown> = {}): Promise<Session> {
        return launch({ env: { HOME: fakeHome, PULLWAVE_APPLICATION_DIRS: fakeApps }, settings });
    }

    test.beforeEach(() => {
        fakeHome = mkdtempSync(join(tmpdir(), 'pullwave-home-'));
        fakeApps = join(fakeHome, 'applications');
        mkdirSync(fakeApps, { recursive: true });
    });

    test.afterEach(async () => {
        await closeQuietly(own);
        rmSync(fakeHome, { recursive: true, force: true });
    });

    test('lists the browsers found on the system and passes the chosen folder to yt-dlp', async () => {
        const originDir = addChromiumBrowser(fakeHome, ORIGIN_FOLDER);
        addFirefox(fakeHome);
        own = await launchOnFakeHome();
        const { page, userData, logPath } = own;
        await openDownloadsSettings(page);
        await expect.poll(() => {
            return browserOptions(page);
        }).toEqual(['Choose a browser…', 'Brave Origin', 'Firefox']);

        await page.getByLabel('Use cookies from my browser').check();
        await page.getByLabel('Browser', { exact: true }).selectOption({ label: 'Brave Origin' });
        await expect(page.getByText('All changes saved.')).toBeVisible({ timeout: 6000 });
        expect(readSettings(userData)).toMatchObject({ useBrowserCookies: true, cookiesBrowser: 'brave', cookiesBrowserDir: originDir });
        await expect(page.getByRole('alert')).toHaveCount(0);

        await page.getByRole('button', { name: 'QUEUE', exact: true }).click();
        await submitUrl(page, 'https://example.com/ok');
        await expectDownloadsComplete(page);
        const args = readCalls(logPath).find((call) => {
            return call.includes('--cookies-from-browser');
        }) ?? [];
        expect(args[args.indexOf('--cookies-from-browser') + 1]).toBe(`brave:${originDir}`);
    });

    test('shows the profiles of the chosen browser by name and passes the one picked to yt-dlp', async () => {
        const originDir = addChromiumBrowser(fakeHome, ORIGIN_FOLDER, { Default: 'Personal', 'Profile 1': 'Work' });
        own = await launchOnFakeHome({ useBrowserCookies: true });
        const { page, userData, logPath } = own;
        await openDownloadsSettings(page);
        await expect(page.getByLabel('Browser profile (optional)')).toHaveJSProperty('tagName', 'INPUT');
        await page.getByLabel('Browser', { exact: true }).selectOption({ label: 'Brave Origin' });
        const profile = page.getByLabel('Browser profile (optional)');
        await expect(profile).toHaveJSProperty('tagName', 'SELECT');
        await expect.poll(() => {
            return profile.locator('option').allTextContents();
        }).toEqual(['Automatic (most recently used)', 'Personal (Default)', 'Work (Profile 1)']);

        await profile.selectOption({ label: 'Work (Profile 1)' });
        await expect(page.getByText('All changes saved.')).toBeVisible({ timeout: 6000 });
        expect(readSettings(userData)).toMatchObject({ cookiesBrowser: 'brave', cookiesBrowserDir: originDir, cookiesProfile: 'Profile 1' });

        await page.getByRole('button', { name: 'QUEUE', exact: true }).click();
        await submitUrl(page, 'https://example.com/ok');
        await expectDownloadsComplete(page);
        const args = readCalls(logPath).find((call) => {
            return call.includes('--cookies-from-browser');
        }) ?? [];
        expect(args[args.indexOf('--cookies-from-browser') + 1]).toBe(`brave:${join(originDir, 'Profile 1')}`);
    });

    test('goes back to the automatic profile when another browser is chosen', async () => {
        addChromiumBrowser(fakeHome, ORIGIN_FOLDER, { Default: 'Personal', 'Profile 1': 'Work' });
        addFirefox(fakeHome);
        own = await launchOnFakeHome({ useBrowserCookies: true });
        const { page, userData } = own;
        await openDownloadsSettings(page);
        await page.getByLabel('Browser', { exact: true }).selectOption({ label: 'Brave Origin' });
        await page.getByLabel('Browser profile (optional)').selectOption({ label: 'Work (Profile 1)' });
        await page.getByLabel('Browser', { exact: true }).selectOption({ label: 'Firefox' });
        await expect(page.getByText('All changes saved.')).toBeVisible({ timeout: 6000 });
        expect(readSettings(userData)).toMatchObject({ cookiesBrowser: 'firefox', cookiesProfile: '' });
        await expect.poll(() => {
            return page.getByLabel('Browser profile (optional)').locator('option').allTextContents();
        }).toEqual(['Automatic (most recently used)', 'default-release (abcd.default-release)']);
    });

    test('accepts a browser registered with the system even without the First Run marker, and shows its registered name', async () => {
        addChromiumBrowser(fakeHome, ORIGIN_FOLDER, { Default: 'Default' }, false);
        writeFileSync(join(fakeApps, 'brave-origin.desktop'), '[Desktop Entry]\nName=Brave Origin Browser\nExec=/usr/bin/brave-origin-stable %U\nMimeType=x-scheme-handler/http;x-scheme-handler/https;\n');
        own = await launchOnFakeHome();
        const { page } = own;
        await openDownloadsSettings(page);
        await expect.poll(() => {
            return browserOptions(page);
        }).toEqual(['Choose a browser…', 'Brave Origin Browser']);
    });

    test('does not take an app with an embedded browser for a browser, even though it is registered as something else', async () => {
        addChromiumBrowser(fakeHome, ['.config', 'Codex'], { Default: 'Default' }, false);
        writeFileSync(join(fakeApps, 'editor.desktop'), '[Desktop Entry]\nName=Editor\nExec=editor\nMimeType=text/plain;\n');
        own = await launchOnFakeHome({ useBrowserCookies: true });
        const { page } = own;
        await openDownloadsSettings(page);
        await expect(page.getByRole('alert')).toHaveText('No browser with saved cookies was found on this system.');
        expect(await browserOptions(page)).toEqual(['Choose a browser…']);
    });

    test('looks for the profile inside the chosen browser folder', async () => {
        const originDir = addChromiumBrowser(fakeHome, ORIGIN_FOLDER);
        own = await launchOnFakeHome({ useBrowserCookies: true, cookiesBrowser: 'brave', cookiesBrowserDir: originDir, cookiesProfile: 'Default' });
        await submitUrl(own.page, 'https://example.com/ok');
        await expectDownloadsComplete(own.page);
        const args = readCalls(own.logPath).find((call) => {
            return call.includes('--cookies-from-browser');
        }) ?? [];
        expect(args[args.indexOf('--cookies-from-browser') + 1]).toBe(`brave:${join(originDir, 'Default')}`);
    });

    test('ignores apps that are not browsers and explains when none is found', async () => {
        mkdirSync(join(fakeHome, '.config', 'Code', 'Network'), { recursive: true });
        writeFileSync(join(fakeHome, '.config', 'Code', 'Local State'), '{}');
        writeFileSync(join(fakeHome, '.config', 'Code', 'Network', 'Cookies'), '');
        own = await launchOnFakeHome({ useBrowserCookies: true });
        const { page } = own;
        await openDownloadsSettings(page);
        await expect(page.getByRole('alert')).toHaveText('No browser with saved cookies was found on this system.');
        expect(await browserOptions(page)).toEqual(['Choose a browser…']);
    });

    test('warns when the saved browser is gone and lets the user pick a detected one', async () => {
        addFirefox(fakeHome);
        own = await launchOnFakeHome({ useBrowserCookies: true, cookiesBrowser: 'brave' });
        const { page } = own;
        await openDownloadsSettings(page);
        await expect(page.getByRole('alert')).toHaveText('The saved browser (brave) was not found on this system. Choose one of the detected browsers.');
        await page.getByLabel('Browser', { exact: true }).selectOption({ label: 'Firefox' });
        await expect(page.getByRole('alert')).toHaveCount(0);
        await expect(page.getByText('All changes saved.')).toBeVisible({ timeout: 6000 });
        expect(readSettings(own.userData)).toMatchObject({ cookiesBrowser: 'firefox', cookiesBrowserDir: join(fakeHome, ...FIREFOX_FOLDER) });
    });

    test('picks up a browser installed while the app is open when rescanning', async () => {
        addFirefox(fakeHome);
        own = await launchOnFakeHome();
        const { page } = own;
        await openDownloadsSettings(page);
        await expect.poll(() => {
            return browserOptions(page);
        }).toEqual(['Choose a browser…', 'Firefox']);

        addChromiumBrowser(fakeHome, ORIGIN_FOLDER);
        await page.getByRole('button', { name: 'RESCAN BROWSERS' }).click();
        await expect.poll(() => {
            return browserOptions(page);
        }).toEqual(['Choose a browser…', 'Brave Origin', 'Firefox']);
    });
});

test('audio-only quick toggle switches to audio extraction', async () => {
    const { page, logPath } = session;
    await page.getByLabel('AUDIO ONLY').check();
    await submitUrl(page, 'https://example.com/ok');
    await expectDownloadsComplete(page);
    const args = readCalls(logPath).find((call) => {
        return call.includes('-x');
    }) ?? [];
    expect(args).toEqual(expect.arrayContaining(['-x', '--audio-format', 'mp3', '-f', 'ba/b']));
});

test('the yt-dlp update button is in the settings, not in the header', async () => {
    const { page } = session;
    await expect(page.getByRole('button', { name: 'UPDATE YT-DLP' })).toHaveCount(0);
    await expect(page.locator('.binary-status').getByRole('button')).toHaveCount(0);
    await openDownloadsSettings(page);
    await expect(page.getByRole('button', { name: 'UPDATE YT-DLP' })).toBeVisible();
    await expect(page.getByText('Installed version: fake-1.0')).toBeVisible();
});

test('updating yt-dlp from the settings shows the command output in a notice', async () => {
    const { page } = session;
    await openDownloadsSettings(page);
    await page.getByRole('button', { name: 'UPDATE YT-DLP' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Fake yt-dlp is up to date' })).toBeVisible();
});

test.describe('themes', () => {
    const BACKGROUNDS: Record<string, string> = { cyberpunk: 'rgb(7, 6, 15)', dark: 'rgb(22, 24, 29)', light: 'rgb(243, 244, 247)' };

    async function backgroundOf(page: Page): Promise<string> {
        return page.evaluate(() => {
            return getComputedStyle(document.body).backgroundColor;
        });
    }

    test('device is the default theme and follows the system light or dark mode', async () => {
        const { page } = session;
        await page.emulateMedia({ colorScheme: 'dark' });
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        expect(await backgroundOf(page)).toBe(BACKGROUNDS.dark);
        await page.emulateMedia({ colorScheme: 'light' });
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
        expect(await backgroundOf(page)).toBe(BACKGROUNDS.light);
        await openGlobalSettings(page);
        await expect(page.getByLabel('Theme')).toHaveValue('device');
    });

    test('offers every theme', async () => {
        const { page } = session;
        await openGlobalSettings(page);
        const options = await page.getByLabel('Theme').locator('option').allTextContents();
        expect(options).toEqual([
            'Device (follows the system)',
            'Cyberpunk (neon)',
            'Synthwave (neon)',
            'Terminal (green)',
            'Dark',
            'Tokyo Night',
            'Nord',
            'Dracula',
            'Gruvbox',
            'AMOLED (pure black)',
            'High contrast',
            'Light',
            'Sakura (pink, light)'
        ]);
    });

    test('choosing a theme changes the look right away and saves it', async () => {
        const { page, userData } = session;
        await openGlobalSettings(page);
        await page.getByLabel('Theme').selectOption('cyberpunk');
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'cyberpunk');
        expect(await backgroundOf(page)).toBe(BACKGROUNDS.cyberpunk);
        await expect(page.getByText('All changes saved.')).toBeVisible({ timeout: 6000 });
        expect(readSettings(userData).theme).toBe('cyberpunk');

        await page.getByLabel('Theme').selectOption('dark');
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        expect(await backgroundOf(page)).toBe(BACKGROUNDS.dark);
        await expect.poll(() => {
            return readSettings(userData).theme;
        }).toBe('dark');
    });

    // The layer that used to draw a neon glow after the mouse is gone: nothing marks the page, and the layer is not drawn.
    async function glowOf(page: Page): Promise<{ attribute: string | null; x: string; y: string; layer: string; image: string }> {
        return page.evaluate(() => {
            const root = document.documentElement;
            const layer = getComputedStyle(document.body, '::before');
            return {
                attribute: root.getAttribute('data-glow'),
                x: root.style.getPropertyValue('--mx'),
                y: root.style.getPropertyValue('--my'),
                layer: layer.content,
                image: layer.backgroundImage
            };
        });
    }

    test('no theme has a neon glow that follows the mouse, the cyberpunk one included', async () => {
        const { page } = session;
        await openGlobalSettings(page);
        for (const theme of ['cyberpunk', 'synthwave', 'terminal', 'dark', 'tokyo-night', 'nord', 'dracula', 'gruvbox', 'amoled', 'high-contrast', 'light', 'sakura']) {
            await page.getByLabel('Theme').selectOption(theme);
            await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
            await page.mouse.move(300, 200);
            await page.mouse.move(640, 480);
            await page.waitForTimeout(200);
            expect(await glowOf(page)).toEqual({ attribute: null, x: '', y: '', layer: 'none', image: 'none' });
        }
    });

    // The background each theme paints (the --bg of its block in themes.css, or of the :root of cyberpunk.css), as the browser writes it.
    const THEME_BACKGROUNDS: Array<[string, string, 'neon' | 'flat']> = [
        ['cyberpunk', 'rgb(7, 6, 15)', 'neon'],
        ['synthwave', 'rgb(18, 12, 42)', 'neon'],
        ['terminal', 'rgb(2, 10, 4)', 'neon'],
        ['dark', 'rgb(22, 24, 29)', 'flat'],
        ['tokyo-night', 'rgb(26, 27, 38)', 'flat'],
        ['nord', 'rgb(46, 52, 64)', 'flat'],
        ['dracula', 'rgb(40, 42, 54)', 'flat'],
        ['gruvbox', 'rgb(40, 40, 40)', 'flat'],
        ['amoled', 'rgb(0, 0, 0)', 'flat'],
        ['high-contrast', 'rgb(0, 0, 0)', 'flat'],
        ['light', 'rgb(243, 244, 247)', 'flat'],
        ['sakura', 'rgb(253, 246, 248)', 'flat']
    ];

    for (const [theme, background, style] of THEME_BACKGROUNDS) {
        test(`the ${theme} theme can be chosen: it paints its background, takes the ${style} style and is saved`, async () => {
            const { page, userData } = session;
            await openGlobalSettings(page);

            await page.getByLabel('Theme').selectOption(theme);

            await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
            await expect(page.locator('html')).toHaveAttribute('data-theme-style', style);
            expect(await backgroundOf(page)).toBe(background);
            const look = await page.evaluate(() => {
                return {
                    scanlines: getComputedStyle(document.body, '::after').backgroundImage,
                    logoGlow: getComputedStyle(document.querySelector('.logo') as Element).textShadow
                };
            });
            if (style === 'flat') {
                expect(look).toEqual({ scanlines: 'none', logoGlow: 'none' });
            } else {
                expect(look.scanlines).toContain('repeating-linear-gradient');
                expect(look.logoGlow).not.toBe('none');
            }
            await expect(page.getByText('All changes saved.')).toBeVisible({ timeout: 6000 });
            expect(readSettings(userData).theme).toBe(theme);
        });
    }

    test('a fixed theme ignores the system mode', async () => {
        const { page } = session;
        await openGlobalSettings(page);
        await page.getByLabel('Theme').selectOption('light');
        await page.emulateMedia({ colorScheme: 'dark' });
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
        expect(await backgroundOf(page)).toBe(BACKGROUNDS.light);
    });

    test('the simple themes have no scanlines and no glow on the logo', async () => {
        const { page } = session;
        await openGlobalSettings(page);
        await page.getByLabel('Theme').selectOption('dark');
        const style = await page.evaluate(() => {
            return {
                scanlines: getComputedStyle(document.body, '::after').backgroundImage,
                logoGlow: getComputedStyle(document.querySelector('.logo') as Element).textShadow
            };
        });
        expect(style).toEqual({ scanlines: 'none', logoGlow: 'none' });
    });

    test('the chosen theme is still there after closing and opening the app again', async () => {
        const { page, app, userData, downloadDir } = session;
        await openGlobalSettings(page);
        await page.getByLabel('Theme').selectOption('cyberpunk');
        await expect(page.getByText('All changes saved.')).toBeVisible({ timeout: 6000 });
        await app.close();

        const reopened = await electron.launch({
            args: [ROOT, '--no-sandbox', `--user-data-dir=${userData}`],
            env: { ...process.env, FAKE_YTDLP_LOG: session.logPath }
        });
        try {
            const reopenedPage = await reopened.firstWindow();
            await reopenedPage.waitForSelector('.logo');
            await expect(reopenedPage.locator('html')).toHaveAttribute('data-theme', 'cyberpunk');
            expect(await backgroundOf(reopenedPage)).toBe(BACKGROUNDS.cyberpunk);
            await openGlobalSettings(reopenedPage);
            await expect(reopenedPage.getByLabel('Theme')).toHaveValue('cyberpunk');
            expect(readSettings(userData)).toMatchObject({ theme: 'cyberpunk', downloadDir });
        } finally {
            await reopened.close();
        }
    });
});

test.describe('the tab the app opens on', () => {
    test('is the video downloader by default, and the setting offers the two tabs', async () => {
        const { page } = session;
        await expect(page.getByRole('button', { name: 'VIDEO DOWNLOADER' })).toHaveAttribute('aria-current', 'page');
        await openGlobalSettings(page);
        await expect(page.getByLabel('Open on', { exact: true })).toHaveValue('downloads');
        expect(await page.getByLabel('Open on', { exact: true }).locator('option').allTextContents()).toEqual(['VIDEO DOWNLOADER', 'ANIME']);
        await expect(page.getByText('The tab the app shows when it starts. If the anime section is not available, the video downloader opens.')).toBeVisible();
    });

    test('choosing the anime saves it right away, without changing the tab that is open', async () => {
        const { page, userData } = session;
        await openGlobalSettings(page);
        await page.getByLabel('Open on', { exact: true }).selectOption('anime');

        await expect.poll(() => {
            return readSettings(userData).startTab;
        }).toBe('anime');
        await expect(page.getByRole('button', { name: 'SETTINGS (GLOBAL)' })).toHaveAttribute('aria-current', 'page');
    });

    test('opens on the anime when the settings say so', async () => {
        const own = await launch({ settings: { startTab: 'anime' } });
        try {
            await expect(own.page.getByRole('button', { name: 'ANIME', exact: true })).toHaveAttribute('aria-current', 'page');
            await expect(own.page.getByRole('button', { name: 'VIDEO DOWNLOADER' })).not.toHaveAttribute('aria-current');
            await expect(own.page.getByLabel('Link 1')).toHaveCount(0);
        } finally {
            await own.app.close();
        }
    });

    test('opens on the video downloader when the settings hold something that is not a tab', async () => {
        const own = await launch({ settings: { startTab: 'history' } });
        try {
            await expect(own.page.getByRole('button', { name: 'VIDEO DOWNLOADER' })).toHaveAttribute('aria-current', 'page');
            await openGlobalSettings(own.page);
            await expect(own.page.getByLabel('Open on', { exact: true })).toHaveValue('downloads');
        } finally {
            await own.app.close();
        }
    });
});

test.describe('languages', () => {
    test('the language setting from the settings file is shown and every language is named in itself', async () => {
        const { page, userData } = session;
        await expect(page.locator('html')).toHaveAttribute('lang', 'en');
        await expect(page.getByRole('button', { name: 'VIDEO DOWNLOADER' })).toHaveAttribute('aria-current', 'page');
        await openGlobalSettings(page);
        await expect(page.getByLabel('Language', { exact: true })).toHaveValue('en');
        const options = await page.getByLabel('Language', { exact: true }).locator('option').allTextContents();
        expect(options).toEqual(['Device (follows the system)', 'English', 'Português', 'Español', '中文', '日本語']);
        expect(readSettings(userData).language).toBe('en');
    });

    test('choosing a language translates the whole interface right away and saves it', async () => {
        const { page, userData } = session;
        await openGlobalSettings(page);
        await page.getByLabel('Language', { exact: true }).selectOption('pt');
        await expect(page.locator('html')).toHaveAttribute('lang', 'pt');
        await expect(page.getByRole('button', { name: 'CONFIGURAÇÕES (GLOBAIS)' })).toHaveAttribute('aria-current', 'page');
        await expect(page.getByLabel('Idioma', { exact: true })).toHaveValue('pt');
        await expect(page.getByText('APARÊNCIA E JANELA')).toBeVisible();
        await expect(page.getByText('Todas as alterações foram salvas.')).toBeVisible({ timeout: 6000 });
        expect(readSettings(userData).language).toBe('pt');

        await page.getByLabel('Idioma', { exact: true }).selectOption('ja');
        await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
        await expect(page.getByRole('button', { name: '設定（全体）' })).toHaveAttribute('aria-current', 'page');
        await expect(page.getByText('外観とウィンドウ')).toBeVisible();
        await expect.poll(() => {
            return readSettings(userData).language;
        }).toBe('ja');

        await page.getByLabel('言語', { exact: true }).selectOption('zh');
        await expect(page.getByRole('button', { name: '设置（全局）' })).toHaveAttribute('aria-current', 'page');
        await expect(page.getByText('外观与窗口')).toBeVisible();

        await page.getByLabel('语言', { exact: true }).selectOption('es');
        await expect(page.getByRole('button', { name: 'AJUSTES (GLOBALES)' })).toHaveAttribute('aria-current', 'page');
        await expect(page.getByText('APARIENCIA Y VENTANA')).toBeVisible();

        await page.getByLabel('Idioma', { exact: true }).selectOption('en');
        await expect(page.getByRole('button', { name: 'SETTINGS (GLOBAL)' })).toHaveAttribute('aria-current', 'page');
        await expect(page.getByText('APPEARANCE & WINDOW')).toBeVisible();
    });

    test('messages written by the main process use the chosen language', async () => {
        const { page } = session;
        await openGlobalSettings(page);
        await page.getByLabel('Language', { exact: true }).selectOption('pt');
        await expect(page.getByText('Todas as alterações foram salvas.')).toBeVisible({ timeout: 6000 });
        await page.getByRole('button', { name: 'BAIXADOR DE VÍDEOS' }).click();
        await page.getByLabel('Link 1', { exact: true }).fill('nope');
        await page.getByRole('button', { name: 'BAIXAR', exact: true }).click();
        const alert = page.getByRole('alert').filter({ hasText: 'URL inválida. Use um link http(s).' });
        await expect(alert).toBeVisible();
        await expect(page.getByRole('alert')).toHaveCount(1);
    });

    test('a download error is explained in the language chosen when it happened', async () => {
        const { page, userData } = session;
        await openGlobalSettings(page);
        await page.getByLabel('Language', { exact: true }).selectOption('es');
        await expect(page.getByText('Todos los cambios guardados.')).toBeVisible({ timeout: 6000 });
        expect(readSettings(userData).language).toBe('es');
        await page.getByRole('button', { name: 'DESCARGADOR DE VÍDEOS' }).click();
        await page.getByLabel('Enlace 1', { exact: true }).fill('https://example.com/fail');
        await page.getByRole('button', { name: 'DESCARGAR', exact: true }).click();
        const banner = page.getByRole('alert').filter({ hasText: 'Vídeo no disponible' });
        await expect(banner).toBeVisible();
        await expect(banner).toContainText('Puede que el vídeo sea privado, se haya eliminado o esté bloqueado en tu región.');
        await expect(banner.getByRole('button', { name: 'MOSTRAR DETALLES' })).toBeVisible();
        await expect(banner.getByRole('button', { name: 'REINTENTAR' })).toBeVisible();
    });

    test('the chosen language is still there after closing and opening the app again', async () => {
        const { page, app, userData, downloadDir } = session;
        await openGlobalSettings(page);
        await page.getByLabel('Language', { exact: true }).selectOption('ja');
        await expect.poll(() => {
            return readSettings(userData).language;
        }).toBe('ja');
        await app.close();

        const reopened = await electron.launch({
            args: [ROOT, '--no-sandbox', `--user-data-dir=${userData}`],
            env: { ...process.env, FAKE_YTDLP_LOG: session.logPath }
        });
        try {
            const reopenedPage = await reopened.firstWindow();
            await reopenedPage.waitForSelector('.logo');
            await expect(reopenedPage.locator('html')).toHaveAttribute('lang', 'ja');
            await expect(reopenedPage.getByRole('navigation', { name: 'セクション' }).getByRole('button', { name: '動画ダウンローダー' })).toHaveAttribute('aria-current', 'page');
            await reopenedPage.getByRole('button', { name: '設定（全体）' }).click();
            await expect(reopenedPage.getByLabel('言語', { exact: true })).toHaveValue('ja');
            expect(readSettings(userData)).toMatchObject({ language: 'ja', downloadDir });
        } finally {
            await reopened.close();
        }
    });

    test('"device" follows the language of the system', async () => {
        const workDir = mkdtempSync(join(tmpdir(), 'pullwave-e2e-'));
        const userData = join(workDir, 'user-data');
        mkdirSync(userData, { recursive: true });
        writeFileSync(join(userData, 'settings.json'), JSON.stringify({ language: 'device', ytdlpPath: FAKE_YTDLP, downloadDir: join(workDir, 'downloads') }));
        const spanish = await electron.launch({
            args: [ROOT, '--no-sandbox', '--lang=es-ES', `--user-data-dir=${userData}`],
            env: { ...process.env, LANGUAGE: 'es_ES', LC_ALL: 'es_ES.UTF-8', FAKE_YTDLP_LOG: join(workDir, 'calls.log') }
        });
        try {
            const spanishPage = await spanish.firstWindow();
            await spanishPage.waitForSelector('.logo');
            await expect(spanishPage.locator('html')).toHaveAttribute('lang', 'es');
            await expect(spanishPage.getByRole('button', { name: 'DESCARGADOR DE VÍDEOS' })).toHaveAttribute('aria-current', 'page');
            await spanishPage.getByRole('button', { name: 'AJUSTES (GLOBALES)' }).click();
            await expect(spanishPage.getByLabel('Idioma', { exact: true })).toHaveValue('device');
            expect(readSettings(userData).language).toBe('device');
        } finally {
            await spanish.close();
            rmSync(workDir, { recursive: true, force: true });
        }
    });
});

test.describe('settings layout @resize', () => {
    interface PanelBox {
        legend: string;
        left: number;
        top: number;
        width: number;
        height: number;
    }

    async function panelBoxes(page: Page): Promise<PanelBox[]> {
        return page.locator('.settings .panel').evaluateAll((panels) => {
            return panels.map((panel) => {
                const rect = panel.getBoundingClientRect();
                return { legend: panel.querySelector('legend')?.textContent ?? '', left: Math.round(rect.left), top: Math.round(rect.top + window.scrollY), width: Math.round(rect.width), height: Math.round(rect.height) };
            });
        });
    }

    // The panels of the settings of the video downloader (the ones of the whole app and of the anime section are on screens of their own).
    const LEGENDS = ['OUTPUT', 'QUALITY & FORMAT', 'PLAYLISTS & SUBTITLES', 'LIVE STREAMS', 'BROWSER COOKIES', 'YT-DLP', 'ADVANCED'];

    test('the panels have all the same width and flow in two even columns, with no panel on a row of its own', async () => {
        const { page } = session;
        await page.setViewportSize({ width: 1100, height: 900 });
        await openDownloadsSettings(page);
        const boxes = await panelBoxes(page);

        expect(boxes.map((box) => {
            return box.legend;
        }).sort()).toEqual([...LEGENDS].sort());
        expect(new Set(boxes.map((box) => {
            return box.width;
        })).size).toBe(1);
        const columns = new Map<number, PanelBox[]>();
        boxes.forEach((box) => {
            columns.set(box.left, [...(columns.get(box.left) ?? []), box]);
        });
        expect(columns.size).toBe(2);
        // Both columns start at the same height and end close to each other (no more than one panel apart).
        const bottoms = [...columns.values()].map((panels) => {
            return Math.max(...panels.map((box) => {
                return box.top + box.height;
            }));
        });
        const tops = [...columns.values()].map((panels) => {
            return Math.min(...panels.map((box) => {
                return box.top;
            }));
        });
        expect(new Set(tops).size).toBe(1);
        expect(Math.abs((bottoms[0] ?? 0) - (bottoms[1] ?? 0))).toBeLessThan(Math.max(...boxes.map((box) => {
            return box.height;
        })));
        // Inside a column the panels are one under the other, with the same gap, and never overlap.
        columns.forEach((panels) => {
            const ordered = [...panels].sort((first, second) => {
                return first.top - second.top;
            });
            ordered.slice(1).forEach((box, index) => {
                const previous = ordered[index];
                // 18 px, give or take the rounding of each box.
                expect(Math.abs(box.top - ((previous?.top ?? 0) + (previous?.height ?? 0)) - 18)).toBeLessThanOrEqual(1);
            });
        });
    });

    test('the panels are one column of the same width in a narrow window', async () => {
        const { page } = session;
        await page.setViewportSize({ width: 800, height: 900 });
        await openDownloadsSettings(page);
        const boxes = await panelBoxes(page);
        expect(boxes).toHaveLength(LEGENDS.length);
        expect(new Set(boxes.map((box) => {
            return box.left;
        })).size).toBe(1);
        expect(new Set(boxes.map((box) => {
            return box.width;
        })).size).toBe(1);
    });

    test('no panel has columns of its own: the fields of every panel are stacked on the same left edge', async () => {
        const { page } = session;
        await page.setViewportSize({ width: 1100, height: 900 });
        await openDownloadsSettings(page);
        const lefts = await page.locator('.settings .panel').evaluateAll((panels) => {
            return panels.map((panel) => {
                const fields = Array.from(panel.querySelectorAll(':scope > .field, :scope > .field-row'));
                return new Set(fields.map((field) => {
                    return Math.round(field.getBoundingClientRect().left);
                })).size;
            });
        });
        lefts.forEach((count) => {
            expect(count).toBeLessThanOrEqual(1);
        });
    });
});

test.describe('options for one download', () => {
    async function openOptions(page: Page, index: number): Promise<Locator> {
        await page.getByRole('button', { name: `Options for link ${index}` }).click();
        const dialog = page.getByRole('dialog', { name: `Options for link ${index}` });
        await expect(dialog).toBeVisible();
        return dialog;
    }

    async function relaunchWith(settings: Record<string, unknown>): Promise<Session> {
        await session.app.close();
        rmSync(resolve(session.userData, '..'), { recursive: true, force: true });
        session = await launch({ settings });
        return session;
    }

    const formatOf = (args: string[]): string => {
        return args[args.indexOf('-f') + 1] ?? '';
    };
    const containerOf = (args: string[]): string => {
        return args[args.indexOf('--merge-output-format') + 1] ?? '';
    };

    test('opens a window for the link with the settings as the defaults and closes with Escape or Cancel without changing anything', async () => {
        const { page } = session;
        const dialog = await openOptions(page, 1);
        await expect(dialog.getByLabel('Video quality')).toBeFocused();
        await expect(dialog.getByLabel('Video quality')).toHaveValue('');
        await expect(dialog.getByLabel('Video quality').locator('option').first()).toHaveText('Use the setting (Best available)');
        await expect(dialog.getByLabel('Double-check that a live stream really ended').locator('option').first()).toHaveText('Use the setting (Off)');

        await dialog.getByLabel('Video quality').selectOption('720');
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Options for link 1' })).toBeFocused();
        await expect(page.getByRole('button', { name: 'Options for link 1' })).toHaveClass(/btn--ghost/);

        const again = await openOptions(page, 1);
        await again.getByLabel('Video container').selectOption('mkv');
        await again.getByRole('button', { name: 'CANCEL' }).click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Options for link 1' })).toHaveClass(/btn--ghost/);
    });

    test('changes the quality and format of one link only and leaves the settings alone', async () => {
        const { page, logPath, userData } = session;
        await page.getByLabel('Link 1', { exact: true }).fill('https://example.com/watch?v=plain');
        await page.getByRole('button', { name: '+ ADD LINK' }).click();
        await page.getByLabel('Link 2', { exact: true }).fill('https://example.com/watch?v=custom');
        const dialog = await openOptions(page, 2);
        await dialog.getByLabel('Video quality').selectOption('720');
        await dialog.getByLabel('Video container').selectOption('mkv');
        await dialog.getByRole('button', { name: 'APPLY' }).click();
        await expect(page.getByRole('button', { name: 'Options for link 2' })).toHaveClass(/btn--hot/);
        await expect(page.getByRole('button', { name: 'Options for link 1' })).toHaveClass(/btn--ghost/);
        await page.getByRole('button', { name: 'DOWNLOAD', exact: true }).click();

        await expectDownloadsComplete(page, 2);
        const plain = lastYtdlpCall(logPath, 'v=plain');
        const custom = lastYtdlpCall(logPath, 'v=custom');
        expect(formatOf(plain)).toBe('bv*+ba/b');
        expect(containerOf(plain)).toBe('mp4');
        expect(formatOf(custom)).toBe('bv*[height<=720]+ba/b[height<=720]');
        expect(containerOf(custom)).toBe('mkv');
        await expect(page.getByTestId('job-card')).toHaveCount(0);
        expect(readSettings(userData).maxResolution ?? 'best').toBe('best');
        expect(readSettings(userData).videoContainer ?? 'mp4').toBe('mp4');
        expect(readSettings(userData).audioOnly ?? false).toBe(false);
        await expect(page.getByLabel('Link 1', { exact: true })).toHaveValue('');
        await expect(page.getByRole('button', { name: 'Options for link 1' })).toHaveClass(/btn--ghost/);
        await expect(page.getByRole('button', { name: /Options for link 2/ })).toHaveCount(0);
    });

    test('downloads only the audio of one link', async () => {
        const { page, logPath } = session;
        await page.getByLabel('Link 1', { exact: true }).fill('https://example.com/watch?v=music');
        const dialog = await openOptions(page, 1);
        await dialog.getByLabel('Audio only').selectOption('on');
        await dialog.getByLabel('Audio format').selectOption('opus');
        await dialog.getByRole('button', { name: 'APPLY' }).click();
        await page.getByRole('button', { name: 'DOWNLOAD', exact: true }).click();
        await expectDownloadsComplete(page, 1);
        const args = lastYtdlpCall(logPath, 'v=music');
        expect(args).toEqual(expect.arrayContaining(['-x', '--audio-format', 'opus']));
        expect(args).not.toContain('--merge-output-format');
    });

    test('keeps following the settings for what the link does not choose', async () => {
        const { page, logPath } = await relaunchWith({ maxResolution: '1080', videoContainer: 'webm' });
        await page.getByLabel('Link 1', { exact: true }).fill('https://example.com/watch?v=follow');
        const dialog = await openOptions(page, 1);
        await expect(dialog.getByLabel('Video quality').locator('option').first()).toHaveText('Use the setting (Up to 1080p)');
        await dialog.getByLabel('Video container').selectOption('mkv');
        await dialog.getByRole('button', { name: 'APPLY' }).click();
        await page.getByRole('button', { name: 'DOWNLOAD', exact: true }).click();
        await expectDownloadsComplete(page, 1);
        const args = lastYtdlpCall(logPath, 'v=follow');
        expect(formatOf(args)).toBe('bv*[height<=1080]+ba/b[height<=1080]');
        expect(containerOf(args)).toBe('mkv');
    });

    test('keeps the options when the download is retried', async () => {
        const { page, logPath } = session;
        await page.getByLabel('Link 1', { exact: true }).fill('https://example.com/fail');
        const dialog = await openOptions(page, 1);
        await dialog.getByLabel('Video quality').selectOption('480');
        await dialog.getByRole('button', { name: 'APPLY' }).click();
        await page.getByRole('button', { name: 'DOWNLOAD', exact: true }).click();
        const banner = page.getByRole('alert').filter({ hasText: 'Video unavailable' });
        await expect(banner).toBeVisible();
        await banner.getByRole('button', { name: 'RETRY' }).click();
        await expect.poll(() => {
            return readCalls(logPath).filter((call) => {
                return call.at(-1)?.endsWith('fail');
            }).length;
        }).toBe(2);
        readCalls(logPath)
            .filter((call) => {
                return call.at(-1)?.endsWith('fail');
            })
            .forEach((call) => {
                expect(formatOf(call)).toBe('bv*[height<=480]+ba/b[height<=480]');
            });
        await expect(page.getByTestId('job-card').getByText('CUSTOM')).toBeVisible();
    });

    test('waits for a scheduled live stream only for the link that asked for it', async () => {
        const { page, logPath, userData } = session;
        await page.getByLabel('Link 1', { exact: true }).fill('https://example.com/livewait');
        const dialog = await openOptions(page, 1);
        await dialog.getByLabel('Wait for scheduled live streams to start').selectOption('on');
        await dialog.getByRole('button', { name: 'APPLY' }).click();
        await page.getByRole('button', { name: 'DOWNLOAD', exact: true }).click();

        const card = page.getByTestId('job-card');
        await expect(card.locator('.badge').filter({ hasText: 'WAITING FOR LIVE' })).toBeVisible();
        const args = lastYtdlpCall(logPath, 'livewait');
        expect(args[args.indexOf('--wait-for-video') + 1]).toBe('30');
        expect(args).toContain('--no-quiet');
        expect(readSettings(userData).waitForLive ?? false).toBe(false);
        await expect(card.locator('.badge').filter({ hasText: 'RECORDING' })).toBeVisible({ timeout: 10000 });
        await card.getByRole('button', { name: 'STOP & SAVE' }).click();
        await expectDownloadsComplete(page);
    });

    test('checks the end of one live stream with its own seconds while the settings keep the check off', async () => {
        const { page, userData } = session;
        await page.getByLabel('Link 1', { exact: true }).fill('https://example.com/liveend');
        const dialog = await openOptions(page, 1);
        const seconds = dialog.getByLabel('Seconds to keep checking');
        await expect(seconds).toBeDisabled();
        await dialog.getByLabel('Double-check that a live stream really ended').selectOption('on');
        await expect(seconds).toBeEnabled();
        await seconds.fill('3');
        await dialog.getByRole('button', { name: 'APPLY' }).click();
        await page.getByRole('button', { name: 'DOWNLOAD', exact: true }).click();

        const card = page.getByTestId('job-card');
        await expect(card.locator('.badge').filter({ hasText: 'VERIFYING END' })).toBeVisible();
        await expectDownloadsComplete(page, 1, 12000);
        expect(readSettings(userData).verifyLiveEnd).toBe(false);
        expect(readSettings(userData).verifyLiveEndSeconds ?? 10).toBe(10);
    });

    test('works with the keyboard: Tab stays inside the window and Escape gives the focus back', async () => {
        const { page } = session;
        await page.getByRole('button', { name: 'Options for link 1' }).focus();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog', { name: 'Options for link 1' });
        await expect(dialog.getByLabel('Video quality')).toBeFocused();
        await page.getByRole('button', { name: 'APPLY' }).focus();
        await page.keyboard.press('Tab');
        await expect(dialog.getByLabel('Video quality')).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect(page.getByRole('button', { name: 'APPLY' })).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Options for link 1' })).toBeFocused();
    });

    test('is translated with the rest of the app', async () => {
        const { page } = await relaunchWith({ language: 'pt' });
        await page.getByRole('button', { name: 'Opções do link 1' }).click();
        const dialog = page.getByRole('dialog', { name: 'Opções do link 1' });
        await expect(dialog.getByText('Só o que você mudar aqui vale para este download. O resto segue as Configurações.')).toBeVisible();
        await expect(dialog.getByLabel('Qualidade do vídeo').locator('option').first()).toHaveText('Usar a configuração (A melhor disponível)');
        await expect(dialog.getByRole('button', { name: 'APLICAR' })).toBeVisible();
    });
});

test.describe('folder for one download', () => {
    async function stubFolderDialog(own: Session, folder: string | null): Promise<void> {
        await own.app.evaluate(({ dialog }, chosen) => {
            dialog.showOpenDialog = (async () => {
                return { canceled: chosen === null, filePaths: chosen === null ? [] : [chosen] };
            }) as unknown as typeof dialog.showOpenDialog;
        }, folder);
    }

    test('sends one link to the chosen folder and keeps the others in the settings folder', async () => {
        const { page, logPath, downloadDir } = session;
        const otherFolder = join(downloadDir, '..', 'other-place');
        await stubFolderDialog(session, otherFolder);

        await page.getByLabel('Link 1', { exact: true }).fill('https://example.com/watch?v=first');
        await page.getByRole('button', { name: '+ ADD LINK' }).click();
        await page.getByLabel('Link 2', { exact: true }).fill('https://example.com/watch?v=second');
        await page.getByRole('button', { name: 'Choose folder for link 2' }).click();
        await expect(page.getByText(`Saving to: ${otherFolder}`)).toBeVisible();
        await page.getByRole('button', { name: 'DOWNLOAD', exact: true }).click();

        await expectDownloadsComplete(page, 2);
        const pathOf = (args: string[]): string => {
            return args[args.indexOf('-P') + 1] ?? '';
        };
        expect(pathOf(lastYtdlpCall(logPath, 'v=first'))).toBe(downloadDir);
        expect(pathOf(lastYtdlpCall(logPath, 'v=second'))).toBe(otherFolder);
    });

    test('keeps the chosen folder when the download is retried', async () => {
        const { page, logPath } = session;
        const otherFolder = join(session.downloadDir, '..', 'retry-place');
        await stubFolderDialog(session, otherFolder);
        await page.getByLabel('Link 1', { exact: true }).fill('https://example.com/fail');
        await page.getByRole('button', { name: 'Choose folder for link 1' }).click();
        await expect(page.getByText(`Saving to: ${otherFolder}`)).toBeVisible();
        await page.getByRole('button', { name: 'DOWNLOAD', exact: true }).click();
        const banner = page.getByRole('alert').filter({ hasText: 'Video unavailable' });
        await expect(banner).toBeVisible();
        await banner.getByRole('button', { name: 'RETRY' }).click();
        await expect.poll(() => {
            return readCalls(logPath).filter((call) => {
                return call.at(-1)?.endsWith('/fail');
            }).length;
        }).toBe(2);
        const folders = readCalls(logPath)
            .filter((call) => {
                return call.at(-1)?.endsWith('/fail');
            })
            .map((call) => {
                return call[call.indexOf('-P') + 1];
            });
        expect(folders).toEqual([otherFolder, otherFolder]);
    });

    test('a cancelled folder dialog leaves the link on the default folder', async () => {
        const { page, logPath, downloadDir } = session;
        await stubFolderDialog(session, null);
        await page.getByLabel('Link 1', { exact: true }).fill('https://example.com/watch?v=plain');
        await page.getByRole('button', { name: 'Choose folder for link 1' }).click();
        await expect(page.getByText(/Saving to:/)).toHaveCount(0);
        await page.getByRole('button', { name: 'DOWNLOAD', exact: true }).click();
        await expectDownloadsComplete(page);
        const args = lastYtdlpCall(logPath, 'v=plain');
        expect(args[args.indexOf('-P') + 1]).toBe(downloadDir);
    });
});

test('app updates are reported as unsupported outside the installed app', async () => {
    const { page } = session;
    await openGlobalSettings(page);
    await expect(page.getByText(/^Current version: \d+\.\d+\.\d+/)).toBeVisible();
    await page.getByRole('button', { name: 'CHECK FOR UPDATES' }).click();
    await expect(page.getByText('Updates are only available in the installed app.')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'is available' })).toHaveCount(0);
});

test('the startup update check setting is saved', async () => {
    const { page, userData } = session;
    await openGlobalSettings(page);
    await expect(page.getByLabel('Check for updates on startup')).toBeChecked();
    await page.getByLabel('Check for updates on startup').uncheck();
    await expect(page.getByText('All changes saved.')).toBeVisible();
    expect(readSettings(userData).checkUpdatesOnStart).toBe(false);
});

function countProcesses(marker: string): number {
    try {
        return Number(execFileSync('pgrep', ['-fc', marker], { encoding: 'utf-8' }).trim());
    } catch {
        return 0;
    }
}

test('closing the app stops downloads that are still running', async () => {
    const own = await launch();
    try {
        const marker = 'example.com/quiet-shutdown-check';
        await own.page.getByLabel('Link 1', { exact: true }).fill(`https://${marker}`);
        await own.page.getByRole('button', { name: 'DOWNLOAD', exact: true }).click();
        await expect(own.page.locator('.badge', { hasText: 'DOWNLOADING' })).toBeVisible();
        await expect.poll(() => {
            return countProcesses(marker);
        }).toBeGreaterThan(0);

        await own.app.close();

        await expect.poll(() => {
            return countProcesses(marker);
        }, { timeout: 8000 }).toBe(0);
    } finally {
        rmSync(resolve(own.userData, '..'), { recursive: true, force: true });
    }
});

async function closeQuietly(own: Session): Promise<void> {
    await own.app.close().catch(() => {
        return undefined;
    });
    rmSync(resolve(own.userData, '..'), { recursive: true, force: true });
}

function windowVisible(own: Session): Promise<boolean> {
    return own.app.evaluate(({ BrowserWindow }) => {
        return BrowserWindow.getAllWindows()[0]?.isVisible() ?? false;
    });
}

async function closeMainWindow(own: Session): Promise<void> {
    await own.app
        .evaluate(({ BrowserWindow }) => {
            BrowserWindow.getAllWindows()[0]?.close();
        })
        .catch(() => {
            return undefined;
        });
}

function appExited(own: Session): boolean {
    return own.hasExited();
}

async function stubQuitDialog(own: Session, response: number): Promise<void> {
    await own.app.evaluate(({ dialog }, answer) => {
        const holder = globalThis as unknown as { quitPrompts: string[] };
        holder.quitPrompts = [];
        dialog.showMessageBox = (async (...args: unknown[]) => {
            const options = args[args.length - 1] as { message: string };
            holder.quitPrompts.push(options.message);
            return { response: answer, checkboxChecked: false };
        }) as typeof dialog.showMessageBox;
    }, response);
}

function quitPrompts(own: Session): Promise<string[]> {
    return own.app.evaluate(() => {
        return (globalThis as unknown as { quitPrompts: string[] }).quitPrompts;
    });
}

const KDE_ENV = { XDG_CURRENT_DESKTOP: 'KDE' };
const GNOME_WITHOUT_TRAY_ENV = { XDG_CURRENT_DESKTOP: 'GNOME', PATH: '/nonexistent' };

test.describe('close to tray', () => {
    test('is off by default: closing the window quits the app', async () => {
        const own = await launch({ env: KDE_ENV });
        try {
            await closeMainWindow(own);
            await expect.poll(() => {
                return appExited(own);
            }, { timeout: 8000 }).toBe(true);
        } finally {
            await closeQuietly(own);
        }
    });

    test('hides the window instead of quitting and a second launch brings it back', async () => {
        const own = await launch({ env: KDE_ENV, settings: { closeToTray: true } });
        try {
            await own.page.waitForTimeout(500);
            expect(await windowVisible(own)).toBe(true);

            await closeMainWindow(own);
            await expect.poll(() => {
                return windowVisible(own);
            }).toBe(false);
            expect(appExited(own)).toBe(false);

            const second = spawnSync(ELECTRON_PATH, [ROOT, '--no-sandbox', `--user-data-dir=${own.userData}`], { timeout: 20000, env: { ...process.env, ...KDE_ENV } });
            expect(second.status).toBe(0);
            await expect.poll(() => {
                return windowVisible(own);
            }).toBe(true);
            expect(appExited(own)).toBe(false);
        } finally {
            await closeQuietly(own);
        }
    });

    test('keeps downloads running while the window is hidden', async () => {
        const own = await launch({ env: KDE_ENV, settings: { closeToTray: true } });
        try {
            const marker = 'example.com/slow-tray-check';
            await own.page.waitForTimeout(500);
            await own.page.getByLabel('Link 1', { exact: true }).fill(`https://${marker}`);
            await own.page.getByRole('button', { name: 'DOWNLOAD', exact: true }).click();
            await expect(own.page.locator('.badge', { hasText: 'DOWNLOADING' })).toBeVisible();

            await closeMainWindow(own);
            await expect.poll(() => {
                return windowVisible(own);
            }).toBe(false);
            await own.page.waitForTimeout(800);
            expect(countProcesses(marker)).toBeGreaterThan(0);

            spawnSync(ELECTRON_PATH, [ROOT, '--no-sandbox', `--user-data-dir=${own.userData}`], { timeout: 20000, env: { ...process.env, ...KDE_ENV } });
            await expect.poll(() => {
                return windowVisible(own);
            }).toBe(true);
            await expect(own.page.locator('.badge', { hasText: 'DOWNLOADING' })).toBeVisible();

            await own.app.evaluate(({ app }) => {
                app.quit();
            }).catch(() => {
                return undefined;
            });
            await expect.poll(() => {
                return countProcesses(marker);
            }, { timeout: 8000 }).toBe(0);
        } finally {
            await closeQuietly(own);
        }
    });

    test('can be turned on from the settings without a warning when a tray exists', async () => {
        const own = await launch({ env: KDE_ENV });
        try {
            await openGlobalSettings(own.page);
            const toggle = own.page.getByLabel('Keep running in the system tray when the window is closed');
            await expect(toggle).not.toBeChecked();
            await toggle.check();
            await expect(own.page.getByText('All changes saved.')).toBeVisible();
            expect(readSettings(own.userData).closeToTray).toBe(true);
            await expect(own.page.getByRole('alert')).toHaveCount(0);
            await own.page.waitForTimeout(500);

            await closeMainWindow(own);
            await expect.poll(() => {
                return windowVisible(own);
            }).toBe(false);
            expect(appExited(own)).toBe(false);
        } finally {
            await closeQuietly(own);
        }
    });

    test('on GNOME without a tray it warns and closing the window still quits the app', async () => {
        const own = await launch({ env: GNOME_WITHOUT_TRAY_ENV, settings: { closeToTray: true } });
        try {
            await openGlobalSettings(own.page);
            await expect(own.page.getByRole('alert')).toContainText('AppIndicator and KStatusNotifierItem Support');

            await closeMainWindow(own);
            await expect.poll(() => {
                return appExited(own);
            }, { timeout: 8000 }).toBe(true);
        } finally {
            await closeQuietly(own);
        }
    });
});

test.describe('quitting with downloads in progress', () => {
    test('asks first and keeps everything running when the user cancels', async () => {
        const own = await launch({ env: KDE_ENV });
        try {
            const marker = 'example.com/slow-cancel-quit-check';
            await stubQuitDialog(own, 1);
            await own.page.getByLabel('Link 1', { exact: true }).fill(`https://${marker}`);
            await own.page.getByRole('button', { name: 'DOWNLOAD', exact: true }).click();
            await expect(own.page.locator('.badge', { hasText: 'DOWNLOADING' })).toBeVisible();

            await closeMainWindow(own);
            await expect.poll(() => {
                return quitPrompts(own);
            }).toEqual(['1 download is still in progress.']);
            expect(appExited(own)).toBe(false);
            expect(await windowVisible(own)).toBe(true);
            expect(countProcesses(marker)).toBeGreaterThan(0);
            await expect(own.page.locator('.badge', { hasText: 'DOWNLOADING' })).toBeVisible();
        } finally {
            await closeQuietly(own);
        }
    });

    test('quits and stops the download when the user confirms', async () => {
        const own = await launch({ env: KDE_ENV });
        try {
            const marker = 'example.com/slow-confirm-quit-check';
            await stubQuitDialog(own, 0);
            await own.page.getByLabel('Link 1', { exact: true }).fill(`https://${marker}`);
            await own.page.getByRole('button', { name: 'DOWNLOAD', exact: true }).click();
            await expect(own.page.locator('.badge', { hasText: 'DOWNLOADING' })).toBeVisible();

            await closeMainWindow(own);
            await expect.poll(() => {
                return appExited(own);
            }, { timeout: 8000 }).toBe(true);
            await expect.poll(() => {
                return countProcesses(marker);
            }, { timeout: 8000 }).toBe(0);
        } finally {
            await closeQuietly(own);
        }
    });

    test('quits without asking when nothing is downloading', async () => {
        const own = await launch({ env: KDE_ENV });
        try {
            await stubQuitDialog(own, 1);
            await closeMainWindow(own);
            await expect.poll(() => {
                return appExited(own);
            }, { timeout: 8000 }).toBe(true);
        } finally {
            await closeQuietly(own);
        }
    });
});

// ---- finding the stream of a page that yt-dlp does not understand (local pages, no external site involved)
const PAGES: Record<string, string> = {
    '/unsupported/static.html': '<html><head><title>Static Episode</title></head><body><video controls><source src="/media/static-clip.mp4" type="video/mp4"></video></body></html>',
    '/unsupported/embed.html': '<html><head><title>Embed Page</title></head><body><iframe src="/player/inner.html"></iframe></body></html>',
    '/player/inner.html': '<html><body><script>var config = {"hls": "\\/media\\/inner-master.m3u8"};</script></body></html>',
    '/unsupported/dynamic.html': `<html><head><title>Dynamic Episode</title></head><body><script>
        var parts = ['/me', 'dia/dyn', 'amic.m3u8'];
        window.addEventListener('load', function () {
            var video = document.createElement('video');
            video.muted = true;
            video.src = parts.join('');
            document.body.appendChild(video);
            video.play().catch(function () {});
        });
    </script></body></html>`,
    '/unsupported/none.html': '<html><head><title>Nothing here</title></head><body><p>No video on this page.</p></body></html>'
};

// A player like the ones embedded from video hosts: it lives in an iframe of ANOTHER origin, below the fold,
// only arms itself once the page is visible, needs a user gesture to start, and then asks for the video through
// a signed address without file extension.
const FRAME_PLAYER = `<html><body style="margin:0"><video id="v" muted playsinline width="640" height="360"></video>
<div id="overlay" style="position:absolute;inset:0;background:#000;display:flex;align-items:center;justify-content:center"><button id="play" style="font-size:40px">PLAY</button></div>
<script>
  var armed = false;
  function arm() { armed = true; }
  if (document.visibilityState === 'visible') { arm(); } else { document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') { arm(); } }); }
  document.getElementById('overlay').addEventListener('click', function () {
    if (!armed || !navigator.userActivation.isActive) { return; }
    var video = document.getElementById('v');
    video.src = '/videoplayback?expire=1999999999&ip=203.0.113.9&id=7081&itag=18&mime=video%2Fmp4&sig=AbC123';
    video.play().catch(function () {});
  });
</script></body></html>`;

function nestedPlayerPage(port: number): string {
    return `<html><head><title>Nested Player</title></head><body><h1>Episode</h1>
        <div style="height:1600px">spacer</div>
        <iframe src="http://localhost:${port}/frame/player.html" width="640" height="360" loading="lazy"></iframe></body></html>`;
}

// The same video asked for through two almost identical addresses (another host and another session parameter),
// like a mirror or a redirect would produce.
function variantsPage(port: number): string {
    const query = 'id=abc123&itag=18&mime=video%2Fmp4&sig=Sig&expire=1999999999&cpn=session&r1=1&r2=2';
    return `<html><head><title>Variants</title></head><body><script>
        window.addEventListener('load', function () {
            ['/videoplayback?${query}&extra=one', 'http://localhost:${port}/videoplayback?${query}&extra=two'].forEach(function (source) {
                var video = document.createElement('video');
                video.muted = true;
                video.src = source;
                document.body.appendChild(video);
                video.play().catch(function () {});
            });
        });
    </script></body></html>`;
}

// A page whose script asks for one video through the given addresses (what a player does once it starts).
function mediaPage(title: string, sources: string[]): string {
    return `<html><head><title>${title}</title></head><body><script>
        window.addEventListener('load', function () {
            ${JSON.stringify(sources)}.forEach(function (source) {
                var video = document.createElement('video');
                video.muted = true;
                video.src = source;
                document.body.appendChild(video);
                video.play().catch(function () {});
            });
        });
    </script></body></html>`;
}

const SIGNED = 'id=bound1&itag=18&mime=video%2Fmp4&sig=Sig&expire=1999999999&cpn=session';

function startLocalSite(): Promise<{ server: Server; origin: string }> {
    return new Promise((resolvePromise) => {
        const server = createServer((request, response) => {
            const path = (request.url ?? '/').split('?')[0] ?? '/';
            if (path === '/unsupported/bound-v4.html') {
                response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
                response.end(mediaPage('Bound IPv4', [`/videoplayback?${SIGNED}&ip=203.0.113.9`]));
            } else if (path === '/unsupported/bound-v6.html') {
                response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
                response.end(mediaPage('Bound IPv6', [`/videoplayback?${SIGNED}&ip=2001%3Adb8%3A%3A1`]));
            } else if (path === '/unsupported/stale.html') {
                response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
                response.end(mediaPage('Stale Stream', [`/forbidden/videoplayback?${SIGNED}`]));
            } else if (path === '/unsupported/variants.html') {
                response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
                response.end(variantsPage((server.address() as AddressInfo).port));
            } else if (path === '/unsupported/nested.html') {
                response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
                response.end(nestedPlayerPage((server.address() as AddressInfo).port));
            } else if (path === '/frame/player.html') {
                response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
                response.end(FRAME_PLAYER);
            } else if (path.endsWith('/videoplayback')) {
                response.writeHead(206, { 'content-type': 'video/mp4', 'content-length': 300000, 'content-range': 'bytes 0-299999/300000', 'accept-ranges': 'bytes' });
                response.end(Buffer.alloc(300000));
            } else if (PAGES[path]) {
                response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
                response.end(PAGES[path]);
            } else if (path.endsWith('.m3u8')) {
                response.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
                response.end('#EXTM3U\n#EXT-X-ENDLIST\n');
            } else if (path.endsWith('.mp4')) {
                response.writeHead(200, { 'content-type': 'video/mp4' });
                response.end(Buffer.alloc(2048));
            } else {
                response.writeHead(404, { 'content-type': 'text/plain' });
                response.end('not found');
            }
        });
        server.listen(0, '127.0.0.1', () => {
            resolvePromise({ server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
        });
    });
}

function lastYtdlpCall(logPath: string, urlEnding: string): string[] {
    return (
        readCalls(logPath)
            .filter((call) => {
                return call.at(-1)?.endsWith(urlEnding);
            })
            .at(-1) ?? []
    );
}

test.describe('live streams', () => {
    test('records a live stream with time and size, then STOP & SAVE keeps the file', async () => {
        const { page, downloadDir } = session;
        await submitUrl(page, 'https://example.com/livestream');

        const card = page.getByTestId('job-card');
        await expect(card.locator('.badge')).toHaveText('RECORDING');
        await expect(card.getByText('● LIVE')).toBeVisible();
        await expect(card.getByRole('progressbar', { name: 'Recording a live stream' })).toHaveClass(/progress--live/);
        await expect(card.getByText(/\d+(\.\d)? KiB/)).toBeVisible();
        await expect(card.getByText(/^\d\d:\d\d$/)).toBeVisible();

        await card.getByRole('button', { name: 'STOP & SAVE' }).click();
        await expectDownloadsComplete(page);
        await expect(card).toHaveCount(0);
        expect(existsSync(join(downloadDir, 'Live Show [abc].mp4'))).toBe(true);
        expect(existsSync(join(downloadDir, 'Live Show [abc].mp4.part'))).toBe(false);

        await page.getByRole('button', { name: 'HISTORY' }).click();
        await expect(page.locator('.history__item--done')).toHaveCount(1);
    });

    test('CANCEL on a live recording discards it instead of saving', async () => {
        const { page } = session;
        await submitUrl(page, 'https://example.com/livestream');

        const card = page.getByTestId('job-card');
        await expect(card.locator('.badge')).toHaveText('RECORDING');
        await card.getByRole('button', { name: 'CANCEL' }).click();
        await expect(card.locator('.badge')).toHaveText('CANCELLED');
        await expect(card.getByRole('button', { name: 'STOP & SAVE' })).toHaveCount(0);
    });

    test('an ordinary download has no STOP & SAVE', async () => {
        const { page } = session;
        await submitUrl(page, 'https://example.com/slow');

        const card = page.getByTestId('job-card');
        await expect(card.locator('.badge')).toHaveText('DOWNLOADING');
        await expect(card.getByRole('button', { name: 'STOP & SAVE' })).toHaveCount(0);
        await card.getByRole('button', { name: 'CANCEL' }).click();
    });

    test('the live settings are saved and passed to yt-dlp', async () => {
        const { page, userData, logPath } = session;
        await openDownloadsSettings(page);
        await page.getByLabel('Record live streams from the start').check();
        await page.getByLabel('Wait for scheduled live streams to start').check();
        await expect(page.getByText('All changes saved.')).toBeVisible({ timeout: 6000 });
        expect(readSettings(userData)).toMatchObject({ liveFromStart: true, waitForLive: true });

        await page.getByRole('button', { name: 'QUEUE', exact: true }).click();
        await submitUrl(page, 'https://example.com/watch?v=live-settings');
        await expectDownloadsComplete(page);
        const args = lastYtdlpCall(logPath, 'live-settings');
        expect(args).toContain('--wait-for-video');
        expect(args[args.indexOf('--wait-for-video') + 1]).toBe('30');
        expect(args).toContain('--live-from-start');
    });

    test('live options are not passed by default', async () => {
        const { page, logPath } = session;
        await submitUrl(page, 'https://example.com/watch?v=live-default');
        await expectDownloadsComplete(page);
        const args = lastYtdlpCall(logPath, 'live-default');
        expect(args).not.toContain('--wait-for-video');
        expect(args).not.toContain('--live-from-start');
    });
});

test.describe('end of live check and waiting for a live stream', () => {
    // Starts the app again with other settings; the session of the test is replaced.
    async function relaunchWith(settings: Record<string, unknown>): Promise<Session> {
        await session.app.close();
        rmSync(resolve(session.userData, '..'), { recursive: true, force: true });
        session = await launch({ settings });
        return session;
    }

    function callsFor(logPath: string, urlEnding: string): string[][] {
        return readCalls(logPath).filter((call) => {
            return call.at(-1)?.endsWith(urlEnding);
        });
    }

    test('is on by default for 10 seconds and its seconds follow the checkbox', async () => {
        const { page, userData } = await relaunchWith({ verifyLiveEnd: undefined });
        await openDownloadsSettings(page);
        const checkbox = page.getByLabel('Double-check that a live stream really ended');
        const seconds = page.getByLabel('Seconds to keep checking');
        await expect(checkbox).toBeChecked();
        await expect(seconds).toHaveValue('10');
        await expect(seconds).toBeEnabled();

        await checkbox.uncheck();
        await expect(seconds).toBeDisabled();
        await expect(page.getByText('All changes saved.')).toBeVisible({ timeout: 6000 });
        expect(readSettings(userData)).toMatchObject({ verifyLiveEnd: false, verifyLiveEndSeconds: 10 });

        await checkbox.check();
        await expect(seconds).toBeEnabled();
        await seconds.fill('7');
        await expect(page.getByText('All changes saved.')).toBeVisible({ timeout: 6000 });
        await expect.poll(() => {
            return readSettings(userData);
        }).toMatchObject({ verifyLiveEnd: true, verifyLiveEndSeconds: 7 });
    });

    test('a live stream that ended is finished right away when the check is off', async () => {
        const { page, logPath } = session;
        await submitUrl(page, 'https://example.com/liveend');
        const card = page.getByTestId('job-card');
        await expectDownloadsComplete(page);
        await expect(card).toHaveCount(0);
        expect(callsFor(logPath, 'liveend')).toHaveLength(1);
    });

    test('shows the check while it runs, asks yt-dlp again and finishes when the stream did not come back', async () => {
        const { page, downloadDir, logPath } = await relaunchWith({ verifyLiveEnd: true, verifyLiveEndSeconds: 4 });
        await submitUrl(page, 'https://example.com/liveend');

        const card = page.getByTestId('job-card');
        await expect(card.locator('.badge')).toHaveText('VERIFYING END');
        await expect(card).toHaveClass(/job--verifying/);
        await expect(card.getByRole('progressbar', { name: 'Checking whether the live stream really ended' })).toHaveClass(/progress--verify/);
        await expect(card.getByText(/^The stream stopped\. Checking whether it really ended… [1-4]s$/)).toBeVisible();
        await expect(card.getByRole('button', { name: 'FINISH NOW' })).toBeVisible();
        await expect(card.getByRole('button', { name: 'CANCEL' })).toHaveCount(0);

        await expectDownloadsComplete(page, 1, 15000);
        await expect(card).toHaveCount(0);
        expect(existsSync(join(downloadDir, 'Live End [abc].mp4'))).toBe(true);
        const calls = callsFor(logPath, 'liveend');
        expect(calls.length).toBeGreaterThanOrEqual(2);
        expect(calls[0]).not.toContain('--match-filter');
        calls.slice(1).forEach((call) => {
            expect(call[call.indexOf('--match-filter') + 1]).toBe('is_live');
            expect(call[call.indexOf('-o') + 1]).toBe('%(title).80s [%(id)s] (part 2).%(ext)s');
        });
        await page.getByRole('button', { name: 'HISTORY' }).click();
        await expect(page.locator('.history__item--done')).toHaveCount(1);
    });

    test('keeps recording in the same card when the stream comes back and joins the parts into one file', async () => {
        const { page, downloadDir } = await relaunchWith({ verifyLiveEnd: true, verifyLiveEndSeconds: 6, ffmpegPath: FAKE_FFMPEG });
        await submitUrl(page, 'https://example.com/liveback');

        const card = page.getByTestId('job-card');
        await expect(card.locator('.badge')).toHaveText('VERIFYING END');
        await expect(card.locator('.badge')).toHaveText('RECORDING', { timeout: 10000 });
        await expect(card).not.toHaveClass(/job--verifying/);
        await expect(card.getByText('● LIVE')).toBeVisible();
        await expect(page.getByTestId('job-card')).toHaveCount(1);

        await card.getByRole('button', { name: 'STOP & SAVE' }).click();
        await expect(card.locator('.badge')).toHaveText('SAVING FILE');
        await expect(card).toHaveClass(/job--saving/);
        await expect(card.getByText('Saving the recording. Do not close the app')).toBeVisible();
        await expect(card.getByRole('button')).toHaveCount(0);
        await expect(card.locator('.badge')).toHaveText('JOINING PARTS');
        await expect(card).toHaveClass(/job--merging/);
        await expect(card.getByText('Joining the parts of the recording into one file')).toBeVisible();
        await expect(card.getByRole('button')).toHaveCount(0);
        await expectDownloadsComplete(page);
        await expect(card).toHaveCount(0);
        expect(readdirSync(downloadDir)).toEqual(['Live Back [abc].mp4']);
        expect(statSync(join(downloadDir, 'Live Back [abc].mp4')).size).toBeGreaterThan(2048);
        await page.getByRole('button', { name: 'HISTORY' }).click();
        await expect(page.locator('.history__item--done')).toHaveCount(1);
    });

    test('keeps every part in the folder when they cannot be joined', async () => {
        const { page, downloadDir } = await relaunchWith({ verifyLiveEnd: true, verifyLiveEndSeconds: 6, ffmpegPath: '/nonexistent/ffmpeg' });
        await submitUrl(page, 'https://example.com/liveback');

        const card = page.getByTestId('job-card');
        await expect(card.locator('.badge')).toHaveText('VERIFYING END');
        await expect(card.locator('.badge')).toHaveText('RECORDING', { timeout: 10000 });
        await card.getByRole('button', { name: 'STOP & SAVE' }).click();
        await expectDownloadsComplete(page);
        expect(readdirSync(downloadDir).sort()).toEqual(['Live Back [abc] (part 2).mp4', 'Live Back [abc].mp4']);
        await page.getByRole('button', { name: 'HISTORY' }).click();
        await expect(page.locator('.history__item--done')).toHaveCount(1);
    });

    test('FINISH NOW ends the check at once', async () => {
        const { page, downloadDir, logPath } = await relaunchWith({ verifyLiveEnd: true, verifyLiveEndSeconds: 60 });
        await submitUrl(page, 'https://example.com/liveend');

        const card = page.getByTestId('job-card');
        await expect(card.locator('.badge')).toHaveText('VERIFYING END');
        await card.getByRole('button', { name: 'FINISH NOW' }).click();
        await expectDownloadsComplete(page, 1, 3000);
        expect(existsSync(join(downloadDir, 'Live End [abc].mp4'))).toBe(true);
        const callsAfter = callsFor(logPath, 'liveend').length;
        await page.waitForTimeout(2500);
        expect(callsFor(logPath, 'liveend')).toHaveLength(callsAfter);
    });

    test('STOP & SAVE on a live recording is final: it is not checked again', async () => {
        const { page, logPath } = await relaunchWith({ verifyLiveEnd: true, verifyLiveEndSeconds: 6 });
        await submitUrl(page, 'https://example.com/livestream');
        const card = page.getByTestId('job-card');
        await expect(card.locator('.badge')).toHaveText('RECORDING');
        await card.getByRole('button', { name: 'STOP & SAVE' }).click();
        await expectDownloadsComplete(page);
        expect(callsFor(logPath, 'livestream')).toHaveLength(1);
    });

    test('shows that it is waiting for a scheduled live stream and goes on when it starts', async () => {
        const { page, downloadDir, logPath } = await relaunchWith({ waitForLive: true });
        await submitUrl(page, 'https://example.com/livewait');

        const card = page.getByTestId('job-card');
        await expect(card.locator('.badge')).toHaveText('WAITING FOR LIVE');
        await expect(card).toHaveClass(/job--waiting/);
        await expect(card.getByRole('progressbar', { name: 'Waiting for the live stream to start' })).toHaveClass(/progress--waiting/);
        await expect(card.getByText('Waiting for the live stream to start', { exact: true }).first()).toBeVisible();
        await expect(card.getByRole('button', { name: 'CANCEL' })).toBeVisible();
        expect(lastYtdlpCall(logPath, 'livewait')).toContain('--no-quiet');

        await expect(card.locator('.badge')).toHaveText('RECORDING', { timeout: 10000 });
        await expect(card).not.toHaveClass(/job--waiting/);
        await card.getByRole('button', { name: 'STOP & SAVE' }).click();
        await expectDownloadsComplete(page);
        expect(existsSync(join(downloadDir, 'Live Wait [abc].mp4'))).toBe(true);
    });

    test('a download that is not waiting for a live stream has no waiting effect', async () => {
        const { page } = session;
        await submitUrl(page, 'https://example.com/livewait');
        const card = page.getByTestId('job-card');
        await expect(card.locator('.badge')).toHaveText('RECORDING', { timeout: 10000 });
        await expect(card).not.toHaveClass(/job--waiting/);
        await expect(card.locator('.badge')).not.toHaveText('WAITING FOR LIVE');
        await card.getByRole('button', { name: 'STOP & SAVE' }).click();
    });
});

test.describe('stopping and cancelling a recording whose ffmpeg is left behind', () => {
    function orphanPid(): number {
        return Number(readFileSync(`${session.logPath}.orphan`, 'utf-8'));
    }

    function isAlive(pid: number): boolean {
        try {
            process.kill(pid, 0);
            return true;
        } catch {
            return false;
        }
    }

    test('CANCEL ends the recording and the process it started, instead of leaving the card recording', async () => {
        const { page } = session;
        await submitUrl(page, 'https://example.com/liveorphan');
        const card = page.getByTestId('job-card');
        await expect(card.locator('.badge')).toHaveText('RECORDING');
        await expect.poll(() => {
            return existsSync(`${session.logPath}.orphan`);
        }).toBe(true);
        const pid = orphanPid();
        expect(isAlive(pid)).toBe(true);

        await card.getByRole('button', { name: 'CANCEL' }).click();
        await expect(card.locator('.badge')).toHaveText('CANCELLED', { timeout: 8000 });
        await expect.poll(() => {
            return isAlive(pid);
        }).toBe(false);
        await expect(card.getByRole('button', { name: 'RETRY' })).toBeVisible();
    });

    test('STOP & SAVE does not leave the card recording when yt-dlp leaves a process holding the pipes', async () => {
        const { page, downloadDir } = session;
        await submitUrl(page, 'https://example.com/liveleftover');
        const card = page.getByTestId('job-card');
        await expect(card.locator('.badge')).toHaveText('RECORDING');
        await expect.poll(() => {
            return existsSync(`${session.logPath}.orphan`);
        }).toBe(true);
        const pid = orphanPid();

        await card.getByRole('button', { name: 'STOP & SAVE' }).click();
        await expectDownloadsComplete(page, 1, 8000);
        expect(existsSync(join(downloadDir, 'Live Orphan [abc].mp4'))).toBe(true);
        await expect.poll(() => {
            return isAlive(pid);
        }).toBe(false);
    });

    test('STOP & SAVE ends a recording that ignores Ctrl+C, after a while, and does not leave anything running', async () => {
        test.setTimeout(60000);
        const { page } = session;
        await submitUrl(page, 'https://example.com/liveorphan');
        const card = page.getByTestId('job-card');
        await expect(card.locator('.badge')).toHaveText('RECORDING');
        await expect.poll(() => {
            return existsSync(`${session.logPath}.orphan`);
        }).toBe(true);
        const pid = orphanPid();

        await card.getByRole('button', { name: 'STOP & SAVE' }).click();
        await expect(card.locator('.badge')).toHaveText('SAVING FILE');
        await expect(card.getByRole('button')).toHaveCount(0);
        await expect(card.locator('.badge')).toHaveText(/COMPLETE|FAILED/, { timeout: 25000 });
        await expect(card).not.toHaveClass(/job--saving/);
        await expect.poll(() => {
            return isAlive(pid);
        }).toBe(false);
    });
});

test.describe('find stream', () => {
    let site: { server: Server; origin: string };

    test.beforeAll(async () => {
        site = await startLocalSite();
    });

    test.afterAll(async () => {
        await new Promise<void>((done) => {
            site.server.close(() => {
                done();
            });
        });
    });

    async function failOn(path: string): Promise<void> {
        await submitUrl(session.page, `${site.origin}${path}`);
        await expect(session.page.locator('.badge', { hasText: 'FAILED' })).toBeVisible();
        await expect(session.page.getByRole('alert').filter({ hasText: 'yt-dlp may be outdated' })).toBeVisible();
    }

    function panel() {
        return session.page.getByRole('region', { name: 'Stream finder' });
    }

    test('offers FIND STREAM only for failures a page scan can help with', async () => {
        const { page } = session;
        await submitUrl(page, 'https://example.com/fail');
        await expect(page.getByRole('alert').filter({ hasText: 'Video unavailable' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'FIND STREAM' })).toHaveCount(0);
    });

    test('finds a <video> source in the page and downloads it with the page as referer and its title as name', async () => {
        const { page, logPath } = session;
        await failOn('/unsupported/static.html');
        await page.getByRole('button', { name: 'FIND STREAM' }).click();

        const item = panel().getByRole('listitem');
        await expect(item).toHaveCount(1);
        await expect(item).toContainText('MP4');
        await expect(item).toContainText(`${site.origin}/media/static-clip.mp4`);
        await expect(item).toContainText('found in the page');
        await expect(panel()).toContainText('Protected (DRM) streams cannot be downloaded.');

        await panel().getByRole('button', { name: 'Download stream 1' }).click();
        await expect(panel()).toHaveCount(0);
        await expect(page.getByTestId('job-card')).toHaveCount(2);
        await expectDownloadsComplete(page);

        const args = lastYtdlpCall(logPath, '/media/static-clip.mp4');
        expect(args.at(-1)).toBe(`${site.origin}/media/static-clip.mp4`);
        expect(args[args.indexOf('--referer') + 1]).toBe(`${site.origin}/unsupported/static.html`);
        expect(args[args.indexOf('--user-agent') + 1]).toContain('Chrome/');
        expect(args[args.indexOf('-o') + 1]).toBe('Static Episode [%(id)s].%(ext)s');
        expect(args).not.toContain('--add-header');
    });

    test('follows an iframe and uses the iframe as the referer of what it finds', async () => {
        const { page, logPath } = session;
        await failOn('/unsupported/embed.html');
        await page.getByRole('button', { name: 'FIND STREAM' }).click();
        const item = panel().getByRole('listitem');
        await expect(item).toHaveCount(1);
        await expect(item).toContainText('HLS');
        await expect(item).toContainText(`${site.origin}/media/inner-master.m3u8`);
        await panel().getByRole('button', { name: 'Download stream 1' }).click();
        await expectDownloadsComplete(page);
        const args = lastYtdlpCall(logPath, '/media/inner-master.m3u8');
        expect(args[args.indexOf('--referer') + 1]).toBe(`${site.origin}/player/inner.html`);
        expect(args[args.indexOf('-o') + 1]).toBe('Embed Page [%(id)s].%(ext)s');
    });

    test('falls back to the hidden browser for a player built by JavaScript', async () => {
        const { page, logPath } = session;
        await failOn('/unsupported/dynamic.html');
        await page.getByRole('button', { name: 'FIND STREAM' }).click();
        const item = panel().getByRole('listitem');
        await expect(item).toHaveCount(1, { timeout: 30000 });
        await expect(item).toContainText('HLS');
        await expect(item).toContainText(`${site.origin}/media/dynamic.m3u8`);
        await expect(item).toContainText('seen on the network');
        await expect(panel().getByRole('button', { name: 'NOT THE ONE? SEARCH DEEPER' })).toHaveCount(0);

        await panel().getByRole('button', { name: 'Download stream 1' }).click();
        await expectDownloadsComplete(page);
        const args = lastYtdlpCall(logPath, '/media/dynamic.m3u8');
        expect(args[args.indexOf('--referer') + 1]).toMatch(new RegExp(`^${site.origin.replace(/[.:/]/g, '\\$&')}/`));
        expect(args[args.indexOf('-o') + 1]).toBe('Dynamic Episode [%(id)s].%(ext)s');
    });

    test('finds a player inside a cross-origin iframe that needs visibility and a user gesture, served from a signed address', async () => {
        test.setTimeout(60000);
        const { page, logPath } = session;
        await failOn('/unsupported/nested.html');
        await page.getByRole('button', { name: 'FIND STREAM' }).click();
        const item = panel().getByRole('listitem');
        await expect(item).toHaveCount(1, { timeout: 40000 });
        await expect(item).toContainText('MP4');
        await expect(item).toContainText('/videoplayback?expire=1999999999');
        await expect(item).toContainText('seen on the network');

        await panel().getByRole('button', { name: 'Download stream 1' }).click();
        await expectDownloadsComplete(page);
        const args = lastYtdlpCall(logPath, 'sig=AbC123');
        expect(args.at(-1)).toContain('/videoplayback?expire=1999999999&ip=203.0.113.9&id=7081&itag=18&mime=video%2Fmp4&sig=AbC123');
        expect(args[args.indexOf('--referer') + 1]).toMatch(/^http:\/\/localhost:\d+\//);
        expect(args[args.indexOf('-o') + 1]).toBe('Nested Player [%(id)s].%(ext)s');
    });

    test.describe('addresses bound to an IP', () => {
        for (const [family, page, flag, other] of [
            ['IPv4', '/unsupported/bound-v4.html', '--force-ipv4', '--force-ipv6'],
            ['IPv6', '/unsupported/bound-v6.html', '--force-ipv6', '--force-ipv4']
        ] as const) {
            test(`downloads an address bound to an ${family} through the same IP family`, async () => {
                test.setTimeout(60000);
                const { page: app, logPath } = session;
                await failOn(page);
                await app.getByRole('button', { name: 'FIND STREAM' }).click();
                await expect(panel().getByRole('listitem')).toHaveCount(1, { timeout: 40000 });
                await panel().getByRole('button', { name: 'Download stream 1' }).click();
                await expectDownloadsComplete(app);
                const args = lastYtdlpCall(logPath, `${SIGNED}&ip=${family === 'IPv4' ? '203.0.113.9' : '2001%3Adb8%3A%3A1'}`);
                expect(args).toContain(flag);
                expect(args).not.toContain(other);
                expect(args[args.indexOf('--referer') + 1]).toBe(`${site.origin}${page}`);
            });
        }

        test('does not force an IP family for addresses that are not bound to one', async () => {
            test.setTimeout(60000);
            const { page, logPath } = session;
            await failOn('/unsupported/static.html');
            await page.getByRole('button', { name: 'FIND STREAM' }).click();
            await expect(panel().getByRole('listitem')).toHaveCount(1);
            await panel().getByRole('button', { name: 'Download stream 1' }).click();
            await expectDownloadsComplete(page);
            const args = lastYtdlpCall(logPath, '/media/static-clip.mp4');
            expect(args).not.toContain('--force-ipv4');
            expect(args).not.toContain('--force-ipv6');
        });
    });

    test('offers a fresh link for a refused stream and searches its page again', async () => {
        test.setTimeout(90000);
        const { page } = session;
        await failOn('/unsupported/stale.html');
        await page.getByRole('button', { name: 'FIND STREAM' }).click();
        await expect(panel().getByRole('listitem')).toHaveCount(1, { timeout: 40000 });
        await panel().getByRole('button', { name: 'Download stream 1' }).click();

        // The newest download is listed first.
        const streamCard = page.getByTestId('job-card').first();
        await expect(streamCard.getByRole('alert').filter({ hasText: 'Access refused by the server' })).toBeVisible();
        await expect(streamCard.getByRole('button', { name: 'FIND STREAM' })).toHaveCount(0);
        await streamCard.getByRole('button', { name: 'FIND A FRESH LINK' }).click();

        const freshPanel = streamCard.getByRole('region', { name: 'Stream finder' });
        await expect(freshPanel.getByRole('listitem')).toHaveCount(1, { timeout: 40000 });
        await expect(freshPanel.getByRole('listitem')).toContainText('/forbidden/videoplayback?id=bound1');
        await expect(page.getByTestId('job-card').last().getByRole('region', { name: 'Stream finder' })).toHaveCount(0);
    });

    test('lists one video once when it is asked for through near-identical addresses', async () => {
        test.setTimeout(60000);
        const { page } = session;
        await failOn('/unsupported/variants.html');
        await page.getByRole('button', { name: 'FIND STREAM' }).click();
        const item = panel().getByRole('listitem');
        await expect(item).toHaveCount(1, { timeout: 40000 });
        await expect(item).toContainText('/videoplayback?id=abc123');
        await expect(item).toContainText('+1 alternate address');
    });

    test('can search deeper with the browser after a static result', async () => {
        const { page } = session;
        await failOn('/unsupported/static.html');
        await page.getByRole('button', { name: 'FIND STREAM' }).click();
        await expect(panel().getByRole('listitem')).toHaveCount(1);
        await panel().getByRole('button', { name: 'NOT THE ONE? SEARCH DEEPER' }).click();
        await expect(panel().getByRole('button', { name: 'NOT THE ONE? SEARCH DEEPER' })).toHaveCount(0, { timeout: 35000 });
        await expect(panel().getByRole('listitem')).toHaveCount(1);
    });

    test('says so when the page has no video', async () => {
        test.setTimeout(60000);
        await session.app.close();
        rmSync(resolve(session.userData, '..'), { recursive: true, force: true });
        session = await launch({ env: { PULLWAVE_SNIFF_TIMEOUT_MS: '3000' } });
        await failOn('/unsupported/none.html');
        await session.page.getByRole('button', { name: 'FIND STREAM' }).click();
        await expect(panel()).toContainText('No video stream was found.', { timeout: 30000 });
        await expect(panel().getByRole('button', { name: /DOWNLOAD|SEARCH DEEPER/ })).toHaveCount(0);
        await expect(panel()).toContainText('Protected (DRM) streams cannot be downloaded.');
    });

    test('lets the user cancel a search and close the panel', async () => {
        test.setTimeout(60000);
        await session.app.close();
        rmSync(resolve(session.userData, '..'), { recursive: true, force: true });
        session = await launch({ env: { PULLWAVE_SNIFF_TIMEOUT_MS: '20000' } });
        await failOn('/unsupported/none.html');
        await session.page.getByRole('button', { name: 'FIND STREAM' }).click();
        await expect(panel()).toContainText('Watching the page’s network activity', { timeout: 15000 });
        await panel().getByRole('button', { name: 'CANCEL' }).click();
        await expect(panel()).toContainText('Search cancelled.', { timeout: 5000 });
        await panel().getByRole('button', { name: 'Close stream finder' }).click();
        await expect(panel()).toHaveCount(0);
        await expect(session.page.getByRole('button', { name: 'FIND STREAM' })).toBeVisible();
    });
});

