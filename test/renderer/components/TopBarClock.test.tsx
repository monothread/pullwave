// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { LanguageSetting } from '@shared/types';
import { TopBarClock } from '@renderer/components/TopBarClock';
import { CLOCK_TICK_MS } from '@renderer/hooks/useClock';
import { useAppStore } from '@renderer/store/appStore';

const initial = useAppStore.getState();

function useLanguage(language: LanguageSetting): void {
    useAppStore.setState({ ...initial, settings: { ...DEFAULT_SETTINGS, language } });
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 1, 14, 5, 58));
});

afterEach(() => {
    vi.useRealTimers();
    useAppStore.setState(initial);
});

describe('TopBarClock', () => {
    it('shows the hour and the minute in a <time> named for the screen readers', () => {
        useLanguage('pt');
        render(<TopBarClock />);
        const clock = screen.getByLabelText('Hora: 14:05');
        expect(clock.tagName).toBe('TIME');
        expect(clock).toHaveClass('topbar__clock');
        expect(clock).toHaveTextContent(/^14:05$/);
        expect(clock).toHaveAttribute('datetime', '14:05');
    });

    it('uses the way the language of the interface writes the time', () => {
        useLanguage('en');
        render(<TopBarClock />);
        const clock = screen.getByLabelText(/^Time: 02:05\sPM$/);
        expect(clock).toHaveTextContent(/^02:05\sPM$/);
        expect(clock).toHaveAttribute('datetime', '14:05');
    });

    it.each([
        ['es', 'Hora: 14:05'],
        ['ja', '時刻: 14:05']
    ] as const)('names the clock in %s', (language, label) => {
        useLanguage(language);
        render(<TopBarClock />);
        expect(screen.getByLabelText(label)).toHaveTextContent('14:05');
    });

    it('moves on to the next minute by itself', async () => {
        useLanguage('pt');
        render(<TopBarClock />);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(CLOCK_TICK_MS);
        });
        const clock = screen.getByLabelText('Hora: 14:06');
        expect(clock).toHaveTextContent('14:06');
        expect(clock).toHaveAttribute('datetime', '14:06');
    });
});
