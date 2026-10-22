import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MangaChapter, MangaDetails, MangaError, MangaErrorCode, MangaOutputFormat } from '@shared/manga';
import { writeCbz as defaultWriteCbz, type CbzEntry } from './cbzWriter';
import { buildComicInfo } from './comicInfo';
import { detectImageType, resolveImageType } from './imageType';
import { ImageFetchError, type ImageFetcher } from './mangaImages';
import { extractCbzPages as defaultExtractCbzPages } from './cbzExtractor';
import { chapterWorkDirectory, COMIC_INFO_FILE, formatOfPath, isCompletePage, missingPageIndexes, pageFileName, TEMPORARY_EXTENSION } from './mangaFiles';

// How many times a page is asked for again after it fails, and how long to wait before each.
export const PAGE_RETRY_DELAYS_MS: readonly number[] = [500, 1500];
// How many pages in a row may fail because the server or the connection does not answer before the chapter gives up (a server that is
// down would otherwise make every page of a long chapter wait for its retries). A page the app refuses, or that is not an image, fails
// at once and does not count.
export const MAX_CONSECUTIVE_SERVER_FAILURES = 5;

export type ChapterRunResult<T> = { status: 'done'; value: T } | { status: 'error'; error: MangaError } | { status: 'cancelled' };

export interface ChapterDownloadResult {
    filePath: string;
    sizeBytes: number;
    pageCount: number;
    // The places (from 0) of the pages the source would not give: the chapter was made without them.
    missingPages: number[];
}

export interface ChapterDownloadOptions {
    // The chapter on the server.
    chapterRemoteId: number;
    seriesTitle: string;
    chapter: Pick<MangaChapter, 'name' | 'number' | 'scanlator'>;
    details: Pick<MangaDetails, 'author' | 'artist' | 'description' | 'genres'> | null;
    format: MangaOutputFormat;
    // Where the finished chapter goes (a .cbz file or a folder); nothing is there yet.
    outputPath: string;
    // The number of pages is known.
    onPageCount: (pageCount: number) => void;
    onProgress: (pagesDone: number, pageCount: number) => void;
}

// What identifies a chapter in its ComicInfo.
type ChapterIdentity = Pick<ChapterDownloadOptions, 'seriesTitle' | 'chapter' | 'details'>;

export interface ChapterRepairOptions extends ChapterIdentity {
    chapterRemoteId: number;
    // The file (a .cbz) or the folder the chapter was made at.
    filePath: string;
    // How many pages the chapter has.
    pageCount: number;
    // The place (from 0) of the only page to download again; null for every page the chapter lacks.
    pageIndex: number | null;
}

export interface ChapterDownloadHandle {
    result: Promise<ChapterRunResult<ChapterDownloadResult>>;
    cancel: () => void;
}

export interface ChapterDownloaderDependencies {
    // The addresses of the pages of a chapter, in reading order.
    pages: (chapterRemoteId: number) => Promise<string[]>;
    fetchImage: ImageFetcher;
    writeCbz?: typeof defaultWriteCbz;
    extractCbzPages?: typeof defaultExtractCbzPages;
    sleep?: (milliseconds: number) => Promise<void>;
}

class ChapterFailure extends Error {
    constructor(
        readonly code: MangaErrorCode,
        message: string,
        // A failure that asking again will not fix.
        readonly final = false
    ) {
        super(message);
    }
}

function defaultSleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

// Whether a failure says the server or the connection is not answering (asking for the next page is likely to fail too).
function isServerFailure(failure: ChapterFailure): boolean {
    return failure.code === 'SERVER_UNAVAILABLE' || failure.code === 'REQUEST_FAILED';
}

// Counts the pages that failed one after the other because of the server; a page that arrives starts the count again.
class FailureStreak {
    private count = 0;

    // Gives the failure when it is the one that makes the chapter give up.
    add(failure: ChapterFailure | null): ChapterFailure | null {
        this.count = failure !== null && isServerFailure(failure) ? this.count + 1 : 0;
        return failure !== null && this.count >= MAX_CONSECUTIVE_SERVER_FAILURES ? failure : null;
    }
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isAbort(error: unknown): boolean {
    // A timeout (`TimeoutError`) is a failure of the site, not a cancellation.
    return error instanceof Error && error.name === 'AbortError';
}

function isDiskError(error: unknown): boolean {
    const code = (error as { code?: unknown } | null)?.code;
    return code === 'ENOSPC' || code === 'EACCES' || code === 'EPERM' || code === 'EROFS' || code === 'EDQUOT' || code === 'ENAMETOOLONG';
}

function toError(error: unknown): MangaError {
    if (error instanceof ChapterFailure) {
        return { code: error.code, message: error.message };
    }
    if (isDiskError(error)) {
        return { code: 'DISK', message: messageOf(error) };
    }
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 'SERVER_UNAVAILABLE' || code === 'REQUEST_FAILED' || code === 'API_ERROR' || code === 'INVALID_RESPONSE') {
        return { code, message: messageOf(error) };
    }
    return { code: 'UNKNOWN', message: messageOf(error) };
}

// The file of a page that is already there complete (the name without the extension, which is only known once it is downloaded).
function existingPage(workDirectory: string, name: string): string | null {
    const found = readdirSync(workDirectory).find((file) => {
        return file.startsWith(`${name}.`) && !file.endsWith(TEMPORARY_EXTENSION);
    });
    return found ?? null;
}

// Downloads the pages of a chapter one at a time into a folder beside the final place (a page that is there already is not asked
// for again, so a chapter that was paused, or that failed, goes on from where it was), then makes the CBZ or the folder in a
// single step: a chapter is never half there.
export class MangaChapterDownloader {
    constructor(private readonly deps: ChapterDownloaderDependencies) {}

    download(options: ChapterDownloadOptions): ChapterDownloadHandle {
        const controller = new AbortController();
        const result = this.run(options, controller.signal);
        return {
            result,
            cancel: () => {
                controller.abort();
            }
        };
    }

    private async run(options: ChapterDownloadOptions, signal: AbortSignal): Promise<ChapterRunResult<ChapterDownloadResult>> {
        try {
            return { status: 'done', value: await this.downloadChapter(options, signal) };
        } catch (error) {
            if (signal.aborted || isAbort(error)) {
                return { status: 'cancelled' };
            }
            return { status: 'error', error: toError(error) };
        }
    }

    private async downloadChapter(options: ChapterDownloadOptions, signal: AbortSignal): Promise<ChapterDownloadResult> {
        const addresses = await this.deps.pages(options.chapterRemoteId);
        if (addresses.length === 0) {
            throw new ChapterFailure('EMPTY_CHAPTER', 'The chapter has no pages', true);
        }
        options.onPageCount(addresses.length);
        const workDirectory = chapterWorkDirectory(options.outputPath);
        mkdirSync(workDirectory, { recursive: true });
        const missingPages: number[] = [];
        let lastFailure: ChapterFailure | null = null;
        const streak = new FailureStreak();
        let done = 0;
        for (const [index, address] of addresses.entries()) {
            signal.throwIfAborted();
            const name = pageFileName(index, addresses.length);
            if (existingPage(workDirectory, name) === null) {
                const failure = await this.tryPage(address, join(workDirectory, name), signal);
                if (failure !== null) {
                    missingPages.push(index);
                    lastFailure = failure;
                }
                const giveUp = streak.add(failure);
                if (giveUp !== null) {
                    throw giveUp;
                }
            }
            done += 1;
            options.onProgress(done, addresses.length);
        }
        signal.throwIfAborted();
        // A chapter with no page at all is a failure of the source or of the connection, not a chapter that lacks some pages.
        if (lastFailure !== null && missingPages.length === addresses.length) {
            throw lastFailure;
        }
        return this.finish(options, workDirectory, addresses.length, missingPages);
    }

    // Downloads again the pages a chapter that was made without some lacks, into its file (or folder). Pages that fail again stay
    // missing; when none of the ones asked for could be downloaded, it is a failure.
    async repair(options: ChapterRepairOptions, signal: AbortSignal = new AbortController().signal): Promise<ChapterRunResult<ChapterDownloadResult>> {
        try {
            return { status: 'done', value: await this.repairChapter(options, signal) };
        } catch (error) {
            if (signal.aborted || isAbort(error)) {
                return { status: 'cancelled' };
            }
            return { status: 'error', error: toError(error) };
        }
    }

    private async repairChapter(options: ChapterRepairOptions, signal: AbortSignal): Promise<ChapterDownloadResult> {
        const addresses = await this.deps.pages(options.chapterRemoteId);
        if (addresses.length !== options.pageCount) {
            throw new ChapterFailure('INVALID_RESPONSE', 'The source has another number of pages now', true);
        }
        const isArchive = formatOfPath(options.filePath) === 'cbz';
        // A CBZ is opened into a folder beside it, and made again once the pages are there; a folder of images is worked in place.
        const directory = isArchive ? chapterWorkDirectory(options.filePath) : options.filePath;
        if (isArchive) {
            rmSync(directory, { recursive: true, force: true });
            mkdirSync(directory, { recursive: true });
        }
        try {
            if (isArchive) {
                await (this.deps.extractCbzPages ?? defaultExtractCbzPages)(options.filePath, directory);
            }
            const lacking = missingPageIndexes(readdirSync(directory).filter(isCompletePage), addresses.length);
            const wanted = options.pageIndex === null ? lacking : lacking.filter((index) => {
                return index === options.pageIndex;
            });
            const failures: ChapterFailure[] = [];
            const streak = new FailureStreak();
            for (const index of wanted) {
                signal.throwIfAborted();
                const failure = await this.tryPage(addresses[index] ?? '', join(directory, pageFileName(index, addresses.length)), signal);
                if (failure !== null) {
                    failures.push(failure);
                }
                const giveUp = streak.add(failure);
                if (giveUp !== null) {
                    throw giveUp;
                }
            }
            signal.throwIfAborted();
            if (failures.length > 0 && failures.length === wanted.length) {
                throw failures[failures.length - 1];
            }
            return isArchive ? await this.finishCbz(options, options.filePath, directory, addresses.length) : this.finishFolderInPlace(options, directory, addresses.length);
        } finally {
            if (isArchive) {
                rmSync(directory, { recursive: true, force: true });
            }
        }
    }

    // One page that is asked for with its retries: the failure when the site would not give it (the chapter goes on without it), nothing
    // when it is there. A cancellation or a full disk is not a failure of the page and goes up.
    private async tryPage(address: string, basePath: string, signal: AbortSignal): Promise<ChapterFailure | null> {
        try {
            await this.downloadPage(address, basePath, signal);
            return null;
        } catch (error) {
            if (error instanceof ChapterFailure) {
                return error;
            }
            throw error;
        }
    }

    // One page, asked for again a couple of times when the site fails; written under a temporary name and only given its final name
    // (and extension) once it is whole.
    private async downloadPage(address: string, basePath: string, signal: AbortSignal): Promise<void> {
        const sleep = this.deps.sleep ?? defaultSleep;
        let lastFailure: ChapterFailure | null = null;
        for (let attempt = 0; attempt <= PAGE_RETRY_DELAYS_MS.length; attempt += 1) {
            if (attempt > 0) {
                await sleep(PAGE_RETRY_DELAYS_MS[attempt - 1] ?? 0);
            }
            signal.throwIfAborted();
            try {
                await this.fetchPage(address, basePath, signal);
                return;
            } catch (error) {
                if (signal.aborted || isAbort(error) || isDiskError(error)) {
                    throw error;
                }
                lastFailure = error instanceof ChapterFailure ? error : this.failureOf(error);
                if (lastFailure.final) {
                    throw lastFailure;
                }
            }
        }
        throw lastFailure ?? new ChapterFailure('UNKNOWN', 'The page could not be downloaded');
    }

    private failureOf(error: unknown): ChapterFailure {
        if (error instanceof ImageFetchError) {
            return new ChapterFailure('IMAGE', error.message, true);
        }
        const code = (error as { code?: unknown } | null)?.code;
        return new ChapterFailure(code === 'SERVER_UNAVAILABLE' ? 'SERVER_UNAVAILABLE' : 'REQUEST_FAILED', messageOf(error));
    }

    private async fetchPage(address: string, basePath: string, signal: AbortSignal): Promise<void> {
        const image = await this.deps.fetchImage(address, signal);
        if (image.status !== 200) {
            throw new ChapterFailure('REQUEST_FAILED', `The server answered ${image.status} for a page`);
        }
        if (image.bytes.byteLength === 0) {
            throw new ChapterFailure('IMAGE', 'A page came back empty');
        }
        const looksLikeImage = detectImageType(image.bytes) !== null || (image.contentType?.toLowerCase().startsWith('image/') ?? false);
        if (!looksLikeImage) {
            throw new ChapterFailure('IMAGE', 'A page is not an image');
        }
        const type = resolveImageType(image.bytes, image.contentType);
        const temporaryPath = `${basePath}${TEMPORARY_EXTENSION}`;
        writeFileSync(temporaryPath, image.bytes);
        renameSync(temporaryPath, `${basePath}.${type.extension}`);
    }

    private async finish(options: ChapterDownloadOptions, workDirectory: string, pageCount: number, missingPages: number[]): Promise<ChapterDownloadResult> {
        if (options.format === 'cbz') {
            const result = await this.finishCbz(options, options.outputPath, workDirectory, pageCount);
            rmSync(workDirectory, { recursive: true, force: true });
            return result;
        }
        writeFileSync(join(workDirectory, COMIC_INFO_FILE), this.comicInfoOf(options, workDirectory, pageCount), 'utf-8');
        if (existsSync(options.outputPath)) {
            throw new ChapterFailure('DISK', 'The place for the chapter is taken', true);
        }
        renameSync(workDirectory, options.outputPath);
        return { filePath: options.outputPath, sizeBytes: folderSize(options.outputPath), pageCount, missingPages };
    }

    // Makes the CBZ of the pages in the folder (in the place of the one there, when there is one).
    private async finishCbz(identity: ChapterIdentity, outputPath: string, directory: string, pageCount: number): Promise<ChapterDownloadResult> {
        const pages = readdirSync(directory).filter(isCompletePage).sort();
        const entries: CbzEntry[] = pages.map((file) => {
            return { name: file, path: join(directory, file) };
        });
        const comicInfo = this.comicInfoOf(identity, directory, pageCount);
        await (this.deps.writeCbz ?? defaultWriteCbz)(outputPath, entries, [{ name: COMIC_INFO_FILE, content: comicInfo }]);
        return { filePath: outputPath, sizeBytes: statSync(outputPath).size, pageCount, missingPages: missingPageIndexes(pages, pageCount) };
    }

    // A folder of images that got pages back: its ComicInfo is written again.
    private finishFolderInPlace(identity: ChapterIdentity, directory: string, pageCount: number): ChapterDownloadResult {
        writeFileSync(join(directory, COMIC_INFO_FILE), this.comicInfoOf(identity, directory, pageCount), 'utf-8');
        const pages = readdirSync(directory).filter(isCompletePage);
        return { filePath: directory, sizeBytes: folderSize(directory), pageCount, missingPages: missingPageIndexes(pages, pageCount) };
    }

    private comicInfoOf(identity: ChapterIdentity, directory: string, pageCount: number): string {
        const present = readdirSync(directory).filter(isCompletePage).length;
        return buildComicInfo({ seriesTitle: identity.seriesTitle, chapter: identity.chapter, details: identity.details, pageCount: Math.min(present, pageCount) });
    }
}

function folderSize(directory: string): number {
    return readdirSync(directory).reduce((total, file) => {
        return total + statSync(join(directory, file)).size;
    }, 0);
}
