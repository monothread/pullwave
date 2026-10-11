import type { MangaChapter, MangaChapterRecord } from './manga';

// Moving a manga to the same manga in another source: the chapters of the library are matched to the chapters the other source has by
// their number (or, when they have none, by their name), so what was downloaded stays attached to the right chapter.

function foldName(name: string): string {
    return name
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

// What makes two chapters the same one in two sources: their number, else their name; null when they have neither.
export function chapterKey(chapter: Pick<MangaChapter, 'number' | 'name'>): string | null {
    if (chapter.number !== null) {
        return `n:${String(chapter.number)}`;
    }
    const name = foldName(chapter.name);
    return name.length > 0 ? `t:${name}` : null;
}

export interface ChapterPairing {
    // The chapter of the library and the chapter of the other source it becomes.
    record: MangaChapterRecord;
    incoming: MangaChapter;
}

export interface ChapterMatching {
    matched: ChapterPairing[];
    // Chapters the other source has that the library does not: they are added, not downloaded.
    added: MangaChapter[];
    // Chapters of the library the other source does not have.
    unmatched: MangaChapterRecord[];
}

// Pairs each chapter of the library with one of the other source. When several chapters share a key (a chapter that was published twice
// by two groups) they are paired one by one, the ones of the library in the order they were added, the other source's newest first.
export function matchChapters(existing: readonly MangaChapterRecord[], incoming: readonly MangaChapter[]): ChapterMatching {
    const available = new Map<string, MangaChapter[]>();
    [...incoming]
        .sort((first, second) => {
            return second.sourceOrder - first.sourceOrder;
        })
        .forEach((chapter) => {
            const key = chapterKey(chapter);
            if (key !== null) {
                available.set(key, [...(available.get(key) ?? []), chapter]);
            }
        });
    const used = new Set<number>();
    const matched: ChapterPairing[] = [];
    const unmatched: MangaChapterRecord[] = [];
    [...existing]
        .sort((first, second) => {
            return first.id - second.id;
        })
        .forEach((record) => {
            const key = chapterKey(record);
            const candidate = key === null ? undefined : available.get(key)?.shift();
            if (candidate === undefined) {
                unmatched.push(record);
                return;
            }
            used.add(candidate.remoteId);
            matched.push({ record, incoming: candidate });
        });
    const added = incoming.filter((chapter) => {
        return !used.has(chapter.remoteId);
    });
    return { matched, added, unmatched };
}

// What the move does to the chapters of the library that the other source does not have: the downloaded ones stay (they are read from
// their files), the others go, since there is nothing to download them from.
export function droppedChapters(matching: ChapterMatching): MangaChapterRecord[] {
    return matching.unmatched.filter((record) => {
        return record.status !== 'done';
    });
}

export function keptUnmatched(matching: ChapterMatching): MangaChapterRecord[] {
    return matching.unmatched.filter((record) => {
        return record.status === 'done';
    });
}
