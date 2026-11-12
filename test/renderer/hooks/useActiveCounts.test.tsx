// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { useActiveCounts } from '@renderer/hooks/useActiveCounts';
import { useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeAnimeJob } from '../../helpers/animeFixtures';
import { makeMangaJob, makeSource } from '../../helpers/mangaFixtures';
import { installMockApi, makeJob } from '../../helpers/mockApi';

const initialApp = useAppStore.getState();
const initialAnime = useAnimeStore.getState();
const initialManga = useMangaStore.getState();

beforeEach(() => {
    installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS, jobs: [] });
    useAnimeStore.setState({ ...initialAnime, jobs: [] });
    useMangaStore.setState({ ...initialManga, jobs: [] });
});

function renderCounts() {
    let renders = 0;
    const hook = renderHook(() => {
        renders += 1;
        return useActiveCounts();
    });
    return {
        ...hook,
        renders: () => {
            return renders;
        }
    };
}

describe('useActiveCounts', () => {
    it('counts the running, waiting and paused downloads of each section, leaving out the ones that are over', () => {
        useAppStore.setState({
            jobs: [
                makeJob({ id: 'a', status: 'running' }),
                makeJob({ id: 'b', status: 'queued' }),
                makeJob({ id: 'c', status: 'queued' }),
                makeJob({ id: 'd', status: 'done' }),
                makeJob({ id: 'e', status: 'error' })
            ]
        });
        useAnimeStore.setState({ jobs: [makeAnimeJob({ episodeId: 1, status: 'paused' }), makeAnimeJob({ episodeId: 2, status: 'cancelled' })] });
        useMangaStore.setState({ jobs: [makeMangaJob({ chapterId: 1, status: 'running' }), makeMangaJob({ chapterId: 2, status: 'running' }), makeMangaJob({ chapterId: 3, status: 'paused' })] });
        const { result } = renderCounts();
        expect(result.current).toEqual({
            video: { running: 1, queued: 2, paused: 0 },
            anime: { running: 0, queued: 0, paused: 1 },
            manga: { running: 2, queued: 0, paused: 1 }
        });
    });

    it('leaves out the chapters of the sources that are hidden', () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, mangaShowAdult: false } });
        useMangaStore.setState({
            browse: { ...initialManga.browse, sources: [makeSource({ id: 'safe' }), makeSource({ id: 'adult', contentWarning: 'NSFW' })], sourcesStatus: 'ready' },
            jobs: [makeMangaJob({ chapterId: 1, sourceId: 'safe' }), makeMangaJob({ chapterId: 2, sourceId: 'adult' })]
        });
        const { result } = renderCounts();
        expect(result.current.manga).toEqual({ running: 1, queued: 0, paused: 0 });
    });

    it('is not drawn again when only the progress of the downloads changes', () => {
        useAppStore.setState({ jobs: [makeJob({ id: 'a', status: 'running', percent: 10 })] });
        useAnimeStore.setState({ jobs: [makeAnimeJob({ episodeId: 1, status: 'running', percent: 10 })] });
        useMangaStore.setState({ jobs: [makeMangaJob({ chapterId: 1, status: 'running', percent: 10 })] });
        const { result, renders } = renderCounts();
        const first = result.current;
        const before = renders();
        act(() => {
            useAppStore.setState({ jobs: [makeJob({ id: 'a', status: 'running', percent: 50 })] });
            useAnimeStore.setState({ jobs: [makeAnimeJob({ episodeId: 1, status: 'running', percent: 50 })] });
            useMangaStore.setState({ jobs: [makeMangaJob({ chapterId: 1, status: 'running', percent: 50 })] });
        });
        expect(renders()).toBe(before);
        expect(result.current).toBe(first);
    });

    it('is drawn again with new numbers when a download changes state', () => {
        useAppStore.setState({ jobs: [makeJob({ id: 'a', status: 'running' })] });
        const { result } = renderCounts();
        const first = result.current;
        act(() => {
            useAppStore.setState({ jobs: [makeJob({ id: 'a', status: 'done' })] });
        });
        expect(result.current).not.toBe(first);
        expect(result.current.video).toEqual({ running: 0, queued: 0, paused: 0 });
        expect(result.current.anime).toBe(first.anime);
        expect(result.current.manga).toBe(first.manga);
    });
});
