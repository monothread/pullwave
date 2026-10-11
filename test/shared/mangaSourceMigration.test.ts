import type { MangaChapter, MangaChapterRecord } from '@shared/manga';
import { chapterKey, droppedChapters, keptUnmatched, matchChapters } from '@shared/mangaSourceMigration';
import { makeChapter, makeChapterRecord } from '../helpers/mangaFixtures';

function record(id: number, number: number | null, name: string, status: MangaChapterRecord['status'] = 'idle'): MangaChapterRecord {
    return makeChapterRecord({ id, remoteId: 100 + id, number, name, status });
}

function incoming(remoteId: number, number: number | null, name: string, sourceOrder = remoteId): MangaChapter {
    return makeChapter({ remoteId, number, name, sourceOrder });
}

describe('chapterKey', () => {
    it('is the number when the chapter has one, whatever its name', () => {
        expect(chapterKey({ number: 12.5, name: 'Anything' })).toBe('n:12.5');
        expect(chapterKey({ number: 0, name: '' })).toBe('n:0');
    });

    it('is the name, without case, accents or extra spaces, when there is no number', () => {
        expect(chapterKey({ number: null, name: '  Épilogue   Final ' })).toBe('t:epilogue final');
        expect(chapterKey({ number: null, name: 'EPILOGUE FINAL' })).toBe('t:epilogue final');
    });

    it('is nothing when the chapter has neither', () => {
        expect(chapterKey({ number: null, name: '   ' })).toBeNull();
        expect(chapterKey({ number: null, name: '' })).toBeNull();
    });
});

describe('matchChapters', () => {
    it('pairs the chapters of the library with the ones of the other source that have the same number', () => {
        const result = matchChapters([record(1, 1, 'One'), record(2, 2, 'Two')], [incoming(11, 2, 'Chapter 2'), incoming(10, 1, 'Chapter 1')]);
        expect(result.matched.map((pair) => {return [pair.record.id, pair.incoming.remoteId]})).toEqual([[1, 10], [2, 11]]);
        expect(result.added).toEqual([]);
        expect(result.unmatched).toEqual([]);
    });

    it('adds the chapters only the other source has, and leaves out the ones only the library has', () => {
        const result = matchChapters([record(1, 1, 'One'), record(2, 2, 'Two')], [incoming(10, 1, 'Chapter 1'), incoming(12, 3, 'Chapter 3')]);
        expect(result.matched.map((pair) => {return pair.record.id})).toEqual([1]);
        expect(result.added).toEqual([incoming(12, 3, 'Chapter 3')]);
        expect(result.unmatched.map((item) => {return item.id})).toEqual([2]);
    });

    it('pairs chapters without a number by their name', () => {
        const result = matchChapters([record(1, null, 'Epilogue'), record(2, null, 'Side story')], [incoming(10, null, 'EPILOGUE'), incoming(11, null, 'Prologue')]);
        expect(result.matched.map((pair) => {return [pair.record.id, pair.incoming.remoteId]})).toEqual([[1, 10]]);
        expect(result.added.map((chapter) => {return chapter.remoteId})).toEqual([11]);
        expect(result.unmatched.map((item) => {return item.id})).toEqual([2]);
    });

    it('does not pair a chapter that has neither a number nor a name', () => {
        const result = matchChapters([record(1, null, '')], [incoming(10, null, '')]);
        expect(result.matched).toEqual([]);
        expect(result.unmatched.map((item) => {return item.id})).toEqual([1]);
        expect(result.added.map((chapter) => {return chapter.remoteId})).toEqual([10]);
    });

    it('pairs chapters that share a number one by one, the library in the order it was added and the other source newest first', () => {
        const result = matchChapters(
            [record(2, 5, 'B'), record(1, 5, 'A'), record(3, 5, 'C')],
            [incoming(10, 5, 'x', 1), incoming(11, 5, 'y', 3), incoming(12, 5, 'z', 2)]
        );
        expect(result.matched.map((pair) => {return [pair.record.id, pair.incoming.remoteId]})).toEqual([[1, 11], [2, 12], [3, 10]]);
        expect(result.added).toEqual([]);
        const fewer = matchChapters([record(1, 5, 'A'), record(2, 5, 'B')], [incoming(10, 5, 'x')]);
        expect(fewer.matched.map((pair) => {return pair.record.id})).toEqual([1]);
        expect(fewer.unmatched.map((item) => {return item.id})).toEqual([2]);
    });

    it('adds the chapters of the other source that have no key, and handles empty lists', () => {
        expect(matchChapters([], []).matched).toEqual([]);
        expect(matchChapters([record(1, 1, 'One')], []).unmatched).toHaveLength(1);
        expect(matchChapters([], [incoming(10, 1, 'One')]).added).toHaveLength(1);
    });

    it('does not change the lists it is given', () => {
        const existing = [record(2, 2, 'Two'), record(1, 1, 'One')];
        const other = [incoming(10, 1, 'One'), incoming(11, 2, 'Two')];
        matchChapters(existing, other);
        expect(existing.map((item) => {return item.id})).toEqual([2, 1]);
        expect(other.map((item) => {return item.remoteId})).toEqual([10, 11]);
    });
});

describe('what the move does to the chapters the other source lacks', () => {
    it('keeps the downloaded ones and drops the others', () => {
        const matching = matchChapters(
            [record(1, 1, 'One', 'done'), record(2, 2, 'Two', 'idle'), record(3, 3, 'Three', 'done'), record(4, 4, 'Four', 'error'), record(5, 5, 'Five', 'queued')],
            [incoming(10, 5, 'Five')]
        );
        expect(keptUnmatched(matching).map((item) => {return item.id})).toEqual([1, 3]);
        expect(droppedChapters(matching).map((item) => {return item.id})).toEqual([2, 4]);
        expect(matching.matched.map((pair) => {return pair.record.id})).toEqual([5]);
    });
});
