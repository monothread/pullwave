// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { useAnimeCoverUrl } from '@renderer/hooks/useAnimeCoverUrl';
import { useDetailBackdrop } from '@renderer/hooks/useDetailBackdrop';
import { useAnimeStore } from '@renderer/store/animeStore';
import { useBackdropStore } from '@renderer/store/backdropStore';

afterEach(() => {
    useBackdropStore.setState({ url: null });
    useAnimeStore.setState({ covers: {} });
});

describe('useDetailBackdrop', () => {
    it('puts the cover behind the screen while the page is open, and takes it away after', () => {
        const { unmount } = renderHook(() => {
            useDetailBackdrop('https://img/cover.jpg');
        });
        expect(useBackdropStore.getState().url).toBe('https://img/cover.jpg');
        unmount();
        expect(useBackdropStore.getState().url).toBeNull();
    });

    it('follows the cover when it changes', () => {
        const { rerender } = renderHook(
            ({ url }) => {
                useDetailBackdrop(url);
            },
            { initialProps: { url: 'https://img/a.jpg' as string | null } }
        );
        rerender({ url: 'https://img/b.jpg' });
        expect(useBackdropStore.getState().url).toBe('https://img/b.jpg');
    });

    it('leaves the backdrop alone with no cover', () => {
        useBackdropStore.setState({ url: 'https://img/kept.jpg' });
        const { unmount } = renderHook(() => {
            useDetailBackdrop(null);
        });
        unmount();
        expect(useBackdropStore.getState().url).toBe('https://img/kept.jpg');
    });
});

describe('useAnimeCoverUrl', () => {
    it('is the address of the cover once it is found, by its title in any case', () => {
        useAnimeStore.setState({ covers: { naruto: { status: 'found', url: 'https://anilist/naruto.jpg' } } });
        const { result } = renderHook(() => {
            return useAnimeCoverUrl('Naruto');
        });
        expect(result.current).toBe('https://anilist/naruto.jpg');
    });

    it.each([
        ['not looked up yet', {}],
        ['not found', { naruto: { status: 'none' as const } }],
        ['could not be asked for', { naruto: { status: 'failed' as const } }]
    ])('is null when it is %s', (_state, covers) => {
        useAnimeStore.setState({ covers });
        const { result } = renderHook(() => {
            return useAnimeCoverUrl('Naruto');
        });
        expect(result.current).toBeNull();
    });
});
