import { posix, win32 } from 'node:path';
import type { MangaChapter } from '@shared/manga';
import { animeFolderName } from '../animeFiles';

export const DEFAULT_MANGA_FOLDER = 'Pullwave Manga';
export const MIN_PAGE_NUMBER_WIDTH = 3;
export const CBZ_EXTENSION = '.cbz';
// The file the chapter is described in, inside its CBZ or its folder (the readers that know it show the metadata).
export const COMIC_INFO_FILE = 'ComicInfo.xml';
// The names the pages of a chapter in the middle of a download have: the final name is only given once the type is known.
export const TEMPORARY_EXTENSION = '.tmp';

function pathFor(platform: NodeJS.Platform): typeof posix {
    return platform === 'win32' ? win32 : posix;
}

// "001", "002"... wide enough for the number of pages (sorting the names is reading order).
export function pageFileName(index: number, pageCount: number): string {
    const width = Math.max(MIN_PAGE_NUMBER_WIDTH, String(Math.max(pageCount, 1)).length);
    return String(index + 1).padStart(width, '0');
}

export function formatChapterNumber(number: number): string {
    return String(number);
}

// "Chapter 12.5" when the source gave a number, otherwise the name it gave.
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

// Where a chapter goes: a folder of images or a CBZ, beside the other chapters of its manga.
export function chapterOutputPath(
    mangaFolder: string,
    chapter: Pick<MangaChapter, 'name' | 'number'>,
    format: 'cbz' | 'folder',
    platform: NodeJS.Platform = process.platform
): string {
    const base = chapterFolderName(chapter, platform);
    return pathFor(platform).join(mangaFolder, format === 'cbz' ? `${base}${CBZ_EXTENSION}` : base);
}

// The same path when nothing is there, otherwise the path with " (2)", " (3)"... before the extension.
export function uniquePath(path: string, exists: (path: string) => boolean, platform: NodeJS.Platform = process.platform): string {
    if (!exists(path)) {
        return path;
    }
    const system = pathFor(platform);
    const extension = system.extname(path);
    const stem = extension.length > 0 ? path.slice(0, -extension.length) : path;
    let attempt = 2;
    while (exists(`${stem} (${attempt})${extension}`)) {
        attempt += 1;
    }
    return `${stem} (${attempt})${extension}`;
}

// The folder where the pages are kept while the chapter is downloaded (next to the final place, so the move at the end is a
// rename on the same disk).
export function chapterWorkDirectory(finalPath: string): string {
    return `${finalPath}.part`;
}
