import { posix, win32 } from 'node:path';
import type { MangaChapter, MangaOutputFormat } from '@shared/manga';
import { animeFolderName } from '../animeFiles';

export const DEFAULT_MANGA_FOLDER = 'Pullwave Manga';
export const MIN_PAGE_NUMBER_WIDTH = 3;
export const CBZ_EXTENSION = '.cbz';
export const COMIC_INFO_FILE = 'ComicInfo.xml';
export const TEMPORARY_EXTENSION = '.tmp';

function pathFor(platform: NodeJS.Platform): typeof posix {
    return platform === 'win32' ? win32 : posix;
}

export function pageFileName(index: number, pageCount: number): string {
    const width = Math.max(MIN_PAGE_NUMBER_WIDTH, String(Math.max(pageCount, 1)).length);
    return String(index + 1).padStart(width, '0');
}

export function formatChapterNumber(number: number): string {
    return String(number);
}

export function chapterLabel(chapter: Pick<MangaChapter, 'name' | 'number'>): string {
    if (chapter.number !== null) {
        return `Chapter ${formatChapterNumber(chapter.number)}`;
    }
    return chapter.name.trim().length > 0 ? chapter.name : 'Chapter';
}

export function mangaFolderName(title: string, platform: NodeJS.Platform = process.platform): string {
    return animeFolderName(title.trim().length > 0 ? title : 'manga', { platform });
}

export function chapterFolderName(chapter: Pick<MangaChapter, 'name' | 'number'>, platform: NodeJS.Platform = process.platform): string {
    return animeFolderName(chapterLabel(chapter), { platform });
}

export function mangaDirectory(baseDirectory: string, title: string, platform: NodeJS.Platform = process.platform): string {
    return pathFor(platform).join(baseDirectory, mangaFolderName(title, platform));
}

export function chapterOutputPath(
    mangaFolder: string,
    chapter: Pick<MangaChapter, 'name' | 'number'>,
    format: 'cbz' | 'folder',
    platform: NodeJS.Platform = process.platform
): string {
    const base = chapterFolderName(chapter, platform);
    return pathFor(platform).join(mangaFolder, format === 'cbz' ? `${base}${CBZ_EXTENSION}` : base);
}

export function numberedPath(path: string, attempt: number, platform: NodeJS.Platform = process.platform): string {
    if (attempt < 2) {
        return path;
    }
    const extension = pathFor(platform).extname(path);
    const stem = extension.length > 0 ? path.slice(0, -extension.length) : path;
    return `${stem} (${attempt})${extension}`;
}

export function uniquePath(path: string, exists: (path: string) => boolean, platform: NodeJS.Platform = process.platform): string {
    let attempt = 1;
    while (exists(numberedPath(path, attempt, platform))) {
        attempt += 1;
    }
    return numberedPath(path, attempt, platform);
}

export function formatOfPath(path: string): MangaOutputFormat {
    return path.toLowerCase().endsWith(CBZ_EXTENSION) ? 'cbz' : 'folder';
}

export function chapterWorkDirectory(finalPath: string): string {
    return `${finalPath}.part`;
}

export function isCompletePage(fileName: string): boolean {
    return !fileName.endsWith(TEMPORARY_EXTENSION) && fileName !== COMIC_INFO_FILE;
}

const PAGE_FILE = /^(\d+)\.[a-z0-9]+$/i;

export function pageIndexOfFile(fileName: string): number | null {
    const match = PAGE_FILE.exec(fileName);
    if (match === null || match[1] === undefined) {
        return null;
    }
    const index = Number(match[1]) - 1;
    return index >= 0 ? index : null;
}

export function missingPageIndexes(fileNames: readonly string[], pageCount: number): number[] {
    const present = new Set(fileNames.map(pageIndexOfFile));
    return Array.from({ length: pageCount }, (_unused, index) => {
        return index;
    }).filter((index) => {
        return !present.has(index);
    });
}
