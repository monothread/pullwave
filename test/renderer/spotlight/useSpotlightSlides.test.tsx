// @vitest-environment jsdom
import { render, renderHook } from '@testing-library/react';
import { createTranslator } from '@shared/i18n';
import { groupLibrary } from '@renderer/components/mangaText';
import type { SpotlightItem } from '@renderer/spotlight/spotlightData';
import { toSlide, useSpotlightSlides } from '@renderer/spotlight/useSpotlightSlides';
import { useAnimeStore } from '@renderer/store/animeStore';
import { makeReading } from '../../helpers/homeFixtures';
import { makeLibraryManga } from '../../helpers/mangaFixtures';

const runPrimary = vi.fn();
const showAnimeDetails = vi.fn();
vi.mock('@renderer/spotlight/spotlightActions', () => {
    return {
        runPrimary: (item: unknown) => {
            runPrimary(item);
        },
        showAnimeDetails: (id: number) => {
            showAnimeDetails(id);
        }
    };
});

const t = createTranslator('en');
const COVERS = { naruto: { status: 'found' as const, url: 'https://img/naruto.jpg' } };
const initial = useAnimeStore.getState();

beforeEach(() => {
    vi.clearAllMocks();
    useAnimeStore.setState({ covers: COVERS, loadCover: vi.fn(async () => {}) });
});

afterEach(() => {
    useAnimeStore.setState(initial, true);
});

const continueAnime: SpotlightItem = { key: 'a', kind: 'anime', reason: 'continue', title: 'Naruto', coverTitle: 'Naruto', animeId: 3, episodeId: 30, episode: '5', progress: 0.4 };

describe('toSlide', () => {
    it('makes an episode to go on with: its cover, its episode, its bar, CONTINUE and DETAILS', () => {
        const slide = toSlide(continueAnime, t, COVERS);
        expect(slide).toMatchObject({ key: 'a', eyebrow: 'CONTINUE WATCHING', title: 'Naruto', meta: 'Episode 5', imageUrl: 'https://img/naruto.jpg', progress: 0.4 });
        expect(slide.primary).toMatchObject({ label: '▶ CONTINUE', ariaLabel: '▶ CONTINUE: Naruto' });
        expect(slide.secondary).toMatchObject({ label: 'DETAILS', ariaLabel: 'DETAILS: Naruto' });
        slide.primary.onClick();
        expect(runPrimary.mock.calls).toEqual([[continueAnime]]);
        slide.secondary?.onClick();
        expect(showAnimeDetails.mock.calls).toEqual([[3]]);
        const { container } = render(<>{slide.art}</>);
        expect(container.querySelector('img.cover')).toHaveAttribute('src', 'https://img/naruto.jpg');
    });

    it.each([
        [1, '1 new episode'],
        [4, '4 new episodes']
    ])('makes a series with %d new episodes, with VIEW and no bar', (count, meta) => {
        const item: SpotlightItem = { key: 'n', kind: 'anime', reason: 'news', title: 'Bleach', coverTitle: 'Bleach S1', groupKey: 'series-bleach', count };
        const slide = toSlide(item, t, COVERS);
        expect(slide).toMatchObject({ eyebrow: 'NEW THIS WEEK', title: 'Bleach', meta, imageUrl: null, progress: null });
        expect(slide.primary).toMatchObject({ label: '▶ VIEW', ariaLabel: '▶ VIEW: Bleach' });
        expect(slide.secondary).toBeUndefined();
        slide.primary.onClick();
        expect(runPrimary.mock.calls).toEqual([[item]]);
    });

    it('makes a manga being read: the chapter, the page, its bar and OPEN', () => {
        const entry = makeReading({ chapterName: 'Romance Dawn', page: 4, pageCount: 20 });
        const item: SpotlightItem = { key: 'm', kind: 'manga', reason: 'continue', title: 'One Piece', coverUrl: 'https://img/op.jpg', entry, progress: 0.25 };
        const slide = toSlide(item, t, COVERS);
        expect(slide).toMatchObject({ eyebrow: 'CONTINUE READING', title: 'One Piece', meta: 'Romance Dawn · Page 5 of 20', imageUrl: 'https://img/op.jpg', progress: 0.25 });
        expect(slide.primary).toMatchObject({ label: '▶ OPEN', ariaLabel: '▶ OPEN: One Piece' });
        expect(slide.secondary).toBeUndefined();
        const { container } = render(<>{slide.art}</>);
        expect(container.querySelector('img.cover')).toHaveAttribute('src', 'https://img/op.jpg');
    });

    it.each([
        [1, '1 new chapter'],
        [3, '3 new chapters']
    ])('makes a manga with %d new chapters', (count, meta) => {
        const [group] = groupLibrary([makeLibraryManga([])]);
        const item: SpotlightItem = { key: 'x', kind: 'manga', reason: 'news', title: 'One Piece', coverUrl: null, group: group!, count };
        expect(toSlide(item, t, COVERS)).toMatchObject({ eyebrow: 'NEW THIS WEEK', meta, imageUrl: null, progress: null, primary: { label: '▶ VIEW', ariaLabel: '▶ VIEW: One Piece' } });
    });
});

describe('useSpotlightSlides', () => {
    it('makes a slide of each item with the covers of the store, in the language of the interface', () => {
        const { result } = renderHook(() => {
            return useSpotlightSlides([continueAnime]);
        });
        expect(result.current.map((slide) => {
            return [slide.key, slide.imageUrl, slide.eyebrow];
        })).toEqual([['a', 'https://img/naruto.jpg', 'CONTINUE WATCHING']]);
    });
});
