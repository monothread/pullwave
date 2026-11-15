import { existsSync } from 'node:fs';
import { localPageUrl, type MangaReadPages, type MangaReadRequest, type MangaResult } from '@shared/manga';
import type { LocalPages } from './localPages';
import { toMangaError } from './mangaService';

export interface MangaReaderDependencies {
    fileOf: (chapterId: number) => string | null;
    localPages: Pick<LocalPages, 'count' | 'missing'>;
    remotePages: (chapterRemoteId: number) => Promise<string[]>;
    incompletePageCount: (chapterId: number) => number | null;
    pathExists?: (path: string) => boolean;
}

export class MangaReader {
    constructor(private readonly deps: MangaReaderDependencies) {}

    async pages(request: MangaReadRequest): Promise<MangaResult<MangaReadPages>> {
        const local = await this.localPages(request.libraryChapterId);
        if (local !== null) {
            return { ok: true, value: local };
        }
        try {
            const pages = await this.deps.remotePages(request.chapterRemoteId);
            return { ok: true, value: { pages, local: false, missing: [] } };
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
            const total = this.deps.incompletePageCount(chapterId) ?? count;
            return {
                pages: Array.from({ length: total }, (_unused, index) => {
                    return localPageUrl(chapterId, index);
                }),
                local: true,
                missing: total === count ? [] : await this.deps.localPages.missing(path, total)
            };
        } catch {
            return null;
        }
    }
}
