import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import './display';
import { leaveHome } from './startScreen';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { LogLine } from '../../src/shared/logs';
import type { DownloadJob } from '../../src/shared/types';
import { STREAM_USER_AGENT } from '../../src/main/services/streamProxy';
import { installedProgramsEnv } from './programs';

const ROOT = resolve(__dirname, '../..');
const FAKE_YTDLP = resolve(__dirname, 'fixtures/fake-yt-dlp.js');
// A PNG of 1x1 pixel: the picture the site gives for the video.
const PICTURE = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8cf500f00038601805a347d6b0000000049454e44ae426082', 'hex');
// A download that goes on until it is cancelled, so the banner of the download going on stays.
const VIDEO_URL = 'https://example.com/slow';

interface Session {
    app: ElectronApplication;
    page: Page;
    workDir: string;
}

interface Site {
    server: Server;
    origin: string;
    requests: Array<{ path: string; headers: IncomingHttpHeaders }>;
}

let site: Site;
let session: Session | null = null;

// The site of the pictures: /picture.png is the picture, anything else is not found.
async function startSite(): Promise<Site> {
    const requests: Site['requests'] = [];
    const server = createServer((request, response) => {
        requests.push({ path: request.url ?? '', headers: request.headers });
        if (request.url === '/picture.png') {
            response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(PICTURE.length) });
            response.end(PICTURE);
            return;
        }
        response.writeHead(404, { 'Content-Type': 'text/plain' });
        response.end('not found');
    });
    await new Promise<void>((done) => {
        server.listen(0, '127.0.0.1', done);
    });
    return { server, origin: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`, requests };
}

async function launch(thumbnail: string): Promise<Session> {
    const workDir = mkdtempSync(join(tmpdir(), 'pullwave-thumbnail-e2e-'));
    const userData = join(workDir, 'user-data');
    mkdirSync(userData, { recursive: true });
    writeFileSync(join(userData, 'settings.json'), JSON.stringify({ language: 'en', checkUpdatesOnStart: false, verifyLiveEnd: false, ytdlpPath: FAKE_YTDLP, downloadDir: join(workDir, 'downloads') }));
    const app = await electron.launch({
        args: [ROOT, '--no-sandbox', `--user-data-dir=${userData}`],
        env: { ...process.env, ...installedProgramsEnv(workDir), FAKE_YTDLP_THUMBNAIL: thumbnail, PULLWAVE_MANGA_URL: 'http://127.0.0.1:9', PULLWAVE_COVER_FALLBACK_URL: 'http://127.0.0.1:9' }
    });
    const page = await app.firstWindow();
    await page.waitForSelector('.logo');
    await leaveHome(page);
    return { app, page, workDir };
}

async function startDownload(page: Page): Promise<DownloadJob> {
    await page.getByLabel('Link 1', { exact: true }).fill(VIDEO_URL);
    await page.getByRole('button', { name: 'DOWNLOAD', exact: true }).click();
    await expect(page.getByTestId('download-hero')).toBeVisible();
    return (await jobs(page))[0] as DownloadJob;
}

async function jobs(page: Page): Promise<DownloadJob[]> {
    return page.evaluate(() => {
        return (window as unknown as { api: { listJobs: () => Promise<DownloadJob[]> } }).api.listJobs();
    });
}

// What the app answers for an address of a picture (asked in the main process: the window may show these pictures, not fetch them).
async function ask(app: ElectronApplication, address: string): Promise<{ status: number; type: string | null; cache: string | null; bytes: number[] }> {
    return app.evaluate(async ({ net }, target) => {
        const response = await net.fetch(target);
        return { status: response.status, type: response.headers.get('content-type'), cache: response.headers.get('cache-control'), bytes: Array.from(new Uint8Array(await response.arrayBuffer())) };
    }, address);
}

test.beforeEach(async () => {
    site = await startSite();
});

test.afterEach(async () => {
    if (session !== null) {
        await session.app.close();
        rmSync(session.workDir, { recursive: true, force: true });
        session = null;
    }
    await new Promise<void>((done) => {
        site.server.close(() => {
            done();
        });
    });
});

test('shows the picture of the video in a wide box of the download going on, fetched and served by the app', async () => {
    session = await launch(`${site.origin}/picture.png`);
    const { app, page } = session;
    const job = await startDownload(page);
    const address = `pullwave-thumb://job/${job.id}?v=1`;

    const hero = page.getByTestId('download-hero');
    await expect(hero).toHaveAttribute('class', 'download-hero download-hero--wide');
    const picture = hero.locator('.download-hero__art img');
    await expect(picture).toHaveAttribute('src', address);
    await expect(picture).toHaveAttribute('class', 'cover download-hero__thumbnail');
    // The picture is there, as the site gave it (1x1), in a box of 16:9.
    await expect.poll(async () => {
        return picture.evaluate((element) => {
            const image = element as HTMLImageElement;
            return [image.complete, image.naturalWidth, image.naturalHeight];
        });
    }).toEqual([true, 1, 1]);
    const box = await hero.locator('.download-hero__art').boundingBox();
    expect(Math.round(box?.width ?? 0)).toBe(196);
    expect(Math.round(box?.height ?? 0)).toBe(110);
    await expect(hero.locator('.tile__generated')).toHaveCount(0);

    // The download carries the address of the app, never the one of the site.
    expect((await jobs(page))[0]?.thumbnail).toBe(address);
    // The app asked the site once, as a browser does.
    expect(
        site.requests.map((request) => {
            return [request.path, request.headers['user-agent'], request.headers['accept']];
        })
    ).toEqual([['/picture.png', STREAM_USER_AGENT, 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8']]);
    // What the app answers for the address: the picture, its kind, and no cache.
    expect(await ask(app, address)).toEqual({ status: 200, type: 'image/png', cache: 'no-store', bytes: Array.from(PICTURE) });

    // Once the download leaves the queue its picture is gone from the memory of the app.
    await page.evaluate((id) => {
        return (window as unknown as { api: { cancelJob: (id: string) => Promise<void> } }).api.cancelJob(id);
    }, job.id);
    await expect.poll(async () => {
        return (await jobs(page))[0]?.status;
    }).toBe('cancelled');
    await page.evaluate((id) => {
        return (window as unknown as { api: { removeJob: (id: string) => Promise<void> } }).api.removeJob(id);
    }, job.id);
    await expect.poll(async () => {
        return (await ask(app, address)).status;
    }).toBe(404);
    expect(await ask(app, address)).toEqual({ status: 404, type: null, cache: null, bytes: [] });
});

test('keeps the picture of the section when the picture of the video cannot be fetched, and says why in the log of yt-dlp', async () => {
    session = await launch(`${site.origin}/missing.png`);
    const { page } = session;
    const job = await startDownload(page);
    const expected = `the picture of the video could not be fetched (HTTP 404): ${site.origin}/missing.png`;
    await expect.poll(async () => {
        const lines = await page.evaluate(() => {
            return (window as unknown as { api: { logs: { snapshot: (source: string) => Promise<LogLine[]> } } }).api.logs.snapshot('yt-dlp');
        });
        return lines
            .filter((line) => {
                return line.stream === 'event';
            })
            .map((line) => {
                return line.text;
            });
    }).toEqual([expected]);

    const hero = page.getByTestId('download-hero');
    await expect(hero).toHaveAttribute('class', 'download-hero');
    await expect(hero.locator('.download-hero__art img')).toHaveCount(0);
    await expect(hero.locator('.download-hero__art .tile__generated svg')).toHaveClass(/section-icon--downloads/);
    expect((await jobs(page)).map((entry) => {
        return [entry.id, entry.thumbnail];
    })).toEqual([[job.id, null]]);
    expect(site.requests.map((request) => {
        return request.path;
    })).toEqual(['/missing.png']);
});

test('shows the picture of the section when the site gives no picture (NA), and asks nothing', async () => {
    session = await launch('NA');
    const { page } = session;
    const job = await startDownload(page);
    const hero = page.getByTestId('download-hero');
    await expect(hero).toHaveAttribute('class', 'download-hero');
    await expect(hero.locator('.download-hero__art .tile__generated svg')).toHaveClass(/section-icon--downloads/);
    // Long enough for a picture that was asked for to have arrived.
    await page.waitForTimeout(1000);
    expect((await jobs(page)).map((entry) => {
        return [entry.id, entry.thumbnail];
    })).toEqual([[job.id, null]]);
    expect(site.requests).toEqual([]);
});
