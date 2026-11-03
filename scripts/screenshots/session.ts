import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installedProgramsEnv } from '../../test/e2e/programs';
import { pinnedSpec } from '../../src/main/services/tools/programSpecs';
import { ANIME_TITLES, EPISODES, MANGA_TITLES, VIDEO_TITLES } from './catalog';
import { makeCover, makePage, makeVideo } from './media';
import { FakeAniList, FakeSuwayomi } from './servers';

const ROOT = resolve(__dirname, '../..');
const ELECTRON_PATH = createRequire(__filename)('electron') as unknown as string;
const FAKE_YTDLP = resolve(__dirname, 'fixtures/fake-yt-dlp.js');
const ANI_CLI_TEMPLATE = resolve(__dirname, 'fixtures/fake-ani-cli.sh');

export const WINDOW = { width: 1280, height: 900 };
export const SCREENSHOTS_DIRECTORY = resolve(ROOT, 'docs/screenshots');

// What is made once for all the screenshots: the pictures, the video and the two servers.
export interface Assets {
    root: string;
    video: string;
    longVideo: string;
    animeList: string;
    aniList: FakeAniList;
    suwayomi: FakeSuwayomi;
}

export async function prepareAssets(): Promise<Assets> {
    const root = mkdtempSync(join(tmpdir(), 'pullwave-shots-'));
    const animeCovers = join(root, 'covers', 'anime');
    const mangaCovers = join(root, 'covers', 'manga');
    const pages = join(root, 'pages');
    ANIME_TITLES.forEach((style) => {
        makeCover(animeCovers, style);
    });
    MANGA_TITLES.forEach((style) => {
        makeCover(mangaCovers, style);
    });
    for (let number = 1; number <= 5; number += 1) {
        makePage(pages, number);
    }
    const video = makeVideo(join(root, 'video'), 'episode', 90);
    const longVideo = makeVideo(join(root, 'video'), 'recording', 300);
    const animeList = join(root, 'anime-list.txt');
    writeFileSync(
        animeList,
        ANIME_TITLES.map((style, position) => {
            return `${String(position + 1)} ${style.title}`;
        }).join('\n') + '\n'
    );
    const aniList = new FakeAniList({ coversDirectory: animeCovers });
    const suwayomi = new FakeSuwayomi({ coversDirectory: mangaCovers, pagesDirectory: pages });
    await Promise.all([aniList.start(), suwayomi.start()]);
    return { root, video, longVideo, animeList, aniList, suwayomi };
}

export async function releaseAssets(assets: Assets): Promise<void> {
    await Promise.all([assets.aniList.stop(), assets.suwayomi.stop()]);
}

export interface Shot {
    app: ElectronApplication;
    page: Page;
    // The folders of this run, all inside a new temporary folder: nothing is read from or written to the data of an installed app.
    work: string;
    downloads: string;
    animeFolder: string;
}

export interface LaunchOptions {
    theme?: string;
    settings?: Record<string, unknown>;
    history?: (shot: Pick<Shot, 'downloads'>) => unknown[];
    env?: Record<string, string>;
}

// The programs of the app are the ones that come with the repository, except yt-dlp: the one that is installed for the app is the fake, so the
// screens that name the program show it as a program of the app and not a path of this machine.
function installFakeYtDlp(toolsEnv: Record<string, string>): void {
    const spec = pinnedSpec('ytdlp', process.platform, process.arch);
    const executable = spec?.executables[0];
    if (spec === null || executable === undefined) {
        return;
    }
    const target = join(toolsEnv['PULLWAVE_TOOLS_DIR'] ?? '', spec.id, spec.version, executable);
    rmSync(target, { force: true });
    symlinkSync(FAKE_YTDLP, target);
}

// The app gives ani-cli an environment of its own, so what the fake needs (the anime it lists, the video it downloads) is written into a copy of it.
function writeFakeAniCli(assets: Assets, work: string): string {
    const file = join(work, 'fake-ani-cli.sh');
    const script = readFileSync(ANI_CLI_TEMPLATE, 'utf-8')
        .replaceAll('@ANIME_LIST@', assets.animeList)
        .replaceAll('@VIDEO@', assets.video)
        .replaceAll('@EPISODES@', String(EPISODES));
    writeFileSync(file, script);
    chmodSync(file, 0o755);
    return file;
}

export async function launch(assets: Assets, options: LaunchOptions = {}): Promise<Shot> {
    const work = mkdtempSync(join(tmpdir(), 'pullwave-shot-run-'));
    const userData = join(work, 'user-data');
    const downloads = join(work, 'downloads');
    const animeFolder = join(work, 'anime');
    mkdirSync(userData, { recursive: true });
    writeFileSync(
        join(userData, 'settings.json'),
        JSON.stringify({
            language: 'en',
            theme: options.theme ?? 'cyberpunk',
            checkUpdatesOnStart: false,
            verifyLiveEnd: false,
            downloadDir: downloads,
            animeDownloadDir: animeFolder,
            animeQuality: '720p',
            mangaDirectory: join(work, 'manga'),
            ...options.settings
        })
    );
    if (options.history !== undefined) {
        writeFileSync(join(userData, 'history.json'), JSON.stringify(options.history({ downloads })));
    }
    const toolsEnv = installedProgramsEnv(work);
    installFakeYtDlp(toolsEnv);
    const app = await electron.launch({
        executablePath: ELECTRON_PATH,
        args: [ROOT, '--no-sandbox', `--user-data-dir=${userData}`],
        env: {
            ...process.env,
            ...toolsEnv,
            PULLWAVE_E2E_DISPLAY: 'primary',
            TZ: 'Etc/UTC',
            PULLWAVE_ANI_CLI: writeFakeAniCli(assets, work),
            PULLWAVE_ANILIST_URL: `${assets.aniList.url}/graphql`,
            PULLWAVE_COVER_FALLBACK_URL: 'http://127.0.0.1:9',
            PULLWAVE_MANGA_URL: assets.suwayomi.url,
            PULLWAVE_IMPORT_DIR: animeFolder,
            ...options.env
        }
    });
    const page = await app.firstWindow();
    await page.waitForSelector('.logo');
    await expect(page.getByText('// BOOTING SYSTEMS…')).toBeHidden({ timeout: 60000 });
    await resize(app, page, WINDOW.width, WINDOW.height);
    return { app, page, work, downloads, animeFolder };
}

export async function resize(app: ElectronApplication, page: Page, width: number, height: number): Promise<void> {
    await app.evaluate(({ BrowserWindow, screen }, [w, h]) => {
        const area = screen.getPrimaryDisplay().workArea;
        BrowserWindow.getAllWindows()[0]?.setBounds({ x: area.x, y: area.y, width: w as number, height: h as number });
    }, [width, height]);
    await page.waitForTimeout(500);
}

// The page the screens are made on scrolls inside the application: every screen is shown from its top.
async function scrollToTop(page: Page): Promise<void> {
    await page.evaluate(() => {
        document.querySelectorAll('*').forEach((element) => {
            element.scrollTop = 0;
        });
    });
}

// The notices of the actions that were made to get here are closed: a screen shows what it is about.
async function closeNotices(page: Page): Promise<void> {
    await page.evaluate(() => {
        document.querySelectorAll<HTMLElement>('.toast button').forEach((button) => {
            button.click();
        });
    });
}

export async function snap(page: Page, name: string): Promise<void> {
    await closeNotices(page);
    await scrollToTop(page);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(SCREENSHOTS_DIRECTORY, `${name}.png`) });
}

export { VIDEO_TITLES };

export async function snapFullscreen(page: Page, name: string): Promise<void> {
    await page.screenshot({ path: join(SCREENSHOTS_DIRECTORY, `${name}.png`) });
}
