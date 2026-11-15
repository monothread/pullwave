import { hasChapterFile, type MangaChapter, type MangaChapterRecord } from './manga';

function foldName(name: string): string {
    return name
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

export function chapterKey(chapter: Pick<MangaChapter, 'number' | 'name'>): string | null {
    if (chapter.number !== null) {
        return `n:${String(chapter.number)}`;
    }
    const name = foldName(chapter.name);
    return name.length > 0 ? `t:${name}` : null;
}

export interface ChapterPairing {
    record: MangaChapterRecord;
    incoming: MangaChapter;
}

export interface ChapterMatching {
    matched: ChapterPairing[];
    added: MangaChapter[];
    unmatched: MangaChapterRecord[];
}

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

export function droppedChapters(matching: ChapterMatching): MangaChapterRecord[] {
    return matching.unmatched.filter((record) => {
        return !hasChapterFile(record.status);
    });
}

export function keptUnmatched(matching: ChapterMatching): MangaChapterRecord[] {
    return matching.unmatched.filter((record) => {
        return hasChapterFile(record.status);
    });
}
