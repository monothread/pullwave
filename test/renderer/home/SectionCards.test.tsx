// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { SectionCards, sectionOrder } from '@renderer/home/SectionCards';
import { useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeAnime, makeAnimeJob, makeEpisode, makeStatus } from '../../helpers/animeFixtures';
import { makeChapterRecord, makeLibraryManga, makeMangaJob, makeMangaStatus } from '../../helpers/mangaFixtures';
import { makeJob } from '../../helpers/mockApi';

const actions = vi.hoisted(() => {
    return { openAnime: vi.fn(), openManga: vi.fn(), pasteLink: vi.fn(), showCut: vi.fn() };
});
vi.mock('@renderer/home/homeActions', () => {
    return actions;
});

const initialApp = useAppStore.getState();
const initialAnime = useAnimeStore.getState();
const initialManga = useMangaStore.getState();
const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, startTab: 'downloads' }, jobs: [] });
    useAnimeStore.setState({ status: makeStatus(), library: [], jobs: [] });
    useMangaStore.setState({ status: makeMangaStatus(), library: [], jobs: [] });
});

afterEach(() => {
    useAppStore.setState(initialApp, true);
    useAnimeStore.setState(initialAnime, true);
    useMangaStore.setState(initialManga, true);
});

function card(name: string): HTMLElement {
    return screen.getByRole('heading', { level: 3, name }).closest('li') as HTMLElement;
}

function lines(name: string): string[] {
    return Array.from(card(name).querySelectorAll('.section-card__lines li')).map((line) => {
        return line.textContent ?? '';
    });
}

describe('sectionOrder', () => {
    it('follows the order of the menu on the left', () => {
        expect(sectionOrder(true, true)).toEqual(['downloads', 'anime', 'manga']);
    });

    it('leaves out the sections that do not exist here', () => {
        expect(sectionOrder(false, true)).toEqual(['downloads', 'manga']);
        expect(sectionOrder(true, false)).toEqual(['downloads', 'anime']);
        expect(sectionOrder(false, false)).toEqual(['downloads']);
    });
});

describe('SectionCards', () => {
    it.each(['downloads', 'anime', 'manga'] as const)('is a list of a block per section, in the order of the menu whatever "Open on" says (%s), with a picture each', (startTab) => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, startTab } });
        render(<SectionCards />);
        const list = screen.getByRole('list', { name: 'Sections' });
        expect(list).toHaveClass('section-cards');
        expect(
            within(list)
                .getAllByRole('heading', { level: 3 })
                .map((heading) => {
                    return heading.textContent;
                })
        ).toEqual(['VIDEO DOWNLOADER', 'ANIME', 'MANGA']);
        expect(card('MANGA').querySelector('.section-icon')).toHaveClass('section-icon--manga');
    });

    it('says nothing goes on when nothing does, with nothing lit', () => {
        render(<SectionCards />);
        expect(lines('VIDEO DOWNLOADER')).toEqual(['Nothing downloading']);
        expect(lines('ANIME')).toEqual(['Nothing new this week']);
        expect(lines('MANGA')).toEqual(['Nothing new this week']);
        ['VIDEO DOWNLOADER', 'ANIME', 'MANGA'].forEach((name) => {
            expect(card(name)).not.toHaveClass('section-card--busy');
        });
    });

    it('says what downloads and waits, and what is new in the last seven days, and lights up', () => {
        useAppStore.setState({ jobs: [makeJob({ id: 'a', status: 'running' }), makeJob({ id: 'b', status: 'queued' }), makeJob({ id: 'c', status: 'queued' }), makeJob({ id: 'd', status: 'done' })] });
        useAnimeStore.setState({
            library: [makeAnime([makeEpisode({ id: 1, addedAt: NOW - DAY }), makeEpisode({ id: 2, addedAt: NOW - 2 * DAY }), makeEpisode({ id: 3, addedAt: NOW - 20 * DAY })])],
            jobs: [makeAnimeJob({ status: 'running' })]
        });
        useMangaStore.setState({ library: [makeLibraryManga([makeChapterRecord({ addedAt: NOW - DAY })])], jobs: [makeMangaJob({ status: 'queued' }), makeMangaJob({ chapterId: 2, status: 'paused' })] });
        render(<SectionCards />);
        expect(lines('VIDEO DOWNLOADER')).toEqual(['1 downloading', '2 waiting']);
        expect(lines('ANIME')).toEqual(['2 new this week', '1 downloading']);
        expect(lines('MANGA')).toEqual(['1 new this week', '2 downloading']);
        ['VIDEO DOWNLOADER', 'ANIME', 'MANGA'].forEach((name) => {
            expect(card(name)).toHaveClass('section-card--busy');
        });
    });

    it('lights the anime up for a download alone, with no news', () => {
        useAnimeStore.setState({ jobs: [makeAnimeJob({ status: 'queued' })] });
        render(<SectionCards />);
        expect(lines('ANIME')).toEqual(['Nothing new this week', '1 downloading']);
        expect(card('ANIME')).toHaveClass('section-card--busy');
    });

    it('leads each button where it says, named with its section, the first one the main one', () => {
        render(<SectionCards />);
        const paste = screen.getByRole('button', { name: 'PASTE A LINK: VIDEO DOWNLOADER' });
        expect(paste).toHaveClass('btn', 'btn--primary');
        expect(screen.getByRole('button', { name: 'CUT: VIDEO DOWNLOADER' })).not.toHaveClass('btn--primary');
        expect(within(card('ANIME')).getAllByRole('button').map((button) => {
            return button.textContent;
        })).toEqual(['UPDATES', 'LIBRARY']);
        expect(within(card('MANGA')).getAllByRole('button').map((button) => {
            return button.textContent;
        })).toEqual(['UPDATES', 'LIBRARY']);
        fireEvent.click(paste);
        expect(actions.pasteLink).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: 'CUT: VIDEO DOWNLOADER' }));
        expect(actions.showCut).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: 'UPDATES: ANIME' }));
        fireEvent.click(screen.getByRole('button', { name: 'LIBRARY: ANIME' }));
        expect(actions.openAnime.mock.calls).toEqual([['updates'], ['library']]);
        fireEvent.click(screen.getByRole('button', { name: 'UPDATES: MANGA' }));
        fireEvent.click(screen.getByRole('button', { name: 'LIBRARY: MANGA' }));
        expect(actions.openManga.mock.calls).toEqual([['updates'], ['library']]);
    });

    it('has no block for a section that does not exist here', () => {
        useAnimeStore.setState({ status: makeStatus({ supported: false }) });
        useMangaStore.setState({ status: makeMangaStatus({ supported: false }) });
        render(<SectionCards />);
        expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => {
            return heading.textContent;
        })).toEqual(['VIDEO DOWNLOADER']);
    });
});
