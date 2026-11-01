import { SEARCH_SUGGESTION_LIMIT, searchSuggestions } from '@renderer/home/searchData';
import { makeAnime, makeEpisode } from '../../helpers/animeFixtures';
import { makeLibraryManga } from '../../helpers/mangaFixtures';

const naruto = makeAnime([makeEpisode()], { id: 1, title: 'Naruto' });
const shippuden = makeAnime([makeEpisode({ id: 2, animeId: 2 })], { id: 2, title: 'Naruto Shippuden', series: 'Naruto Saga', season: 2 });
const bleach = makeAnime([makeEpisode({ id: 3, animeId: 3 })], { id: 3, title: 'Bleach' });
const onePiece = makeLibraryManga([], { id: 7, title: 'One Piece' });
const narutoManga = makeLibraryManga([], { id: 8, title: 'Naruto (manga)' });

describe('searchSuggestions', () => {
    it('suggests six titles of the library at most', () => {
        expect(SEARCH_SUGGESTION_LIMIT).toBe(6);
    });

    it('is empty for an empty text or one of spaces', () => {
        expect(searchSuggestions('', [naruto], [onePiece], true, true)).toEqual([]);
        expect(searchSuggestions('   ', [naruto], [onePiece], true, true)).toEqual([]);
    });

    it('lists the series of the anime library and the mangas whose names have the text, then the two searches', () => {
        expect(searchSuggestions(' naru ', [naruto, shippuden, bleach], [onePiece, narutoManga], true, true)).toEqual([
            { kind: 'anime', key: 'anime-anime-1', title: 'Naruto', animeId: 1 },
            { kind: 'anime', key: 'anime-series-naruto saga', title: 'Naruto Saga', animeId: 2 },
            { kind: 'manga', key: 'manga-8', title: 'Naruto (manga)', manga: narutoManga },
            { kind: 'search-anime', key: 'search-anime', query: 'naru' },
            { kind: 'search-manga', key: 'search-manga', query: 'naru' }
        ]);
    });

    it('ignores the case and the accents', () => {
        const accented = makeLibraryManga([], { id: 9, title: 'Pokémon' });
        expect(searchSuggestions('POKEMON', [], [accented], false, false)).toEqual([{ kind: 'manga', key: 'manga-9', title: 'Pokémon', manga: accented }]);
    });

    it('offers only the searches of the sections that exist here', () => {
        expect(searchSuggestions('zzz', [naruto], [onePiece], true, false)).toEqual([{ kind: 'search-anime', key: 'search-anime', query: 'zzz' }]);
        expect(searchSuggestions('zzz', [naruto], [onePiece], false, true)).toEqual([{ kind: 'search-manga', key: 'search-manga', query: 'zzz' }]);
        expect(searchSuggestions('zzz', [naruto], [onePiece], false, false)).toEqual([]);
    });

    it('stops the titles at the limit and keeps the searches after them', () => {
        const many = [1, 2, 3].map((id) => {
            return makeLibraryManga([], { id, title: `Same ${String(id)}` });
        });
        expect(
            searchSuggestions('same', [], many, true, false, 2).map((suggestion) => {
                return suggestion.key;
            })
        ).toEqual(['manga-1', 'manga-2', 'search-anime']);
    });
});
