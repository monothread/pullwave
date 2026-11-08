// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { activityOf, RUSH_FROM, useActivityLevel } from '@renderer/fx/useActivityLevel';
import { useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeAnimeJob } from '../../helpers/animeFixtures';
import { makeMangaJob } from '../../helpers/mangaFixtures';
import { makeJob } from '../../helpers/mockApi';

beforeEach(() => {
    useAppStore.setState({ jobs: [] });
    useAnimeStore.setState({ jobs: [] });
    useMangaStore.setState({ jobs: [] });
});

describe('activityOf', () => {
    it('is idle with no download, busy with a few and a rush from four', () => {
        expect(RUSH_FROM).toBe(4);
        expect(activityOf(0)).toBe('idle');
        expect(activityOf(1)).toBe('busy');
        expect(activityOf(3)).toBe('busy');
        expect(activityOf(4)).toBe('rush');
        expect(activityOf(9)).toBe('rush');
    });
});

describe('useActivityLevel', () => {
    it('is idle while nothing downloads, and does not count a finished download', () => {
        useAppStore.setState({ jobs: [makeJob({ id: 'a', status: 'done' })] });
        const { result } = renderHook(() => { return useActivityLevel(); });
        expect(result.current).toBe('idle');
    });

    it('counts the downloads of every section', () => {
        const { result } = renderHook(() => { return useActivityLevel(); });
        act(() => {
            useAppStore.setState({ jobs: [makeJob({ id: 'a', status: 'running' })] });
        });
        expect(result.current).toBe('busy');
        act(() => {
            useAnimeStore.setState({ jobs: [makeAnimeJob({ episodeId: 1, status: 'running' }), makeAnimeJob({ episodeId: 2, status: 'queued' })] });
            useMangaStore.setState({ jobs: [makeMangaJob({ chapterId: 1, status: 'running' })] });
        });
        expect(result.current).toBe('rush');
    });
});
