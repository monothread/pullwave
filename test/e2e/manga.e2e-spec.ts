import { expect, test, _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import './display';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readZipEntries } from '../helpers/zipEntries';

const ROOT = resolve(__dirname, '../..');
const ELECTRON_PATH = createRequire(__filename)('electron') as unknown as string;

const STORE_URL = 'https://store.example/index.min.json';
const EXTENSION_PKG = 'eu.kanade.tachiyomi.extension.en.fakedex';
const SOURCE_ID = '4242';
const OTHER_SOURCE_ID = '5252';
// Enough of a JPEG for the app to recognize it by its first bytes.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
// A picture a browser can decode: the covers are shown in the page, so they have to be real.
const COVER = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

interface RecordedRequest {
    method: string;
    path: string;
    contentType: string | undefined;
    query: string | null;
    variables: Record<string, unknown> | null;
}

// Stands in for Suwayomi-Server: the app is pointed at it with PULLWAVE_MANGA_URL, so nothing is downloaded and no Java is started.
class FakeSuwayomi {
    readonly requests: RecordedRequest[] = [];
    stores: Array<{ name: string; indexUrl: string }> = [];
    installed = false;
    // Chapters (by their number on the server) whose pages the server cannot give.
    failingChapters = new Set<number>();
    // How long an image takes to arrive.
    imageDelayMs = 0;
    // The pages are real pictures a page can show (the reader needs them; the downloads only look at the bytes).
    pagesArePicture = false;
    // How many pages the chapters have.
    pageTotal = 3;
    // Addresses that answer with an error, and how many times they do before they answer well (the next pages are asked for ahead of time too).
    failTimes = new Map<string, number>();
    // The extension and its source are for adults.
    adult = false;
    // The extension has an update, and the version of the library of extensions it was made for.
    hasUpdate = false;
    // A second source (of the same extension) that has the same manga under another number, with these chapters (by their number).
    otherSource = false;
    // The server lists the second source before the first one.
    otherSourceFirst = false;
    otherChapters = [1, 2, 3];
    // Chapters the source has published after the first two (their numbers on the server).
    laterChapters: number[] = [];
    extensionLib = '1.4';
    // The server cannot get the manga from its source (a site behind Cloudflare).
    failDetails = false;
    // The list of the first source has more than a page: 12 mangas, and 3 more in the second page.
    pagedList = false;
    private server: Server | null = null;

    get url(): string {
        return `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
    }

    async start(): Promise<void> {
        this.server = createServer((request, response) => {
            void this.handle(request, response);
        });
        await new Promise<void>((resolveStart) => {
            this.server!.listen(0, '127.0.0.1', resolveStart);
        });
    }

    async stop(): Promise<void> {
        await new Promise<void>((resolveStop) => {
            this.server?.close(() => {
                resolveStop();
            });
            this.server?.closeAllConnections();
        });
    }

    graphqlRequests(contains: string): RecordedRequest[] {
        return this.requests.filter((item) => {
            return item.query?.includes(contains) === true;
        });
    }

    private extension(): Record<string, unknown> {
        return {
            pkgName: EXTENSION_PKG,
            name: 'Tachiyomi: Fake Dex',
            lang: 'en',
            versionName: '1.0.0',
            isInstalled: this.installed,
            hasUpdate: this.hasUpdate,
            isObsolete: false,
            iconUrl: null,
            contentWarning: this.adult ? 'NSFW' : 'SAFE',
            storeIndexUrl: STORE_URL,
            extensionLib: this.extensionLib
        };
    }

    private manga(id: number, title: string): Record<string, unknown> {
        return { id, sourceId: id >= 70 && id < 80 ? OTHER_SOURCE_ID : SOURCE_ID, title, thumbnailUrl: `/api/v1/manga/${id}/thumbnail` };
    }

    private answer(query: string, variables: Record<string, unknown>): unknown {
        if (this.failDetails && query.includes('fetchMangaAndChapters')) {
            throw new Error('Cloudflare protection is on');
        }
        if (query.includes('aboutServer')) {
            return { aboutServer: { version: 'v9.9.9-fake' } };
        }
        if (query.includes('addExtensionStore')) {
            const store = { name: 'Fake Store', indexUrl: String(variables['indexUrl']) };
            this.stores.push(store);
            return { addExtensionStore: { extensionStore: store } };
        }
        if (query.includes('removeExtensionStore')) {
            this.stores = this.stores.filter((store) => {
                return store.indexUrl !== variables['indexUrl'];
            });
            return { removeExtensionStore: { extensionStore: null } };
        }
        if (query.includes('extensionStores')) {
            return { extensionStores: { nodes: this.stores } };
        }
        if (query.includes('fetchExtensions')) {
            return { fetchExtensions: { extensions: this.stores.length > 0 ? [this.extension()] : [] } };
        }
        if (query.includes('updateExtensions')) {
            this.hasUpdate = false;
            return { updateExtensions: { extensions: [this.extension()] } };
        }
        if (query.includes('updateExtension')) {
            this.installed = (variables['patch'] as Record<string, boolean>)['install'] === true || ((variables['patch'] as Record<string, boolean>)['uninstall'] !== true && this.installed);
            return { updateExtension: { extension: this.extension() } };
        }
        if (query.trim().startsWith('{ extensions')) {
            return { extensions: { nodes: this.stores.length > 0 ? [this.extension()] : [] } };
        }
        if (query.trim().startsWith('{ sources')) {
            const local = { id: '0', name: 'Local source', displayName: 'Local source', lang: 'localsourcelang', iconUrl: '', supportsLatest: false, contentWarning: 'SAFE', extension: { pkgName: 'local' } };
            const site = { id: SOURCE_ID, name: 'Fake Dex', displayName: 'Fake Dex', lang: 'en', iconUrl: '/icon', supportsLatest: true, contentWarning: this.adult ? 'NSFW' : 'SAFE', extension: { pkgName: EXTENSION_PKG, storeIndexUrl: STORE_URL } };
            const other = { ...site, id: OTHER_SOURCE_ID, name: 'Other Dex', displayName: 'Other Dex' };
            return { sources: { nodes: this.installed ? (this.otherSource && this.otherSourceFirst ? [local, other, site] : [local, site, ...(this.otherSource ? [other] : [])]) : [local] } };
        }
        if (query.includes('{ filters {')) {
            return {
                source: {
                    filters: [
                        { __typename: 'CheckBoxFilter', name: 'Has chapters', checkValue: false },
                        { __typename: 'TriStateFilter', name: 'Action', triValue: 'IGNORE' },
                        { __typename: 'SortFilter', name: 'Sort', sortOptions: ['Name', 'Date'], sortValue: { index: 0, ascending: true } },
                        { __typename: 'GroupFilter', name: 'Genre', filters: [{ __typename: 'TriStateFilter', name: 'Drama', triValue: 'IGNORE' }] }
                    ]
                }
            };
        }
        if (query.includes('fetchSourceManga') && this.pagedList && variables['source'] !== OTHER_SOURCE_ID) {
            const second = Number(variables['page']) === 2;
            const ids = second ? [112, 113, 114] : Array.from({ length: 12 }, (_unused, index) => {return 100 + index});
            return {
                fetchSourceManga: {
                    hasNextPage: !second,
                    mangas: ids.map((id) => {
                        return this.manga(id, `Title ${id}`);
                    })
                }
            };
        }
        if (query.includes('fetchSourceManga')) {
            const all = variables['source'] === OTHER_SOURCE_ID ? [this.manga(70, 'One Piece')] : [this.manga(7, 'One Piece'), this.manga(8, 'Bleach')];
            const text = String(variables['query'] ?? '').toLowerCase();
            const mangas = variables['type'] === 'SEARCH' ? all.filter((item) => {return String(item['title']).toLowerCase().includes(text)}) : all;
            return { fetchSourceManga: { hasNextPage: false, mangas } };
        }
        if (query.includes('fetchMangaAndChapters')) {
            const id = Number(variables['id']);
            if (id === 70) {
                return {
                    fetchMangaAndChapters: {
                        manga: { ...this.manga(70, 'One Piece'), realUrl: 'https://other.example/manga/70', author: 'Oda', artist: null, description: 'Pirates', genre: ['Action'], status: 'ONGOING' },
                        chapters: this.otherChapters.map((number) => {
                            return { id: 700 + number, name: `Ch. ${number}`, chapterNumber: number, uploadDate: '1700000000000', scanlator: null, sourceOrder: number };
                        })
                    }
                };
            }
            return {
                fetchMangaAndChapters: {
                    manga: { ...this.manga(id, id === 7 ? 'One Piece' : 'Bleach'), realUrl: `https://dex.example/manga/${id}`, author: 'Oda', artist: null, description: 'Pirates', genre: ['Action'], status: 'ONGOING' },
                    chapters: [
                        { id: 101, name: 'Romance Dawn', chapterNumber: 1, uploadDate: '1700000000000', scanlator: 'Group A', sourceOrder: 1 },
                        { id: 102, name: 'The Great Race', chapterNumber: 2, uploadDate: '1700100000000', scanlator: null, sourceOrder: 2 },
                        ...this.laterChapters.map((chapterId, index) => {
                            return { id: chapterId, name: `Chapter ${index + 3}`, chapterNumber: index + 3, uploadDate: String(Date.now()), scanlator: null, sourceOrder: index + 3 };
                        })
                    ]
                }
            };
        }
        if (query.includes('fetchChapterPages')) {
            const chapterId = Number(variables['chapterId']);
            if (this.failingChapters.has(chapterId)) {
                throw new Error('The source could not give the pages');
            }
            return { fetchChapterPages: { pages: Array.from({ length: this.pageTotal }, (_unused, page) => {return `/api/v1/chapter/${chapterId}/page/${page}`}) } };
        }
        throw new Error(`Unexpected query: ${query.slice(0, 60)}`);
    }

    private async handle(request: IncomingMessage, response: import('node:http').ServerResponse): Promise<void> {
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
            chunks.push(chunk as Buffer);
        }
        const path = request.url ?? '';
        const contentType = request.headers['content-type'];
        if (request.method === 'POST' && path === '/api/graphql') {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as { query: string; variables: Record<string, unknown> };
            this.requests.push({ method: 'POST', path, contentType, query: body.query, variables: body.variables });
            let payload: unknown;
            try {
                payload = { data: this.answer(body.query, body.variables) };
            } catch (error) {
                payload = { errors: [{ message: (error as Error).message }] };
            }
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify(payload));
            return;
        }
        this.requests.push({ method: request.method ?? 'GET', path, contentType, query: null, variables: null });
        if (this.imageDelayMs > 0) {
            await new Promise((resolveWait) => {
                setTimeout(resolveWait, this.imageDelayMs);
            });
        }
        const failures = this.failTimes.get(path) ?? 0;
        if (failures > 0) {
            this.failTimes.set(path, failures - 1);
            response.writeHead(500);
            response.end();
            return;
        }
        const isCover = path.endsWith('/thumbnail') || path.endsWith('/icon');
        const picture = isCover || this.pagesArePicture;
        response.writeHead(200, { 'Content-Type': picture ? 'image/png' : 'image/jpeg' });
        response.end(picture ? COVER : JPEG);
    }
}

interface Session {
    app: ElectronApplication;
    page: Page;
    userData: string;
}

let workDir: string;
let fake: FakeSuwayomi;
let session: Session;

function mangaFolder(): string {
    return join(workDir, 'manga');
}

async function launch(settings: Record<string, unknown> = {}, env: Record<string, string> = {}): Promise<Session> {
    const userData = join(workDir, 'userData');
    mkdirSync(userData, { recursive: true });
    writeFileSync(
        join(userData, 'settings.json'),
        JSON.stringify({ language: 'en', checkUpdatesOnStart: false, downloadDir: join(workDir, 'downloads'), mangaDirectory: mangaFolder(), ...settings })
    );
    const app = await electron.launch({
        executablePath: ELECTRON_PATH,
        args: [ROOT, '--no-sandbox', `--user-data-dir=${userData}`],
        env: { ...process.env, PULLWAVE_NO_TOOLS: '1', PULLWAVE_MANGA_URL: fake.url, ...env }
    });
    const page = await app.firstWindow();
    await page.waitForSelector('.logo');
    await expect(page.getByText('// BOOTING SYSTEMS…')).toBeHidden({ timeout: 60000 });
    return { app, page, userData };
}

async function openManga(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'MANGA', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Manga' })).toBeVisible();
}

// Downloads what is missing of the manga open in the library, with the one button of its season.
async function downloadSeason(page: Page, title = 'One Piece'): Promise<void> {
    await page.getByRole('button', { name: `DOWNLOAD SEASON: ${title}` }).click();
}

async function goTo(page: Page, view: 'BROWSE' | 'UPDATES' | 'LIBRARY' | 'HISTORY' | 'EXTENSIONS' | 'SETTINGS'): Promise<void> {
    await page.getByRole('navigation', { name: 'Manga' }).getByRole('button', { name: view, exact: true }).click();
}

// Adds the store, in the settings of the manga section.
async function addStore(page: Page): Promise<void> {
    await goTo(page, 'SETTINGS');
    await page.getByLabel('Address of a store (index.min.json)').fill(STORE_URL);
    await page.getByRole('button', { name: 'ADD', exact: true }).click();
    await expect(page.getByText('Fake Store')).toBeVisible();
}

// Adds the store and installs the extension, which is what makes a source appear.
async function installExtension(page: Page): Promise<void> {
    await addStore(page);
    await goTo(page, 'EXTENSIONS');
    // Only the installed extensions are listed at first: the one to install is shown by turning that off.
    await expect(page.getByText('No extension is installed. Turn off "Installed only" to see the ones you can install.')).toBeVisible();
    await page.getByRole('switch', { name: 'Installed only' }).uncheck();
    await page.getByRole('button', { name: 'INSTALL: Tachiyomi: Fake Dex' }).click();
    await expect(page.getByText('INSTALLED', { exact: true })).toBeVisible();
}

// The browse opens on the list of sources; the source of the extension is opened on its popular mangas (when it is not open already).
async function openSource(page: Page): Promise<void> {
    await goTo(page, 'BROWSE');
    const popular = page.getByRole('button', { name: 'POPULAR: Fake Dex', exact: true });
    if (await popular.isVisible()) {
        await popular.click();
    }
}

// The list of the sources of the browse: back from a source when one is open.
async function backToSources(page: Page): Promise<void> {
    const back = page.getByRole('button', { name: '← SOURCES' });
    if (await back.isVisible()) {
        await back.click();
    }
}

async function openOnePiece(page: Page): Promise<void> {
    await openSource(page);
    await page.getByRole('button', { name: 'Open: One Piece' }).click();
    await expect(page.getByRole('button', { name: 'READ: Romance Dawn', exact: true })).toBeVisible();
}

// Adds One Piece to the library from the browse and opens it there: the chapters are picked, downloaded and removed in the library.
async function openOnePieceInLibrary(page: Page): Promise<void> {
    await openOnePiece(page);
    await page.getByRole('button', { name: 'ADD TO LIBRARY' }).click();
    await goTo(page, 'LIBRARY');
    await page.getByTestId('manga-entry').getByRole('button', { name: 'Open: One Piece' }).click();
    await expect(page.getByRole('button', { name: 'READ: Romance Dawn', exact: true })).toBeVisible();
}

// The groups, the series and the move to another source of a manga of the library are behind the gear in the head of its page.
async function openOrganize(page: Page): Promise<void> {
    const gear = page.getByRole('button', { name: 'Groups, series and source' });
    if ((await gear.getAttribute('aria-expanded')) !== 'true') {
        await gear.click();
    }
}

// Answers the window that asks before something is taken away (a cancel, a removal, a clear).
async function answerConfirm(page: Page, title: string | RegExp, answer: string): Promise<void> {
    await page.getByRole('dialog', { name: title }).getByRole('button', { name: answer, exact: true }).click();
}

async function waitForDownloaded(page: Page): Promise<void> {
    await expect(page.locator('.toast').filter({ hasText: 'Download complete: ' }).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: 'DOWNLOADS (0)' })).toBeVisible({ timeout: 20000 });
}

test.beforeEach(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'pullwave-manga-e2e-'));
    fake = new FakeSuwayomi();
    await fake.start();
});

test.afterEach(async () => {
    await session?.app.close();
    await fake.stop();
    rmSync(workDir, { recursive: true, force: true });
});

test.describe('manga section', () => {
    test('has a MANGA tab that opens on the browse with no source yet', async () => {
        session = await launch();
        await openManga(session.page);
        await expect(session.page.getByRole('button', { name: 'MANGA', exact: true })).toHaveAttribute('aria-current', 'page');
        await expect(session.page.getByRole('navigation', { name: 'Manga' }).getByRole('button', { name: 'BROWSE', exact: true })).toHaveAttribute('aria-current', 'page');
        await expect(session.page.getByText('No source yet. Add a store and install an extension in EXTENSIONS.')).toBeVisible();
        // Nothing is downloaded when a server is given.
        await expect(session.page.getByText('PREPARING THE MANGA SERVER')).toHaveCount(0);
    });

    test('lists only the installed extensions at first and remembers the choices after the app is closed', async () => {
        session = await launch();
        await openManga(session.page);
        await addStore(session.page);
        await goTo(session.page, 'EXTENSIONS');
        const installedOnly = session.page.getByRole('switch', { name: 'Installed only' });
        await expect(installedOnly).toBeChecked();
        await expect(installedOnly).toHaveAttribute('type', 'checkbox');
        await installedOnly.uncheck();
        await session.app.close();
        session = await launch();
        await openManga(session.page);
        await goTo(session.page, 'EXTENSIONS');
        await expect(session.page.getByRole('switch', { name: 'Installed only' })).not.toBeChecked();
        await expect(session.page.getByTestId('manga-extension')).toContainText('Tachiyomi: Fake Dex');
    });

    test('keeps the switch "Installed only" level with the fields beside it', async () => {
        session = await launch();
        await openManga(session.page);
        await addStore(session.page);
        await goTo(session.page, 'EXTENSIONS');
        const centre = async (locator: Locator): Promise<number> => {
            const box = (await locator.boundingBox())!;
            return box.y + box.height / 2;
        };
        const row = session.page.locator('.manga__extensions .field-row').first();
        const filter = await centre(row.getByLabel('Filter extensions', { exact: true }));
        const language = await centre(row.getByLabel('Language', { exact: true }));
        const switchCentre = await centre(row.getByRole('switch', { name: 'Installed only' }));
        expect(Math.abs(switchCentre - filter)).toBeLessThanOrEqual(1.5);
        expect(Math.abs(switchCentre - language)).toBeLessThanOrEqual(1.5);
        const refresh = await centre(row.getByRole('button').first());
        expect(Math.abs(switchCentre - refresh)).toBeLessThanOrEqual(1.5);
    });

    test('hides the extensions and the sources for adults until the setting is turned on', async () => {
        fake.adult = true;
        session = await launch();
        await openManga(session.page);
        await addStore(session.page);
        await goTo(session.page, 'EXTENSIONS');
        await session.page.getByRole('switch', { name: 'Installed only' }).uncheck();
        await expect(session.page.getByText('No extension found.')).toBeVisible();
        await expect(session.page.getByTestId('manga-extension')).toHaveCount(0);
        await session.page.getByRole('navigation', { name: 'Manga' }).getByRole('button', { name: 'SETTINGS', exact: true }).click();
        const adult = session.page.getByRole('switch', { name: 'Show adult (+18) sources' });
        await expect(adult).not.toBeChecked();
        await adult.check();
        await expect.poll(() => {
            return JSON.parse(readFileSync(join(session!.userData, 'settings.json'), 'utf8')) as { mangaShowAdult?: boolean };
        }).toMatchObject({ mangaShowAdult: true });
        await goTo(session.page, 'EXTENSIONS');
        await expect(session.page.getByTestId('manga-extension')).toContainText('Tachiyomi: Fake Dex');
        await expect(session.page.getByTestId('manga-extension')).toContainText('18+');
        await session.page.getByRole('button', { name: 'INSTALL: Tachiyomi: Fake Dex' }).click();
        await expect(session.page.getByText('INSTALLED', { exact: true })).toBeVisible();
        await goTo(session.page, 'BROWSE');
        await expect(session.page.getByTestId('manga-source')).toContainText('Fake Dex');
        await session.page.getByRole('navigation', { name: 'Manga' }).getByRole('button', { name: 'SETTINGS', exact: true }).click();
        await session.page.getByRole('switch', { name: 'Show adult (+18) sources' }).uncheck();
        await goTo(session.page, 'BROWSE');
        await expect(session.page.getByTestId('manga-source')).toHaveCount(0);
    });

    test('keeps the stores in the settings, and sends the address of a store to the server', async () => {
        session = await launch();
        await openManga(session.page);
        await goTo(session.page, 'EXTENSIONS');
        await expect(session.page.getByText('No store yet. Add one in the manga SETTINGS to see its extensions.')).toBeVisible();
        await expect(session.page.getByLabel('Address of a store (index.min.json)')).toHaveCount(0);
        await session.page.getByRole('button', { name: 'OPEN SETTINGS' }).click();
        await expect(session.page.getByText('Extension stores')).toBeVisible();
        await session.page.getByLabel('Address of a store (index.min.json)').fill(STORE_URL);
        await session.page.getByRole('button', { name: 'ADD', exact: true }).click();
        await expect(session.page.getByTestId('manga-store')).toContainText('Fake Store');
        await expect(session.page.getByTestId('manga-store')).toContainText(STORE_URL);
        expect(fake.graphqlRequests('addExtensionStore')[0]?.variables).toEqual({ indexUrl: STORE_URL });
        // Removing asks first: KEEP leaves the store and nothing is sent to the server.
        await session.page.getByRole('button', { name: 'REMOVE: Fake Store' }).click();
        const ask = session.page.getByRole('dialog', { name: 'Remove the store "Fake Store"?' });
        await expect(ask).toBeVisible();
        await expect(ask).toContainText('The store leaves the list and its extensions are not offered any more.');
        await ask.getByRole('button', { name: 'KEEP' }).click();
        await expect(ask).toBeHidden();
        await expect(session.page.getByTestId('manga-store')).toHaveCount(1);
        expect(fake.graphqlRequests('removeExtensionStore')).toHaveLength(0);
        await session.page.getByRole('button', { name: 'REMOVE: Fake Store' }).click();
        await ask.getByRole('button', { name: 'REMOVE', exact: true }).click();
        await expect(session.page.getByTestId('manga-store')).toHaveCount(0);
        expect(fake.graphqlRequests('removeExtensionStore')[0]?.variables).toEqual({ indexUrl: STORE_URL });
    });

    test('says in the settings how the server is doing, and has the button that looks for updates', async () => {
        session = await launch();
        await openManga(session.page);
        await goTo(session.page, 'SETTINGS');
        const status = session.page.getByRole('group', { name: 'Status of the programs' });
        const server = status.getByTestId('manga-health-server');
        await expect(server).toContainText('Suwayomi-Server');
        await expect(server).toContainText('v9.9.9-fake');
        await expect(server).toContainText('HEALTHY');
        expect(fake.graphqlRequests('aboutServer').length).toBeGreaterThanOrEqual(1);
        expect(fake.graphqlRequests('aboutServer')[0]?.path).toBe('/api/graphql');
        await expect(status.getByTestId('manga-health-helper')).toContainText('FlareSolverr');
        await expect(status.getByTestId('manga-health-helper')).toContainText('Not in use: it is not installed, or you run your own.');
        const before = fake.graphqlRequests('aboutServer').length;
        await status.getByRole('button', { name: 'CHECK NOW' }).click();
        await expect(status.getByRole('button', { name: 'CHECK NOW' })).toBeEnabled();
        expect(fake.graphqlRequests('aboutServer').length).toBe(before + 1);
        await expect(session.page.getByRole('group', { name: 'Updates of the programs' })).toHaveCount(0);
        await expect(status.getByRole('button', { name: 'CHECK FOR UPDATES' })).toBeEnabled();
        await expect(status.getByRole('button', { name: /^UPDATE TO/ })).toHaveCount(0);
    });

    test('only adds to the library and reads one chapter on the page of the browse: no way to start reading or to mark as read', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePiece(session.page);
        await expect(session.page.getByRole('button', { name: 'ADD TO LIBRARY' })).toBeVisible();
        await expect(session.page.getByRole('button', { name: 'READ: Romance Dawn', exact: true })).toBeVisible();
        await expect(session.page.getByRole('button', { name: 'START READING' })).toHaveCount(0);
        await expect(session.page.getByRole('button', { name: 'CONTINUE READING' })).toHaveCount(0);
        await expect(session.page.getByRole('button', { name: /^MARK ALL AS/ })).toHaveCount(0);
        await expect(session.page.getByRole('button', { name: /^Mark as/ })).toHaveCount(0);
    });

    test('explains what extensions are, updates all that have an update and marks the ones the server cannot run', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await goTo(session.page, 'EXTENSIONS');
        const about = session.page.getByRole('region', { name: 'WHAT ARE EXTENSIONS?' });
        await expect(about).toContainText('you alone are responsible for installing them');
        await expect(about).toContainText('The authors of Pullwave take no responsibility');
        await expect(session.page.getByRole('button', { name: /UPDATE ALL/ })).toHaveCount(0);
        fake.hasUpdate = true;
        await session.page.getByRole('button', { name: 'REFRESH LIST' }).click();
        await session.page.getByRole('button', { name: 'UPDATE ALL (1)' }).click();
        await expect(session.page.getByRole('button', { name: /UPDATE ALL/ })).toHaveCount(0);
        const updates = fake.graphqlRequests('updateExtensions(');
        expect(updates).toHaveLength(1);
        expect(updates[0]?.variables).toEqual({ ids: [EXTENSION_PKG] });
        expect(updates[0]?.path).toBe('/api/graphql');
        fake.extensionLib = '1.2';
        await session.page.getByRole('button', { name: 'REFRESH LIST' }).click();
        await expect(session.page.getByText('INCOMPATIBLE')).toHaveAttribute('title', 'Made for version 1.2 of the extension library, which the server does not support.');
        await expect(session.page.getByRole('button', { name: 'UNINSTALL: Tachiyomi: Fake Dex' })).toBeVisible();
    });

    test('says which store a source comes from', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await goTo(session.page, 'BROWSE');
        await expect(session.page.getByTestId('manga-source')).toContainText('Store: Fake Store');
    });

    test('searches a manga in all the sources at once, says which ones have it, and keeps the results when the tab is left', async () => {
        fake.otherSource = true;
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await goTo(session.page, 'BROWSE');
        await session.page.getByRole('navigation', { name: 'Manga' }).getByRole('button', { name: 'SEARCH', exact: true }).click();
        await expect(session.page.getByRole('navigation', { name: 'Manga' }).getByRole('button', { name: 'SEARCH', exact: true })).toHaveAttribute('aria-current', 'page');
        await expect(session.page.getByRole('button', { name: 'SEARCH', exact: true }).last()).toBeDisabled();

        await session.page.getByLabel('Manga name').fill('bleach');
        await session.page.getByLabel('Manga name').press('Enter');
        await expect(session.page.getByText('"bleach": found in 1 of 2 sources')).toBeVisible();
        const groups = session.page.getByTestId('manga-search-source');
        await expect(groups).toHaveCount(2);
        await expect(groups.nth(0).locator('h3')).toHaveText('Fake Dex (EN) Found: 1');
        await expect(groups.nth(0).getByRole('button', { name: 'Open: Bleach' })).toBeVisible();
        await expect(groups.nth(1).locator('h3')).toHaveText('Other Dex (EN) Not found');
        await expect(groups.nth(1).getByRole('listitem')).toHaveCount(0);
        const searches = (): ReturnType<FakeSuwayomi['graphqlRequests']> => {
            return fake.graphqlRequests('fetchSourceManga').filter((item) => {return item.variables?.['type'] === 'SEARCH'});
        };
        expect(searches().map((item) => {return [item.variables?.['source'], item.variables?.['query']]})).toEqual([[SOURCE_ID, 'bleach'], [OTHER_SOURCE_ID, 'bleach']]);

        // A name both sources have.
        await session.page.getByLabel('Manga name').fill('one piece');
        await session.page.getByRole('button', { name: 'SEARCH', exact: true }).last().click();
        await expect(session.page.getByText('"one piece": found in 2 of 2 sources')).toBeVisible();
        await expect(groups.nth(0).locator('h3')).toHaveText('Fake Dex (EN) Found: 1');
        await expect(groups.nth(1).locator('h3')).toHaveText('Other Dex (EN) Found: 1');

        // The results stay where they were when the user goes to another tab and comes back.
        await goTo(session.page, 'LIBRARY');
        await session.page.getByRole('navigation', { name: 'Manga' }).getByRole('button', { name: 'SEARCH', exact: true }).click();
        await expect(session.page.getByLabel('Manga name')).toHaveValue('one piece');
        await expect(session.page.getByText('"one piece": found in 2 of 2 sources')).toBeVisible();

        // A result opens on the page of the manga, which goes back to the results.
        await groups.nth(1).getByRole('button', { name: 'Open: One Piece' }).click();
        await expect(session.page.getByRole('button', { name: 'READ: Ch. 1', exact: true })).toBeVisible();
        await session.page.getByRole('button', { name: '← BACK' }).click();
        await expect(groups).toHaveCount(2);
        await expect(session.page.getByLabel('Manga name')).toHaveValue('one piece');
    });

    test('loads the next pages of the lists at the end of the scroll, also after the page of a manga was opened and closed, in the popular, the latest and the search', async () => {
        fake.pagedList = true;
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await goTo(session.page, 'BROWSE');
        for (const mode of ['POPULAR', 'LATEST']) {
            await goTo(session.page, 'BROWSE');
            await backToSources(session.page);
            await session.page.getByRole('button', { name: `${mode}: Fake Dex`, exact: true }).click();
            await expect(session.page.getByText('Results: 12')).toBeVisible();
            // The page of a manga covers the list, and going back puts the end of the list in the page again.
            await session.page.getByRole('button', { name: 'Open: Title 100' }).click();
            await expect(session.page.getByRole('button', { name: '← BACK' })).toBeVisible();
            await session.page.getByRole('button', { name: '← BACK' }).click();
            await expect(session.page.getByText('Results: 12')).toBeVisible();
            await session.page.getByTestId('manga-end-of-list').scrollIntoViewIfNeeded();
            await expect(session.page.getByText('Results: 15')).toBeVisible();
            await expect(session.page.getByRole('button', { name: 'Open: Title 114' })).toBeVisible();
        }
        // The search of the source: the same.
        await goTo(session.page, 'BROWSE');
        await backToSources(session.page);
        await session.page.getByRole('button', { name: 'POPULAR: Fake Dex', exact: true }).click();
        await expect(session.page.getByText('Results: 12')).toBeVisible();
        await session.page.getByRole('button', { name: 'SEARCH', exact: true }).last().click();
        await session.page.getByLabel('Manga name').fill('Title');
        await session.page.keyboard.press('Enter');
        await expect(session.page.getByText('Results: 12')).toBeVisible();
        await session.page.getByRole('button', { name: 'Open: Title 100' }).click();
        await session.page.getByRole('button', { name: '← BACK' }).click();
        await session.page.getByTestId('manga-end-of-list').scrollIntoViewIfNeeded();
        await expect(session.page.getByText('Results: 15')).toBeVisible();
    });

    test('clears the results of the search of all the sources and of the search of a source when the name is erased', async () => {
        fake.otherSource = true;
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await goTo(session.page, 'BROWSE');
        await session.page.getByRole('navigation', { name: 'Manga' }).getByRole('button', { name: 'SEARCH', exact: true }).click();
        const name = session.page.getByLabel('Manga name');
        await name.fill('bleach');
        await name.press('Enter');
        await expect(session.page.getByText('"bleach": found in 1 of 2 sources')).toBeVisible();
        await expect(session.page.getByTestId('manga-search-source')).toHaveCount(2);
        await name.fill('');
        await expect(session.page.getByTestId('manga-search-source')).toHaveCount(0);
        await expect(session.page.getByText('"bleach": found in 1 of 2 sources')).toHaveCount(0);
        await expect(session.page.getByRole('button', { name: 'Open: Bleach' })).toHaveCount(0);
        await expect(session.page.getByRole('button', { name: 'SEARCH', exact: true }).last()).toBeDisabled();

        // The search inside a source: erasing the name takes the list away.
        await goTo(session.page, 'BROWSE');
        await backToSources(session.page);
        await session.page.getByRole('button', { name: 'POPULAR: Fake Dex', exact: true }).click();
        await session.page.getByRole('button', { name: 'SEARCH', exact: true }).last().click();
        await name.fill('bleach');
        await name.press('Enter');
        await expect(session.page.getByRole('button', { name: 'Open: Bleach' })).toBeVisible();
        await expect(session.page.getByRole('button', { name: 'Open: One Piece' })).toHaveCount(0);
        await name.fill('');
        await expect(session.page.getByRole('button', { name: 'Open: Bleach' })).toHaveCount(0);
        await expect(session.page.getByRole('button', { name: 'Open: One Piece' })).toHaveCount(0);
    });

    test('lists the sources by name and has a search to find one', async () => {
        fake.otherSource = true;
        fake.otherSourceFirst = true;
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await goTo(session.page, 'BROWSE');
        const names = session.page.getByTestId('manga-source').locator('.row-link__text');
        await expect(names).toHaveText(['Fake Dex', 'Other Dex']);
        await expect(session.page.getByText('Sources: 2')).toBeVisible();

        const search = session.page.getByLabel('Search sources');
        await search.fill('other');
        await expect(names).toHaveText(['Other Dex']);
        await expect(session.page.getByText('Sources: 1')).toBeVisible();
        await search.fill('zzz');
        await expect(session.page.getByTestId('manga-source')).toHaveCount(0);
        await expect(session.page.getByText('No source matches that name.')).toBeVisible();
        await expect(session.page.getByText('Sources: 0')).toBeVisible();

        // The one found opens like any other.
        await search.fill('  FAKE ');
        await expect(names).toHaveText(['Fake Dex']);
        await session.page.getByRole('button', { name: 'Open: Fake Dex' }).click();
        await expect(session.page.getByRole('button', { name: '← SOURCES' })).toBeVisible();
    });

    test('installs the helper for Cloudflare from the settings, with the warning that Docker is needed', async () => {
        session = await launch();
        await openManga(session.page);
        await goTo(session.page, 'SETTINGS');
        await expect(session.page.getByTestId('manga-helper-docker')).toContainText('Docker must be installed and running.');
        await expect(session.page.getByText('Not installed. Only the sites protected by Cloudflare need it.')).toBeVisible();
        await session.page.getByRole('button', { name: 'INSTALL', exact: true }).click();
        await expect.poll(() => {
            return JSON.parse(readFileSync(join(session!.userData, 'settings.json'), 'utf8')) as { mangaFlaresolverrEnabled?: boolean };
        }).toMatchObject({ mangaFlaresolverrEnabled: true });
        await expect(session.page.getByRole('button', { name: 'REMOVE', exact: true })).toBeVisible();
    });

    test('adds a store, installs an extension and finds its source', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        const added = fake.graphqlRequests('addExtensionStore');
        expect(added).toHaveLength(1);
        expect(added[0]).toMatchObject({ method: 'POST', path: '/api/graphql', contentType: 'application/json', variables: { indexUrl: STORE_URL } });
        const installs = fake.graphqlRequests('updateExtension(');
        expect(installs).toHaveLength(1);
        expect(installs[0]?.variables).toEqual({ id: EXTENSION_PKG, patch: { install: true } });
        // The list of sources has the one the extension brings (not the local one of the server), and opens on its popular mangas.
        await goTo(session.page, 'BROWSE');
        await expect(session.page.getByTestId('manga-source')).toHaveCount(1);
        await expect(session.page.getByTestId('manga-source')).toContainText('Fake Dex');
        await expect(session.page.getByTestId('manga-source-group').locator('h3')).toHaveText('EN');
        await expect(session.page.getByRole('button', { name: 'LATEST: Fake Dex' })).toBeVisible();
        await session.page.getByRole('button', { name: 'POPULAR: Fake Dex', exact: true }).click();
        await expect(session.page.getByRole('heading', { name: 'Fake Dex' })).toBeVisible();
        await expect(session.page.getByRole('button', { name: 'Open: One Piece' })).toBeVisible();
        await expect(session.page.getByRole('button', { name: 'Open: Bleach' })).toBeVisible();
        await expect(session.page.getByText('Results: 2')).toBeVisible();
        // Back to the list of sources.
        await session.page.getByRole('button', { name: '← SOURCES' }).click();
        await expect(session.page.getByTestId('manga-source')).toHaveCount(1);
    });

    test('shows the covers the server gives', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openSource(session.page);
        const cover = session.page.locator('img.cover').first();
        await expect(cover).toBeVisible();
        // The page could decode it: it is a real picture, loaded from the server of the app.
        await expect.poll(() => {return cover.evaluate((image: HTMLImageElement) => {return image.complete && image.naturalWidth > 0})}).toBe(true);
        expect(fake.requests.some((item) => {return item.method === 'GET' && item.path === '/api/v1/manga/7/thumbnail'})).toBe(true);
    });

    test('searches a source', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openSource(session.page);
        await expect(session.page.getByRole('button', { name: 'Open: Bleach' })).toBeVisible();
        await session.page.getByRole('button', { name: 'SEARCH', exact: true }).last().click();
        await session.page.getByLabel('Manga name').fill('bleach');
        await session.page.keyboard.press('Enter');
        await expect(session.page.getByRole('button', { name: 'Open: One Piece' })).toHaveCount(0);
        await expect(session.page.getByRole('button', { name: 'Open: Bleach' })).toBeVisible();
        const searches = fake.graphqlRequests('fetchSourceManga').filter((item) => {return item.variables?.['type'] === 'SEARCH'});
        expect(searches).toHaveLength(1);
        expect(searches[0]?.variables).toEqual({ source: SOURCE_ID, type: 'SEARCH', page: 1, query: 'bleach',
            // The filters the source offers go with the search as they are (nothing was changed).
            filters: [
                { position: 0, checkBoxState: false },
                { position: 1, triState: 'IGNORE' },
                { position: 2, sortState: { index: 0, ascending: true } },
                { position: 3, groupChange: { position: 0, triState: 'IGNORE' } }
            ]
        });
    });

    test('sets the filters of a search and sends them with it', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openSource(session.page);
        await session.page.getByRole('button', { name: 'SEARCH', exact: true }).last().click();
        await session.page.getByRole('button', { name: 'FILTERS', exact: true }).click();
        await session.page.getByRole('switch', { name: 'Has chapters' }).check();
        await session.page.getByRole('checkbox', { name: 'Action', exact: true }).click();
        // The order is a field that lists its options when it is clicked, and narrows them as the user types.
        await session.page.getByRole('combobox', { name: 'Sort' }).click();
        await expect(session.page.getByRole('option')).toHaveText(['Name', 'Date']);
        await session.page.getByRole('combobox', { name: 'Sort' }).fill('da');
        await expect(session.page.getByRole('option')).toHaveText(['Date']);
        await session.page.getByRole('option', { name: 'Date' }).click();
        await expect(session.page.getByRole('combobox', { name: 'Sort' })).toHaveValue('Date');
        // The options of a group are picked by typing.
        await session.page.getByRole('combobox', { name: 'Genre' }).fill('dra');
        await session.page.getByRole('option', { name: 'Drama' }).click();
        await session.page.getByRole('button', { name: 'Drama: Only with this' }).click();
        await session.page.getByRole('button', { name: 'APPLY' }).click();
        await expect(session.page.getByRole('button', { name: 'Open: One Piece' })).toBeVisible();
        const searches = fake.graphqlRequests('fetchSourceManga').filter((item) => {return item.variables?.['type'] === 'SEARCH'});
        expect(searches).toHaveLength(1);
        expect(searches[0]?.variables).toEqual({
            source: SOURCE_ID,
            type: 'SEARCH',
            page: 1,
            query: '',
            filters: [
                { position: 0, checkBoxState: true },
                { position: 1, triState: 'INCLUDE' },
                { position: 2, sortState: { index: 1, ascending: true } },
                { position: 3, groupChange: { position: 0, triState: 'EXCLUDE' } }
            ]
        });
        // Starting over puts every filter back as the source gave it.
        await session.page.getByRole('button', { name: 'RESET' }).click();
        await expect(session.page.getByRole('switch', { name: 'Has chapters' })).not.toBeChecked();
        await expect(session.page.getByRole('checkbox', { name: 'Action', exact: true })).toHaveAttribute('aria-checked', 'false');
    });

    test('reads a chapter from the source: pages, keys, modes and the page it was left on', async () => {
        fake.pagesArePicture = true;
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePiece(session.page);
        await session.page.getByRole('button', { name: 'READ: Romance Dawn', exact: true }).click();
        const reader = session.page.getByRole('region', { name: 'Reader' });
        await expect(reader).toBeVisible();
        await expect(reader.getByText('One Piece · Romance Dawn')).toBeVisible();
        await expect(reader.getByText('1 / 3')).toBeVisible();
        const image = reader.getByRole('img');
        await expect(image).toHaveAttribute('src', `${fake.url}/api/v1/chapter/101/page/0`);
        await expect.poll(() => {return image.evaluate((element: HTMLImageElement) => {return element.complete && element.naturalWidth > 0})}).toBe(true);
        await session.page.keyboard.press('ArrowRight');
        await expect(reader.getByText('2 / 3')).toBeVisible();
        await expect(image).toHaveAttribute('src', `${fake.url}/api/v1/chapter/101/page/1`);
        // The scroll shows all the pages, and the settings are kept for the next chapter.
        await reader.getByRole('button', { name: 'READER SETTINGS' }).click();
        await reader.getByLabel('Reading mode').selectOption('vertical');
        await reader.getByRole('button', { name: 'READER SETTINGS' }).click({ force: true });
        await expect(reader.getByRole('img')).toHaveCount(3);
        // The next chapter.
        await reader.getByRole('button', { name: 'NEXT CHAPTER', exact: true }).click();
        await expect(reader.getByText('One Piece · The Great Race')).toBeVisible();
        await expect(reader.getByRole('img')).toHaveCount(3);
        await expect(reader.getByRole('button', { name: 'NEXT CHAPTER' })).toBeDisabled();
        await session.page.keyboard.press('Escape');
        await expect(reader).toHaveCount(0);
        await expect(session.page.getByRole('button', { name: 'READ: Romance Dawn', exact: true })).toBeVisible();
        await expect(session.page.getByRole('checkbox')).toHaveCount(0);
        // Opened again, it comes back in the mode that was chosen.
        await session.page.getByRole('button', { name: 'READ: Romance Dawn', exact: true }).click();
        await expect(session.page.getByRole('region', { name: 'Reader' }).getByRole('img')).toHaveCount(3);
    });

    test('shows the progress of the chapter, lets the user jump to a chapter and tries again only the page that failed', async () => {
        fake.pagesArePicture = true;
        fake.failTimes.set('/api/v1/chapter/101/page/1', 2);
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePiece(session.page);
        await session.page.getByRole('button', { name: 'READ: Romance Dawn', exact: true }).click();
        const reader = session.page.getByRole('region', { name: 'Reader' });
        const bar = reader.getByRole('progressbar', { name: 'Reading progress' });
        await expect(bar).toHaveAttribute('aria-valuenow', '33');
        await expect(bar.locator('.progress__bar')).toHaveCSS('box-shadow', /rgb/);
        await session.page.keyboard.press('ArrowRight');
        await expect(reader.getByText('2 / 3')).toBeVisible();
        await expect(bar).toHaveAttribute('aria-valuenow', '67');
        // The second page answered with an error: only it is asked for again.
        await expect(reader.getByRole('alert')).toHaveText('Page 2 could not be loaded.');
        // The page failed twice in all: how many of those were spent before the button depends on how soon the next page was preloaded, so the
        // button is pressed again while the message is still there.
        const image = reader.getByRole('img');
        await expect.poll(async () => {
            if (await reader.getByRole('button', { name: 'TRY AGAIN' }).isVisible()) {
                await reader.getByRole('button', { name: 'TRY AGAIN' }).click();
            }
            return image.evaluate((element: HTMLImageElement) => {return element.complete && element.naturalWidth > 0}).catch(() => {return false});
        }, { timeout: 15000 }).toBe(true);
        expect(fake.requests.filter((item) => {return item.path === '/api/v1/chapter/101/page/1'}).length).toBeGreaterThanOrEqual(3);
        expect(fake.requests.filter((item) => {return item.path === '/api/v1/chapter/101/page/0'})).toHaveLength(1);
        // Between the buttons of the chapters there is a list to jump to one.
        const chapters = reader.getByLabel('Go to chapter');
        await expect(chapters).toHaveValue('0');
        await chapters.selectOption('1');
        await expect(reader.getByText('One Piece · The Great Race')).toBeVisible();
        await expect(chapters).toHaveValue('1');
    });

    test('follows the scroll in the progress bar of the scroll modes, and the page in the single page mode', async () => {
        fake.pagesArePicture = true;
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePiece(session.page);
        await session.page.getByRole('button', { name: 'READ: Romance Dawn', exact: true }).click();
        const reader = session.page.getByRole('region', { name: 'Reader' });
        const bar = reader.getByRole('progressbar', { name: 'Reading progress' });
        await expect(bar).toHaveAttribute('aria-valuenow', '33');
        await reader.getByRole('button', { name: 'READER SETTINGS' }).click();
        await reader.getByLabel('Reading mode').selectOption('webtoon');
        await reader.getByRole('button', { name: 'READER SETTINGS' }).click({ force: true });
        const area = session.page.locator('.app__main');
        await expect(reader.getByRole('img')).toHaveCount(3);
        // The pages count once their pictures are in the flow (until then each one is a block that says it is loading).
        await expect(reader.locator('.reader__loading-page')).toHaveCount(0);
        await expect.poll(() => {return area.evaluate((element) => {return element.scrollHeight - element.clientHeight})}).toBeGreaterThan(1500);
        await expect(bar).toHaveAttribute('aria-valuenow', '0');

        // Half way down the pages the bar is half full, however many pages that is.
        const half = await reader.getByTestId('reader-scroll').evaluate((element) => {
            const box = element.getBoundingClientRect();
            const areaBox = (element.closest('.app__main') as HTMLElement).getBoundingClientRect();
            return Math.round((box.height - areaBox.height) / 2);
        });
        await area.evaluate((element, top) => {
            element.scrollTop = element.scrollTop + top;
        }, half);
        await expect.poll(async () => {return Number(await bar.getAttribute('aria-valuenow'))}).toBeGreaterThanOrEqual(45);
        expect(Number(await bar.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(55);

        // At the end of the pages it is full.
        await area.evaluate((element) => {
            element.scrollTop = element.scrollHeight;
        });
        await expect(bar).toHaveAttribute('aria-valuenow', '100');
        await expect(bar.locator('.progress__bar')).toHaveAttribute('style', /width: 100%/);

        // One page at a time it follows the page again.
        await reader.getByRole('button', { name: 'READER SETTINGS' }).click();
        await reader.getByLabel('Reading mode').selectOption('single');
        await expect(bar).toHaveAttribute('aria-valuenow', /^(33|67|100)$/);
    });

    test('goes back to the top with a gliding motion that the user can interrupt', async () => {
        fake.pagesArePicture = true;
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePiece(session.page);
        await session.page.getByRole('button', { name: 'READ: Romance Dawn', exact: true }).click();
        const reader = session.page.getByRole('region', { name: 'Reader' });
        await reader.getByRole('button', { name: 'READER SETTINGS' }).click();
        await reader.getByLabel('Reading mode').selectOption('webtoon');
        await reader.getByRole('button', { name: 'READER SETTINGS' }).click({ force: true });
        const area = session.page.locator('.app__main');
        await expect(reader.getByRole('img')).toHaveCount(3);
        await expect(reader.locator('.reader__loading-page')).toHaveCount(0);
        await expect.poll(() => {return area.evaluate((element) => {return element.scrollHeight - element.clientHeight})}).toBeGreaterThan(1500);
        // A chapter starts with the zone of the previous chapter above its first page, out of view: that is the top the button goes back to.
        await expect.poll(() => {return area.evaluate((element) => {return element.scrollTop})}).toBeGreaterThan(100);
        const chapterTop = await area.evaluate((element) => {return element.scrollTop});
        await area.evaluate((element) => {
            element.scrollTop = 1500;
        });
        const start = await area.evaluate((element) => {return element.scrollTop});
        expect(start).toBeGreaterThan(1000);
        await expect(session.page.getByRole('button', { name: 'Back to the top' })).toBeVisible();

        // Every frame of the way up is recorded: it is a long run of small steps, never a jump, and it ends at the top.
        const samples = await session.page.evaluate(async () => {
            const element = document.querySelector('.app__main') as HTMLElement;
            const button = document.querySelector('.reader__top') as HTMLElement;
            const seen: number[] = [element.scrollTop];
            button.click();
            const began = performance.now();
            await new Promise<void>((resolve) => {
                const frame = (): void => {
                    seen.push(element.scrollTop);
                    if (element.scrollTop <= 0 || performance.now() - began > 3000) {
                        resolve();
                        return;
                    }
                    requestAnimationFrame(frame);
                };
                requestAnimationFrame(frame);
            });
            return seen;
        });
        expect(Math.abs(samples.at(-1)! - chapterTop)).toBeLessThanOrEqual(1);
        expect(samples.length).toBeGreaterThan(15);
        for (let index = 1; index < samples.length; index += 1) {
            expect(samples[index]!).toBeLessThanOrEqual(samples[index - 1]!);
        }
        const biggestStep = Math.max(
            ...samples.slice(1).map((value, index) => {
                return samples[index]! - value;
            })
        );
        expect(biggestStep).toBeLessThan((start - chapterTop) / 3);

        // The user taking over (the wheel) stops it where it is. (The first run is allowed to finish its last frames first.)
        await session.page.waitForTimeout(1000);
        await area.evaluate((element) => {
            element.scrollTop = 1500;
        });
        await expect.poll(() => {return area.evaluate((element) => {return element.scrollTop})}).toBeGreaterThan(1000);
        await expect(session.page.getByRole('button', { name: 'Back to the top' })).toBeVisible();
        await session.page.getByRole('button', { name: 'Back to the top' }).click();
        await expect.poll(() => {return area.evaluate((element) => {return element.scrollTop})}).toBeLessThan(1400);
        await area.dispatchEvent('wheel');
        const stopped = await area.evaluate((element) => {return element.scrollTop});
        await session.page.waitForTimeout(500);
        expect(await area.evaluate((element) => {return element.scrollTop})).toBe(stopped);
        expect(stopped).toBeGreaterThan(chapterTop);
    });

    test('grows the bar of a download smoothly, with the neon of the app', async () => {
        fake.imageDelayMs = 350;
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        await downloadSeason(session.page);
        await session.page.getByRole('button', { name: /^DOWNLOADS \(\d+\)$/ }).click();
        const bar = session.page.getByTestId('manga-job').first().locator('.progress__bar');
        await expect(bar).toBeVisible();
        await expect(bar).toHaveClass(/progress__bar--smooth/);
        // The glow comes out of the bar, in the colour of the theme, and a wave flows through it.
        await expect(bar).toHaveCSS('animation-name', 'bar-wave-flow');
        await expect(bar).toHaveCSS('box-shadow', /rgb.*rgb.*rgb/);
        await expect(session.page.locator('.progress').first()).toHaveCSS('overflow', 'visible');

        // A chapter has three pages, so the real value moves in three steps; the bar goes through many values between them, never back.
        const widths = await session.page.evaluate(async () => {
            const element = document.querySelector('[data-testid="manga-job"] .progress__bar') as HTMLElement | null;
            const seen: number[] = [];
            const began = performance.now();
            await new Promise<void>((resolve) => {
                const frame = (): void => {
                    const current = document.querySelector('[data-testid="manga-job"] .progress__bar') as HTMLElement | null;
                    if (current !== null) {
                        seen.push(current.getBoundingClientRect().width);
                    }
                    if (performance.now() - began > 1500 || (element === null && current === null)) {
                        resolve();
                        return;
                    }
                    requestAnimationFrame(frame);
                };
                requestAnimationFrame(frame);
            });
            return seen;
        });
        const distinct = new Set(
            widths.map((width) => {
                return Math.round(width);
            })
        );
        expect(distinct.size).toBeGreaterThan(8);
        await expect(session.page.locator('.toast').filter({ hasText: 'Download complete: ' }).first()).toBeVisible({ timeout: 20000 });
    });

    test('lets the bar of a chapter with fast pages glide to the end before it leaves the downloads', async () => {
        fake.imageDelayMs = 40;
        fake.pageTotal = 20;
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        await downloadSeason(session.page);
        await session.page.getByRole('button', { name: /^DOWNLOADS \(\d+\)$/ }).click();
        // The share of the track the first bar fills, frame by frame, until that job is no longer in the list.
        const fills = await session.page.evaluate(async () => {
            const seen: number[] = [];
            const title = document.querySelector('[data-testid="manga-job"] .job__title')?.textContent ?? '';
            await new Promise<void>((resolve) => {
                const began = performance.now();
                const frame = (): void => {
                    const job = Array.from(document.querySelectorAll('[data-testid="manga-job"]')).find((candidate) => {
                        return candidate.querySelector('.job__title')?.textContent === title;
                    });
                    const bar = job?.querySelector('.progress__bar') as HTMLElement | null | undefined;
                    if (bar && bar.parentElement) {
                        seen.push((bar.getBoundingClientRect().width / bar.parentElement.getBoundingClientRect().width) * 100);
                    }
                    if (!job || performance.now() - began > 5000) {
                        resolve();
                        return;
                    }
                    requestAnimationFrame(frame);
                };
                requestAnimationFrame(frame);
            });
            return seen;
        });
        expect(fills.length).toBeGreaterThan(20);
        // Never back, and the last thing shown is the full bar, not a bar that was cut off half way.
        expect(fills.every((fill, index) => {return index === 0 || fill >= fills[index - 1]! - 0.01})).toBe(true);
        expect(fills.at(-1)).toBeGreaterThan(99.5);
    });

    test('keeps the settings in view wherever the chapter is, goes back to the top, and scrolls by itself', async () => {
        fake.pagesArePicture = true;
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePiece(session.page);
        await session.page.getByRole('button', { name: 'READ: Romance Dawn', exact: true }).click();
        const reader = session.page.getByRole('region', { name: 'Reader' });
        await expect(reader.getByRole('button', { name: 'AUTO SCROLL' })).toBeDisabled();
        await reader.getByRole('button', { name: 'READER SETTINGS' }).click();
        await reader.getByLabel('Reading mode').selectOption('webtoon');
        await reader.getByRole('button', { name: 'READER SETTINGS' }).click({ force: true });
        const area = session.page.locator('.app__main');
        await expect(reader.getByRole('img')).toHaveCount(3);
        // The pages count once their pictures are in the flow (until then each one is a block that says it is loading).
        await expect(reader.locator('.reader__loading-page')).toHaveCount(0);
        await expect.poll(() => {return area.evaluate((element) => {return element.scrollHeight - element.clientHeight})}).toBeGreaterThan(1500);
        await expect.poll(() => {return area.evaluate((element) => {return element.scrollTop})}).toBeGreaterThan(100);
        const chapterTop = await area.evaluate((element) => {return element.scrollTop});
        await expect(session.page.getByRole('button', { name: 'Back to the top' })).toHaveCount(0);

        // Far into the chapter, the settings still open where the user is looking.
        await area.evaluate((element) => {
            element.scrollTop = 1200;
        });
        await expect(session.page.getByRole('button', { name: 'Back to the top' })).toBeVisible();
        await reader.getByRole('button', { name: 'READER SETTINGS' }).click();
        await expect(reader.getByLabel('Reading mode')).toBeInViewport();
        await expect(reader.getByLabel('Auto scroll speed (pixels per second)')).toHaveValue('80');
        await reader.getByRole('button', { name: 'READER SETTINGS' }).click();
        await expect(reader.getByLabel('Reading mode')).toHaveCount(0);

        // It scrolls by itself, and stops when asked to.
        const before = await area.evaluate((element) => {return element.scrollTop});
        await reader.getByRole('button', { name: 'AUTO SCROLL' }).click();
        await expect.poll(() => {return area.evaluate((element) => {return element.scrollTop})}).toBeGreaterThan(before + 40);
        await reader.getByRole('button', { name: 'STOP SCROLL' }).click();
        const stopped = await area.evaluate((element) => {return element.scrollTop});
        await session.page.waitForTimeout(400);
        expect(await area.evaluate((element) => {return element.scrollTop})).toBe(stopped);

        // The button at the corner takes it back to where the chapter starts (the first page under the bar).
        await session.page.getByRole('button', { name: 'Back to the top' }).click();
        await expect.poll(() => {return area.evaluate((element) => {return Math.round(element.scrollTop)})}).toBe(chapterTop);
        await expect(session.page.getByRole('button', { name: 'Back to the top' })).toHaveCount(0);
    });

    test('reads a downloaded chapter from its file, with no request to the server for the pages', async () => {
        fake.pagesArePicture = true;
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        await downloadSeason(session.page);
        await waitForDownloaded(session.page);
        const before = fake.requests.filter((item) => {return item.path.startsWith('/api/v1/chapter/101/page/')}).length;
        await session.page.getByRole('button', { name: 'READ: Romance Dawn', exact: true }).click();
        const reader = session.page.getByRole('region', { name: 'Reader' });
        await expect(reader.getByText('1 / 3')).toBeVisible();
        const image = reader.getByRole('img');
        const source = await image.getAttribute('src');
        expect(source).toMatch(/^pullwave-manga:\/\/page\/\d+\/0$/);
        await expect.poll(() => {return image.evaluate((element: HTMLImageElement) => {return element.complete && element.naturalWidth > 0})}).toBe(true);
        await session.page.keyboard.press('ArrowRight');
        await expect(reader.getByText('2 / 3')).toBeVisible();
        await expect.poll(() => {return image.evaluate((element: HTMLImageElement) => {return element.complete && element.naturalWidth > 0})}).toBe(true);
        expect(fake.requests.filter((item) => {return item.path.startsWith('/api/v1/chapter/101/page/')})).toHaveLength(before);
    });

    test('downloads a chapter into a CBZ with the pages in order and the ComicInfo', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePiece(session.page);
        await expect(session.page.getByText(/^Author:/)).toHaveText('Author: Oda');
        await expect(session.page.getByText('Chapters (2)')).toBeVisible();
        // The page of the browse only reads and adds: nothing to pick or download there.
        await expect(session.page.getByRole('checkbox')).toHaveCount(0);
        await expect(session.page.getByRole('button', { name: /^DOWNLOAD (SELECTED|MISSING)/ })).toHaveCount(0);
        await session.page.getByRole('button', { name: 'ADD TO LIBRARY' }).click();
        await goTo(session.page, 'LIBRARY');
        await session.page.getByTestId('manga-entry').getByRole('button', { name: 'Open: One Piece' }).click();
        await downloadSeason(session.page);
        await waitForDownloaded(session.page);

        const file = join(mangaFolder(), 'One Piece', 'Chapter 1.cbz');
        await expect.poll(() => {return existsSync(file)}).toBe(true);
        // The one button of the season downloads every chapter the library has, the oldest first.
        await expect.poll(() => {return readdirSync(join(mangaFolder(), 'One Piece')).sort()}).toEqual(['Chapter 1.cbz', 'Chapter 2.cbz']);
        const entries = readZipEntries(readFileSync(file));
        expect(entries.map((entry) => {return entry.name})).toEqual(['001.jpg', '002.jpg', '003.jpg', 'ComicInfo.xml']);
        expect([...entries[0]!.data]).toEqual([...JPEG]);
        const info = entries[3]!.data.toString('utf-8');
        expect(info).toContain('<Series>One Piece</Series>');
        expect(info).toContain('<Title>Romance Dawn</Title>');
        expect(info).toContain('<Number>1</Number>');
        expect(info).toContain('<Writer>Oda</Writer>');
        expect(info).toContain('<PageCount>3</PageCount>');
        // Nothing is left beside them.
        expect(readdirSync(join(mangaFolder(), 'One Piece')).sort()).toEqual(['Chapter 1.cbz', 'Chapter 2.cbz']);

        const pages = fake.graphqlRequests('fetchChapterPages');
        expect(pages).toHaveLength(2);
        expect(pages[0]?.variables).toEqual({ chapterId: 101 });
        expect(pages[1]?.variables).toEqual({ chapterId: 102 });
        expect(fake.requests.filter((item) => {return item.path.startsWith('/api/v1/chapter/101/page/')}).map((item) => {return item.path})).toEqual([
            '/api/v1/chapter/101/page/0',
            '/api/v1/chapter/101/page/1',
            '/api/v1/chapter/101/page/2'
        ]);
    });

    test('downloads one chapter from its own row in the library, and the rest with the button of the season', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        const first = session.page.getByTestId('manga-chapter').filter({ hasText: 'Romance Dawn' });
        const second = session.page.getByTestId('manga-chapter').filter({ hasText: 'The Great Race' });
        await expect(first.getByRole('button', { name: 'DOWNLOAD: Romance Dawn' })).toBeVisible();
        await expect(second.getByRole('button', { name: 'DOWNLOAD: The Great Race' })).toHaveClass(/btn--small/);

        // Only the chapter of the row is downloaded.
        await second.getByRole('button', { name: 'DOWNLOAD: The Great Race' }).click();
        await expect(session.page.locator('.toast').filter({ hasText: '1 chapter(s) queued.' })).toBeVisible();
        await expect(second.getByText('Downloaded')).toBeVisible({ timeout: 20000 });
        await expect(second.getByRole('button', { name: /^DOWNLOAD:/ })).toHaveCount(0);
        await expect.poll(() => {return readdirSync(join(mangaFolder(), 'One Piece')).sort()}).toEqual(['Chapter 2.cbz']);
        expect(
            fake.graphqlRequests('fetchChapterPages').map((item) => {
                return item.variables?.['chapterId'];
            })
        ).toEqual([102]);
        await expect(first.getByText('Not downloaded')).toBeVisible();
        await expect(first.getByRole('button', { name: 'DOWNLOAD: Romance Dawn' })).toBeVisible();

        // The season still downloads what is missing.
        await downloadSeason(session.page);
        await expect.poll(() => {return readdirSync(join(mangaFolder(), 'One Piece')).sort()}).toEqual(['Chapter 1.cbz', 'Chapter 2.cbz']);
        await expect(session.page.getByRole('button', { name: /^DOWNLOAD:/ })).toHaveCount(0);
    });

    test('keeps the downloaded chapter in the library, with its state in the manga', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        await downloadSeason(session.page);
        await waitForDownloaded(session.page);
        await expect(session.page.locator('.badge--done', { hasText: 'Downloaded' })).toHaveCount(2);
        // Nothing is missing any more: the button of the season is gone.
        await expect(session.page.getByRole('button', { name: /^DOWNLOAD SEASON/ })).toHaveCount(0);

        await session.page.getByRole('button', { name: '← BACK' }).click();
        const entry = session.page.getByTestId('manga-entry');
        await expect(entry.getByRole('heading', { name: 'One Piece' })).toBeVisible();
        await expect(entry.getByText('2 of 2 downloaded')).toBeVisible();
        // There is no button to download what is missing in the list: that is in the page of the manga.
        await expect(entry.getByRole('button', { name: 'DOWNLOAD SEASON' })).toHaveCount(0);

        // The list of the browse says the manga is in the library.
        await goTo(session.page, 'BROWSE');
        await expect(session.page.getByText('IN LIBRARY')).toBeVisible();
    });

    test('goes from the source to the library and from the library to the source, and adds the chapters the library lacks', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePiece(session.page);
        await expect(session.page.getByRole('button', { name: 'GO TO LIBRARY' })).toHaveCount(0);
        await session.page.getByRole('button', { name: 'ADD TO LIBRARY' }).click();
        await expect(session.page.getByRole('button', { name: 'GO TO LIBRARY' })).toBeVisible();
        await expect(session.page.getByRole('button', { name: 'ADD MISSING CHAPTERS (0)' })).toBeDisabled();
        await session.page.getByRole('button', { name: 'GO TO LIBRARY' }).click();
        await expect(session.page.getByRole('button', { name: 'READ: Romance Dawn', exact: true })).toBeVisible();
        await expect(session.page.getByRole('navigation', { name: 'Manga' }).getByRole('button', { name: 'LIBRARY', exact: true })).toHaveAttribute('aria-current', 'page');
        await session.page.getByRole('button', { name: 'GO TO SOURCE' }).click();
        await expect(session.page.getByRole('button', { name: 'READ: Romance Dawn', exact: true })).toBeVisible();
        await expect(session.page.getByRole('checkbox')).toHaveCount(0);
        await expect(session.page.getByRole('navigation', { name: 'Manga' }).getByRole('button', { name: 'BROWSE', exact: true })).toHaveAttribute('aria-current', 'page');
    });

    test('searches the source by a genre as a filter, and only shows as text the author the source has no filter for', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePiece(session.page);
        await session.page.getByRole('button', { name: 'Search by: Action', exact: true }).click();
        await expect(session.page.getByRole('button', { name: 'Open: One Piece' })).toBeVisible();
        const searches = (): ReturnType<FakeSuwayomi['graphqlRequests']> => {
            return fake.graphqlRequests('fetchSourceManga').filter((item) => {return item.variables?.['type'] === 'SEARCH'});
        };
        expect(searches()).toHaveLength(1);
        expect(searches()[0]?.variables).toEqual({
            source: SOURCE_ID,
            type: 'SEARCH',
            page: 1,
            query: '',
            filters: [
                { position: 0, checkBoxState: false },
                { position: 1, triState: 'INCLUDE' },
                { position: 2, sortState: { index: 0, ascending: true } },
                { position: 3, groupChange: { position: 0, triState: 'IGNORE' } }
            ]
        });
        // The filters start closed; the user opens them to see which ones are on.
        const filtersToggle = session.page.getByRole('button', { name: 'FILTERS', exact: true });
        await expect(filtersToggle).toHaveAttribute('aria-expanded', 'false');
        await expect(session.page.getByRole('checkbox', { name: 'Action', exact: true })).toHaveCount(0);
        await filtersToggle.click();
        await expect(session.page.getByRole('button', { name: 'HIDE FILTERS', exact: true })).toHaveAttribute('aria-expanded', 'true');
        await expect(session.page.getByRole('checkbox', { name: 'Action', exact: true })).toHaveAttribute('aria-checked', 'true');

        // The author has no filter in this source: it is shown, and a click on it does not search the name as text.
        await session.page.getByRole('button', { name: 'Open: One Piece' }).click();
        await expect(session.page.getByRole('button', { name: 'Search by: Action', exact: true })).toBeVisible();
        await expect(session.page.getByRole('button', { name: 'Search by: Oda', exact: true })).toHaveCount(0);
        await expect(session.page.getByText(/^Author:/).locator('.manga__tag--plain')).toHaveText('Oda');
        expect(searches()).toHaveLength(1);
    });

    test('adds a manga to the library with all its chapters, and downloads what is missing from the page of the manga', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePiece(session.page);
        await session.page.getByRole('button', { name: 'ADD TO LIBRARY' }).click();
        await goTo(session.page, 'LIBRARY');
        await expect(session.page.getByText('0 of 2 downloaded')).toBeVisible();
        expect(existsSync(join(mangaFolder(), 'One Piece'))).toBe(false);

        await session.page.getByRole('button', { name: 'Open: One Piece' }).click();
        await downloadSeason(session.page);
        await expect(session.page.getByRole('button', { name: 'DOWNLOADS (0)' })).toBeVisible({ timeout: 30000 });
        await session.page.getByRole('button', { name: '← BACK' }).click();
        await expect(session.page.getByText('2 of 2 downloaded')).toBeVisible({ timeout: 30000 });
        // The oldest chapter goes first.
        const order = fake.graphqlRequests('fetchChapterPages').map((item) => {return item.variables?.['chapterId']});
        expect(order).toEqual([101, 102]);
        expect(readdirSync(join(mangaFolder(), 'One Piece')).sort()).toEqual(['Chapter 1.cbz', 'Chapter 2.cbz']);
    });

    test('opens the page of a manga on the site of its source', async () => {
        const log = join(workDir, 'opened.log');
        session = await launch({}, { PULLWAVE_MANGA_OPEN_LOG: log });
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePiece(session.page);
        const button = session.page.getByRole('button', { name: 'OPEN SITE' });
        await expect(button).toHaveAttribute('title', 'https://dex.example/manga/7');
        await button.click();
        await expect.poll(() => {return existsSync(log) ? readFileSync(log, 'utf-8') : ''}).toBe('default https://dex.example/manga/7\n');
    });

    test('leaves the manga folder free while the library is empty, and fixes it, with only MIGRATE FOLDER, once there is a manga', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await goTo(session.page, 'SETTINGS');
        await expect(session.page.getByLabel('Manga folder')).toBeEnabled();
        await expect(session.page.getByRole('region', { name: 'Settings' }).getByRole('button', { name: 'BROWSE' })).toBeEnabled();
        await expect(session.page.getByRole('button', { name: 'MIGRATE FOLDER' })).toBeEnabled();
        await expect(session.page.getByText('With mangas in the library, the folder only changes through MIGRATE FOLDER, which moves the files too.')).toHaveCount(0);

        await openOnePieceInLibrary(session.page);
        await goTo(session.page, 'SETTINGS');
        await expect(session.page.getByLabel('Manga folder')).toBeDisabled();
        await expect(session.page.getByRole('region', { name: 'Settings' }).getByRole('button', { name: 'BROWSE' })).toBeDisabled();
        await expect(session.page.getByText('With mangas in the library, the folder only changes through MIGRATE FOLDER, which moves the files too.')).toBeVisible();
        await expect(session.page.getByRole('button', { name: 'MIGRATE FOLDER' })).toBeEnabled();
        const saved = JSON.parse(readFileSync(join(session.userData, 'settings.json'), 'utf-8')) as Record<string, unknown>;
        expect(saved['mangaDirectory']).toBe(mangaFolder());
    });

    test('moves the downloaded chapters to another folder, checks them and points the library to them', async () => {
        const target = join(workDir, 'moved');
        session = await launch({}, { PULLWAVE_MANGA_MIGRATE_DIR: target });
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        await downloadSeason(session.page);
        await waitForDownloaded(session.page);
        const oldFile = join(mangaFolder(), 'One Piece', 'Chapter 1.cbz');
        await expect.poll(() => {return existsSync(oldFile)}).toBe(true);
        const original = readFileSync(oldFile);

        await goTo(session.page, 'SETTINGS');
        await session.page.getByRole('button', { name: 'MIGRATE FOLDER' }).click();
        await expect(session.page.getByLabel('Manga folder')).toHaveValue(target);
        await expect(session.page.locator('.toast, .notice').filter({ hasText: `2 chapter(s) moved to ${target}.` }).first()).toBeVisible();

        const newFile = join(target, 'One Piece', 'Chapter 1.cbz');
        expect(readFileSync(newFile).equals(original)).toBe(true);
        expect(existsSync(oldFile)).toBe(false);
        expect(existsSync(mangaFolder())).toBe(false);
        const saved = JSON.parse(readFileSync(join(session.userData, 'settings.json'), 'utf-8')) as Record<string, unknown>;
        expect(saved['mangaDirectory']).toBe(target);

        // The chapter is read from its new place, and a new download goes to the new folder.
        await goTo(session.page, 'LIBRARY');
        await expect(session.page.locator('.badge--done', { hasText: 'Downloaded' })).toHaveCount(2);
        await session.page.getByRole('button', { name: 'Remove download: Romance Dawn' }).click();
        await answerConfirm(session.page, 'Remove the download of "Romance Dawn"?', 'REMOVE');
        await expect.poll(() => {return existsSync(newFile)}).toBe(false);
        await downloadSeason(session.page);
        await waitForDownloaded(session.page);
        await expect.poll(() => {return readdirSync(join(target, 'One Piece')).sort()}).toEqual(['Chapter 1.cbz', 'Chapter 2.cbz']);
    });

    test('looks for new chapters by itself and adds them to the library without downloading them', async () => {
        session = await launch({}, { PULLWAVE_MANGA_CHECK_MS: '1500' });
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePiece(session.page);
        await session.page.getByRole('button', { name: 'ADD TO LIBRARY' }).click();
        await goTo(session.page, 'LIBRARY');
        await expect(session.page.getByText('0 of 2 downloaded')).toBeVisible();

        fake.laterChapters = [103, 104];
        await expect(session.page.getByText('0 of 4 downloaded')).toBeVisible({ timeout: 20000 });
        // The chapters that came today say so on the card of the manga; the two it came with do not count.
        await expect(session.page.getByTestId('manga-entry').getByTestId('manga-new-chapters')).toHaveText('2 NEW CHAPTERS');
        await expect(session.page.locator('.toast').filter({ hasText: '2 new chapter(s) added to the library: One Piece' }).first()).toBeVisible();
        expect(existsSync(join(mangaFolder(), 'One Piece'))).toBe(false);
        expect(fake.graphqlRequests('fetchChapterPages')).toHaveLength(0);
    });

    test('does not look for new chapters when the setting is off', async () => {
        session = await launch({ mangaCheckNewChapters: false }, { PULLWAVE_MANGA_CHECK_MS: '700' });
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePiece(session.page);
        await session.page.getByRole('button', { name: 'ADD TO LIBRARY' }).click();
        fake.laterChapters = [103];
        const before = fake.graphqlRequests('fetchMangaAndChapters').length;
        await session.page.waitForTimeout(3000);
        expect(fake.graphqlRequests('fetchMangaAndChapters')).toHaveLength(before);
        await goTo(session.page, 'LIBRARY');
        await expect(session.page.getByText('0 of 2 downloaded')).toBeVisible();
    });

    test('hides a group with its mangas from the library, shows it again, and forgets the hiding when the app is closed', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openSource(session.page);
        await session.page.getByRole('button', { name: 'Open: One Piece' }).click();
        await session.page.getByRole('button', { name: 'ADD TO LIBRARY' }).click();
        await session.page.getByRole('button', { name: '← BACK' }).click();
        await session.page.getByRole('button', { name: 'Open: Bleach' }).click();
        await session.page.getByRole('button', { name: 'ADD TO LIBRARY' }).click();
        await goTo(session.page, 'LIBRARY');
        await session.page.getByRole('button', { name: 'MANAGE GROUPS' }).click();
        await session.page.getByLabel('Name of the group').fill('Mangas');
        await session.page.getByRole('button', { name: 'CREATE', exact: true }).click();
        await expect(session.page.getByTestId('manga-group')).toHaveCount(1);
        await session.page.getByRole('button', { name: 'MANAGE GROUPS' }).click();
        await session.page.getByTestId('manga-entry').filter({ hasText: 'One Piece' }).getByRole('button', { name: 'Open: One Piece' }).click();
        await openOrganize(session.page);
        await session.page.getByRole('button', { name: 'Mangas', exact: true }).click();
        await session.page.getByRole('button', { name: '← BACK' }).click();

        const tabs = session.page.getByRole('navigation', { name: 'Groups' });
        await expect(tabs.getByRole('button')).toHaveText(['ALL', 'Mangas']);
        await tabs.getByRole('button', { name: 'Mangas' }).click();
        await expect(session.page.getByTestId('manga-entry').getByRole('heading', { name: 'One Piece' })).toBeVisible();

        // Hiding the group takes its tab away, and the manga that is only in it; the tab that was open goes back to all.
        await session.page.getByRole('button', { name: 'MANAGE GROUPS' }).click();
        await session.page.getByRole('button', { name: 'HIDE: Mangas' }).click();
        await expect(session.page.getByTestId('manga-group').getByText('HIDDEN')).toBeVisible();
        await expect(tabs).toHaveCount(0);
        await expect(session.page.getByTestId('manga-entry')).toHaveCount(1);
        await expect(session.page.getByTestId('manga-entry').getByRole('heading', { name: 'Bleach' })).toBeVisible();
        await expect(session.page.getByText('1 hidden group(s). Open MANAGE GROUPS to show them again.')).toBeVisible();

        // SHOW brings it back.
        await session.page.getByRole('button', { name: 'SHOW: Mangas' }).click();
        await expect(tabs.getByRole('button')).toHaveText(['ALL', 'Mangas']);
        await expect(session.page.getByText(/hidden group/)).toHaveCount(0);
        await tabs.getByRole('button', { name: 'Mangas' }).click();
        await expect(session.page.getByTestId('manga-entry').getByRole('heading', { name: 'One Piece' })).toBeVisible();

        // It is a hiding for now: when the app is closed and opened again the group is there.
        await session.page.getByRole('button', { name: 'HIDE: Mangas' }).click();
        await expect(tabs).toHaveCount(0);
        await session.app.close();
        session = await launch();
        await openManga(session.page);
        await goTo(session.page, 'LIBRARY');
        await expect(session.page.getByRole('navigation', { name: 'Groups' }).getByRole('button')).toHaveText(['ALL', 'Mangas']);
        await expect(session.page.getByText(/hidden group/)).toHaveCount(0);
    });

    test('keeps seasons together in a series and mangas in groups, which are made and used from the library', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openSource(session.page);
        await session.page.getByRole('button', { name: 'Open: One Piece' }).click();
        await session.page.getByRole('button', { name: 'ADD TO LIBRARY' }).click();
        await session.page.getByRole('button', { name: '← BACK' }).click();
        await session.page.getByRole('button', { name: 'Open: Bleach' }).click();
        await session.page.getByRole('button', { name: 'ADD TO LIBRARY' }).click();
        await goTo(session.page, 'LIBRARY');
        await expect(session.page.getByText('Library (2)')).toBeVisible();

        // Groups are made in the library.
        await session.page.getByRole('button', { name: 'MANAGE GROUPS' }).click();
        await session.page.getByLabel('Name of the group').fill('Mangas');
        await session.page.getByRole('button', { name: 'CREATE', exact: true }).click();
        await session.page.getByLabel('Name of the group').fill('Favorites');
        await session.page.getByRole('button', { name: 'CREATE', exact: true }).click();
        await expect(session.page.getByTestId('manga-group')).toHaveCount(2);
        await session.page.getByRole('button', { name: 'MANAGE GROUPS' }).click();

        // One Piece is put in two groups, and Bleach joins it as the second season of a series.
        await session.page.getByTestId('manga-entry').filter({ hasText: 'One Piece' }).getByRole('button', { name: 'Open: One Piece' }).click();
        await openOrganize(session.page);
        await session.page.getByRole('button', { name: 'Mangas', exact: true }).click();
        await session.page.getByRole('button', { name: 'Favorites', exact: true }).click();
        await expect(session.page.getByRole('button', { name: 'Mangas', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await session.page.getByLabel('Series', { exact: true }).fill('Pirates');
        await session.page.getByRole('button', { name: 'SAVE SERIES' }).click();
        await expect(session.page.getByText('In the series "Pirates", order 1.')).toBeVisible();
        await session.page.getByRole('button', { name: '← BACK' }).click();
        // A manga that is in a group is not in the tab of all: Bleach, which is in none, is the one that is there.
        await expect(session.page.getByTestId('manga-entry')).toHaveCount(1);
        await session.page.getByTestId('manga-entry').getByRole('button', { name: 'Open: Bleach' }).click();
        await openOrganize(session.page);
        await session.page.getByLabel('Series', { exact: true }).fill('pirates');
        await session.page.getByLabel('Order').fill('2');
        await session.page.getByRole('button', { name: 'SAVE SERIES' }).click();
        await expect(session.page.getByText('In the series "Pirates", order 2.')).toBeVisible();
        // The season that joined the series is in the groups the series is in.
        await expect(session.page.getByRole('button', { name: 'Mangas', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await expect(session.page.getByRole('button', { name: 'Favorites', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await session.page.getByRole('button', { name: '← BACK' }).click();

        // The library shows the series as one card, which opens to its seasons. Every manga is in a group now, so there is no tab of all:
        // the first group (the one made first, which is the tab on the left) is the one that is shown.
        const tabs = session.page.getByRole('navigation', { name: 'Groups' });
        await expect(tabs.getByRole('button', { name: 'ALL', exact: true })).toHaveCount(0);
        await expect(tabs.getByRole('button')).toHaveText(['Mangas', 'Favorites']);
        await expect(tabs.getByRole('button', { name: 'Mangas' })).toHaveAttribute('aria-current', 'page');
        await expect(session.page.getByTestId('manga-series')).toHaveCount(1);
        await expect(session.page.getByTestId('manga-entry')).toHaveCount(0);
        await expect(session.page.getByText('2 SEASONS')).toBeVisible();
        await tabs.getByRole('button', { name: 'Favorites' }).click();
        await expect(session.page.getByTestId('manga-series')).toHaveCount(1);
        await session.page.getByRole('button', { name: 'Open series: Pirates' }).click();
        await expect(session.page.getByTestId('manga-season')).toHaveCount(2);
        await expect(session.page.getByTestId('manga-season').first()).toContainText('SEASON 1');
        // The series has no small cover at the top: each season is a card with its own big cover.
        await expect(session.page.getByTestId('manga-series-cover')).toHaveCount(0);
        await expect(session.page.getByTestId('manga-season').first()).toHaveClass(/cover-card/);
        await expect(session.page.getByTestId('manga-season-cover')).toHaveCount(2);
        await expect(session.page.getByTestId('manga-season').first().getByTestId('manga-season-cover').locator('.cover')).toHaveCount(1);
        // The groups of a series are behind its gear.
        await expect(session.page.getByRole('button', { name: 'Mangas', exact: true })).toHaveCount(0);
        await session.page.getByRole('button', { name: 'Series options: Pirates' }).click();
        await expect(session.page.getByRole('button', { name: 'Mangas', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await session.page.keyboard.press('Escape');
        await session.page.getByRole('button', { name: 'BACK TO LIBRARY' }).click();

        // Deleting a group leaves the mangas.
        await session.page.getByRole('button', { name: 'MANAGE GROUPS' }).click();
        await session.page.getByRole('button', { name: 'DELETE: Favorites' }).click();
        await expect(session.page.getByRole('dialog', { name: 'Delete the group "Favorites"?' })).toBeVisible();
        await session.page.getByRole('dialog').getByRole('button', { name: 'DELETE', exact: true }).click();
        await expect(session.page.getByTestId('manga-group')).toHaveCount(1);
        await expect(session.page.getByTestId('manga-series')).toHaveCount(1);
    });

    test('keeps the groups and the series after the app is closed and opened again', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        await openOrganize(session.page);
        await session.page.getByLabel('Series', { exact: true }).fill('Pirates');
        await session.page.getByRole('button', { name: 'SAVE SERIES' }).click();
        await expect(session.page.getByText('In the series "Pirates", order 1.')).toBeVisible();
        await session.page.getByRole('button', { name: '← BACK' }).click();
        await session.page.getByRole('button', { name: 'MANAGE GROUPS' }).click();
        await session.page.getByLabel('Name of the group').fill('Mangas');
        await session.page.getByRole('button', { name: 'CREATE', exact: true }).click();
        await expect(session.page.getByTestId('manga-group')).toHaveCount(1);
        await session.app.close();

        session = await launch();
        await openManga(session.page);
        await goTo(session.page, 'LIBRARY');
        await expect(session.page.getByTestId('manga-series')).toContainText('Pirates');
        await expect(session.page.getByRole('navigation', { name: 'Groups' }).getByRole('button', { name: 'Mangas' })).toBeVisible();
    });

    test('puts the groups in the order the user chooses with the arrows, and the tabs of the library follow it, even after the app is closed', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        await session.page.getByRole('button', { name: '← BACK' }).click();
        await session.page.getByRole('button', { name: 'MANAGE GROUPS' }).click();
        for (const name of ['Zeta', 'Alpha', 'Mid']) {
            await session.page.getByLabel('Name of the group').fill(name);
            await session.page.getByRole('button', { name: 'CREATE', exact: true }).click();
        }
        const rows = session.page.getByTestId('manga-group').locator('.history__title');
        const tabs = session.page.getByRole('navigation', { name: 'Groups' }).getByRole('button');
        // A new group goes to the end, and the first of the list is the tab on the left.
        await expect(rows).toHaveText(['Zeta', 'Alpha', 'Mid']);
        await expect(tabs).toHaveText(['ALL', 'Zeta', 'Alpha', 'Mid']);
        await expect(session.page.getByRole('button', { name: 'Move up (towards the left tab): Zeta' })).toBeDisabled();
        await expect(session.page.getByRole('button', { name: 'Move down (towards the right tab): Mid' })).toBeDisabled();

        // Going up, a group goes to the left; going down, to the right.
        await session.page.getByRole('button', { name: 'Move up (towards the left tab): Mid' }).click();
        await expect(rows).toHaveText(['Zeta', 'Mid', 'Alpha']);
        await expect(tabs).toHaveText(['ALL', 'Zeta', 'Mid', 'Alpha']);
        await session.page.getByRole('button', { name: 'Move up (towards the left tab): Mid' }).click();
        await expect(rows).toHaveText(['Mid', 'Zeta', 'Alpha']);
        await expect(tabs).toHaveText(['ALL', 'Mid', 'Zeta', 'Alpha']);
        await session.page.getByRole('button', { name: 'Move down (towards the right tab): Zeta' }).click();
        await expect(rows).toHaveText(['Mid', 'Alpha', 'Zeta']);
        await expect(tabs).toHaveText(['ALL', 'Mid', 'Alpha', 'Zeta']);
        await expect(session.page.getByRole('button', { name: 'Move up (towards the left tab): Mid' })).toBeDisabled();
        await expect(session.page.getByRole('button', { name: 'Move down (towards the right tab): Zeta' })).toBeDisabled();

        // The order is kept when the app is closed and opened again.
        await session.app.close();
        session = await launch();
        await openManga(session.page);
        await goTo(session.page, 'LIBRARY');
        await expect(session.page.getByRole('navigation', { name: 'Groups' }).getByRole('button')).toHaveText(['ALL', 'Mid', 'Alpha', 'Zeta']);
        await session.page.getByRole('button', { name: 'MANAGE GROUPS' }).click();
        await expect(session.page.getByTestId('manga-group').locator('.history__title')).toHaveText(['Mid', 'Alpha', 'Zeta']);
    });

    test('goes back and forward through the series and the groups with the buttons of the mouse', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        await openOrganize(session.page);
        await session.page.getByLabel('Series', { exact: true }).fill('Pirates');
        await session.page.getByRole('button', { name: 'SAVE SERIES' }).click();
        await expect(session.page.getByText('In the series "Pirates", order 1.')).toBeVisible();
        await session.page.getByRole('button', { name: '← BACK' }).click();
        await session.page.getByRole('button', { name: 'Open series: Pirates' }).click();
        await expect(session.page.getByTestId('manga-series-view')).toBeVisible();
        await session.page.getByRole('button', { name: 'Open: One Piece' }).click();
        await expect(session.page.getByRole('button', { name: 'READ: Romance Dawn', exact: true })).toBeVisible();
        // Back: the series, then the cards. Forward: the series, then the manga.
        await session.page.evaluate(() => {
            window.dispatchEvent(new MouseEvent('mouseup', { button: 3, bubbles: true, cancelable: true }));
        });
        await expect(session.page.getByTestId('manga-series-view')).toBeVisible();
        await session.page.evaluate(() => {
            window.dispatchEvent(new MouseEvent('mouseup', { button: 3, bubbles: true, cancelable: true }));
        });
        await expect(session.page.getByTestId('manga-series')).toBeVisible();
        await session.page.evaluate(() => {
            window.dispatchEvent(new MouseEvent('mouseup', { button: 4, bubbles: true, cancelable: true }));
        });
        await expect(session.page.getByTestId('manga-series-view')).toBeVisible();
    });

    test('moves a manga to the same manga in another source, keeping what was downloaded and matching the chapters by number', async () => {
        fake.otherSource = true;
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        await downloadSeason(session.page);
        await waitForDownloaded(session.page);
        const file = join(mangaFolder(), 'One Piece', 'Chapter 1.cbz');
        await expect.poll(() => {return existsSync(file)}).toBe(true);

        await openOrganize(session.page);
        await session.page.getByRole('button', { name: 'MIGRATE TO ANOTHER SOURCE' }).click();
        const dialog = session.page.getByRole('dialog', { name: 'MIGRATE TO ANOTHER SOURCE' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByLabel('Language').locator('option')).toHaveText(['All languages', 'EN']);
        await expect(dialog.getByLabel('Search in').locator('option')).toHaveText(['All sources', 'Other Dex (en)']);
        await dialog.getByLabel('Language').selectOption('en');
        await expect(dialog.getByLabel('Search in').locator('option')).toHaveText(['All sources', 'Other Dex (en)']);
        await session.page.getByRole('button', { name: 'SEARCH', exact: true }).last().click();
        await session.page.getByRole('button', { name: 'Pick: One Piece (Other Dex)' }).click();
        await expect(session.page.getByTestId('manga-migration-preview')).toHaveText(
            '2 of the 2 chapters of the library match chapters of the new source. 1 new chapter(s) will be added, 0 downloaded chapter(s) the new source lacks will be kept and 0 chapter(s) not downloaded will be removed.'
        );
        await session.page.getByRole('button', { name: 'MIGRATE', exact: true }).click();
        await expect(session.page.locator('.toast').filter({ hasText: 'Migrated: 2 chapter(s) matched, 1 added, 0 removed.' }).first()).toBeVisible();
        await expect(session.page.getByRole('dialog')).toHaveCount(0);

        // The manga is the one of the other source now: its chapters (three of them) come from there, and the downloaded one is still downloaded.
        await expect(session.page.getByTestId('manga-chapter')).toHaveCount(3);
        await expect(session.page.getByTestId('manga-chapter').filter({ hasText: 'Ch. 1' }).locator('.badge--done')).toBeVisible();
        await expect(session.page.getByTestId('manga-chapter').filter({ hasText: 'Ch. 2' }).locator('.badge--done')).toBeVisible();
        await expect(session.page.getByTestId('manga-chapter').filter({ hasText: 'Ch. 3' }).locator('.badge--done')).toHaveCount(0);
        await expect(session.page.getByRole('button', { name: 'OPEN SITE' })).toHaveAttribute('title', 'https://other.example/manga/70');
        expect(existsSync(file)).toBe(true);
        await session.page.getByRole('button', { name: '← BACK' }).click();
        await expect(session.page.getByText('2 of 3 downloaded')).toBeVisible();
        await expect(session.page.getByRole('heading', { name: 'One Piece' })).toBeVisible();

        // The chapters that are new download from the new source.
        await session.page.getByRole('button', { name: 'Open: One Piece' }).click();
        await downloadSeason(session.page);
        await waitForDownloaded(session.page);
        await expect.poll(() => {return readdirSync(join(mangaFolder(), 'One Piece')).sort()}).toEqual(['Chapter 1.cbz', 'Chapter 2.cbz', 'Chapter 3.cbz']);
        expect(fake.graphqlRequests('fetchChapterPages').map((item) => {return item.variables?.['chapterId']})).toEqual([101, 102, 703]);
    });

    test('says a manga is in the library from another source, and asks before adding it again', async () => {
        fake.otherSource = true;
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);

        // The same title in another source: the list marks it, and the page of the manga says which source has it.
        await goTo(session.page, 'BROWSE');
        await session.page.getByRole('button', { name: '← SOURCES' }).click();
        await session.page.getByRole('button', { name: 'Open: Other Dex' }).click();
        const popular = session.page.getByRole('button', { name: 'POPULAR: Other Dex', exact: true });
        if (await popular.isVisible()) {
            await popular.click();
        }
        await expect(session.page.getByText('IN LIBRARY (OTHER SOURCE)')).toBeVisible();
        await expect(session.page.getByText('IN LIBRARY', { exact: true })).toHaveCount(0);
        await session.page.getByRole('button', { name: 'Open: One Piece' }).click();
        await expect(session.page.getByText('Already in your library from: Fake Dex.')).toBeVisible();
        await expect(session.page.getByRole('button', { name: 'GO TO LIBRARY' })).toHaveCount(0);

        // Cancelling adds nothing.
        await session.page.getByRole('button', { name: 'ADD TO LIBRARY' }).click();
        const dialog = session.page.getByRole('dialog', { name: 'ALREADY IN YOUR LIBRARY' });
        await expect(dialog).toContainText('"One Piece" is already in your library from Fake Dex. Add it from this source too?');
        await dialog.getByRole('button', { name: 'CANCEL' }).click();
        await expect(dialog).toHaveCount(0);
        await expect(session.page.getByRole('button', { name: 'GO TO LIBRARY' })).toHaveCount(0);

        // Confirming adds it as a second entry.
        await session.page.getByRole('button', { name: 'ADD TO LIBRARY' }).click();
        await dialog.getByRole('button', { name: 'ADD ANYWAY' }).click();
        await expect(session.page.getByRole('button', { name: 'GO TO LIBRARY' })).toBeVisible();
        await goTo(session.page, 'LIBRARY');
        await expect(session.page.getByTestId('manga-entry')).toHaveCount(2);
    });

    test('makes a folder of images when the setting says so', async () => {
        session = await launch({ mangaFormat: 'folder' });
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        await downloadSeason(session.page);
        await waitForDownloaded(session.page);
        const folder = join(mangaFolder(), 'One Piece', 'Chapter 2');
        await expect.poll(() => {return existsSync(folder)}).toBe(true);
        expect(readdirSync(folder).sort()).toEqual(['001.jpg', '002.jpg', '003.jpg', 'ComicInfo.xml']);
    });

    test('changes the format in the settings of the section', async () => {
        session = await launch();
        await openManga(session.page);
        await session.page.getByRole('navigation', { name: 'Manga' }).getByRole('button', { name: 'SETTINGS' }).click();
        await expect(session.page.getByLabel('Manga folder')).toHaveValue(mangaFolder());
        await session.page.getByLabel('Format of each chapter').selectOption('folder');
        await expect(session.page.getByText('All changes saved.')).toBeVisible();
        const saved = JSON.parse(readFileSync(join(session.userData, 'settings.json'), 'utf-8')) as Record<string, unknown>;
        expect(saved['mangaFormat']).toBe('folder');
        expect(saved['mangaDirectory']).toBe(mangaFolder());
    });

    test('has no setting for the number of downloads at the same time, which is fixed', async () => {
        session = await launch();
        await openManga(session.page);
        await session.page.getByRole('navigation', { name: 'Manga' }).getByRole('button', { name: 'SETTINGS' }).click();
        await expect(session.page.getByLabel('Format of each chapter')).toBeVisible();
        await expect(session.page.getByLabel('Downloads at the same time')).toHaveCount(0);
    });

    test('shows the source of the manga in its card and on its page, with the language', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        await session.page.getByRole('button', { name: '← BACK' }).click();
        const badge = session.page.getByTestId('manga-entry').getByTestId('manga-source-name');
        await expect(badge).toHaveText('Fake Dex · EN');
        await session.page.getByRole('button', { name: 'Open: One Piece' }).click();
        await expect(session.page.getByTestId('manga-source')).toHaveText('Source: Fake Dex (EN)');
        await expect(session.page.getByRole('button', { name: 'LINK SOURCE' })).toHaveCount(0);
    });

    test('pauses everything at once and goes on with everything', async () => {
        fake.imageDelayMs = 400;
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        await downloadSeason(session.page);
        await session.page.getByRole('button', { name: /^DOWNLOADS \(\d+\)$/ }).click();
        await session.page.getByRole('button', { name: 'PAUSE ALL' }).click();
        const jobs = session.page.getByTestId('manga-job');
        await expect(jobs.getByText('Paused', { exact: true })).toHaveCount(2);
        await expect(session.page.getByRole('button', { name: 'PAUSE ALL' })).toHaveCount(0);
        expect(existsSync(join(mangaFolder(), 'One Piece', 'Chapter 1.cbz'))).toBe(false);
        await session.page.getByRole('button', { name: 'RESUME ALL' }).click();
        await expect(session.page.locator('.toast').filter({ hasText: 'Download complete: ' }).first()).toBeVisible({ timeout: 20000 });
        await expect.poll(() => {return readdirSync(join(mangaFolder(), 'One Piece')).sort()}).toEqual(['Chapter 1.cbz', 'Chapter 2.cbz']);
    });

    test('downloads three chapters of a source at once, and PAUSE ALL keeps the one that waits waiting until RESUME ALL', async () => {
        fake.imageDelayMs = 400;
        fake.laterChapters = [103, 104];
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        await downloadSeason(session.page);
        await session.page.getByRole('button', { name: /^DOWNLOADS \(\d+\)$/ }).click();
        const jobs = session.page.getByTestId('manga-job');
        await expect(jobs.getByText('Downloading', { exact: true })).toHaveCount(3);
        await expect(jobs.filter({ hasText: 'Chapter 4' }).getByText('Waiting', { exact: true })).toBeVisible();

        await session.page.getByRole('button', { name: 'PAUSE ALL' }).click();
        await expect(jobs.getByText('Paused', { exact: true })).toHaveCount(3);
        await expect(jobs.filter({ hasText: 'Chapter 4' }).getByText('Waiting', { exact: true })).toBeVisible();
        await expect(session.page.getByText('The downloads are paused: the chapters that wait start with RESUME ALL.')).toBeVisible();
        await expect(session.page.getByRole('button', { name: 'PAUSE ALL' })).toHaveCount(0);

        await session.page.getByRole('button', { name: 'RESUME ALL' }).click();
        await expect(session.page.getByText(/The downloads are paused/)).toHaveCount(0);
        await expect.poll(() => {return readdirSync(join(mangaFolder(), 'One Piece')).sort()}, { timeout: 20000 }).toEqual(['Chapter 1.cbz', 'Chapter 2.cbz', 'Chapter 3.cbz', 'Chapter 4.cbz']);
    });

    test('tries a chapter whose pages the server cannot give three times, then shows why and lets it be retried', async () => {
        fake.failingChapters.add(101);
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        await downloadSeason(session.page);
        await session.page.getByRole('button', { name: /^DOWNLOADS \(\d+\)$/ }).click();
        // The chapter that works is downloaded; the other, the oldest, is the one that failed.
        const job = session.page.getByTestId('manga-job').filter({ hasText: 'Romance Dawn' });
        await expect(job.getByText('Failed', { exact: true })).toBeVisible({ timeout: 20000 });
        await expect(job.getByRole('alert')).toHaveText('The site or the extension reported an error.');
        const failure = job.getByRole('alert').getByRole('button', { name: 'The site or the extension reported an error.' });
        await expect(failure).toHaveAttribute('title', 'Click to copy the technical error');
        // Clicking the error copies what the backend said about it, to be pasted where it is debugged.
        await failure.click();
        await expect(session.page.locator('.toast').filter({ hasText: 'Technical error copied.' })).toBeVisible();
        const copied = await session.app.evaluate(({ clipboard }) => {
            return clipboard.readText();
        });
        expect(copied).toContain('API_ERROR\n');
        expect(copied).toContain('The source could not give the pages');
        expect(
            fake.graphqlRequests('fetchChapterPages').filter((item) => {
                return item.variables?.['chapterId'] === 101;
            })
        ).toHaveLength(3);
        expect(existsSync(join(mangaFolder(), 'One Piece', 'Chapter 1.cbz'))).toBe(false);

        fake.failingChapters.clear();
        await job.getByRole('button', { name: 'RETRY' }).click();
        await expect(session.page.locator('.toast').filter({ hasText: 'Download complete: ' }).first()).toBeVisible({ timeout: 20000 });
        await expect.poll(() => {return existsSync(join(mangaFolder(), 'One Piece', 'Chapter 1.cbz'))}).toBe(true);
    });

    test('pauses a download and goes on from where it was', async () => {
        fake.imageDelayMs = 400;
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        await downloadSeason(session.page);
        await session.page.getByRole('button', { name: /^DOWNLOADS \(\d+\)$/ }).click();
        // Both chapters download at once (three at a time for a source): the first one is paused.
        const job = session.page.getByTestId('manga-job').filter({ hasText: 'Romance Dawn' });
        await job.getByRole('button', { name: 'PAUSE' }).click();
        await expect(job.getByText('Paused', { exact: true })).toBeVisible();
        expect(existsSync(join(mangaFolder(), 'One Piece', 'Chapter 1.cbz'))).toBe(false);
        await job.getByRole('button', { name: 'RESUME' }).click();
        await expect(session.page.locator('.toast').filter({ hasText: 'Download complete: ' }).first()).toBeVisible({ timeout: 20000 });
        await expect.poll(() => {return existsSync(join(mangaFolder(), 'One Piece', 'Chapter 1.cbz'))}).toBe(true);
        await expect.poll(() => {return readdirSync(join(mangaFolder(), 'One Piece')).sort()}).toEqual(['Chapter 1.cbz', 'Chapter 2.cbz']);
    });

    test('keeps the paused chapters when the app is closed, and goes on with them at the same place', async () => {
        fake.imageDelayMs = 400;
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        await downloadSeason(session.page);
        await session.page.getByRole('button', { name: /^DOWNLOADS \(\d+\)$/ }).click();
        await session.page.getByRole('button', { name: 'PAUSE ALL' }).click();
        await expect(session.page.getByTestId('manga-job').getByText('Paused', { exact: true })).toHaveCount(2);
        await session.app.close();

        session = await launch();
        await openManga(session.page);
        await goTo(session.page, 'LIBRARY');
        await session.page.getByRole('button', { name: /^DOWNLOADS \(\d+\)$/ }).click();
        const jobs = session.page.getByTestId('manga-job');
        await expect(jobs.getByText('Paused', { exact: true })).toHaveCount(2);
        await expect(jobs.getByRole('button', { name: 'CANCEL' })).toHaveCount(2);
        await session.page.getByRole('button', { name: 'RESUME ALL' }).click();
        await expect(session.page.locator('.toast').filter({ hasText: 'Download complete: ' }).first()).toBeVisible({ timeout: 20000 });
        // The same names, and no folder of pages left behind.
        await expect.poll(() => {return readdirSync(join(mangaFolder(), 'One Piece')).sort()}, { timeout: 20000 }).toEqual(['Chapter 1.cbz', 'Chapter 2.cbz']);
    });

    test('cancels from the library a chapter that was paused when the app was closed, deleting its pages', async () => {
        fake.imageDelayMs = 400;
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        await downloadSeason(session.page);
        await session.page.getByRole('button', { name: /^DOWNLOADS \(\d+\)$/ }).click();
        await session.page.getByRole('button', { name: 'PAUSE ALL' }).click();
        await expect(session.page.getByTestId('manga-job').getByText('Paused', { exact: true })).toHaveCount(2);
        await session.app.close();

        session = await launch();
        await openManga(session.page);
        await goTo(session.page, 'LIBRARY');
        await session.page.getByTestId('manga-entry').getByRole('button', { name: 'Open: One Piece' }).click();
        const row = session.page.getByTestId('manga-chapter').filter({ hasText: 'Romance Dawn' });
        await expect(row.getByText('Paused', { exact: true })).toBeVisible();
        await expect(row.getByRole('button', { name: 'RESUME: Romance Dawn' })).toBeVisible();
        await row.getByRole('button', { name: 'CANCEL: Romance Dawn' }).click();
        await answerConfirm(session.page, 'Cancel this download?', 'CANCEL');
        await expect(row.getByRole('button', { name: 'RETRY: Romance Dawn' })).toBeVisible();
        await expect(row.getByRole('button', { name: 'RESUME: Romance Dawn' })).toHaveCount(0);
        await expect.poll(() => {
            return readdirSync(join(mangaFolder(), 'One Piece')).filter((name) => {
                return name.startsWith('Chapter 1');
            });
        }).toEqual([]);
    });

    test('removes the download of a chapter, which stays as not downloaded, and a manga with its folder', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        await downloadSeason(session.page);
        await expect(session.page.getByRole('button', { name: 'DOWNLOADS (0)' })).toBeVisible({ timeout: 30000 });
        await session.page.getByRole('button', { name: '← BACK' }).click();
        await expect(session.page.getByText('2 of 2 downloaded')).toBeVisible({ timeout: 30000 });
        await session.page.getByRole('button', { name: 'Open: One Piece' }).click();
        await session.page.getByRole('button', { name: 'Remove download: Romance Dawn' }).click();
        await answerConfirm(session.page, 'Remove the download of "Romance Dawn"?', 'REMOVE');
        await expect.poll(() => {return existsSync(join(mangaFolder(), 'One Piece', 'Chapter 1.cbz'))}).toBe(false);
        // The chapter is still in the list, as one that is not downloaded, with nothing left to remove.
        const first = session.page.getByTestId('manga-chapter').filter({ hasText: 'Romance Dawn' });
        await expect(first.getByText('Not downloaded')).toBeVisible();
        await expect(first.getByRole('button', { name: /^Remove download/ })).toHaveCount(0);
        await session.page.getByRole('button', { name: '← BACK' }).click();
        await expect(session.page.getByText('1 of 2 downloaded')).toBeVisible();
        await expect.poll(() => {return existsSync(join(mangaFolder(), 'One Piece', 'Chapter 1.cbz'))}).toBe(false);
        expect(existsSync(join(mangaFolder(), 'One Piece', 'Chapter 2.cbz'))).toBe(true);

        await session.page.getByRole('button', { name: 'REMOVE: One Piece' }).click();
        await expect(session.page.getByRole('dialog', { name: 'Remove "One Piece"?' })).toBeVisible();
        await session.page.getByRole('dialog').getByRole('button', { name: 'REMOVE', exact: true }).click();
        await expect(session.page.getByText('Your library is empty.')).toBeVisible();
        await expect.poll(() => {return existsSync(join(mangaFolder(), 'One Piece'))}).toBe(false);
    });

    test('remembers the chapter and the page where the reading stopped, marks chapters as read, and starts every page at the top', async () => {
        fake.pagesArePicture = true;
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        await expect(session.page.getByRole('button', { name: 'START READING' })).toBeVisible();
        await session.page.getByRole('button', { name: 'READ: The Great Race', exact: true }).click();
        const reader = session.page.getByRole('region', { name: 'Reader' });
        await session.page.keyboard.press('ArrowRight');
        await expect(reader.getByText('2 / 3')).toBeVisible();
        await session.page.keyboard.press('Escape');
        await expect(reader).toHaveCount(0);

        // The page of the manga starts at the top, says where the chapter was left, and continues from there.
        await expect.poll(() => {return session.page.locator('.app__main').evaluate((element) => {return element.scrollTop})}).toBe(0);
        await expect(session.page.getByTestId('manga-chapter').filter({ hasText: 'The Great Race' })).toContainText('left on page 2');
        await session.page.getByRole('button', { name: 'CONTINUE READING' }).click();
        await expect(reader.getByText('One Piece · The Great Race')).toBeVisible();
        await expect(reader.getByText('2 / 3')).toBeVisible();
        // Reading to the last page marks the chapter as read.
        await session.page.keyboard.press('ArrowRight');
        await expect(reader.getByText('3 / 3')).toBeVisible();
        await session.page.keyboard.press('Escape');
        const great = session.page.getByTestId('manga-chapter').filter({ hasText: 'The Great Race' });
        await expect(great.getByRole('img', { name: 'Read' })).toHaveText('✓');
        await expect(great).toHaveClass(/history__item--watched/);
        await expect(great.getByRole('button', { name: 'Mark as not read: The Great Race' })).toHaveAttribute('aria-pressed', 'true');

        // By hand, one chapter or the whole manga.
        await session.page.getByRole('button', { name: 'Mark as read: Romance Dawn' }).click();
        await expect(session.page.getByRole('button', { name: 'MARK ALL AS NOT READ' })).toBeVisible();
        await session.page.getByRole('button', { name: 'MARK ALL AS NOT READ' }).click();
        await expect(session.page.getByRole('img', { name: 'Read' })).toHaveCount(0);

        // What was read is remembered after the app is closed.
        await session.page.getByRole('button', { name: 'MARK ALL AS READ' }).click();
        await session.app.close();
        session = await launch();
        await openManga(session.page);
        await goTo(session.page, 'LIBRARY');
        await session.page.getByRole('button', { name: 'Open: One Piece' }).click();
        await expect(session.page.getByRole('img', { name: 'Read' })).toHaveCount(2);
    });

    test('continues in the chapter the manga was last read in, on the page it was left on, even when the chapter is marked as read', async () => {
        fake.pagesArePicture = true;
        fake.pageTotal = 10;
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        const reader = session.page.getByRole('region', { name: 'Reader' });
        const row = session.page.getByRole('button', { name: 'READ: Romance Dawn', exact: true });
        const openedChapter = reader.getByText(/One Piece · /);

        // The chapter is marked as read, and read again up to page 3.
        await session.page.getByRole('button', { name: 'Mark as read: Romance Dawn' }).click();
        await row.click();
        await expect(reader.getByText('1 / 10')).toBeVisible();
        await session.page.keyboard.press('ArrowRight');
        await session.page.keyboard.press('ArrowRight');
        await expect(reader.getByText('3 / 10')).toBeVisible();
        await session.page.keyboard.press('Escape');

        // The row and CONTINUE READING both go to page 3 of that chapter, not to the next one.
        await row.click();
        await expect(reader.getByText('3 / 10')).toBeVisible();
        await expect(openedChapter).toHaveText('One Piece · Romance Dawn');
        await session.page.keyboard.press('Escape');
        await session.page.getByRole('button', { name: 'CONTINUE READING' }).click();
        await expect(openedChapter).toHaveText('One Piece · Romance Dawn');
        await expect(reader.getByText('3 / 10')).toBeVisible();

        // Left on the last page, it continues on the last page of that chapter; the row starts the chapter over, as it always did.
        await session.page.keyboard.press('End');
        await expect(reader.getByText('10 / 10')).toBeVisible();
        await session.page.keyboard.press('Escape');
        await session.page.getByRole('button', { name: 'CONTINUE READING' }).click();
        await expect(openedChapter).toHaveText('One Piece · Romance Dawn');
        await expect(reader.getByText('10 / 10')).toBeVisible();
        await session.page.keyboard.press('Escape');
        await row.click();
        await expect(reader.getByText('1 / 10')).toBeVisible();

        // Another chapter read after it becomes the one that is continued.
        await session.page.keyboard.press('Escape');
        await session.page.getByRole('button', { name: 'READ: The Great Race', exact: true }).click();
        await session.page.keyboard.press('ArrowRight');
        await expect(reader.getByText('2 / 10')).toBeVisible();
        await session.page.keyboard.press('Escape');
        await session.page.getByRole('button', { name: 'CONTINUE READING' }).click();
        await expect(openedChapter).toHaveText('One Piece · The Great Race');
        await expect(reader.getByText('2 / 10')).toBeVisible();
    });

    test('holds the place of every page with a block that says it is loading, and gives it to the picture when it arrives', async () => {
        fake.pagesArePicture = true;
        fake.imageDelayMs = 1200;
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        await session.page.getByRole('button', { name: 'READ: Romance Dawn', exact: true }).click();
        const reader = session.page.getByRole('region', { name: 'Reader' });
        await reader.getByRole('button', { name: 'READER SETTINGS' }).click();
        await reader.getByLabel('Reading mode').selectOption('webtoon');
        await reader.getByRole('button', { name: 'READER SETTINGS' }).click({ force: true });

        // The pictures are slow: each page is a block that says so, and the pictures wait beside them, out of the flow.
        const blocks = reader.locator('.reader__loading-page');
        await expect(blocks).toHaveCount(3);
        await expect(blocks.nth(0)).toHaveText('Loading page 1…');
        await expect(blocks.nth(2)).toHaveText('Loading page 3…');
        await expect(reader.locator('.reader__img--pending')).toHaveCount(3);
        const box = await blocks.nth(0).boundingBox();
        expect(box!.height).toBeGreaterThan(300);

        // When the pictures arrive the blocks are gone and the pages are in the flow.
        await expect(blocks).toHaveCount(0, { timeout: 15000 });
        await expect(reader.locator('.reader__img--pending')).toHaveCount(0);
        await expect(reader.locator('img[data-page]')).toHaveCount(3);
    });

    test('switches the chapter by itself when the user scrolls through the zone between chapters, in both directions', async () => {
        fake.pagesArePicture = true;
        fake.pageTotal = 4;
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        const reader = session.page.getByRole('region', { name: 'Reader' });
        const area = session.page.locator('.app__main');
        const title = reader.locator('.reader__title');
        await session.page.getByRole('button', { name: 'READ: Romance Dawn', exact: true }).click();
        await reader.getByRole('button', { name: 'READER SETTINGS' }).click();
        await reader.getByLabel('Reading mode').selectOption('webtoon');
        await reader.getByRole('button', { name: 'READER SETTINGS' }).click({ force: true });
        await expect(reader.getByRole('img')).toHaveCount(4);
        // The pages count once their pictures are in the flow (until then each one is a block that says it is loading).
        await expect(reader.locator('.reader__loading-page')).toHaveCount(0);
        await expect(title).toHaveText('One Piece · Romance Dawn');

        // The chapter starts with its first page under the bar, the zone of the previous chapter above it, out of view.
        const bar = session.page.locator('.reader__bar');
        const firstPage = reader.getByRole('img').first();
        await expect.poll(async () => {
            const top = (await firstPage.boundingBox())!.y;
            const barBottom = (await bar.boundingBox())!.y + (await bar.boundingBox())!.height;
            return top >= barBottom - 1 && top <= barBottom + 24;
        }).toBe(true);
        const startZone = reader.getByTestId('reader-zone-start');
        // The zone above the first page is out of view: all of it is above the bar.
        const zoneAboveBar = async (): Promise<boolean> => {
            const zone = (await startZone.boundingBox())!;
            const barBox = (await bar.boundingBox())!;
            return zone.y + zone.height <= barBox.y + barBox.height + 1;
        };
        expect(await zoneAboveBar()).toBe(true);

        // Going down through the zone at the end switches to the next chapter.
        await area.evaluate((element) => {element.scrollTop = element.scrollHeight});
        await expect(reader.getByTestId('reader-zone-end')).toBeInViewport();
        await expect(reader.getByTestId('reader-zone-end').getByText('The Great Race', { exact: true })).toBeVisible();
        await expect(title).toHaveText('One Piece · The Great Race', { timeout: 10000 });
        // Only the current chapter is on the screen.
        await expect(reader.getByRole('img')).toHaveCount(4);
        expect(fake.graphqlRequests('fetchChapterPages').map((item) => {return item.variables?.['chapterId']})).toEqual([101, 102]);
        await expect.poll(zoneAboveBar).toBe(true);

        // Going up through the zone at the start goes back to the previous chapter, on its last page.
        await area.evaluate((element) => {element.scrollTop = 0});
        await expect(title).toHaveText('One Piece · Romance Dawn', { timeout: 10000 });
        await expect(reader.getByText('4 / 4')).toBeVisible();
        await expect(reader.getByTestId('reader-zone-end')).not.toBeInViewport();
    });

    // Opens the first chapter of the manga in the webtoon mode, with four pages in each chapter.
    async function openWebtoon(): Promise<{ reader: Locator; area: Locator; title: Locator }> {
        fake.pagesArePicture = true;
        fake.pageTotal = 4;
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        const reader = session.page.getByRole('region', { name: 'Reader' });
        await session.page.getByRole('button', { name: 'READ: Romance Dawn', exact: true }).click();
        await reader.getByRole('button', { name: 'READER SETTINGS' }).click();
        await reader.getByLabel('Reading mode').selectOption('webtoon');
        await reader.getByRole('button', { name: 'READER SETTINGS' }).click({ force: true });
        await expect(reader.getByRole('img')).toHaveCount(4);
        return { reader, area: session.page.locator('.app__main'), title: reader.locator('.reader__title') };
    }

    test('does not switch the chapter when the user scrolls back before the moment of the zone is over, nor while the zone is only crossed', async () => {
        const { reader, area, title } = await openWebtoon();
        // Down to the end of the zone and back at once: nothing happens.
        await area.evaluate((element) => {
            element.scrollTop = element.scrollHeight;
            window.setTimeout(() => {
                element.scrollTop = element.scrollTop - 600;
            }, 150);
        });
        await session.page.waitForTimeout(1500);
        await expect(title).toHaveText('One Piece · Romance Dawn');
        await expect(reader.getByRole('img')).toHaveCount(4);
        // The bar of the zone shows how far the user went through it.
        await area.evaluate((element) => {
            element.scrollTop = element.scrollHeight - element.clientHeight - 150;
        });
        const bar = reader.getByTestId('reader-zone-end').getByRole('progressbar');
        await expect.poll(async () => {return Number(await bar.getAttribute('aria-valuenow'))}).toBeGreaterThan(30);
        expect(Number(await bar.getAttribute('aria-valuenow'))).toBeLessThan(100);
        await session.page.waitForTimeout(1000);
        await expect(title).toHaveText('One Piece · Romance Dawn');
    });

    test('switches the chapter with the button of the zone, and only that way when the setting is off', async () => {
        const { reader, area, title } = await openWebtoon();
        await reader.getByRole('button', { name: 'READER SETTINGS' }).click();
        const toggle = reader.getByRole('switch', { name: 'Switch chapter while scrolling' });
        await expect(toggle).toBeChecked();
        await toggle.uncheck();
        await reader.getByRole('button', { name: 'READER SETTINGS' }).click();
        await area.evaluate((element) => {
            element.scrollTop = element.scrollHeight;
        });
        await expect(reader.getByTestId('reader-zone-end')).toBeInViewport();
        await expect(reader.getByTestId('reader-zone-end').getByRole('progressbar')).toHaveCount(0);
        await session.page.waitForTimeout(1500);
        await expect(title).toHaveText('One Piece · Romance Dawn');
        await reader.getByRole('button', { name: 'GO TO THE NEXT CHAPTER' }).click();
        await expect(title).toHaveText('One Piece · The Great Race');
        await expect(reader.getByText('1 / 4')).toBeVisible();
        // Going up through the zone at the start does not switch either, and its button does.
        await area.evaluate((element) => {
            element.scrollTop = 0;
        });
        await session.page.waitForTimeout(1500);
        await expect(title).toHaveText('One Piece · The Great Race');
        await reader.getByRole('button', { name: 'GO TO THE PREVIOUS CHAPTER' }).click();
        await expect(title).toHaveText('One Piece · Romance Dawn');
        await expect(reader.getByText('4 / 4')).toBeVisible();
        // The choice is kept after the app is closed and opened again.
        await session.app.close();
        session = await launch();
        await openManga(session.page);
        await goTo(session.page, 'LIBRARY');
        await session.page.getByRole('button', { name: 'Open: One Piece' }).click();
        await session.page.getByRole('button', { name: 'READ: Romance Dawn', exact: true }).click();
        const again = session.page.getByRole('region', { name: 'Reader' });
        await again.getByRole('button', { name: 'READER SETTINGS' }).click();
        await expect(again.getByRole('switch', { name: 'Switch chapter while scrolling' })).not.toBeChecked();
    });

    test('says there is no chapter before the first one nor after the last one, and does not switch there', async () => {
        const { reader, area, title } = await openWebtoon();
        await expect(reader.getByTestId('reader-zone-start')).toContainText('This is the first chapter.');
        await expect(reader.getByTestId('reader-zone-start').getByRole('button')).toHaveCount(0);
        await area.evaluate((element) => {
            element.scrollTop = 0;
        });
        await session.page.waitForTimeout(1500);
        await expect(title).toHaveText('One Piece · Romance Dawn');
        // To the last chapter, and to the end of it.
        await reader.getByRole('button', { name: 'NEXT CHAPTER', exact: true }).click();
        await expect(title).toHaveText('One Piece · The Great Race');
        await expect(reader.getByTestId('reader-zone-end')).toContainText('This is the last chapter.');
        await area.evaluate((element) => {
            element.scrollTop = element.scrollHeight;
        });
        await session.page.waitForTimeout(1500);
        await expect(title).toHaveText('One Piece · The Great Race');
        await expect(reader.getByRole('img')).toHaveCount(4);
    });

    test('has no zones one page at a time, and does not switch the chapter when the mode changes in the middle of it', async () => {
        const { reader, area, title } = await openWebtoon();
        await reader.getByRole('button', { name: 'READER SETTINGS' }).click();
        await reader.getByLabel('Reading mode').selectOption('single');
        await reader.getByRole('button', { name: 'READER SETTINGS' }).click();
        await expect(reader.getByTestId('reader-zone-start')).toHaveCount(0);
        await expect(reader.getByTestId('reader-zone-end')).toHaveCount(0);
        await session.page.keyboard.press('ArrowRight');
        await expect(reader.getByText('2 / 4')).toBeVisible();
        await reader.getByRole('button', { name: 'READER SETTINGS' }).click();
        await reader.getByLabel('Reading mode').selectOption('vertical');
        await reader.getByRole('button', { name: 'READER SETTINGS' }).click({ force: true });
        await session.page.waitForTimeout(1500);
        await expect(title).toHaveText('One Piece · Romance Dawn');
        await expect(reader.getByTestId('reader-zone-start')).toHaveCount(1);
        await area.evaluate((element) => {
            element.scrollTop = element.scrollTop + 10;
        });
        await expect(title).toHaveText('One Piece · Romance Dawn');
    });

    test('goes back to where the chapter starts, not to the zone above it, and does not take the user to the previous chapter by doing so', async () => {
        const { reader, area, title } = await openWebtoon();
        await reader.getByRole('button', { name: 'NEXT CHAPTER', exact: true }).click();
        await expect(title).toHaveText('One Piece · The Great Race');
        const bar = session.page.locator('.reader__bar');
        const firstPage = reader.getByRole('img').first();
        const underTheBar = async (): Promise<boolean> => {
            const top = (await firstPage.boundingBox())!.y;
            const barBox = (await bar.boundingBox())!;
            return Math.abs(top - (barBox.y + barBox.height)) <= 12;
        };
        await expect.poll(underTheBar).toBe(true);
        await expect(session.page.getByRole('button', { name: 'Back to the top' })).toHaveCount(0);
        await area.evaluate((element) => {
            element.scrollTop = element.scrollTop + 1200;
        });
        await session.page.getByRole('button', { name: 'Back to the top' }).click();
        await expect.poll(underTheBar).toBe(true);
        await session.page.waitForTimeout(1200);
        await expect(title).toHaveText('One Piece · The Great Race');
        await expect(session.page.getByRole('button', { name: 'Back to the top' })).toHaveCount(0);
    });

    test('goes on with the auto scroll into the next chapter, and stops at the end of the last one', async () => {
        const { reader, title } = await openWebtoon();
        await reader.getByRole('button', { name: 'READER SETTINGS' }).click();
        await reader.getByLabel('Auto scroll speed (pixels per second)').fill('600');
        await reader.getByRole('button', { name: 'READER SETTINGS' }).click();
        await session.page.getByRole('button', { name: 'AUTO SCROLL' }).click();
        await expect(title).toHaveText('One Piece · The Great Race', { timeout: 40000 });
        await expect(session.page.getByRole('button', { name: 'STOP SCROLL' })).toBeVisible();
        await expect(reader.getByTestId('reader-zone-end')).toContainText('This is the last chapter.', { timeout: 20000 });
        await expect(session.page.getByRole('button', { name: 'AUTO SCROLL' })).toBeVisible({ timeout: 40000 });
        await expect(title).toHaveText('One Piece · The Great Race');
    });

    test('keeps the groups, the series and the source of a manga of the library behind a gear in its head', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        await expect(session.page.getByLabel('Series', { exact: true })).toHaveCount(0);
        const gear = session.page.getByRole('button', { name: 'Groups, series and source' });
        await gear.click();
        await expect(session.page.getByLabel('Series', { exact: true })).toBeVisible();
        await expect(session.page.getByRole('button', { name: 'MIGRATE TO ANOTHER SOURCE' })).toBeVisible();
        await gear.click();
        await expect(session.page.getByLabel('Series', { exact: true })).toHaveCount(0);
    });

    test('lets the space between the pages be made zero in the vertical scroll, and fits the pages to the width at first', async () => {
        fake.pagesArePicture = true;
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePiece(session.page);
        await session.page.getByRole('button', { name: 'READ: Romance Dawn', exact: true }).click();
        const reader = session.page.getByRole('region', { name: 'Reader' });
        await reader.getByRole('button', { name: 'READER SETTINGS' }).click();
        await expect(reader.getByLabel('Page size')).toHaveValue('width');
        await reader.getByLabel('Reading mode').selectOption('vertical');
        await expect(reader.getByTestId('reader-scroll')).toHaveCSS('row-gap', '8px');
        await reader.getByLabel('Space between pages (pixels)').fill('0');
        await expect(reader.getByTestId('reader-scroll')).toHaveCSS('row-gap', '0px');
        await expect(reader.locator('.reader__float')).toContainText('AUTO SCROLL');
    });

    test('keeps the library, with its covers, after the app is closed and opened again', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePiece(session.page);
        await session.page.getByRole('button', { name: 'ADD TO LIBRARY' }).click();
        await session.app.close();

        session = await launch();
        await openManga(session.page);
        await goTo(session.page, 'LIBRARY');
        const entry = session.page.getByTestId('manga-entry');
        await expect(entry.getByRole('heading', { name: 'One Piece' })).toBeVisible();
        await expect(entry.getByText('0 of 2 downloaded')).toBeVisible();
        await expect(entry.locator('img.cover')).toBeVisible();
        // The cover is the one kept in the data folder, not one asked of the server.
        await expect(entry.locator('img.cover')).toHaveAttribute('src', /^pullwave-manga:\/\/cover\/\d+\?v=[0-9a-f]{12}$/);
    });

    test('keeps the cover of a manga of the library in the data folder and shows it from there', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePiece(session.page);
        await session.page.getByRole('button', { name: 'ADD TO LIBRARY' }).click();
        await goTo(session.page, 'LIBRARY');
        const cover = session.page.getByTestId('manga-entry').locator('img.cover');
        await expect(cover).toHaveAttribute('src', /^pullwave-manga:\/\/cover\/\d+\?v=[0-9a-f]{12}$/);
        await expect.poll(async () => {
            return cover.evaluate((image: HTMLImageElement) => {
                return image.complete && image.naturalWidth > 0;
            });
        }).toBe(true);
        const kept = readdirSync(join(session.userData, 'manga', 'covers'));
        expect(kept).toHaveLength(1);
        expect(readFileSync(join(session.userData, 'manga', 'covers', kept[0]!)).subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        expect(fake.requests.filter((item) => {return item.path === '/api/v1/manga/7/thumbnail'}).length).toBeGreaterThan(0);
    });

    test('opens a manga of the library with its saved chapters even when the source cannot be reached', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePiece(session.page);
        await session.page.getByRole('button', { name: 'ADD TO LIBRARY' }).click();
        fake.failDetails = true;
        await goTo(session.page, 'LIBRARY');
        await session.page.getByTestId('manga-entry').getByRole('button', { name: 'Open: One Piece' }).click();
        await expect(session.page.getByRole('button', { name: 'READ: Romance Dawn', exact: true })).toBeVisible();
        await expect(session.page.getByRole('heading', { name: 'One Piece' })).toBeVisible();
        await expect(session.page.getByText(/^Author:/)).toHaveText('Author: Oda');
        await expect(session.page.getByRole('alert').filter({ hasText: 'Could not reach the source. Showing what is saved.' })).toBeVisible();
        await expect(session.page.getByText(/This site is protected by Cloudflare/)).toBeVisible();
        await expect(session.page.getByText('LOADING CHAPTERS…')).toHaveCount(0);
        await expect(session.page.getByTestId('manga-chapter')).toHaveCount(2);
        fake.failDetails = false;
    });

    test('marks the mangas whose extension was uninstalled, and does not look for new chapters in them, saying how many it left out', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePiece(session.page);
        await session.page.getByRole('button', { name: 'ADD TO LIBRARY' }).click();
        await goTo(session.page, 'LIBRARY');
        const entry = session.page.getByTestId('manga-entry');
        await expect(entry).toHaveCount(1);
        await expect(entry.getByTestId('manga-source-missing')).toHaveCount(0);

        // The extension is uninstalled: the manga stays, with a badge on its card.
        await goTo(session.page, 'EXTENSIONS');
        await session.page.getByRole('button', { name: 'UNINSTALL: Tachiyomi: Fake Dex' }).click();
        await answerConfirm(session.page, 'Uninstall "Tachiyomi: Fake Dex"?', 'UNINSTALL');
        await expect(session.page.getByRole('button', { name: 'INSTALL: Tachiyomi: Fake Dex' })).toBeVisible();
        await goTo(session.page, 'LIBRARY');
        await expect(entry.getByRole('heading', { name: 'One Piece' })).toBeVisible();
        await expect(entry.getByTestId('manga-source-missing')).toHaveText('SOURCE NOT INSTALLED');
        await expect(entry.getByTestId('manga-source-missing')).toHaveAttribute('title', 'The extension of this source is not installed.');

        // The check of all the mangas does not ask the server about it, and says it was left out.
        const before = fake.graphqlRequests('fetchMangaAndChapters').length;
        await goTo(session.page, 'UPDATES');
        await session.page.getByRole('button', { name: 'LOOK FOR NEW CHAPTERS' }).click();
        await expect(session.page.locator('.toast').filter({ hasText: 'No new chapters.' }).first()).toBeVisible();
        await expect(session.page.locator('.toast').filter({ hasText: '1 manga(s) were not looked at: the extension of their source is not installed.' }).first()).toBeVisible();
        expect(fake.graphqlRequests('fetchMangaAndChapters')).toHaveLength(before);

        // The same for the button of the page of the manga.
        await goTo(session.page, 'LIBRARY');
        await entry.getByRole('button', { name: 'Open: One Piece' }).click();
        await expect(session.page.getByRole('button', { name: 'GO TO SOURCE' })).toBeDisabled();
        const afterOpening = fake.graphqlRequests('fetchMangaAndChapters').length;
        // The notices of the check before have gone by now (they last five seconds), so the one that shows up is the answer to this click.
        const skipped = session.page.locator('.toast').filter({ hasText: '1 manga(s) were not looked at' });
        await expect(skipped).toHaveCount(0, { timeout: 10000 });
        await session.page.getByRole('button', { name: 'LOOK FOR NEW CHAPTERS' }).click();
        await expect(skipped).toHaveCount(1);
        expect(fake.graphqlRequests('fetchMangaAndChapters')).toHaveLength(afterOpening);

        // Its page says the source is gone and has LINK SOURCE, which opens the window to move it to another source (none is installed here).
        await expect(session.page.getByTestId('manga-source-gone')).toHaveText('Source: 4242. Its extension is not installed, so there is no source to read or update this manga from.');
        await expect(session.page.getByTestId('manga-source')).toHaveCount(0);
        await session.page.getByRole('button', { name: 'LINK SOURCE' }).click();
        const linking = session.page.getByRole('dialog', { name: 'MIGRATE TO ANOTHER SOURCE' });
        await expect(linking.getByText('There is no other source: install another extension first.')).toBeVisible();
        await linking.getByRole('button', { name: 'CANCEL' }).click();
        await expect(session.page.getByRole('dialog')).toHaveCount(0);

        // Installing the extension again takes the badge away.
        await session.page.getByRole('button', { name: '← BACK' }).click();
        await goTo(session.page, 'EXTENSIONS');
        await session.page.getByRole('button', { name: 'INSTALL: Tachiyomi: Fake Dex' }).click();
        await expect(session.page.getByRole('button', { name: 'UNINSTALL: Tachiyomi: Fake Dex' })).toBeVisible();
        await goTo(session.page, 'LIBRARY');
        await expect(session.page.getByTestId('manga-entry').getByRole('heading', { name: 'One Piece' })).toBeVisible();
        await expect(session.page.getByTestId('manga-source-missing')).toHaveCount(0);
    });

    test('lists in UPDATES the chapters that arrive, how they came, and opens the manga in the library from there', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePiece(session.page);
        await session.page.getByRole('button', { name: 'ADD TO LIBRARY' }).click();
        await goTo(session.page, 'UPDATES');
        await expect(session.page.getByText('No new chapters yet.')).toBeVisible();
        fake.laterChapters = [103, 104];
        await session.page.getByRole('button', { name: 'LOOK FOR NEW CHAPTERS' }).click();
        await expect(session.page.getByTestId('manga-update')).toHaveCount(2);
        await expect(session.page.getByTestId('manga-update-day').first()).toHaveAccessibleName('Today');
        await expect(session.page.getByTestId('manga-update').first()).toContainText('One Piece');
        await expect(session.page.getByTestId('manga-update').first().getByText('MANUAL')).toBeVisible();
        await expect(session.page.getByTestId('manga-update').first().getByText('Not downloaded')).toBeVisible();
        await expect(session.page.locator('.toast').filter({ hasText: '2 new chapter(s) added to the library: One Piece' }).first()).toBeVisible();
        // Nothing new the second time.
        await session.page.getByRole('button', { name: 'LOOK FOR NEW CHAPTERS' }).click();
        await expect(session.page.locator('.toast').filter({ hasText: 'No new chapters.' }).first()).toBeVisible();
        await expect(session.page.getByTestId('manga-update')).toHaveCount(2);

        await session.page.getByTestId('manga-update').first().getByRole('button', { name: /^Open: One Piece/ }).click();
        await expect(session.page.getByRole('button', { name: 'READ: Romance Dawn', exact: true })).toBeVisible();
        await expect(session.page.getByRole('navigation', { name: 'Manga' }).getByRole('button', { name: 'LIBRARY', exact: true })).toHaveAttribute('aria-current', 'page');

        // The list is kept, and clearing it asks first and keeps the library.
        await goTo(session.page, 'UPDATES');
        await expect(session.page.getByTestId('manga-update')).toHaveCount(2);
        await session.page.getByRole('button', { name: 'CLEAR LIST' }).click();
        await session.page.getByRole('dialog').getByRole('button', { name: 'REMOVE', exact: true }).click();
        await expect(session.page.getByTestId('manga-update')).toHaveCount(0);
        await goTo(session.page, 'LIBRARY');
        await session.page.getByRole('button', { name: '← BACK' }).click();
        await expect(session.page.getByText('0 of 4 downloaded')).toBeVisible();
    });

    test('looks for the new chapters of one manga from its own page', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        fake.laterChapters = [103];
        await session.page.getByRole('button', { name: 'LOOK FOR NEW CHAPTERS' }).click();
        await expect(session.page.locator('.toast').filter({ hasText: '1 new chapter(s) added to the library: One Piece' }).first()).toBeVisible();
        await goTo(session.page, 'UPDATES');
        await expect(session.page.getByTestId('manga-update')).toHaveCount(1);
        await expect(session.page.getByTestId('manga-update').first().getByText('MANUAL')).toBeVisible();
    });

    test('downloads the new chapters the check finds when the setting is on', async () => {
        session = await launch({ mangaAutoDownloadNew: true });
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        fake.laterChapters = [103];
        await session.page.getByRole('button', { name: 'LOOK FOR NEW CHAPTERS' }).click();
        await expect.poll(() => {return fake.graphqlRequests('fetchChapterPages').length}, { timeout: 30000 }).toBeGreaterThan(0);
        await expect.poll(() => {return existsSync(join(mangaFolder(), 'One Piece'))}, { timeout: 30000 }).toBe(true);
    });

    test('keeps a history of reading that goes back to the manga in the library, and can be cleared', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        await session.page.getByRole('button', { name: 'START READING' }).click();
        const reader = session.page.getByRole('region', { name: 'Reader' });
        await expect(reader.getByText('1 / 3')).toBeVisible();
        await session.page.keyboard.press('ArrowRight');
        await expect(reader.getByText('2 / 3')).toBeVisible();
        await session.page.waitForTimeout(1200);
        await session.page.keyboard.press('Escape');
        await goTo(session.page, 'HISTORY');
        const entry = session.page.getByTestId('manga-history-entry');
        await expect(entry).toHaveCount(1);
        await expect(entry).toContainText('One Piece');
        await expect(entry).toContainText('Romance Dawn · page 2 of 3');
        await expect(entry.getByText('IN THE LIBRARY')).toBeVisible();
        await entry.getByRole('button', { name: 'Open: One Piece' }).click();
        await expect(session.page.getByRole('button', { name: 'READ: Romance Dawn', exact: true })).toBeVisible();
        await expect(session.page.getByRole('navigation', { name: 'Manga' }).getByRole('button', { name: 'LIBRARY', exact: true })).toHaveAttribute('aria-current', 'page');
        await expect(session.page.getByRole('button', { name: 'CONTINUE READING' })).toBeVisible();

        await goTo(session.page, 'HISTORY');
        await session.page.getByRole('button', { name: 'CLEAR HISTORY' }).click();
        await session.page.getByRole('dialog').getByRole('button', { name: 'REMOVE', exact: true }).click();
        await expect(session.page.getByTestId('manga-history-entry')).toHaveCount(0);
        await expect(session.page.getByText('Nothing read yet.')).toBeVisible();
    });

    test('names the series after the manga when its name is left empty, and taking that manga out of the series keeps it, with its files, and ends the series', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        await downloadSeason(session.page);
        await waitForDownloaded(session.page);
        const file = join(mangaFolder(), 'One Piece', 'Chapter 1.cbz');
        await expect.poll(() => {return existsSync(file)}).toBe(true);
        await openOrganize(session.page);
        await expect(session.page.getByLabel('Series', { exact: true })).toHaveAttribute('placeholder', 'Empty: "One Piece", the name of the manga');
        await session.page.getByRole('button', { name: 'SAVE SERIES' }).click();
        await expect(session.page.getByText('In the series "One Piece", order 1.')).toBeVisible();
        await session.page.getByRole('button', { name: '← BACK' }).click();
        await session.page.getByRole('button', { name: 'Open series: One Piece' }).click();
        // The manga that gives its name to the series can leave it, like any other, after the question and with no deletion.
        const leave = session.page.getByRole('button', { name: 'REMOVE FROM SERIES: One Piece' });
        await expect(leave).toBeEnabled();
        await expect(session.page.getByRole('button', { name: 'REMOVE: One Piece' })).toHaveCount(0);
        await leave.click();
        await expect(session.page.getByRole('dialog', { name: 'Take "One Piece" out of the series?' })).toBeVisible();
        await answerConfirm(session.page, 'Take "One Piece" out of the series?', 'REMOVE FROM SERIES');
        await expect(session.page.getByRole('dialog')).toHaveCount(0);

        // It was the only manga of the series: the series is gone and the screen is the library, where the manga is, by itself.
        await expect(session.page.getByTestId('manga-series-view')).toHaveCount(0);
        await expect(session.page.getByTestId('manga-series')).toHaveCount(0);
        const entry = session.page.getByTestId('manga-entry');
        await expect(entry).toHaveCount(1);
        await expect(entry.getByRole('heading', { name: 'One Piece' })).toBeVisible();
        await expect(entry.getByText('2 of 2 downloaded')).toBeVisible();
        expect(existsSync(file)).toBe(true);
        await entry.getByRole('button', { name: 'Open: One Piece' }).click();
        await openOrganize(session.page);
        await expect(session.page.getByText(/^In the series/)).toHaveCount(0);
    });

    test('takes one manga out of a series with two seasons: it stays in the library by itself and the series goes on with the other one', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openSource(session.page);
        await session.page.getByRole('button', { name: 'Open: One Piece' }).click();
        await session.page.getByRole('button', { name: 'ADD TO LIBRARY' }).click();
        await session.page.getByRole('button', { name: '← BACK' }).click();
        await session.page.getByRole('button', { name: 'Open: Bleach' }).click();
        await session.page.getByRole('button', { name: 'ADD TO LIBRARY' }).click();
        await goTo(session.page, 'LIBRARY');
        for (const [title, order] of [['One Piece', '1'], ['Bleach', '2']]) {
            await session.page.getByTestId('manga-entry').filter({ hasText: title! }).getByRole('button', { name: `Open: ${title!}` }).click();
            await openOrganize(session.page);
            await session.page.getByLabel('Series', { exact: true }).fill('Pirates');
            await session.page.getByLabel('Order').fill(order!);
            await session.page.getByRole('button', { name: 'SAVE SERIES' }).click();
            await expect(session.page.getByText(`In the series "Pirates", order ${order!}.`)).toBeVisible();
            await session.page.getByRole('button', { name: '← BACK' }).click();
        }
        await expect(session.page.getByTestId('manga-series')).toHaveCount(1);
        await expect(session.page.getByText('2 SEASONS')).toBeVisible();

        await session.page.getByRole('button', { name: 'Open series: Pirates' }).click();
        await expect(session.page.getByTestId('manga-season')).toHaveCount(2);
        await session.page.getByRole('button', { name: 'REMOVE FROM SERIES: Bleach' }).click();
        await answerConfirm(session.page, 'Take "Bleach" out of the series?', 'REMOVE FROM SERIES');
        // The series stays, with one season; the manga that left is not deleted.
        await expect(session.page.getByTestId('manga-season')).toHaveCount(1);
        await expect(session.page.getByTestId('manga-season')).toContainText('One Piece');
        await session.page.getByRole('button', { name: 'BACK TO LIBRARY' }).click();
        await expect(session.page.getByTestId('manga-series')).toHaveCount(1);
        await expect(session.page.getByText('1 SEASON', { exact: true })).toBeVisible();
        await expect(session.page.getByTestId('manga-entry')).toHaveCount(1);
        await expect(session.page.getByTestId('manga-entry').getByRole('heading', { name: 'Bleach' })).toBeVisible();
        await expect(session.page.getByText('Library (2)')).toBeVisible();
    });

    test('does not let an order that the series has be used, and offers the next one', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openSource(session.page);
        await session.page.getByRole('button', { name: 'Open: One Piece' }).click();
        await session.page.getByRole('button', { name: 'ADD TO LIBRARY' }).click();
        await session.page.getByRole('button', { name: '← BACK' }).click();
        await session.page.getByRole('button', { name: 'Open: Bleach' }).click();
        await session.page.getByRole('button', { name: 'ADD TO LIBRARY' }).click();
        await goTo(session.page, 'LIBRARY');
        await session.page.getByTestId('manga-entry').filter({ hasText: 'One Piece' }).getByRole('button', { name: 'Open: One Piece' }).click();
        await openOrganize(session.page);
        await session.page.getByLabel('Series', { exact: true }).fill('Pirates');
        await session.page.getByRole('button', { name: 'SAVE SERIES' }).click();
        await expect(session.page.getByText('In the series "Pirates", order 1.')).toBeVisible();
        await session.page.getByRole('button', { name: '← BACK' }).click();
        await session.page.getByTestId('manga-entry').getByRole('button', { name: 'Open: Bleach' }).click();
        await openOrganize(session.page);
        await session.page.getByLabel('Series', { exact: true }).fill('pirates');
        // The series has order 1: the field goes to the next one by itself.
        await expect(session.page.getByLabel('Order')).toHaveValue('2');
        await expect(session.page.getByRole('alert')).toHaveCount(0);
        await expect(session.page.getByRole('button', { name: 'SAVE SERIES' })).toBeEnabled();
        // And an order that is taken by hand is not let through.
        await session.page.getByLabel('Order').fill('1');
        await expect(session.page.getByRole('alert')).toContainText('Order 1 is already used by another manga of the series. The next free one is 2.');
        await expect(session.page.getByRole('button', { name: 'SAVE SERIES' })).toBeDisabled();
        await session.page.getByLabel('Order').fill('2');
        await expect(session.page.getByRole('button', { name: 'SAVE SERIES' })).toBeEnabled();
    });

    test('says in the tabs where the mangas that match the search are, only while the user searches', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openSource(session.page);
        await session.page.getByRole('button', { name: 'Open: One Piece' }).click();
        await session.page.getByRole('button', { name: 'ADD TO LIBRARY' }).click();
        await session.page.getByRole('button', { name: '← BACK' }).click();
        await session.page.getByRole('button', { name: 'Open: Bleach' }).click();
        await session.page.getByRole('button', { name: 'ADD TO LIBRARY' }).click();
        await goTo(session.page, 'LIBRARY');
        await session.page.getByRole('button', { name: 'MANAGE GROUPS' }).click();
        for (const name of ['Mangas', 'Favorites']) {
            await session.page.getByLabel('Name of the group').fill(name);
            await session.page.getByRole('button', { name: 'CREATE', exact: true }).click();
        }
        await session.page.getByRole('button', { name: 'MANAGE GROUPS' }).click();
        await session.page.getByTestId('manga-entry').filter({ hasText: 'One Piece' }).getByRole('button', { name: 'Open: One Piece' }).click();
        await openOrganize(session.page);
        await session.page.getByRole('button', { name: 'Favorites', exact: true }).click();
        await expect(session.page.getByRole('button', { name: 'Favorites', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await session.page.getByRole('button', { name: '← BACK' }).click();

        // Bleach is in no group, so the tab of all (the one that is open) holds it; One Piece is in Favorites.
        const tabs = session.page.getByRole('navigation', { name: 'Groups' });
        const search = session.page.getByLabel('Search the library');
        await expect(tabs.getByRole('button')).toHaveText(['ALL', 'Mangas', 'Favorites']);
        await expect(tabs.locator('.badge')).toHaveCount(0);

        await search.fill('one piece');
        await expect(tabs.locator('.badge')).toHaveCount(1);
        await expect(tabs.getByRole('button', { name: /Favorites/ }).locator('.badge')).toHaveText('1');
        await expect(tabs.getByRole('button', { name: /Favorites/ }).locator('.badge')).toHaveAttribute('aria-label', '1 match(es) for the search');
        await expect(session.page.getByText('// NO MANGA IN THE LIBRARY MATCHES THIS SEARCH.')).toBeVisible();

        await search.fill('bleach');
        await expect(tabs.locator('.badge')).toHaveCount(1);
        await expect(tabs.getByRole('button', { name: /ALL/ }).locator('.badge')).toHaveText('1');
        await expect(session.page.getByTestId('manga-entry').getByRole('heading', { name: 'Bleach' })).toBeVisible();

        await search.fill('');
        await expect(tabs.locator('.badge')).toHaveCount(0);
        await expect(tabs.getByRole('button')).toHaveText(['ALL', 'Mangas', 'Favorites']);
    });

    test('goes on to the season that comes after (or before) in the series when the chapters of a season end', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openSource(session.page);
        await session.page.getByRole('button', { name: 'Open: One Piece' }).click();
        await session.page.getByRole('button', { name: 'ADD TO LIBRARY' }).click();
        await session.page.getByRole('button', { name: '← BACK' }).click();
        await session.page.getByRole('button', { name: 'Open: Bleach' }).click();
        await session.page.getByRole('button', { name: 'ADD TO LIBRARY' }).click();
        await goTo(session.page, 'LIBRARY');
        await session.page.getByTestId('manga-entry').filter({ hasText: 'One Piece' }).getByRole('button', { name: 'Open: One Piece' }).click();
        await openOrganize(session.page);
        await session.page.getByLabel('Series', { exact: true }).fill('Pirates');
        await session.page.getByRole('button', { name: 'SAVE SERIES' }).click();
        await expect(session.page.getByText('In the series "Pirates", order 1.')).toBeVisible();
        await session.page.getByRole('button', { name: '← BACK' }).click();
        await session.page.getByTestId('manga-entry').getByRole('button', { name: 'Open: Bleach' }).click();
        await openOrganize(session.page);
        await session.page.getByLabel('Series', { exact: true }).fill('pirates');
        await session.page.getByLabel('Order').fill('2');
        await session.page.getByRole('button', { name: 'SAVE SERIES' }).click();
        await expect(session.page.getByText('In the series "Pirates", order 2.')).toBeVisible();

        // From the first chapter of the second season, PREVIOUS goes to the last chapter of the first one.
        await session.page.getByRole('button', { name: 'READ: Romance Dawn', exact: true }).click();
        const reader = session.page.getByRole('region', { name: 'Reader' });
        const previous = reader.getByRole('button', { name: 'PREVIOUS CHAPTER', exact: true });
        const next = reader.getByRole('button', { name: 'NEXT CHAPTER', exact: true });
        await expect(reader.getByText('Bleach · Romance Dawn')).toBeVisible();
        await expect(previous).toBeEnabled();
        // In the scroll the zone above the first chapter of the season names the last chapter of the season before, not "first chapter".
        await reader.getByRole('button', { name: 'READER SETTINGS' }).click();
        await reader.getByLabel('Reading mode').selectOption('webtoon');
        await reader.getByRole('button', { name: 'READER SETTINGS' }).click({ force: true });
        await expect(reader.getByTestId('reader-zone-start')).toContainText('The Great Race');
        await expect(reader.getByTestId('reader-zone-start')).not.toContainText('This is the first chapter.');
        await previous.click();
        await expect(reader.getByText('One Piece · The Great Race')).toBeVisible();
        await expect(next).toBeEnabled();
        // The zone below the last chapter of the first season names the first chapter of the second one.
        await expect(reader.getByTestId('reader-zone-end')).toContainText('Romance Dawn');
        await expect(reader.getByTestId('reader-zone-end')).not.toContainText('This is the last chapter.');

        // And NEXT, at the end of the first season, goes to the first chapter of the second one.
        await next.click();
        await expect(reader.getByText('Bleach · Romance Dawn')).toBeVisible();
        await next.click();
        await expect(reader.getByText('Bleach · The Great Race')).toBeVisible();
        // There is no season after the last one: the zone says so.
        await expect(next).toBeDisabled();
        await expect(reader.getByTestId('reader-zone-end')).toContainText('This is the last chapter.');

        // The first chapter of the first season has nothing before it.
        await previous.click();
        await previous.click();
        await previous.click();
        await expect(reader.getByText('One Piece · Romance Dawn')).toBeVisible();
        await expect(previous).toBeDisabled();
    });

    test('has the tabs gathered in one list on a very narrow window', async () => {
        session = await launch();
        await openManga(session.page);
        await session.app.evaluate(({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows()[0]!;
            win.unmaximize();
            win.setSize(480, 700);
        });
        const menu = session.page.getByRole('combobox', { name: 'Manga' });
        await expect(menu).toBeVisible();
        await expect(session.page.getByRole('navigation', { name: 'Manga' }).getByRole('button', { name: 'LIBRARY', exact: true })).toBeHidden();
        await expect(session.page.getByRole('button', { name: 'DOWNLOADS (0)' })).toBeVisible();
        await menu.selectOption('history');
        await expect(session.page.getByText('Nothing read yet.')).toBeVisible();
        await expect(menu).toHaveValue('history');
    });
});

test.describe('manga chapters that lack pages', () => {
    const MISSING_PAGE = '/api/v1/chapter/101/page/1';
    const FAILS_FOR_GOOD = 1000;

    function pageRequests(path: string): number {
        return fake.requests.filter((item) => {
            return item.path === path;
        }).length;
    }

    async function waitForIncomplete(page: Page): Promise<void> {
        await expect(page.locator('.toast').filter({ hasText: 'Download finished without 1 page(s): One Piece · Romance Dawn' })).toBeVisible({ timeout: 25000 });
        await expect(page.getByRole('button', { name: 'DOWNLOADS (0)' })).toBeVisible({ timeout: 20000 });
    }

    test('finishes the chapter without the page that fails, marks it as incomplete, and downloads the missing page with RETRY', async () => {
        test.setTimeout(60000);
        fake.failTimes.set(MISSING_PAGE, FAILS_FOR_GOOD);
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        await downloadSeason(session.page);
        await waitForIncomplete(session.page);

        // The page was asked for three times and then skipped: the chapter was not asked for again as a whole.
        expect(pageRequests(MISSING_PAGE)).toBe(3);
        expect(pageRequests('/api/v1/chapter/101/page/0')).toBe(1);
        expect(pageRequests('/api/v1/chapter/101/page/2')).toBe(1);
        expect(
            fake.graphqlRequests('fetchChapterPages').filter((item) => {
                return item.variables?.['chapterId'] === 101;
            })
        ).toHaveLength(1);
        const file = join(mangaFolder(), 'One Piece', 'Chapter 1.cbz');
        await expect.poll(() => {return readdirSync(join(mangaFolder(), 'One Piece')).sort()}).toEqual(['Chapter 1.cbz', 'Chapter 2.cbz']);
        const entries = readZipEntries(readFileSync(file));
        expect(entries.map((entry) => {return entry.name})).toEqual(['001.jpg', '003.jpg', 'ComicInfo.xml']);
        expect(entries[2]!.data.toString('utf-8')).toContain('<PageCount>2</PageCount>');

        const first = session.page.getByTestId('manga-chapter').filter({ hasText: 'Romance Dawn' });
        const second = session.page.getByTestId('manga-chapter').filter({ hasText: 'The Great Race' });
        await expect(first.getByText('Incomplete', { exact: true })).toHaveClass(/badge--incomplete/);
        // Yellow, like a paused chapter: the --yellow of the theme the tests run with (#a15c07).
        await expect(first.getByText('Incomplete', { exact: true })).toHaveCSS('color', 'rgb(161, 92, 7)');
        await expect(first.getByText('Downloaded', { exact: true })).toHaveCount(0);
        await expect(second.getByText('Downloaded', { exact: true })).toBeVisible();
        await expect(second.getByRole('button', { name: /^RETRY/ })).toHaveCount(0);

        // The page still fails: the chapter says why and stays as it was.
        await first.getByRole('button', { name: 'RETRY: Romance Dawn' }).click();
        await expect(session.page.locator('.toast').filter({ hasText: 'Could not download the missing pages: The server answered 500 for a page' })).toBeVisible({ timeout: 15000 });
        await expect(first.getByText('Incomplete', { exact: true })).toBeVisible();
        await expect(first.getByRole('button', { name: 'RETRY: Romance Dawn' })).toBeEnabled();
        expect(readZipEntries(readFileSync(file)).map((entry) => {return entry.name})).toEqual(['001.jpg', '003.jpg', 'ComicInfo.xml']);

        // The server gives the page now: only that page is downloaded, and the chapter is whole.
        fake.failTimes.clear();
        const before = pageRequests(MISSING_PAGE);
        await first.getByRole('button', { name: 'RETRY: Romance Dawn' }).click();
        await expect(session.page.locator('.toast').filter({ hasText: 'The missing pages were downloaded.' })).toBeVisible({ timeout: 15000 });
        await expect(first.getByText('Downloaded', { exact: true })).toBeVisible();
        await expect(first.getByText('Incomplete', { exact: true })).toHaveCount(0);
        await expect(first.getByRole('button', { name: /^RETRY/ })).toHaveCount(0);
        expect(pageRequests(MISSING_PAGE)).toBe(before + 1);
        expect(pageRequests('/api/v1/chapter/101/page/0')).toBe(1);
        const repaired = readZipEntries(readFileSync(file));
        expect(repaired.map((entry) => {return entry.name})).toEqual(['001.jpg', '002.jpg', '003.jpg', 'ComicInfo.xml']);
        expect([...repaired[1]!.data]).toEqual([...JPEG]);
        expect(repaired[3]!.data.toString('utf-8')).toContain('<PageCount>3</PageCount>');
        expect(readdirSync(join(mangaFolder(), 'One Piece')).sort()).toEqual(['Chapter 1.cbz', 'Chapter 2.cbz']);
    });

    test('warns at the missing page of the reader and downloads it from there', async () => {
        test.setTimeout(60000);
        fake.pagesArePicture = true;
        fake.failTimes.set(MISSING_PAGE, FAILS_FOR_GOOD);
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        await downloadSeason(session.page);
        await waitForIncomplete(session.page);

        await session.page.getByRole('button', { name: 'READ: Romance Dawn', exact: true }).click();
        const reader = session.page.getByRole('region', { name: 'Reader' });
        await expect(reader.getByText('1 / 3')).toBeVisible();
        await expect(reader.getByRole('img')).toHaveCount(1);
        await session.page.keyboard.press('ArrowRight');
        await expect(reader.getByText('2 / 3')).toBeVisible();
        await expect(reader.getByRole('alert')).toHaveText('Page 2 was not downloaded.');
        await expect(reader.getByRole('button', { name: 'TRY AGAIN' })).toHaveCount(0);

        // The page still fails: the reader says so and keeps the button.
        await reader.getByRole('button', { name: 'DOWNLOAD PAGE' }).click();
        await expect(reader.getByRole('alert')).toHaveText(['Page 2 was not downloaded.', 'The page could not be downloaded. Try again.'], { timeout: 15000 });
        await expect(reader.getByRole('button', { name: 'DOWNLOAD PAGE' })).toBeEnabled();

        fake.failTimes.clear();
        await reader.getByRole('button', { name: 'DOWNLOAD PAGE' }).click();
        const image = reader.getByRole('img');
        await expect(image).toHaveCount(1, { timeout: 15000 });
        await expect.poll(() => {
            return image.evaluate((element: HTMLImageElement) => {return element.complete && element.naturalWidth > 0}).catch(() => {return false});
        }).toBe(true);
        await expect(reader.getByRole('alert')).toHaveCount(0);
        // The pages come from the file: only the missing one was asked for again.
        expect(pageRequests('/api/v1/chapter/101/page/0')).toBe(1);
        expect(pageRequests(MISSING_PAGE)).toBe(7);
        const file = join(mangaFolder(), 'One Piece', 'Chapter 1.cbz');
        expect(readZipEntries(readFileSync(file)).map((entry) => {return entry.name})).toEqual(['001.png', '002.png', '003.png', 'ComicInfo.xml']);

        await reader.getByRole('button', { name: '← CLOSE' }).click();
        const first = session.page.getByTestId('manga-chapter').filter({ hasText: 'Romance Dawn' });
        await expect(first.getByText('Downloaded', { exact: true })).toBeVisible();
        await expect(first.getByText('Incomplete', { exact: true })).toHaveCount(0);
    });

    test('downloads the pages incomplete chapters lack with the button that downloads what is missing of the season', async () => {
        test.setTimeout(60000);
        fake.failTimes.set(MISSING_PAGE, FAILS_FOR_GOOD);
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        await downloadSeason(session.page);
        await waitForIncomplete(session.page);
        const first = session.page.getByTestId('manga-chapter').filter({ hasText: 'Romance Dawn' });
        await expect(first.getByText('Incomplete', { exact: true })).toBeVisible();

        fake.failTimes.clear();
        await downloadSeason(session.page);
        await expect(first.getByText('Downloaded', { exact: true })).toBeVisible({ timeout: 15000 });
        await expect(first.getByText('Incomplete', { exact: true })).toHaveCount(0);
        const file = join(mangaFolder(), 'One Piece', 'Chapter 1.cbz');
        expect(readZipEntries(readFileSync(file)).map((entry) => {return entry.name})).toEqual(['001.jpg', '002.jpg', '003.jpg', 'ComicInfo.xml']);
        expect(readdirSync(join(mangaFolder(), 'One Piece')).sort()).toEqual(['Chapter 1.cbz', 'Chapter 2.cbz']);
        // The chapter that was whole is not downloaded again.
        expect(pageRequests('/api/v1/chapter/102/page/0')).toBe(1);
    });
});
