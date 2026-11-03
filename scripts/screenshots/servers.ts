import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { ANIME_TITLES, CHAPTERS, MANGA_TITLES } from './catalog';
import { fileNameOf } from './media';

// Two servers on this machine stand in for the services the app talks to, so the screenshots never reach the network:
//   - FakeAniList answers the schedule, the covers and the status of the anime (PULLWAVE_ANILIST_URL);
//   - FakeSuwayomi answers like the server of the manga (PULLWAVE_MANGA_URL).

type Json = Record<string, unknown>;

const SECONDS_PER_DAY = 86400;
const PAGES_PER_CHAPTER = 5;
const MANGA_FIRST_ID = 11;
const FIRST_SOURCE = '4242';
const SECOND_SOURCE = '5252';
const EXTENSION_PACKAGE = 'eu.kanade.tachiyomi.extension.en.lanternscans';
const STORE_ADDRESS = 'https://store.example/index.min.json';

abstract class LocalServer {
    private server: Server | null = null;

    get url(): string {
        return `http://127.0.0.1:${String((this.server?.address() as AddressInfo).port)}`;
    }

    async start(): Promise<void> {
        this.server = createServer((request, response) => {
            void this.handle(request, response);
        });
        await new Promise<void>((resolve) => {
            this.server?.listen(0, '127.0.0.1', resolve);
        });
    }

    async stop(): Promise<void> {
        await new Promise<void>((resolve) => {
            this.server?.close(() => {
                resolve();
            });
            this.server?.closeAllConnections();
        });
    }

    protected abstract handle(request: IncomingMessage, response: ServerResponse): Promise<void>;
}

async function readBody(request: IncomingMessage): Promise<Json> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
        chunks.push(chunk as Buffer);
    }
    const text = Buffer.concat(chunks).toString('utf-8');
    return text.length > 0 ? (JSON.parse(text) as Json) : {};
}

function sendJson(response: ServerResponse, payload: unknown): void {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(payload));
}

function sendPicture(response: ServerResponse, file: string): void {
    response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
    response.end(readFileSync(file));
}

export interface AniListFiles {
    // The folder with the cover of every anime (see makeCover).
    coversDirectory: string;
}

export class FakeAniList extends LocalServer {
    constructor(private readonly files: AniListFiles) {
        super();
    }

    private coverOf(title: string): string | null {
        const known = ANIME_TITLES.find((anime) => {
            return anime.title.toLowerCase() === title.trim().toLowerCase();
        });
        return known === undefined ? null : `${this.url}/covers/${fileNameOf(known.title)}.png`;
    }

    private schedule(start: number, end: number): Json {
        const first = Math.floor(start / SECONDS_PER_DAY);
        const airings: Json[] = [];
        for (let day = first; day <= Math.floor(end / SECONDS_PER_DAY); day += 1) {
            ANIME_TITLES.forEach((anime, position) => {
                const airingAt = day * SECONDS_PER_DAY + (position * 3 + 1) * 3600 + 20 * 60;
                if (airingAt > start && airingAt < end && (position + day) % 3 !== 0) {
                    airings.push({
                        episode: 4 + ((day + position) % 8),
                        airingAt,
                        media: {
                            id: 1000 + position,
                            format: 'TV',
                            countryOfOrigin: 'JP',
                            isAdult: false,
                            title: { romaji: anime.title, english: anime.title },
                            synonyms: [],
                            coverImage: { large: this.coverOf(anime.title) }
                        }
                    });
                }
            });
        }
        return { Page: { pageInfo: { hasNextPage: false }, airingSchedules: airings } };
    }

    private covers(variables: Json): Json {
        const data: Json = {};
        Object.entries(variables).forEach(([name, value]) => {
            const cover = this.coverOf(String(value));
            data[`a${name.slice(1)}`] = { media: cover === null ? [] : [{ coverImage: { large: cover } }] };
        });
        return data;
    }

    private search(variables: Json): Json {
        const data: Json = {};
        Object.entries(variables).forEach(([name, value]) => {
            const position = ANIME_TITLES.findIndex((anime) => {
                return anime.title.toLowerCase() === String(value).trim().toLowerCase();
            });
            const title = String(value);
            data[`m${name.slice(1)}`] = { media: position < 0 ? [] : [{ id: 1000 + position, status: 'RELEASING', title: { romaji: title, english: title, native: title }, synonyms: [] }] };
        });
        return data;
    }

    protected async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
        const path = request.url ?? '';
        if (request.method === 'GET' && path.startsWith('/covers/')) {
            sendPicture(response, `${this.files.coversDirectory}/${path.slice('/covers/'.length)}`);
            return;
        }
        const body = await readBody(request);
        const query = String(body['query'] ?? '');
        const variables = (body['variables'] ?? {}) as Json;
        if (query.includes('airingSchedules')) {
            sendJson(response, { data: this.schedule(Number(variables['start']), Number(variables['end'])) });
        } else if (query.includes('coverImage { large } } }') && query.includes('a0:')) {
            sendJson(response, { data: this.covers(variables) });
        } else if (query.includes('m0:')) {
            sendJson(response, { data: this.search(variables) });
        } else {
            sendJson(response, { data: { Page: { media: [] } } });
        }
    }
}

export interface SuwayomiFiles {
    // The folder with the cover of every manga (makeCover) and the page that every chapter shows (makePage, page-1.png and so on).
    coversDirectory: string;
    pagesDirectory: string;
}

export class FakeSuwayomi extends LocalServer {
    installed = false;
    stores: Array<{ name: string; indexUrl: string }> = [];

    constructor(private readonly files: SuwayomiFiles) {
        super();
    }

    private extension(): Json {
        return {
            pkgName: EXTENSION_PACKAGE,
            name: 'Tachiyomi: Lantern Scans',
            lang: 'en',
            versionName: '1.4.12',
            isInstalled: this.installed,
            hasUpdate: false,
            isObsolete: false,
            iconUrl: null,
            contentWarning: 'SAFE',
            storeIndexUrl: STORE_ADDRESS,
            extensionLib: '1.4'
        };
    }

    private source(id: string, name: string): Json {
        return { id, name, displayName: name, lang: 'en', iconUrl: '', supportsLatest: true, contentWarning: 'SAFE', extension: { pkgName: EXTENSION_PACKAGE, storeIndexUrl: STORE_ADDRESS } };
    }

    private sourceOfManga(id: number): string {
        return id - MANGA_FIRST_ID < 4 ? FIRST_SOURCE : SECOND_SOURCE;
    }

    private manga(id: number): Json {
        const style = MANGA_TITLES[id - MANGA_FIRST_ID];
        return { id, sourceId: this.sourceOfManga(id), title: style?.title ?? 'Unknown', thumbnailUrl: `/api/v1/manga/${String(id)}/thumbnail` };
    }

    private mangasOfSource(sourceId: string): Json[] {
        return MANGA_TITLES.map((_style, position) => {
            return this.manga(MANGA_FIRST_ID + position);
        }).filter((manga) => {
            return manga['sourceId'] === sourceId;
        });
    }

    private details(id: number): Json {
        return {
            fetchMangaAndChapters: {
                manga: { ...this.manga(id), realUrl: `https://lanternscans.example/manga/${String(id)}`, author: 'Mei Tanabe', artist: 'Ren Okabe', description: 'A quiet town, a strange visitor and a secret kept for three generations.', genre: ['Adventure', 'Mystery', 'Slice of life'], status: 'ONGOING' },
                chapters: Array.from({ length: CHAPTERS }, (_unused, index) => {
                    const number = index + 1;
                    return { id: id * 100 + number, name: `Chapter ${String(number)}`, chapterNumber: number, uploadDate: String(Date.now() - (CHAPTERS - number) * 86400000), scanlator: 'Lantern Scans', sourceOrder: number };
                })
            }
        };
    }

    private answer(query: string, variables: Json): unknown {
        if (query.includes('aboutServer')) {
            return { aboutServer: { version: 'v2.4.2366' } };
        }
        if (query.includes('addExtensionStore')) {
            const store = { name: 'Lantern Store', indexUrl: String(variables['indexUrl']) };
            this.stores.push(store);
            return { addExtensionStore: { extensionStore: store } };
        }
        if (query.includes('extensionStores')) {
            return { extensionStores: { nodes: this.stores } };
        }
        if (query.includes('fetchExtensions')) {
            return { fetchExtensions: { extensions: this.stores.length > 0 ? [this.extension()] : [] } };
        }
        if (query.includes('updateExtension')) {
            this.installed = (variables['patch'] as Record<string, boolean>)['install'] === true;
            return { updateExtension: { extension: this.extension() } };
        }
        if (query.trim().startsWith('{ extensions')) {
            return { extensions: { nodes: this.stores.length > 0 ? [this.extension()] : [] } };
        }
        if (query.trim().startsWith('{ sources')) {
            return { sources: { nodes: this.installed ? [this.source(FIRST_SOURCE, 'Lantern Scans'), this.source(SECOND_SOURCE, 'Paperwind')] : [] } };
        }
        if (query.includes('{ filters {')) {
            return { source: { filters: [] } };
        }
        if (query.includes('fetchSourceManga')) {
            const all = this.mangasOfSource(String(variables['source']));
            const text = String(variables['query'] ?? '').toLowerCase();
            const mangas = variables['type'] === 'SEARCH' ? all.filter((manga) => {return String(manga['title']).toLowerCase().includes(text)}) : all;
            return { fetchSourceManga: { hasNextPage: false, mangas } };
        }
        if (query.includes('fetchMangaAndChapters')) {
            return this.details(Number(variables['id']));
        }
        if (query.includes('fetchChapterPages')) {
            const chapterId = Number(variables['chapterId']);
            return { fetchChapterPages: { pages: Array.from({ length: PAGES_PER_CHAPTER }, (_unused, page) => {return `/api/v1/chapter/${String(chapterId)}/page/${String(page)}`}) } };
        }
        throw new Error(`Unexpected query: ${query.slice(0, 80)}`);
    }

    protected async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
        const path = request.url ?? '';
        if (request.method === 'POST' && path === '/api/graphql') {
            const body = await readBody(request);
            try {
                sendJson(response, { data: this.answer(String(body['query']), (body['variables'] ?? {}) as Json) });
            } catch (error) {
                sendJson(response, { errors: [{ message: (error as Error).message }] });
            }
            return;
        }
        const thumbnail = /^\/api\/v1\/manga\/(\d+)\/thumbnail/.exec(path);
        if (thumbnail !== null) {
            const style = MANGA_TITLES[Number(thumbnail[1]) - MANGA_FIRST_ID];
            sendPicture(response, `${this.files.coversDirectory}/${fileNameOf(style?.title ?? '')}.png`);
            return;
        }
        const page = /\/page\/(\d+)/.exec(path);
        if (page !== null) {
            sendPicture(response, `${this.files.pagesDirectory}/page-${String(Number(page[1]) + 1)}.png`);
            return;
        }
        sendPicture(response, `${this.files.coversDirectory}/${fileNameOf(MANGA_TITLES[0]?.title ?? '')}.png`);
    }
}
