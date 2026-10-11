import { existsSync } from 'node:fs';
import { localPageUrl, type MangaReadPages, type MangaReadRequest, type MangaResult } from '@shared/manga';
import type { LocalPages } from './localPages';
import { toMangaError } from './mangaService';

export interface MangaReaderDependencies {
    // The file of a chapter of the library, when it was downloaded.
    fileOf: (chapterId: number) => string | null;
    localPages: Pick<LocalPages, 'count'>;
    // The addresses of the pages on the source.
    remotePages: (chapterRemoteId: number) => Promise<string[]>;
    pathExists?: (path: string) => boolean;
}

// Gives the pages of a chapter to read: from its file when it was downloaded (so it reads with no connection and no wait), from the
// source when not, or when the file cannot be read any more.
export class MangaReader {
    constructor(private readonly deps: MangaReaderDependencies) {}

    async pages(request: MangaReadRequest): Promise<MangaResult<MangaReadPages>> {
        const local = await this.localPages(request.libraryChapterId);
        if (local !== null) {
            return { ok: true, value: local };
        }
        try {
            const pages = await this.deps.remotePages(request.chapterRemoteId);
            return { ok: true, value: { pages, local: false } };
        } catch (error) {
            return { ok: false, error: toMangaError(error) };
        }
    }

    private async localPages(chapterId: number | null): Promise<MangaReadPages | null> {
        if (chapterId === null) {
            return null;
        }
        const path = this.deps.fileOf(chapterId);
        if (path === null || !(this.deps.pathExists ?? existsSync)(path)) {
            return null;
        }
        try {
            const count = await this.deps.localPages.count(path);
            if (count === 0) {
                return null;
            }
            return {
                pages: Array.from({ length: count }, (_unused, index) => {
                    return localPageUrl(chapterId, index);
                }),
                local: true
            };
        } catch {
            return null;
        }
    }
}
