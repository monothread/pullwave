// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { pickSeriesCoverTitle, useSeriesCoverTitle } from '@renderer/hooks/useSeriesCoverTitle';
import { useAnimeStore, type AnimeCoverState } from '@renderer/store/animeStore';

const initialAnime = useAnimeStore.getState();
const NONE: AnimeCoverState = { status: 'none' };
const FAILED: AnimeCoverState = { status: 'failed' };
const found = (name: string): AnimeCoverState => {
    return { status: 'found', url: `https://s4.anilist.co/cover/${name}.jpg` };
};

beforeEach(() => {
    useAnimeStore.setState({ ...initialAnime, covers: {} });
});

function pickTitle(...args: Parameters<typeof pickSeriesCoverTitle>): string | null {
    return pickSeriesCoverTitle(...args).title;
}

describe('pickSeriesCoverTitle', () => {
    const titles = ['Yamada-kun to 7-nin no Majo', 'Yamada-kun to 7-nin no Majo: Mou Hitotsu no Suzaku-sai', 'Yamada-kun to 7-nin no Majo 3'];

    it('is the first season when its cover is found', () => {
        expect(pickTitle(titles, { 'yamada-kun to 7-nin no majo': found('one'), 'yamada-kun to 7-nin no majo 3': found('three') }, new Set())).toBe(titles[0]);
    });

    it('is the first season while its cover is still being looked for', () => {
        expect(pickTitle(titles, {}, new Set())).toBe(titles[0]);
        expect(pickTitle(titles, { [titles[1]!.toLowerCase()]: found('two') }, new Set())).toBe(titles[0]);
    });

    it('goes to the next season when the cover of the first is not found', () => {
        expect(pickTitle(titles, { [titles[0]!.toLowerCase()]: NONE }, new Set())).toBe(titles[1]);
    });

    it('goes to the next season when the cover of the first could not be asked for', () => {
        expect(pickTitle(titles, { [titles[0]!.toLowerCase()]: FAILED }, new Set())).toBe(titles[1]);
    });

    it('waits for the next season to be looked up instead of going past it', () => {
        expect(pickTitle(titles, { [titles[0]!.toLowerCase()]: NONE, [titles[2]!.toLowerCase()]: found('three') }, new Set())).toBe(titles[1]);
    });

    it('goes past the seasons that have none until the first that has one', () => {
        expect(pickTitle(titles, { [titles[0]!.toLowerCase()]: NONE, [titles[1]!.toLowerCase()]: FAILED, [titles[2]!.toLowerCase()]: found('three') }, new Set())).toBe(titles[2]);
    });

    it('goes past a season whose picture does not load', () => {
        const covers = { [titles[0]!.toLowerCase()]: found('one'), [titles[1]!.toLowerCase()]: found('two') };
        expect(pickTitle(titles, covers, new Set([titles[0]!.toLowerCase()]))).toBe(titles[1]);
    });

    it('is the first season when none has a cover', () => {
        const covers = { [titles[0]!.toLowerCase()]: NONE, [titles[1]!.toLowerCase()]: NONE, [titles[2]!.toLowerCase()]: FAILED };
        expect(pickTitle(titles, covers, new Set())).toBe(titles[0]);
        expect(pickTitle(titles, {}, new Set(titles.map((title) => {
            return title.toLowerCase();
        })))).toBe(titles[0]);
    });

    it('says every season is without a cover only when each one is known to have none', () => {
        const covers = { [titles[0]!.toLowerCase()]: NONE, [titles[1]!.toLowerCase()]: NONE, [titles[2]!.toLowerCase()]: FAILED };
        expect(pickSeriesCoverTitle(titles, covers, new Set())).toEqual({ title: titles[0], exhausted: true });
        expect(pickSeriesCoverTitle(titles, { ...covers, [titles[2]!.toLowerCase()]: found('three') }, new Set())).toEqual({ title: titles[2], exhausted: false });
        expect(pickSeriesCoverTitle(titles, {}, new Set())).toEqual({ title: titles[0], exhausted: false });
        expect(pickSeriesCoverTitle(titles, {}, new Set(titles.map((title) => {
            return title.toLowerCase();
        })))).toEqual({ title: titles[0], exhausted: true });
    });

    it('is null for a series with no season, and not exhausted', () => {
        expect(pickSeriesCoverTitle([], {}, new Set())).toEqual({ title: null, exhausted: false });
    });

    it('finds the cover by the title in any case and without the spaces around it', () => {
        expect(pickTitle(['  Naruto ', 'Naruto 2'], { naruto: NONE }, new Set())).toBe('Naruto 2');
    });

    it('goes back to the first season when its cover turns up later', () => {
        expect(pickTitle(['Naruto', 'Naruto 2'], { naruto: NONE, 'naruto 2': found('two') }, new Set())).toBe('Naruto 2');
        expect(pickTitle(['Naruto', 'Naruto 2'], { naruto: found('one'), 'naruto 2': found('two') }, new Set())).toBe('Naruto');
    });
});

describe('useSeriesCoverTitle', () => {
    it('follows the store: the first season, then the next one when the first has no cover, then the first again when it is found', () => {
        const { result } = renderHook(() => {
            return useSeriesCoverTitle(['Naruto', 'Naruto 2']);
        });
        expect(result.current.title).toBe('Naruto');

        act(() => {
            useAnimeStore.setState({ covers: { naruto: NONE } });
        });
        expect(result.current.title).toBe('Naruto 2');

        act(() => {
            useAnimeStore.setState({ covers: { naruto: found('one'), 'naruto 2': NONE } });
        });
        expect(result.current.title).toBe('Naruto');
    });

    it('passes over a title whose picture was marked as broken', () => {
        useAnimeStore.setState({ covers: { naruto: found('one'), 'naruto 2': found('two') } });
        const { result } = renderHook(() => {
            return useSeriesCoverTitle(['Naruto', 'Naruto 2']);
        });
        expect(result.current.title).toBe('Naruto');

        act(() => {
            result.current.markBroken(' NARUTO ');
        });
        expect(result.current.title).toBe('Naruto 2');
    });

    it('says when every season has no cover', () => {
        useAnimeStore.setState({ covers: { naruto: NONE, 'naruto 2': FAILED } });
        const { result } = renderHook(() => {
            return useSeriesCoverTitle(['Naruto', 'Naruto 2']);
        });
        expect(result.current.title).toBe('Naruto');
        expect(result.current.exhausted).toBe(true);
    });

    it('is null for a series with no season', () => {
        const { result } = renderHook(() => {
            return useSeriesCoverTitle([]);
        });
        expect(result.current.title).toBeNull();
        expect(result.current.exhausted).toBe(false);
    });
});
