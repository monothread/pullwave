import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MangaChapter, MangaDetails, MangaError, MangaErrorCode, MangaOutputFormat } from '@shared/manga';
import { writeCbz as defaultWriteCbz, type CbzEntry } from './cbzWriter';
import { buildComicInfo } from './comicInfo';
import { detectImageType, resolveImageType } from './imageType';
import { ImageFetchError, type ImageFetcher } from './mangaImages';
import { chapterWorkDirectory, COMIC_INFO_FILE, isCompletePage, pageFileName, TEMPORARY_EXTENSION } from './mangaFiles';

// How many times a page is asked for again after it fails, and how long to wait before each.
export const PAGE_RETRY_DELAYS_MS: readonly number[] = [500, 1500];

export type ChapterRunResult<T> = { status: 'done'; value: T } | { status: 'error'; error: MangaError } | { status: 'cancelled' };

export interface ChapterDownloadResult {
    filePath: string;
    sizeBytes: number;
    pageCount: number;
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

export interface ChapterDownloadHandle {
    result: Promise<ChapterRunResult<ChapterDownloadResult>>;
    cancel: () => void;
}

export interface ChapterDownloaderDependencies {
    // The addresses of the pages of a chapter, in reading order.
    pages: (chapterRemoteId: number) => Promise<string[]>;
    fetchImage: ImageFetcher;
    writeCbz?: typeof defaultWriteCbz;
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
        let done = 0;
        for (const [index, address] of addresses.entries()) {
            signal.throwIfAborted();
            const name = pageFileName(index, addresses.length);
            if (existingPage(workDirectory, name) === null) {
                await this.downloadPage(address, join(workDirectory, name), signal);
            }
            done += 1;
            options.onProgress(done, addresses.length);
        }
        signal.throwIfAborted();
        return this.finish(options, workDirectory, addresses.length);
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

    private async finish(options: ChapterDownloadOptions, workDirectory: string, pageCount: number): Promise<ChapterDownloadResult> {
        const comicInfo = buildComicInfo({ seriesTitle: options.seriesTitle, chapter: options.chapter, details: options.details, pageCount });
        const pages = readdirSync(workDirectory).filter(isCompletePage).sort();
        if (options.format === 'cbz') {
            const entries: CbzEntry[] = pages.map((file) => {
                return { name: file, path: join(workDirectory, file) };
            });
            await (this.deps.writeCbz ?? defaultWriteCbz)(options.outputPath, entries, [{ name: COMIC_INFO_FILE, content: comicInfo }]);
            const sizeBytes = statSync(options.outputPath).size;
            rmSync(workDirectory, { recursive: true, force: true });
            return { filePath: options.outputPath, sizeBytes, pageCount };
        }
        writeFileSync(join(workDirectory, COMIC_INFO_FILE), comicInfo, 'utf-8');
        if (existsSync(options.outputPath)) {
            throw new ChapterFailure('DISK', 'The place for the chapter is taken', true);
        }
        renameSync(workDirectory, options.outputPath);
        const sizeBytes = readdirSync(options.outputPath).reduce((total, file) => {
            return total + statSync(join(options.outputPath, file)).size;
        }, 0);
        return { filePath: options.outputPath, sizeBytes, pageCount };
    }
}
