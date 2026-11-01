// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { AUTO_NEXT_DELAY_MS, AUTO_NEXT_TICK_MS, AutoNextPanel } from '@renderer/components/AutoNextPanel';

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

function renderPanel(delayMs?: number) {
    const onGo = vi.fn();
    const onCancel = vi.fn();
    const view = render(<AutoNextPanel title="Frieren · EP 5" onGo={onGo} onCancel={onCancel} delayMs={delayMs} />);
    return { onGo, onCancel, ...view };
}

function advance(milliseconds: number): void {
    act(() => {
        vi.advanceTimersByTime(milliseconds);
    });
}

describe('the constants', () => {
    it('counts ten seconds, a tenth of a second at a time', () => {
        expect(AUTO_NEXT_DELAY_MS).toBe(10_000);
        expect(AUTO_NEXT_TICK_MS).toBe(100);
    });
});

describe('AutoNextPanel', () => {
    it('says which episode comes next, with an empty bar, the seconds left and the two buttons', () => {
        renderPanel();
        const panel = screen.getByRole('region', { name: 'NEXT EPISODE' });
        expect(panel).toHaveClass('player__auto-next');
        expect(panel).toHaveAttribute('data-testid', 'auto-next');
        expect(within(panel).getByText('NEXT EPISODE')).toHaveClass('player__auto-next-label');
        expect(within(panel).getByText('Frieren · EP 5')).toHaveClass('player__auto-next-title');
        const bar = within(panel).getByRole('progressbar', { name: 'Time until the next episode starts' });
        expect(bar).toHaveAttribute('aria-valuemin', '0');
        expect(bar).toHaveAttribute('aria-valuemax', '100');
        expect(bar).toHaveAttribute('aria-valuenow', '0');
        expect(bar.querySelector('.progress__bar')).toHaveStyle({ width: '0%' });
        expect(within(panel).getByText('Starts in 10s')).toHaveAttribute('aria-live', 'polite');
        const go = within(panel).getByRole('button', { name: 'PLAY NOW' });
        expect(go).toHaveClass('btn', 'btn--small', 'btn--primary');
        expect(go).toHaveFocus();
        expect(within(panel).getByRole('button', { name: 'CANCEL' })).toHaveClass('btn', 'btn--small');
    });

    it('fills the bar and counts the seconds down as the time passes', () => {
        renderPanel();
        advance(2_500);
        const bar = screen.getByRole('progressbar', { name: 'Time until the next episode starts' });
        expect(bar).toHaveAttribute('aria-valuenow', '25');
        expect(bar.querySelector('.progress__bar')).toHaveStyle({ width: '25%' });
        expect(screen.getByText('Starts in 8s')).toBeInTheDocument();
        advance(5_000);
        expect(bar).toHaveAttribute('aria-valuenow', '75');
        expect(screen.getByText('Starts in 3s')).toBeInTheDocument();
    });

    it('goes to the next episode once, when the bar is full', () => {
        const { onGo, onCancel } = renderPanel();
        advance(AUTO_NEXT_DELAY_MS - AUTO_NEXT_TICK_MS);
        expect(onGo).not.toHaveBeenCalled();
        advance(AUTO_NEXT_TICK_MS);
        expect(onGo).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('progressbar', { name: 'Time until the next episode starts' })).toHaveAttribute('aria-valuenow', '100');
        expect(screen.getByText('Starts in 0s')).toBeInTheDocument();
        advance(AUTO_NEXT_DELAY_MS);
        expect(onGo).toHaveBeenCalledTimes(1);
        expect(onCancel).not.toHaveBeenCalled();
    });

    it('counts the time it is given', () => {
        const { onGo } = renderPanel(3_000);
        expect(screen.getByText('Starts in 3s')).toBeInTheDocument();
        advance(3_000);
        expect(onGo).toHaveBeenCalledTimes(1);
    });

    it('goes at once with PLAY NOW, and stays with CANCEL', () => {
        const { onGo, onCancel } = renderPanel();
        fireEvent.click(screen.getByRole('button', { name: 'PLAY NOW' }));
        expect(onGo).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: 'CANCEL' }));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('stops counting when it goes away', () => {
        const { onGo, unmount } = renderPanel();
        advance(4_000);
        unmount();
        advance(AUTO_NEXT_DELAY_MS);
        expect(onGo).not.toHaveBeenCalled();
    });

    it('does not start the count again when it is drawn again, and calls the last way to go it was given', () => {
        const first = vi.fn();
        const second = vi.fn();
        const { rerender } = render(<AutoNextPanel title="A" onGo={first} onCancel={vi.fn()} />);
        advance(6_000);
        rerender(<AutoNextPanel title="A" onGo={second} onCancel={vi.fn()} />);
        advance(4_000);
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });
});
