import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
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
    // Addresses that answer with an error, and how many times they do before they answer well (the next pages are asked for ahead of time too).
    failTimes = new Map<string, number>();
    // The extension and its source are for adults.
    adult = false;
    // The extension has an update, and the version of the library of extensions it was made for.
    hasUpdate = false;
    // A second source (of the same extension) that has the same manga under another number, with these chapters (by their number).
    otherSource = false;
    otherChapters = [1, 2, 3];
    // Chapters the source has published after the first two (their numbers on the server).
    laterChapters: number[] = [];
    extensionLib = '1.4';
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
            return { sources: { nodes: this.installed ? [local, site, ...(this.otherSource ? [other] : [])] : [local] } };
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
                            return { id: chapterId, name: `Chapter ${index + 3}`, chapterNumber: index + 3, uploadDate: '1700200000000', scanlator: null, sourceOrder: index + 3 };
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
            return { fetchChapterPages: { pages: [0, 1, 2].map((page) => {return `/api/v1/chapter/${chapterId}/page/${page}`}) } };
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
        env: { ...process.env, PULLWAVE_MANGA_URL: fake.url, ...env }
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

async function goTo(page: Page, view: 'BROWSE' | 'LIBRARY' | 'EXTENSIONS' | 'SETTINGS'): Promise<void> {
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

async function openOnePiece(page: Page): Promise<void> {
    await openSource(page);
    await page.getByRole('button', { name: 'Open: One Piece' }).click();
    await expect(page.getByRole('button', { name: 'READ: Romance Dawn' })).toBeVisible();
}

// Adds One Piece to the library from the browse and opens it there: the chapters are picked, downloaded and removed in the library.
async function openOnePieceInLibrary(page: Page): Promise<void> {
    await openOnePiece(page);
    await page.getByRole('button', { name: 'ADD TO LIBRARY' }).click();
    await goTo(page, 'LIBRARY');
    await page.getByTestId('manga-entry').getByRole('button', { name: 'Open: One Piece' }).click();
    await expect(page.getByRole('checkbox', { name: 'Select: Romance Dawn' })).toBeVisible();
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
        await session.page.getByRole('button', { name: 'REMOVE: Fake Store' }).click();
        await expect(session.page.getByTestId('manga-store')).toHaveCount(0);
        expect(fake.graphqlRequests('removeExtensionStore')[0]?.variables).toEqual({ indexUrl: STORE_URL });
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
        await session.page.getByRole('button', { name: 'SEARCH', exact: true }).first().click();
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
        await session.page.getByRole('button', { name: 'SEARCH', exact: true }).first().click();
        await session.page.getByRole('button', { name: 'FILTERS', exact: true }).click();
        await session.page.getByRole('switch', { name: 'Has chapters' }).check();
        await session.page.getByRole('checkbox', { name: 'Action', exact: true }).click();
        await session.page.getByLabel('Sort').first().selectOption('1');
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
        await session.page.getByRole('button', { name: 'READ: Romance Dawn' }).click();
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
        await reader.getByRole('button', { name: 'READER SETTINGS' }).click();
        await expect(reader.getByRole('img')).toHaveCount(3);
        // The next chapter.
        await reader.getByRole('button', { name: 'NEXT CHAPTER' }).click();
        await expect(reader.getByText('One Piece · The Great Race')).toBeVisible();
        await expect(reader.getByRole('img')).toHaveCount(3);
        await expect(reader.getByRole('button', { name: 'NEXT CHAPTER' })).toBeDisabled();
        await session.page.keyboard.press('Escape');
        await expect(reader).toHaveCount(0);
        await expect(session.page.getByRole('button', { name: 'READ: Romance Dawn' })).toBeVisible();
        await expect(session.page.getByRole('checkbox')).toHaveCount(0);
        // Opened again, it comes back in the mode that was chosen.
        await session.page.getByRole('button', { name: 'READ: Romance Dawn' }).click();
        await expect(session.page.getByRole('region', { name: 'Reader' }).getByRole('img')).toHaveCount(3);
    });

    test('shows the progress of the chapter, lets the user jump to a chapter and tries again only the page that failed', async () => {
        fake.pagesArePicture = true;
        fake.failTimes.set('/api/v1/chapter/101/page/1', 2);
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePiece(session.page);
        await session.page.getByRole('button', { name: 'READ: Romance Dawn' }).click();
        const reader = session.page.getByRole('region', { name: 'Reader' });
        const bar = reader.getByRole('progressbar', { name: 'Reading progress' });
        await expect(bar).toHaveAttribute('aria-valuenow', '33');
        await expect(bar.locator('.progress__bar')).toHaveCSS('box-shadow', /rgb/);
        await session.page.keyboard.press('ArrowRight');
        await expect(reader.getByText('2 / 3')).toBeVisible();
        await expect(bar).toHaveAttribute('aria-valuenow', '67');
        // The second page answered with an error: only it is asked for again.
        await expect(reader.getByRole('alert')).toHaveText('Page 2 could not be loaded.');
        await reader.getByRole('button', { name: 'TRY AGAIN' }).click();
        const image = reader.getByRole('img');
        await expect.poll(() => {return image.evaluate((element: HTMLImageElement) => {return element.complete && element.naturalWidth > 0})}).toBe(true);
        expect(fake.requests.filter((item) => {return item.path === '/api/v1/chapter/101/page/1'}).length).toBeGreaterThanOrEqual(3);
        expect(fake.requests.filter((item) => {return item.path === '/api/v1/chapter/101/page/0'})).toHaveLength(1);
        // Between the buttons of the chapters there is a list to jump to one.
        const chapters = reader.getByLabel('Go to chapter');
        await expect(chapters).toHaveValue('0');
        await chapters.selectOption('1');
        await expect(reader.getByText('One Piece · The Great Race')).toBeVisible();
        await expect(chapters).toHaveValue('1');
    });

    test('keeps the settings in view wherever the chapter is, goes back to the top, and scrolls by itself', async () => {
        fake.pagesArePicture = true;
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePiece(session.page);
        await session.page.getByRole('button', { name: 'READ: Romance Dawn' }).click();
        const reader = session.page.getByRole('region', { name: 'Reader' });
        await expect(reader.getByRole('button', { name: 'AUTO SCROLL' })).toBeDisabled();
        await reader.getByRole('button', { name: 'READER SETTINGS' }).click();
        await reader.getByLabel('Reading mode').selectOption('webtoon');
        await reader.getByRole('button', { name: 'READER SETTINGS' }).click();
        const area = session.page.locator('.app__main');
        await expect(reader.getByRole('img')).toHaveCount(3);
        await expect.poll(() => {return area.evaluate((element) => {return element.scrollHeight - element.clientHeight})}).toBeGreaterThan(1500);
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

        // The button at the corner takes it back to the top.
        await session.page.getByRole('button', { name: 'Back to the top' }).click();
        await expect.poll(() => {return area.evaluate((element) => {return element.scrollTop})}).toBe(0);
        await expect(session.page.getByRole('button', { name: 'Back to the top' })).toHaveCount(0);
    });

    test('reads a downloaded chapter from its file, with no request to the server for the pages', async () => {
        fake.pagesArePicture = true;
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        await session.page.getByRole('checkbox', { name: 'Select: Romance Dawn' }).check();
        await session.page.getByRole('button', { name: 'DOWNLOAD SELECTED (1)' }).click();
        await waitForDownloaded(session.page);
        const before = fake.requests.filter((item) => {return item.path.startsWith('/api/v1/chapter/101/page/')}).length;
        await session.page.getByRole('button', { name: 'READ: Romance Dawn' }).click();
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
        await session.page.getByRole('checkbox', { name: 'Select: Romance Dawn' }).check();
        await session.page.getByRole('button', { name: 'DOWNLOAD SELECTED (1)' }).click();
        await waitForDownloaded(session.page);

        const file = join(mangaFolder(), 'One Piece', 'Chapter 1.cbz');
        await expect.poll(() => {return existsSync(file)}).toBe(true);
        const entries = readZipEntries(readFileSync(file));
        expect(entries.map((entry) => {return entry.name})).toEqual(['001.jpg', '002.jpg', '003.jpg', 'ComicInfo.xml']);
        expect([...entries[0]!.data]).toEqual([...JPEG]);
        const info = entries[3]!.data.toString('utf-8');
        expect(info).toContain('<Series>One Piece</Series>');
        expect(info).toContain('<Title>Romance Dawn</Title>');
        expect(info).toContain('<Number>1</Number>');
        expect(info).toContain('<Writer>Oda</Writer>');
        expect(info).toContain('<PageCount>3</PageCount>');
        // Nothing is left beside it.
        expect(readdirSync(join(mangaFolder(), 'One Piece'))).toEqual(['Chapter 1.cbz']);

        const pages = fake.graphqlRequests('fetchChapterPages');
        expect(pages).toHaveLength(1);
        expect(pages[0]?.variables).toEqual({ chapterId: 101 });
        expect(fake.requests.filter((item) => {return item.path.startsWith('/api/v1/chapter/101/page/')}).map((item) => {return item.path})).toEqual([
            '/api/v1/chapter/101/page/0',
            '/api/v1/chapter/101/page/1',
            '/api/v1/chapter/101/page/2'
        ]);
    });

    test('keeps the downloaded chapter in the library, with its state in the manga', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        await session.page.getByRole('checkbox', { name: 'Select: Romance Dawn' }).check();
        await session.page.getByRole('button', { name: 'DOWNLOAD SELECTED (1)' }).click();
        await waitForDownloaded(session.page);
        await expect(session.page.locator('.badge--done', { hasText: 'Downloaded' })).toBeVisible();

        await session.page.getByRole('button', { name: '← BACK' }).click();
        const entry = session.page.getByTestId('manga-entry');
        await expect(entry.getByRole('heading', { name: 'One Piece' })).toBeVisible();
        await expect(entry.getByText('1 of 2 downloaded')).toBeVisible();
        // There is no button to download what is missing in the list: that is in the page of the manga.
        await expect(entry.getByRole('button', { name: 'DOWNLOAD MISSING' })).toHaveCount(0);

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
        await expect(session.page.getByRole('checkbox', { name: 'Select: Romance Dawn' })).toBeVisible();
        await expect(session.page.getByRole('navigation', { name: 'Manga' }).getByRole('button', { name: 'LIBRARY', exact: true })).toHaveAttribute('aria-current', 'page');
        await session.page.getByRole('button', { name: 'GO TO SOURCE' }).click();
        await expect(session.page.getByRole('button', { name: 'READ: Romance Dawn' })).toBeVisible();
        await expect(session.page.getByRole('checkbox')).toHaveCount(0);
        await expect(session.page.getByRole('navigation', { name: 'Manga' }).getByRole('button', { name: 'BROWSE', exact: true })).toHaveAttribute('aria-current', 'page');
    });

    test('searches the source by a genre as a filter, and by the author as text when the source has no filter for them', async () => {
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
        await expect(session.page.getByRole('checkbox', { name: 'Action', exact: true })).toHaveAttribute('aria-checked', 'true');

        await session.page.getByRole('button', { name: 'Open: One Piece' }).click();
        await session.page.getByRole('button', { name: 'Search by: Oda', exact: true }).click();
        await expect.poll(() => {return searches().length}).toBe(2);
        expect(searches()[1]?.variables).toMatchObject({ source: SOURCE_ID, type: 'SEARCH', page: 1, query: 'Oda' });
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
        await session.page.getByRole('button', { name: 'DOWNLOAD MISSING' }).click();
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
        await expect.poll(() => {return existsSync(log) ? readFileSync(log, 'utf-8') : ''}).toBe('https://dex.example/manga/7\n');
    });

    test('moves the downloaded chapters to another folder, checks them and points the library to them', async () => {
        const target = join(workDir, 'moved');
        session = await launch({}, { PULLWAVE_MANGA_MIGRATE_DIR: target });
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        await session.page.getByRole('checkbox', { name: 'Select: Romance Dawn' }).check();
        await session.page.getByRole('button', { name: 'DOWNLOAD SELECTED (1)' }).click();
        await waitForDownloaded(session.page);
        const oldFile = join(mangaFolder(), 'One Piece', 'Chapter 1.cbz');
        await expect.poll(() => {return existsSync(oldFile)}).toBe(true);
        const original = readFileSync(oldFile);

        await goTo(session.page, 'SETTINGS');
        await session.page.getByRole('button', { name: 'MIGRATE FOLDER' }).click();
        await expect(session.page.getByLabel('Manga folder')).toHaveValue(target);
        await expect(session.page.locator('.toast, .notice').filter({ hasText: `1 chapter(s) moved to ${target}.` }).first()).toBeVisible();

        const newFile = join(target, 'One Piece', 'Chapter 1.cbz');
        expect(readFileSync(newFile).equals(original)).toBe(true);
        expect(existsSync(oldFile)).toBe(false);
        expect(existsSync(mangaFolder())).toBe(false);
        const saved = JSON.parse(readFileSync(join(session.userData, 'settings.json'), 'utf-8')) as Record<string, unknown>;
        expect(saved['mangaDirectory']).toBe(target);

        // The chapter is read from its new place, and a new download goes to the new folder.
        await goTo(session.page, 'LIBRARY');
        await expect(session.page.locator('.badge--done', { hasText: 'Downloaded' })).toBeVisible();
        await session.page.getByRole('checkbox', { name: 'Select: The Great Race' }).check();
        await session.page.getByRole('button', { name: 'DOWNLOAD SELECTED (1)' }).click();
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
        await session.page.getByRole('button', { name: 'Mangas', exact: true }).click();
        await session.page.getByRole('button', { name: 'Favorites', exact: true }).click();
        await expect(session.page.getByRole('button', { name: 'Mangas', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await session.page.getByLabel('Series').fill('Pirates');
        await session.page.getByRole('button', { name: 'SAVE SERIES' }).click();
        await expect(session.page.getByText('In the series "Pirates", order 1.')).toBeVisible();
        await session.page.getByRole('button', { name: '← BACK' }).click();
        await session.page.getByTestId('manga-entry').getByRole('button', { name: 'Open: Bleach' }).click();
        await session.page.getByLabel('Series').fill('pirates');
        await session.page.getByLabel('Order').fill('2');
        await session.page.getByRole('button', { name: 'SAVE SERIES' }).click();
        await expect(session.page.getByText('In the series "Pirates", order 2.')).toBeVisible();
        // The season that joined the series is in the groups the series is in.
        await expect(session.page.getByRole('button', { name: 'Mangas', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await expect(session.page.getByRole('button', { name: 'Favorites', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await session.page.getByRole('button', { name: '← BACK' }).click();

        // The library shows the series as one card, which opens to its seasons; the groups limit it.
        await expect(session.page.getByTestId('manga-series')).toHaveCount(1);
        await expect(session.page.getByTestId('manga-entry')).toHaveCount(0);
        await expect(session.page.getByText('2 SEASONS')).toBeVisible();
        await session.page.getByRole('navigation', { name: 'Groups' }).getByRole('button', { name: 'Favorites' }).click();
        await expect(session.page.getByTestId('manga-series')).toHaveCount(1);
        await session.page.getByRole('button', { name: 'Open series: Pirates' }).click();
        await expect(session.page.getByTestId('manga-season')).toHaveCount(2);
        await expect(session.page.getByTestId('manga-season').first()).toContainText('SEASON 1');
        await expect(session.page.getByRole('button', { name: 'Mangas', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await session.page.getByRole('button', { name: 'BACK TO LIBRARY' }).click();

        // Deleting a group leaves the mangas.
        await session.page.getByRole('button', { name: 'MANAGE GROUPS' }).click();
        await session.page.getByRole('button', { name: 'DELETE: Favorites' }).click();
        await session.page.getByRole('button', { name: /^DELETE THE GROUP/ }).click();
        await expect(session.page.getByTestId('manga-group')).toHaveCount(1);
        await expect(session.page.getByTestId('manga-series')).toHaveCount(1);
    });

    test('keeps the groups and the series after the app is closed and opened again', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        await session.page.getByLabel('Series').fill('Pirates');
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

    test('goes back and forward through the series and the groups with the buttons of the mouse', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        await session.page.getByLabel('Series').fill('Pirates');
        await session.page.getByRole('button', { name: 'SAVE SERIES' }).click();
        await expect(session.page.getByText('In the series "Pirates", order 1.')).toBeVisible();
        await session.page.getByRole('button', { name: '← BACK' }).click();
        await session.page.getByRole('button', { name: 'Open series: Pirates' }).click();
        await expect(session.page.getByTestId('manga-series-view')).toBeVisible();
        await session.page.getByRole('button', { name: 'Open: One Piece' }).click();
        await expect(session.page.getByLabel('Series')).toBeVisible();
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
        await session.page.getByRole('checkbox', { name: 'Select: Romance Dawn' }).check();
        await session.page.getByRole('button', { name: 'DOWNLOAD SELECTED (1)' }).click();
        await waitForDownloaded(session.page);
        const file = join(mangaFolder(), 'One Piece', 'Chapter 1.cbz');
        await expect.poll(() => {return existsSync(file)}).toBe(true);

        await session.page.getByRole('button', { name: 'MIGRATE TO ANOTHER SOURCE' }).click();
        await expect(session.page.getByLabel('Search in').locator('option')).toHaveText(['All sources', 'Other Dex (en)']);
        await session.page.getByRole('button', { name: 'SEARCH', exact: true }).click();
        await session.page.getByRole('button', { name: 'Pick: One Piece (Other Dex)' }).click();
        await expect(session.page.getByTestId('manga-migration-preview')).toHaveText(
            '2 of the 2 chapters of the library match chapters of the new source. 1 new chapter(s) will be added, 0 downloaded chapter(s) the new source lacks will be kept and 0 chapter(s) not downloaded will be removed.'
        );
        await session.page.getByRole('button', { name: 'MIGRATE', exact: true }).click();
        await expect(session.page.locator('.toast').filter({ hasText: 'Migrated: 2 chapter(s) matched, 1 added, 0 removed.' }).first()).toBeVisible();

        // The manga is the one of the other source now: its chapters (three of them) come from there, and the downloaded one is still downloaded.
        await expect(session.page.getByTestId('manga-chapter')).toHaveCount(3);
        await expect(session.page.getByTestId('manga-chapter').filter({ hasText: 'Ch. 1' }).locator('.badge--done')).toBeVisible();
        await expect(session.page.getByTestId('manga-chapter').filter({ hasText: 'Ch. 3' }).locator('.badge--done')).toHaveCount(0);
        await expect(session.page.getByRole('button', { name: 'OPEN SITE' })).toHaveAttribute('title', 'https://other.example/manga/70');
        expect(existsSync(file)).toBe(true);
        await session.page.getByRole('button', { name: '← BACK' }).click();
        await expect(session.page.getByText('1 of 3 downloaded')).toBeVisible();
        await expect(session.page.getByRole('heading', { name: 'One Piece' })).toBeVisible();

        // The chapters that are new download from the new source.
        await session.page.getByRole('button', { name: 'Open: One Piece' }).click();
        await session.page.getByRole('checkbox', { name: 'Select: Ch. 3' }).check();
        await session.page.getByRole('button', { name: 'DOWNLOAD SELECTED (1)' }).click();
        await waitForDownloaded(session.page);
        await expect.poll(() => {return readdirSync(join(mangaFolder(), 'One Piece')).sort()}).toEqual(['Chapter 1.cbz', 'Chapter 3.cbz']);
        expect(fake.graphqlRequests('fetchChapterPages').map((item) => {return item.variables?.['chapterId']})).toEqual([101, 703]);
    });

    test('makes a folder of images when the setting says so', async () => {
        session = await launch({ mangaFormat: 'folder' });
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        await session.page.getByRole('checkbox', { name: 'Select: The Great Race' }).check();
        await session.page.getByRole('button', { name: 'DOWNLOAD SELECTED (1)' }).click();
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

    test('tries a chapter whose pages the server cannot give three times, then shows why and lets it be retried', async () => {
        fake.failingChapters.add(101);
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        await session.page.getByRole('checkbox', { name: 'Select: Romance Dawn' }).check();
        await session.page.getByRole('button', { name: 'DOWNLOAD SELECTED (1)' }).click();
        await session.page.getByRole('button', { name: /^DOWNLOADS \(\d+\)$/ }).click();
        const job = session.page.getByTestId('manga-job');
        await expect(job.getByText('Failed', { exact: true })).toBeVisible({ timeout: 20000 });
        await expect(job.getByRole('alert')).toHaveText('The site or the extension reported an error.');
        await expect(job.getByRole('alert')).toHaveAttribute('title', 'The source could not give the pages');
        expect(fake.graphqlRequests('fetchChapterPages')).toHaveLength(3);
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
        await session.page.getByRole('checkbox', { name: 'Select: Romance Dawn' }).check();
        await session.page.getByRole('button', { name: 'DOWNLOAD SELECTED (1)' }).click();
        await session.page.getByRole('button', { name: /^DOWNLOADS \(\d+\)$/ }).click();
        const job = session.page.getByTestId('manga-job');
        await job.getByRole('button', { name: 'PAUSE' }).click();
        await expect(job.getByText('Paused', { exact: true })).toBeVisible();
        expect(existsSync(join(mangaFolder(), 'One Piece', 'Chapter 1.cbz'))).toBe(false);
        await job.getByRole('button', { name: 'RESUME' }).click();
        await expect(session.page.locator('.toast').filter({ hasText: 'Download complete: ' }).first()).toBeVisible({ timeout: 20000 });
        await expect.poll(() => {return existsSync(join(mangaFolder(), 'One Piece', 'Chapter 1.cbz'))}).toBe(true);
        expect(readdirSync(join(mangaFolder(), 'One Piece'))).toEqual(['Chapter 1.cbz']);
    });

    test('removes a chapter with its file, and a manga with its folder', async () => {
        session = await launch();
        await openManga(session.page);
        await installExtension(session.page);
        await openOnePieceInLibrary(session.page);
        await session.page.getByRole('button', { name: 'ALL' }).click();
        await session.page.getByRole('button', { name: 'DOWNLOAD SELECTED (2)' }).click();
        await expect(session.page.getByRole('button', { name: 'DOWNLOADS (0)' })).toBeVisible({ timeout: 30000 });
        await session.page.getByRole('button', { name: '← BACK' }).click();
        await expect(session.page.getByText('2 of 2 downloaded')).toBeVisible({ timeout: 30000 });
        await session.page.getByRole('button', { name: 'Open: One Piece' }).click();
        await session.page.getByRole('button', { name: 'Remove chapter: Romance Dawn' }).click();
        await expect.poll(() => {return existsSync(join(mangaFolder(), 'One Piece', 'Chapter 1.cbz'))}).toBe(false);
        await session.page.getByRole('button', { name: '← BACK' }).click();
        await expect(session.page.getByText('1 of 1 downloaded')).toBeVisible();
        await expect.poll(() => {return existsSync(join(mangaFolder(), 'One Piece', 'Chapter 1.cbz'))}).toBe(false);
        expect(existsSync(join(mangaFolder(), 'One Piece', 'Chapter 2.cbz'))).toBe(true);

        await session.page.getByRole('button', { name: 'REMOVE', exact: true }).click();
        await session.page.getByRole('button', { name: 'REMOVE WITH FILES?' }).click();
        await expect(session.page.getByText('Your library is empty.')).toBeVisible();
        await expect.poll(() => {return existsSync(join(mangaFolder(), 'One Piece'))}).toBe(false);
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
        // The cover is asked of the server of this run.
        await expect.poll(() => {return fake.requests.filter((item) => {return item.path === '/api/v1/manga/7/thumbnail'}).length}).toBeGreaterThan(0);
    });
});
