// @vitest-environment jsdom
import { act, fireEvent, render, renderHook } from '@testing-library/react';
import { BRAND_WAVE_BARS, BrandWave, DANCE_MS, useLogoClicks } from '@renderer/fx/BrandWave';
import { useFxStore } from '@renderer/fx/fxStore';
import { useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeJob } from '../../helpers/mockApi';

beforeEach(() => {
    vi.useFakeTimers();
    useFxStore.setState({ celebrations: 0, failures: 0, dances: 0, rainbow: false });
    useAppStore.setState({ jobs: [] });
    useAnimeStore.setState({ jobs: [] });
    useMangaStore.setState({ jobs: [] });
});

afterEach(() => {
    vi.useRealTimers();
});

function wave(container: HTMLElement): HTMLElement {
    return container.querySelector('.brand__wave') as HTMLElement;
}

describe('BrandWave', () => {
    it('draws five bars, hidden from the screen readers, and lies flat when nothing goes on', () => {
        const { container } = render(<BrandWave />);
        expect(BRAND_WAVE_BARS).toBe(5);
        expect(container.querySelectorAll('.brand__bar')).toHaveLength(5);
        expect(wave(container).getAttribute('aria-hidden')).toBe('true');
        expect(wave(container).className).toBe('brand__wave brand__wave--idle');
        expect(wave(container).dataset.activity).toBe('idle');
    });

    it('rises with the downloads going on', () => {
        useAppStore.setState({ jobs: [makeJob({ id: 'a', status: 'running' })] });
        const { container } = render(<BrandWave />);
        expect(wave(container).className).toBe('brand__wave brand__wave--busy');
        expect(wave(container).dataset.activity).toBe('busy');
    });

    it('dances for a moment when something finishes and then settles', () => {
        const { container } = render(<BrandWave />);
        act(() => {
            useFxStore.getState().celebrate();
        });
        expect(wave(container).className).toBe('brand__wave brand__wave--idle brand__wave--dance');
        act(() => {
            vi.advanceTimersByTime(DANCE_MS);
        });
        expect(wave(container).className).toBe('brand__wave brand__wave--idle');
    });

    it('runs through every colour in the secret mode', () => {
        const { container } = render(<BrandWave />);
        act(() => {
            useFxStore.getState().toggleRainbow();
        });
        expect(wave(container).className).toBe('brand__wave brand__wave--idle brand__wave--rainbow');
    });

    it('does not dance when it is drawn before anything happened', () => {
        useFxStore.setState({ dances: 0 });
        const { container } = render(<BrandWave />);
        act(() => {
            vi.advanceTimersByTime(DANCE_MS * 2);
        });
        expect(wave(container).className).not.toContain('dance');
    });
});

describe('useLogoClicks', () => {
    it('makes the wave dance at the fifth close click and starts counting again', () => {
        const { result } = renderHook(() => { return useLogoClicks(); });
        for (let click = 0; click < 4; click += 1) {
            result.current();
            vi.advanceTimersByTime(100);
        }
        expect(useFxStore.getState().dances).toBe(0);
        result.current();
        expect(useFxStore.getState().dances).toBe(1);
        result.current();
        expect(useFxStore.getState().dances).toBe(1);
    });

    it('does not count clicks that are far apart', () => {
        const { result } = renderHook(() => { return useLogoClicks(); });
        for (let click = 0; click < 6; click += 1) {
            result.current();
            vi.advanceTimersByTime(2000);
        }
        expect(useFxStore.getState().dances).toBe(0);
    });

    it('is the click handler of the brand in the top bar', () => {
        function Brand() {
            const onClick = useLogoClicks();
            return <div data-testid="brand" onClick={onClick} />;
        }
        const { getByTestId } = render(<Brand />);
        for (let click = 0; click < 5; click += 1) {
            fireEvent.click(getByTestId('brand'));
        }
        expect(useFxStore.getState().dances).toBe(1);
    });
});
