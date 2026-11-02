// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { useHiddenSourceIds, useShownHistory, useShownJobs, useShownLibrary, useShownUpdates } from '@renderer/hooks/useShownManga';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeLibraryManga, makeMangaJob, makeMangaStatus, makeSource } from '../../helpers/mangaFixtures';
import { makeMangaUpdate, makeReading } from '../../helpers/homeFixtures';

const initialApp = useAppStore.getState();
const initialManga = useMangaStore.getState();

const SOURCES = [makeSource({ id: 'safe', contentWarning: 'SAFE' }), makeSource({ id: 'adult', contentWarning: 'NSFW' })];
const SAFE = makeLibraryManga([], { id: 1, remoteId: 11, sourceId: 'safe', title: 'Safe' });
const ADULT = makeLibraryManga([], { id: 2, remoteId: 12, sourceId: 'adult', title: 'Adult' });
const REMOVED = makeLibraryManga([], { id: 3, remoteId: 13, sourceId: 'removed', title: 'Removed' });

const loadSources = vi.fn<() => Promise<void>>();

function setAdult(showAdult: boolean): void {
    useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, mangaShowAdult: showAdult } });
}

beforeEach(() => {
    loadSources.mockReset();
    loadSources.mockResolvedValue(undefined);
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS });
    useMangaStore.setState({
        ...initialManga,
        status: makeMangaStatus({ supported: true, server: 'running' }),
        browse: { ...initialManga.browse, sources: SOURCES, sourcesStatus: 'ready' },
        library: [SAFE, ADULT, REMOVED],
        history: [makeReading({ id: 1, sourceId: 'safe' }), makeReading({ id: 2, sourceId: 'adult' }), makeReading({ id: 3, sourceId: 'removed' })],
        updates: [makeMangaUpdate({ id: 1, mangaId: 1 }), makeMangaUpdate({ id: 2, mangaId: 2 }), makeMangaUpdate({ id: 3, mangaId: 3 })],
        jobs: [makeMangaJob({ chapterId: 1, sourceId: 'safe' }), makeMangaJob({ chapterId: 2, sourceId: 'adult' }), makeMangaJob({ chapterId: 3, sourceId: 'removed' })],
        loadSources
    });
});

describe('useHiddenSourceIds', () => {
    it('hides the adult sources while the setting is off', () => {
        const { result } = renderHook(() => {
            return useHiddenSourceIds();
        });
        expect([...result.current]).toEqual(['adult']);
    });

    it('hides nothing while the setting is on', () => {
        setAdult(true);
        const { result } = renderHook(() => {
            return useHiddenSourceIds();
        });
        expect(result.current.size).toBe(0);
    });

    it('follows the setting when it changes', () => {
        const { result } = renderHook(() => {
            return useHiddenSourceIds();
        });
        expect([...result.current]).toEqual(['adult']);
        act(() => {
            setAdult(true);
        });
        expect(result.current.size).toBe(0);
    });

    it('reads the sources when they were not read yet and the server is running', () => {
        useMangaStore.setState({ browse: { ...initialManga.browse, sources: [], sourcesStatus: 'idle' } });
        renderHook(() => {
            return useHiddenSourceIds();
        });
        expect(loadSources).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['the sources are loading', { sourcesStatus: 'loading' as const }, true, true],
        ['the sources are read', { sourcesStatus: 'ready' as const }, true, true],
        ['the sources failed', { sourcesStatus: 'error' as const }, true, true],
        ['the server is not running', { sourcesStatus: 'idle' as const }, false, true],
        ['the manga section is not supported', { sourcesStatus: 'idle' as const }, true, false],
        ['the adult sources are listed', { sourcesStatus: 'idle' as const }, true, true]
    ])('does not read the sources when %s', (reason, browse, running, supported) => {
        useMangaStore.setState({
            status: makeMangaStatus({ supported, server: running ? 'running' : 'stopped' }),
            browse: { ...initialManga.browse, sources: [], ...browse }
        });
        setAdult(reason === 'the adult sources are listed');
        renderHook(() => {
            return useHiddenSourceIds();
        });
        expect(loadSources).not.toHaveBeenCalled();
    });

    it('hides nothing before the sources are known', () => {
        useMangaStore.setState({ browse: { ...initialManga.browse, sources: [], sourcesStatus: 'idle' } });
        const { result } = renderHook(() => {
            return useHiddenSourceIds();
        });
        expect(result.current.size).toBe(0);
    });
});

describe('what the user sees', () => {
    it('shows a library without the mangas of the adult sources, keeping the ones whose source is gone', () => {
        const { result } = renderHook(() => {
            return useShownLibrary();
        });
        expect(result.current).toEqual([SAFE, REMOVED]);
    });

    it('shows the whole library when the adult sources are listed', () => {
        setAdult(true);
        const { result } = renderHook(() => {
            return useShownLibrary();
        });
        expect(result.current).toEqual([SAFE, ADULT, REMOVED]);
    });

    it('shows the history without the readings of the adult sources', () => {
        const { result } = renderHook(() => {
            return useShownHistory();
        });
        expect(
            result.current.map((entry) => {
                return entry.id;
            })
        ).toEqual([1, 3]);
    });

    it('shows the new chapters without the ones of the mangas of the adult sources', () => {
        const { result } = renderHook(() => {
            return useShownUpdates();
        });
        expect(
            result.current.map((entry) => {
                return entry.id;
            })
        ).toEqual([1, 3]);
    });

    it('shows the downloads without the ones of the adult sources', () => {
        const { result } = renderHook(() => {
            return useShownJobs();
        });
        expect(
            result.current.map((job) => {
                return job.chapterId;
            })
        ).toEqual([1, 3]);
    });

    it('does not change what the store keeps', () => {
        renderHook(() => {
            return [useShownLibrary(), useShownHistory(), useShownUpdates(), useShownJobs()];
        });
        const state = useMangaStore.getState();
        expect(state.library).toHaveLength(3);
        expect(state.history).toHaveLength(3);
        expect(state.updates).toHaveLength(3);
        expect(state.jobs).toHaveLength(3);
    });

    it('gives the same list between renders while nothing changes', () => {
        const { result, rerender } = renderHook(() => {
            return useShownLibrary();
        });
        const first = result.current;
        rerender();
        expect(result.current).toBe(first);
    });
});
