import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ErrorDetails } from '@shared/errorDetails';
import type { MangaChapter, MangaDetails, MangaError, MangaErrorCode, MangaOutputFormat } from '@shared/manga';
import { describeError } from '../errorDetails';
import { writeCbz as defaultWriteCbz, type CbzEntry } from './cbzWriter';
import { buildComicInfo } from './comicInfo';
import { detectImageType, resolveImageType } from './imageType';
import { ImageFetchError, type ImageFetcher } from './mangaImages';
import { SuwayomiApiError } from './suwayomiClient';
import { extractCbzPages as defaultExtractCbzPages } from './cbzExtractor';
import { chapterWorkDirectory, COMIC_INFO_FILE, formatOfPath, isCompletePage, missingPageIndexes, pageFileName, TEMPORARY_EXTENSION } from './mangaFiles';

export const PAGE_RETRY_DELAYS_MS: readonly number[] = [500, 1500];
export const MAX_CONSECUTIVE_SERVER_FAILURES = 5;

export type ChapterRunResult<T> = { status: 'done'; value: T } | { status: 'error'; error: MangaError } | { status: 'cancelled' };

export interface ChapterDownloadResult {
    filePath: string;
    sizeBytes: number;
    pageCount: number;
    missingPages: number[];
}

export interface ChapterDownloadOptions {
    chapterRemoteId: number;
    seriesTitle: string;
    chapter: Pick<MangaChapter, 'name' | 'number' | 'scanlator'>;
    details: Pick<MangaDetails, 'author' | 'artist' | 'description' | 'genres'> | null;
    format: MangaOutputFormat;
    outputPath: string;
    onPageCount: (pageCount: number) => void;
    onPageFetched: (bytes: number) => void;
    onProgress: (pagesDone: number, pageCount: number) => void;
}

interface PageAttempt {
    failure: ChapterFailure | null;
    bytes: number;
}

type ChapterIdentity = Pick<ChapterDownloadOptions, 'seriesTitle' | 'chapter' | 'details'>;

export interface ChapterRepairOptions extends ChapterIdentity {
    chapterRemoteId: number;
    filePath: string;
    pageCount: number;
    pageIndex: number | null;
}

export interface ChapterDownloadHandle {
    result: Promise<ChapterRunResult<ChapterDownloadResult>>;
    cancel: () => void;
}

export interface ChapterDownloaderDependencies {
    pages: (chapterRemoteId: number) => Promise<string[]>;
    fetchImage: ImageFetcher;
    writeCbz?: typeof defaultWriteCbz;
    extractCbzPages?: typeof defaultExtractCbzPages;
    sleep?: (milliseconds: number) => Promise<void>;
}

const DOWNLOAD_OPERATION = 'Downloading a chapter';
const PAGE_OPERATION = 'Downloading a page of the chapter';

class ChapterFailure extends Error {
    constructor(
        readonly code: MangaErrorCode,
        message: string,
        readonly final = false,
        readonly known: Partial<ErrorDetails> = {}
    ) {
        super(message);
    }
}

function defaultSleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

function isServerFailure(failure: ChapterFailure): boolean {
    return failure.code === 'SERVER_UNAVAILABLE' || failure.code === 'REQUEST_FAILED';
}

class FailureStreak {
    private count = 0;

    add(failure: ChapterFailure | null): ChapterFailure | null {
        this.count = failure !== null && isServerFailure(failure) ? this.count + 1 : 0;
        return failure !== null && this.count >= MAX_CONSECUTIVE_SERVER_FAILURES ? failure : null;
    }
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isAbort(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

function isDiskError(error: unknown): boolean {
    const code = (error as { code?: unknown } | null)?.code;
    return code === 'ENOSPC' || code === 'EACCES' || code === 'EPERM' || code === 'EROFS' || code === 'EDQUOT' || code === 'ENAMETOOLONG';
}

function toError(error: unknown): MangaError {
    if (error instanceof ChapterFailure) {
        return { code: error.code, message: error.message, details: describeError(error, { operation: DOWNLOAD_OPERATION, ...error.known }) };
    }
    const known = { operation: DOWNLOAD_OPERATION };
    if (isDiskError(error)) {
        return { code: 'DISK', message: messageOf(error), details: describeError(error, known) };
    }
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 'SERVER_UNAVAILABLE' || code === 'REQUEST_FAILED' || code === 'API_ERROR' || code === 'INVALID_RESPONSE') {
        const apiKnown = error instanceof SuwayomiApiError ? { ...known, ...error.known } : known;
        return { code, message: messageOf(error), details: describeError(error, apiKnown) };
    }
    return { code: 'UNKNOWN', message: messageOf(error), details: describeError(error, known) };
}

async function existingPageNames(workDirectory: string): Promise<Set<string>> {
    const files = await readdir(workDirectory);
    return new Set(files.flatMap((file) => {
        const dot = file.indexOf('.');
        return dot > 0 && !file.endsWith(TEMPORARY_EXTENSION) ? [file.slice(0, dot)] : [];
    }));
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

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
        await mkdir(workDirectory, { recursive: true });
        const existing = await existingPageNames(workDirectory);
        const missingPages: number[] = [];
        let lastFailure: ChapterFailure | null = null;
        const streak = new FailureStreak();
        let done = 0;
        for (const [index, address] of addresses.entries()) {
            signal.throwIfAborted();
            const name = pageFileName(index, addresses.length);
            if (!existing.has(name)) {
                const { failure, bytes } = await this.tryPage(address, join(workDirectory, name), signal);
                options.onPageFetched(bytes);
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
        if (lastFailure !== null && missingPages.length === addresses.length) {
            throw lastFailure;
        }
        return this.finish(options, workDirectory, addresses.length, missingPages);
    }

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
        const directory = isArchive ? chapterWorkDirectory(options.filePath) : options.filePath;
        if (isArchive) {
            await rm(directory, { recursive: true, force: true });
            await mkdir(directory, { recursive: true });
        }
        try {
            if (isArchive) {
                await (this.deps.extractCbzPages ?? defaultExtractCbzPages)(options.filePath, directory);
            }
            const lacking = missingPageIndexes((await readdir(directory)).filter(isCompletePage), addresses.length);
            const wanted = options.pageIndex === null ? lacking : lacking.filter((index) => {
                return index === options.pageIndex;
            });
            const failures: ChapterFailure[] = [];
            const streak = new FailureStreak();
            for (const index of wanted) {
                signal.throwIfAborted();
                const { failure } = await this.tryPage(addresses[index] ?? '', join(directory, pageFileName(index, addresses.length)), signal);
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
            return isArchive ? await this.finishCbz(options, options.filePath, directory, addresses.length) : await this.finishFolderInPlace(options, directory, addresses.length);
        } finally {
            if (isArchive) {
                await rm(directory, { recursive: true, force: true });
            }
        }
    }

    private async tryPage(address: string, basePath: string, signal: AbortSignal): Promise<PageAttempt> {
        try {
            return { failure: null, bytes: await this.downloadPage(address, basePath, signal) };
        } catch (error) {
            if (error instanceof ChapterFailure) {
                return { failure: error, bytes: 0 };
            }
            throw error;
        }
    }

    private async downloadPage(address: string, basePath: string, signal: AbortSignal): Promise<number> {
        const sleep = this.deps.sleep ?? defaultSleep;
        let lastFailure: ChapterFailure | null = null;
        for (let attempt = 0; attempt <= PAGE_RETRY_DELAYS_MS.length; attempt += 1) {
            if (attempt > 0) {
                await sleep(PAGE_RETRY_DELAYS_MS[attempt - 1] ?? 0);
            }
            signal.throwIfAborted();
            try {
                return await this.fetchPage(address, basePath, signal);
            } catch (error) {
                if (signal.aborted || isAbort(error) || isDiskError(error)) {
                    throw error;
                }
                lastFailure = error instanceof ChapterFailure ? error : this.failureOf(error, address);
                if (lastFailure.final) {
                    throw lastFailure;
                }
            }
        }
        throw lastFailure ?? new ChapterFailure('UNKNOWN', 'The page could not be downloaded');
    }

    private failureOf(error: unknown, address: string): ChapterFailure {
        const known = { ...describeError(error), operation: PAGE_OPERATION, url: address };
        if (error instanceof ImageFetchError) {
            return new ChapterFailure('IMAGE', error.message, true, known);
        }
        const code = (error as { code?: unknown } | null)?.code;
        return new ChapterFailure(code === 'SERVER_UNAVAILABLE' ? 'SERVER_UNAVAILABLE' : 'REQUEST_FAILED', messageOf(error), false, known);
    }

    private async fetchPage(address: string, basePath: string, signal: AbortSignal): Promise<number> {
        const image = await this.deps.fetchImage(address, signal);
        const pageKnown: Partial<ErrorDetails> = { operation: PAGE_OPERATION, url: address };
        if (image.status !== 200) {
            throw new ChapterFailure('REQUEST_FAILED', `The server answered ${image.status} for a page`, false, { ...pageKnown, httpStatus: image.status });
        }
        if (image.bytes.byteLength === 0) {
            throw new ChapterFailure('IMAGE', 'A page came back empty', false, { ...pageKnown, httpStatus: image.status });
        }
        const looksLikeImage = detectImageType(image.bytes) !== null || (image.contentType?.toLowerCase().startsWith('image/') ?? false);
        if (!looksLikeImage) {
            throw new ChapterFailure('IMAGE', 'A page is not an image', false, { ...pageKnown, httpStatus: image.status });
        }
        const type = resolveImageType(image.bytes, image.contentType);
        const temporaryPath = `${basePath}${TEMPORARY_EXTENSION}`;
        await writeFile(temporaryPath, image.bytes);
        await rename(temporaryPath, `${basePath}.${type.extension}`);
        return image.bytes.byteLength;
    }

    private async finish(options: ChapterDownloadOptions, workDirectory: string, pageCount: number, missingPages: number[]): Promise<ChapterDownloadResult> {
        if (options.format === 'cbz') {
            const result = await this.finishCbz(options, options.outputPath, workDirectory, pageCount);
            await rm(workDirectory, { recursive: true, force: true });
            return result;
        }
        const present = (await readdir(workDirectory)).filter(isCompletePage).length;
        await writeFile(join(workDirectory, COMIC_INFO_FILE), this.comicInfoOf(options, present, pageCount), 'utf-8');
        if (await pathExists(options.outputPath)) {
            throw new ChapterFailure('DISK', 'The place for the chapter is taken', true);
        }
        await rename(workDirectory, options.outputPath);
        return { filePath: options.outputPath, sizeBytes: await folderSize(options.outputPath), pageCount, missingPages };
    }

    private async finishCbz(identity: ChapterIdentity, outputPath: string, directory: string, pageCount: number): Promise<ChapterDownloadResult> {
        const pages = (await readdir(directory)).filter(isCompletePage).sort();
        const entries: CbzEntry[] = pages.map((file) => {
            return { name: file, path: join(directory, file) };
        });
        const comicInfo = this.comicInfoOf(identity, pages.length, pageCount);
        await (this.deps.writeCbz ?? defaultWriteCbz)(outputPath, entries, [{ name: COMIC_INFO_FILE, content: comicInfo }]);
        return { filePath: outputPath, sizeBytes: (await stat(outputPath)).size, pageCount, missingPages: missingPageIndexes(pages, pageCount) };
    }

    private async finishFolderInPlace(identity: ChapterIdentity, directory: string, pageCount: number): Promise<ChapterDownloadResult> {
        const pages = (await readdir(directory)).filter(isCompletePage);
        await writeFile(join(directory, COMIC_INFO_FILE), this.comicInfoOf(identity, pages.length, pageCount), 'utf-8');
        return { filePath: directory, sizeBytes: await folderSize(directory), pageCount, missingPages: missingPageIndexes(pages, pageCount) };
    }

    private comicInfoOf(identity: ChapterIdentity, present: number, pageCount: number): string {
        return buildComicInfo({ seriesTitle: identity.seriesTitle, chapter: identity.chapter, details: identity.details, pageCount: Math.min(present, pageCount) });
    }
}

async function folderSize(directory: string): Promise<number> {
    const files = await readdir(directory);
    const sizes = await Promise.all(files.map(async (file) => {
        return (await stat(join(directory, file))).size;
    }));
    return sizes.reduce((total, size) => {
        return total + size;
    }, 0);
}
