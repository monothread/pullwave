// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { LOADING_CLASS, useImageReveal } from '@renderer/fx/useImageReveal';
import { useAppStore } from '@renderer/store/appStore';

afterEach(() => {
    cleanup();
    useAppStore.setState({ settings: DEFAULT_SETTINGS });
});

describe('useImageReveal', () => {
    it('blurs the picture until it has loaded and then lets it into focus', () => {
        const { result } = renderHook(() => { return useImageReveal(); });
        expect(LOADING_CLASS).toBe('cover--loading');
        expect(result.current.className('cover')).toBe('cover cover--loading');
        act(() => {
            result.current.onLoad({} as never);
        });
        expect(result.current.className('cover')).toBe('cover');
    });

    it('skips the loading class in performance mode without triggering re-renders on load', () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, performanceMode: true } });
        let renders = 0;
        const { result } = renderHook(() => {
            renders += 1;
            return useImageReveal();
        });
        expect(result.current.className('cover')).toBe('cover');
        expect(renders).toBe(1);
        act(() => {
            result.current.onLoad({} as never);
        });
        expect(renders).toBe(1);
    });
});
