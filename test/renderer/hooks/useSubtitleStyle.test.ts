// @vitest-environment jsdom
import { createRef, type RefObject } from 'react';
import { act, renderHook } from '@testing-library/react';
import { useSubtitleStyle } from '@renderer/hooks/useSubtitleStyle';

function makeVideo(): { video: HTMLVideoElement; ref: RefObject<HTMLVideoElement | null> } {
    const video = document.createElement('video');
    const ref = createRef<HTMLVideoElement>();
    (ref as { current: HTMLVideoElement | null }).current = video;
    return { video, ref };
}

beforeEach(() => {
    window.localStorage.clear();
});

describe('useSubtitleStyle', () => {
    it('starts with the default size', () => {
        const { video, ref } = makeVideo();
        const { result } = renderHook(() => {
            return useSubtitleStyle(ref);
        });
        expect(result.current.scale).toBe(1);
        expect(video.style.getPropertyValue('--subtitle-scale')).toBe('1');
    });

    it('starts with what the viewer chose before', () => {
        window.localStorage.setItem('pullwave-subtitle-scale', '2');
        const { video, ref } = makeVideo();
        const { result } = renderHook(() => {
            return useSubtitleStyle(ref);
        });
        expect(result.current).toMatchObject({ scale: 2 });
        expect(video.style.getPropertyValue('--subtitle-scale')).toBe('2');
    });

    it('resizes by a step, remembers it and shows it on the video', () => {
        const { video, ref } = makeVideo();
        const { result } = renderHook(() => {
            return useSubtitleStyle(ref);
        });
        act(() => {
            result.current.resize(1);
        });
        expect(result.current.scale).toBe(1.25);
        expect(video.style.getPropertyValue('--subtitle-scale')).toBe('1.25');
        expect(window.localStorage.getItem('pullwave-subtitle-scale')).toBe('1.25');
        act(() => {
            result.current.resize(-1);
        });
        act(() => {
            result.current.resize(-1);
        });
        expect(result.current.scale).toBe(0.75);
    });

    it('does not fail when there is no video yet', () => {
        const ref = createRef<HTMLVideoElement>();
        const { result } = renderHook(() => {
            return useSubtitleStyle(ref);
        });
        act(() => {
            result.current.resize(1);
        });
        expect(result.current.scale).toBe(1.25);
    });
});
