import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import yauzl from 'yauzl';
import { COMIC_INFO_FILE, missingPageIndexes, pageIndexOfFile } from './mangaFiles';

export class LocalPagesError extends Error {}

export const MAX_LOCAL_PAGES = 5000;
export const MAX_LOCAL_PAGE_BYTES = 50 * 1024 * 1024;
export const CACHED_CHAPTERS = 4;
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);

export function isImageName(name: string): boolean {
    return IMAGE_EXTENSIONS.has(extname(name).toLowerCase()) && !name.endsWith('/');
}

export function comparePageNames(first: string, second: string): number {
    return first.localeCompare(second, undefined, { numeric: true, sensitivity: 'base' });
}

function openZip(file: string): Promise<yauzl.ZipFile> {
    return new Promise((resolve, reject) => {
        yauzl.open(file, { lazyEntries: true, autoClose: false }, (error, zip) => {
            if (error !== null || zip === undefined) {
                reject(error ?? new LocalPagesError('The file of the chapter could not be opened'));
                return;
            }
            resolve(zip);
        });
    });
}

async function cbzNames(file: string): Promise<string[]> {
    const zip = await openZip(file);
    return new Promise((resolve, reject) => {
        const names: string[] = [];
        zip.on('entry', (entry: yauzl.Entry) => {
            if (isImageName(entry.fileName) && entry.fileName !== COMIC_INFO_FILE && names.length < MAX_LOCAL_PAGES) {
                names.push(entry.fileName);
            }
            zip.readEntry();
        });
        zip.once('end', () => {
            zip.close();
            resolve(names.sort(comparePageNames));
        });
        zip.once('error', (error) => {
            zip.close();
            reject(error);
        });
        zip.readEntry();
    });
}

async function readCbzEntry(file: string, name: string): Promise<Buffer> {
    const zip = await openZip(file);
    return new Promise((resolve, reject) => {
        const fail = (error: Error): void => {
            zip.close();
            reject(error);
        };
        zip.on('entry', (entry: yauzl.Entry) => {
            if (entry.fileName !== name) {
                zip.readEntry();
                return;
            }
            if (entry.uncompressedSize > MAX_LOCAL_PAGE_BYTES) {
                fail(new LocalPagesError('The page is too large'));
                return;
            }
            zip.openReadStream(entry, (error, stream) => {
                if (error !== null || stream === undefined) {
                    fail(error ?? new LocalPagesError('The page could not be read'));
                    return;
                }
                const chunks: Buffer[] = [];
                stream.on('data', (chunk: Buffer) => {
                    chunks.push(chunk);
                });
                stream.once('error', fail);
                stream.once('end', () => {
                    zip.close();
                    resolve(Buffer.concat(chunks));
                });
            });
        });
        zip.once('end', () => {
            fail(new LocalPagesError('The page is not in the file'));
        });
        zip.once('error', fail);
        zip.readEntry();
    });
}

async function folderNames(folder: string): Promise<string[]> {
    const entries = await readdir(folder, { withFileTypes: true });
    return entries
        .filter((entry) => {
            return entry.isFile() && isImageName(entry.name);
        })
        .map((entry) => {
            return entry.name;
        })
        .sort(comparePageNames)
        .slice(0, MAX_LOCAL_PAGES);
}

interface Listing {
    modified: number;
    isFolder: boolean;
    names: string[];
    byPlace: Map<number, string> | null;
}

function namesByPlace(names: readonly string[]): Map<number, string> | null {
    const places = names.map(pageIndexOfFile);
    if (places.some((place) => {
        return place === null;
    })) {
        return null;
    }
    return new Map(names.map((name, position) => {
        return [places[position] as number, name];
    }));
}

export class LocalPages {
    private readonly listings = new Map<string, Listing>();

    private async listing(path: string): Promise<Listing> {
        const stats = await stat(path);
        const cached = this.listings.get(path);
        if (cached !== undefined && cached.modified === stats.mtimeMs) {
            this.listings.delete(path);
            this.listings.set(path, cached);
            return cached;
        }
        const isFolder = stats.isDirectory();
        const names = isFolder ? await folderNames(path) : await cbzNames(path);
        const listing: Listing = { modified: stats.mtimeMs, isFolder, names, byPlace: namesByPlace(names) };
        this.listings.set(path, listing);
        if (this.listings.size > CACHED_CHAPTERS) {
            this.listings.delete(this.listings.keys().next().value as string);
        }
        return listing;
    }

    async count(path: string): Promise<number> {
        return (await this.listing(path)).names.length;
    }

    async missing(path: string, pageCount: number): Promise<number[]> {
        return missingPageIndexes((await this.listing(path)).names, pageCount);
    }

    async read(path: string, index: number): Promise<Buffer> {
        const listing = await this.listing(path);
        const name = listing.byPlace === null ? listing.names[index] : listing.byPlace.get(index);
        if (!Number.isInteger(index) || name === undefined) {
            throw new LocalPagesError('There is no such page');
        }
        if (listing.isFolder) {
            return readFile(join(path, name));
        }
        return readCbzEntry(path, name);
    }
}
