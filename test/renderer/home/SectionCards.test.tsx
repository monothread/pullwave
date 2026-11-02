// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { SectionCards, animeFirstAction, mangaFirstAction, sectionOrder } from '@renderer/home/SectionCards';
import { makeChapterRecord, makeLibraryManga, makeMangaJob, makeMangaStatus, makeSource } from '../../helpers/mangaFixtures';
import { useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeAnime, makeAnimeJob, makeEpisode, makeStatus } from '../../helpers/animeFixtures';
import { installMockApi, makeJob } from '../../helpers/mockApi';

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
    installMockApi();
    useAppStore.setState({ settings: { ...DEFAULT_SETTINGS }, jobs: [] });
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
    it('is a list of a block per section, in the order of the menu, with a picture each', () => {
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
        useAnimeStore.setState({ library: [makeAnime([makeEpisode({ id: 1, animeId: 1 })], { id: 1, title: 'Watched' })] });
        useMangaStore.setState({ library: [makeLibraryManga([makeChapterRecord({ id: 1 })], { id: 1, title: 'Read' })] });
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

    it('offers the search of the anime instead of the updates while the library of the anime is empty', () => {
        render(<SectionCards />);
        expect(within(card('ANIME')).getAllByRole('button').map((button) => {
            return button.textContent;
        })).toEqual(['SEARCH', 'LIBRARY']);
        const search = screen.getByRole('button', { name: 'SEARCH: ANIME' });
        expect(search).toHaveClass('btn', 'btn--primary');
        fireEvent.click(search);
        expect(actions.openAnime.mock.calls).toEqual([['search']]);
    });

    it('leaves the chapters and downloads of the adult sources out of the manga card while they are not listed', () => {
        useMangaStore.setState({
            library: [makeLibraryManga([makeChapterRecord({ addedAt: NOW - DAY })], { id: 1, sourceId: 'safe' }), makeLibraryManga([makeChapterRecord({ id: 2, addedAt: NOW - DAY })], { id: 2, remoteId: 8, sourceId: 'adult' })],
            jobs: [makeMangaJob({ chapterId: 1, sourceId: 'safe', status: 'queued' }), makeMangaJob({ chapterId: 2, sourceId: 'adult', status: 'running' }), makeMangaJob({ chapterId: 3, sourceId: 'adult', status: 'paused' })],
            browse: { ...initialManga.browse, sources: [makeSource({ id: 'safe', contentWarning: 'SAFE' }), makeSource({ id: 'adult', contentWarning: 'NSFW' })], sourcesStatus: 'ready' }
        });
        const { unmount } = render(<SectionCards />);
        expect(lines('MANGA')).toEqual(['1 new this week', '1 downloading']);
        unmount();
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, mangaShowAdult: true } });
        render(<SectionCards />);
        expect(lines('MANGA')).toEqual(['2 new this week', '3 downloading']);
    });

    it('offers the extensions instead of the updates while the library of the manga is empty and no extension gives a source', () => {
        useMangaStore.setState({ browse: { ...initialManga.browse, sources: [], sourcesStatus: 'ready' } });
        render(<SectionCards />);
        expect(within(card('MANGA')).getAllByRole('button').map((button) => {
            return button.textContent;
        })).toEqual(['EXTENSIONS', 'LIBRARY']);
        fireEvent.click(screen.getByRole('button', { name: 'EXTENSIONS: MANGA' }));
        expect(actions.openManga.mock.calls).toEqual([['extensions']]);
    });

    it('offers the extensions while it is not known yet whether an extension gives a source', () => {
        useMangaStore.setState({ browse: { ...initialManga.browse, sources: [makeSource()], sourcesStatus: 'loading' } });
        render(<SectionCards />);
        expect(screen.getByRole('button', { name: 'EXTENSIONS: MANGA' })).toBeInTheDocument();
    });

    it('offers the browse instead of the updates while the library of the manga is empty and an extension gives a source', () => {
        useMangaStore.setState({ browse: { ...initialManga.browse, sources: [makeSource()], sourcesStatus: 'ready' } });
        render(<SectionCards />);
        expect(within(card('MANGA')).getAllByRole('button').map((button) => {
            return button.textContent;
        })).toEqual(['BROWSE', 'LIBRARY']);
        fireEvent.click(screen.getByRole('button', { name: 'BROWSE: MANGA' }));
        expect(actions.openManga.mock.calls).toEqual([['browse']]);
    });

    it('offers the updates of the manga again once the library has a manga, whatever the sources', () => {
        useMangaStore.setState({ library: [makeLibraryManga([], { id: 1 })], browse: { ...initialManga.browse, sources: [], sourcesStatus: 'ready' } });
        render(<SectionCards />);
        expect(screen.getByRole('button', { name: 'UPDATES: MANGA' })).toBeInTheDocument();
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

describe('animeFirstAction and mangaFirstAction', () => {
    it('lead the anime to its updates, or to its search while its library is empty', () => {
        const updates = animeFirstAction(false);
        const search = animeFirstAction(true);
        expect([updates.label, search.label]).toEqual(['anime.nav.updates', 'anime.nav.search']);
        updates.onClick();
        search.onClick();
        expect(actions.openAnime.mock.calls).toEqual([['updates'], ['search']]);
    });

    it('lead the manga to its updates, or, while its library is empty, to the browse when there is a source and to the extensions otherwise', () => {
        const cases = [mangaFirstAction(false, false), mangaFirstAction(false, true), mangaFirstAction(true, true), mangaFirstAction(true, false)];
        expect(cases.map((action) => {
            return action.label;
        })).toEqual(['manga.nav.updates', 'manga.nav.updates', 'manga.nav.browse', 'manga.nav.extensions']);
        cases.forEach((action) => {
            action.onClick();
        });
        expect(actions.openManga.mock.calls).toEqual([['updates'], ['updates'], ['browse'], ['extensions']]);
    });
});
