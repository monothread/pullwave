import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import yauzl from 'yauzl';
import type { MangaStatus } from '@shared/manga';
import { parseComicInfo, type ParsedComicInfo } from './comicInfo';
import { isImageName, MAX_LOCAL_PAGES } from './localPages';
import { CBZ_EXTENSION, COMIC_INFO_FILE } from './mangaFiles';
import { MANGA_METADATA_FILE, MAX_METADATA_BYTES, readMangaMetadata, type MangaChapterMetadata, type MangaMetadata } from './mangaMetadata';

export const MAX_MANGA_SCAN_DEPTH = 2;
const CHAPTER_NAME_NUMBER = /^Chapter\s+(\d+(?:\.\d+)?)(?:\s+\(\d+\))?$/i;
const MAX_COMIC_INFO_BYTES = 1024 * 1024;
const MAX_ZIP_ENTRIES = MAX_LOCAL_PAGES * 2;
const WORK_DIRECTORY_SUFFIX = '.part';

function pathFor(platform: NodeJS.Platform): typeof posix {
    return platform === 'win32' ? win32 : posix;
}

export interface MangaScanEntry {
    name: string;
    directory: boolean;
}

export interface CbzInspection {
    pageCount: number;
    comicInfoXml: string | null;
}

export interface MangaScanFileSystem {
    entries: (directory: string) => MangaScanEntry[];
    read: (path: string) => string | null;
    inspectCbz: (filePath: string) => Promise<CbzInspection | null>;
}

function inspectRealCbz(filePath: string): Promise<CbzInspection | null> {
    return new Promise((resolve) => {
        yauzl.open(filePath, { lazyEntries: true, autoClose: false }, (error, zip) => {
            if (error !== null || zip === undefined) {
                resolve(null);
                return;
            }
            let pageCount = 0;
            let entriesSeen = 0;
            let comicInfoXml: string | null = null;
            let finished = false;
            const finish = (result: CbzInspection | null): void => {
                if (finished) {
                    return;
                }
                finished = true;
                try {
                    zip.close();
                } catch {
                    resolve(result);
                    return;
                }
                resolve(result);
            };
            const nextEntry = (): void => {
                if (entriesSeen >= MAX_ZIP_ENTRIES) {
                    finish({ pageCount, comicInfoXml });
                    return;
                }
                zip.readEntry();
            };
            zip.on('entry', (entry: yauzl.Entry) => {
                entriesSeen += 1;
                if (entry.fileName === COMIC_INFO_FILE && comicInfoXml === null && entry.uncompressedSize <= MAX_COMIC_INFO_BYTES) {
                    zip.openReadStream(entry, (streamError, stream) => {
                        if (streamError !== null || stream === undefined) {
                            nextEntry();
                            return;
                        }
                        const chunks: Buffer[] = [];
                        stream.on('data', (chunk: Buffer) => {
                            chunks.push(chunk);
                        });
                        stream.once('error', () => {
                            stream.destroy();
                            nextEntry();
                        });
                        stream.once('end', () => {
                            comicInfoXml = Buffer.concat(chunks).toString('utf-8');
                            nextEntry();
                        });
                    });
                    return;
                }
                if (isImageName(entry.fileName) && entry.fileName !== COMIC_INFO_FILE && pageCount < MAX_LOCAL_PAGES) {
                    pageCount += 1;
                }
                nextEntry();
            });
            zip.once('end', () => {
                finish({ pageCount, comicInfoXml });
            });
            zip.once('error', () => {
                finish(null);
            });
            zip.readEntry();
        });
    });
}

export const defaultMangaScanFileSystem: MangaScanFileSystem = {
    entries: (directory) => {
        try {
            return readdirSync(directory, { withFileTypes: true })
                .filter((entry) => {
                    return !entry.isSymbolicLink() && (entry.isDirectory() || entry.isFile());
                })
                .map((entry) => {
                    return { name: entry.name, directory: entry.isDirectory() };
                });
        } catch {
            return [];
        }
    },
    read: (path) => {
        try {
            const stats = lstatSync(path);
            if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_METADATA_BYTES) {
                return null;
            }
            return readFileSync(path, 'utf-8');
        } catch {
            return null;
        }
    },
    inspectCbz: inspectRealCbz
};

export interface ScannedMangaChapter {
    filePath: string;
    remoteId: number | null;
    name: string;
    number: number | null;
    dateUploaded: number | null;
    scanlator: string | null;
    sourceOrder: number;
    pageCount: number;
    incomplete: boolean;
}

export interface ScannedManga {
    folder: string;
    sourceId: string | null;
    remoteId: number | null;
    title: string;
    thumbnailUrl: string | null;
    url: string | null;
    author: string | null;
    artist: string | null;
    description: string | null;
    genres: string[];
    status: MangaStatus;
    series: string | null;
    season: number | null;
    seasonName: string | null;
    chapters: ScannedMangaChapter[];
}

export interface MangaScanResult {
    mangas: ScannedManga[];
    ignored: number;
}

function chapterNumberFromName(name: string): number | null {
    const match = CHAPTER_NAME_NUMBER.exec(name.trim());
    if (match === null || match[1] === undefined) {
        return null;
    }
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : null;
}

function stripExtension(name: string, platform: NodeJS.Platform): string {
    const extension = pathFor(platform).extname(name);
    return extension.length > 0 ? name.slice(0, -extension.length) : name;
}

function isChapterDirectory(entries: readonly MangaScanEntry[]): boolean {
    return entries.some((entry) => {
        return !entry.directory && (entry.name === COMIC_INFO_FILE || isImageName(entry.name));
    });
}

function countImageEntries(entries: readonly MangaScanEntry[]): number {
    return entries.filter((entry) => {
        return !entry.directory && isImageName(entry.name);
    }).length;
}

function chapterFromMetadata(filePath: string, meta: MangaChapterMetadata): ScannedMangaChapter {
    return {
        filePath,
        remoteId: meta.remoteId,
        name: meta.name,
        number: meta.number,
        dateUploaded: meta.dateUploaded,
        scanlator: meta.scanlator,
        sourceOrder: meta.sourceOrder,
        pageCount: meta.pageCount,
        incomplete: meta.incomplete
    };
}

function chapterFromFallback(filePath: string, stem: string, info: ParsedComicInfo | null, pageCount: number, order: number): ScannedMangaChapter {
    const number = info?.number ?? chapterNumberFromName(stem);
    const name = info?.title ?? stem;
    return {
        filePath,
        remoteId: null,
        name,
        number,
        dateUploaded: null,
        scanlator: info?.scanlator ?? null,
        sourceOrder: order,
        pageCount: info?.pageCount !== null && info?.pageCount !== undefined && info.pageCount > 0 ? info.pageCount : pageCount,
        incomplete: false
    };
}

function chapterLookup(metadata: MangaMetadata | null, platform: NodeJS.Platform): Map<string, MangaChapterMetadata> {
    const map = new Map<string, MangaChapterMetadata>();
    if (metadata === null) {
        return map;
    }
    metadata.chapters.forEach((chapter) => {
        const key = platform === 'win32' ? chapter.fileName.toLowerCase() : chapter.fileName;
        map.set(key, chapter);
    });
    return map;
}

function lookupChapter(map: ReadonlyMap<string, MangaChapterMetadata>, fileName: string, platform: NodeJS.Platform): MangaChapterMetadata | undefined {
    return map.get(platform === 'win32' ? fileName.toLowerCase() : fileName);
}

export async function scanMangaLibraryFolder(
    root: string,
    files: MangaScanFileSystem = defaultMangaScanFileSystem,
    platform: NodeJS.Platform = process.platform
): Promise<MangaScanResult> {
    const path = pathFor(platform);
    const mangas: ScannedManga[] = [];
    let ignored = 0;

    const scanDirectory = async (directory: string, depth: number, preloadedEntries?: MangaScanEntry[]): Promise<void> => {
        const entries = [...(preloadedEntries ?? files.entries(directory))].sort((first, second) => {
            return first.name.localeCompare(second.name, undefined, { numeric: true, sensitivity: 'base' });
        });
        const metadata = readMangaMetadata(directory, files, platform);
        const byFileName = chapterLookup(metadata, platform);
        const chapters: ScannedMangaChapter[] = [];
        let firstComicInfo: ParsedComicInfo | null = null;
        const subdirectories: Array<{ directory: string; entries: MangaScanEntry[] }> = [];

        for (const entry of entries) {
            if (entry.name === MANGA_METADATA_FILE || entry.name === COMIC_INFO_FILE || entry.name.endsWith(WORK_DIRECTORY_SUFFIX)) {
                continue;
            }
            const fullPath = path.join(directory, entry.name);
            if (!entry.directory) {
                if (path.extname(entry.name).toLowerCase() !== CBZ_EXTENSION) {
                    continue;
                }
                const inspection = await files.inspectCbz(fullPath);
                if (inspection === null || inspection.pageCount === 0) {
                    ignored += 1;
                    continue;
                }
                const matched = lookupChapter(byFileName, entry.name, platform);
                if (matched !== undefined) {
                    chapters.push(chapterFromMetadata(fullPath, matched));
                    continue;
                }
                const info = inspection.comicInfoXml === null ? null : parseComicInfo(inspection.comicInfoXml);
                if (firstComicInfo === null && info !== null) {
                    firstComicInfo = info;
                }
                chapters.push(chapterFromFallback(fullPath, stripExtension(entry.name, platform), info, inspection.pageCount, chapters.length + 1));
                continue;
            }

            const childEntries = files.entries(fullPath);
            if (isChapterDirectory(childEntries)) {
                const pageCount = countImageEntries(childEntries);
                if (pageCount === 0) {
                    ignored += 1;
                    continue;
                }
                const matched = lookupChapter(byFileName, entry.name, platform);
                if (matched !== undefined) {
                    chapters.push(chapterFromMetadata(fullPath, matched));
                    continue;
                }
                const xml = files.read(path.join(fullPath, COMIC_INFO_FILE));
                const info = xml === null ? null : parseComicInfo(xml);
                if (firstComicInfo === null && info !== null) {
                    firstComicInfo = info;
                }
                chapters.push(chapterFromFallback(fullPath, entry.name, info, pageCount, chapters.length + 1));
                continue;
            }

            if (depth < MAX_MANGA_SCAN_DEPTH) {
                subdirectories.push({ directory: fullPath, entries: childEntries });
            }
        }

        if (chapters.length > 0) {
            const fallbackTitle = firstComicInfo?.series ?? path.basename(directory);
            const title = metadata?.title ?? fallbackTitle;
            if (title.trim().length > 0) {
                mangas.push({
                    folder: directory,
                    sourceId: metadata?.sourceId ?? null,
                    remoteId: metadata?.remoteId ?? null,
                    title: title.trim(),
                    thumbnailUrl: metadata?.thumbnailUrl ?? null,
                    url: metadata?.url ?? null,
                    author: metadata?.author ?? firstComicInfo?.author ?? null,
                    artist: metadata?.artist ?? firstComicInfo?.artist ?? null,
                    description: metadata?.description ?? firstComicInfo?.description ?? null,
                    genres: metadata !== null ? metadata.genres : (firstComicInfo?.genres ?? []),
                    status: metadata?.status ?? 'unknown',
                    series: metadata?.series ?? null,
                    season: metadata?.season ?? null,
                    seasonName: metadata?.seasonName ?? null,
                    chapters
                });
            }
        }

        for (const subdirectory of subdirectories) {
            await scanDirectory(subdirectory.directory, depth + 1, subdirectory.entries);
        }
    };

    await scanDirectory(root, 0);
    return { mangas, ignored };
}
