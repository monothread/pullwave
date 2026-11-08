// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { LOADING_CLASS, useImageReveal } from '@renderer/fx/useImageReveal';

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
});
