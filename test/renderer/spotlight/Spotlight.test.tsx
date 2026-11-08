// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { SPOTLIGHT_ROTATE_MS, SPOTLIGHT_SLIDE_MS, Spotlight, slideAfter, type SpotlightSlide } from '@renderer/spotlight/Spotlight';
import { useBackdropStore } from '@renderer/store/backdropStore';

let reduceMotion = false;

function slide(n: number, overrides: Partial<SpotlightSlide> = {}): SpotlightSlide {
    return {
        key: `s${String(n)}`,
        eyebrow: 'CONTINUE WATCHING',
        title: `Title ${String(n)}`,
        meta: `Episode ${String(n)}`,
        art: <img data-testid={`art-${String(n)}`} alt="" />,
        imageUrl: `https://img/${String(n)}.jpg`,
        progress: 0.5,
        primary: { label: '▶ CONTINUE', ariaLabel: `▶ CONTINUE: Title ${String(n)}`, onClick: vi.fn() },
        ...overrides
    };
}

beforeEach(() => {
    vi.useFakeTimers();
    reduceMotion = false;
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: (query: string) => {
            return { matches: query === '(prefers-reduced-motion: reduce)' && reduceMotion };
        }
    });
    useBackdropStore.setState({ url: null });
});

afterEach(() => {
    vi.useRealTimers();
});

function shownTitle(): string | null {
    return screen.getByRole('heading', { level: 2 }).textContent;
}

describe('slideAfter', () => {
    it.each([
        [0, 1, 3, 1],
        [2, 1, 3, 0],
        [0, -1, 3, 2],
        [1, 5, 3, 0],
        [0, 1, 0, 0]
    ])('from %d by %d of %d goes to %d', (index, step, count, expected) => {
        expect(slideAfter(index, step, count)).toBe(expected);
    });
});

describe('Spotlight', () => {
    it('changes every five seconds, in a change of 0.7 s', () => {
        expect(SPOTLIGHT_ROTATE_MS).toBe(5000);
        expect(SPOTLIGHT_SLIDE_MS).toBe(700);
    });

    it('brings the next slide in from the right while the one shown leaves to the left, then takes the old one away', () => {
        render(<Spotlight slides={[slide(1), slide(2), slide(3)]} label="Highlights" />);
        fireEvent.click(screen.getByRole('button', { name: 'Next highlight' }));
        const stage = document.querySelector('.spotlight__stage') as HTMLElement;
        const [leaving, entering] = Array.from(stage.children);
        expect(leaving).toHaveClass('spotlight__slide', 'spotlight__slide--leaving', 'spotlight__slide--forward');
        expect(leaving).toHaveAttribute('aria-hidden', 'true');
        expect(leaving).toHaveAttribute('inert');
        expect(leaving?.querySelector('.hero__title')).toHaveTextContent('Title 1');
        expect(entering).toHaveClass('spotlight__slide', 'spotlight__slide--entering', 'spotlight__slide--forward');
        expect(entering).toHaveAttribute('aria-label', '2 of 3');
        // Only the slide shown is a slide for the screen readers.
        expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
        act(() => {
            vi.advanceTimersByTime(SPOTLIGHT_SLIDE_MS);
        });
        expect(stage.children).toHaveLength(1);
        expect(stage.children[0]).not.toHaveClass('spotlight__slide--entering');
    });

    it('brings the slide before in from the left, and a dot before the one shown the same way', () => {
        render(<Spotlight slides={[slide(1), slide(2), slide(3)]} label="Highlights" />);
        fireEvent.click(screen.getByRole('button', { name: 'Previous highlight' }));
        expect(document.querySelector('.spotlight__slide--entering')).toHaveClass('spotlight__slide--back');
        expect(document.querySelector('.spotlight__slide--leaving')).toHaveClass('spotlight__slide--back');
        act(() => {
            vi.advanceTimersByTime(SPOTLIGHT_SLIDE_MS);
        });
        fireEvent.click(screen.getByRole('button', { name: 'Highlight 1 of 3' }));
        expect(document.querySelector('.spotlight__slide--entering')).toHaveClass('spotlight__slide--back');
        act(() => {
            vi.advanceTimersByTime(SPOTLIGHT_SLIDE_MS);
        });
        fireEvent.click(screen.getByRole('button', { name: 'Highlight 3 of 3' }));
        expect(document.querySelector('.spotlight__slide--entering')).toHaveClass('spotlight__slide--forward');
    });

    it('does nothing when the dot of the slide shown is pressed', () => {
        render(<Spotlight slides={[slide(1), slide(2)]} label="Highlights" />);
        fireEvent.click(screen.getByRole('button', { name: 'Highlight 1 of 2' }));
        expect(document.querySelector('.spotlight__slide--leaving')).toBeNull();
        expect(shownTitle()).toBe('Title 1');
    });

    it('changes the slide with its soft change also when the system asks for less motion (D-130)', () => {
        reduceMotion = true;
        render(<Spotlight slides={[slide(1), slide(2)]} label="Highlights" />);
        fireEvent.click(screen.getByRole('button', { name: 'Next highlight' }));
        expect(shownTitle()).toBe('Title 2');
        expect(document.querySelector('.spotlight__slide--leaving')).not.toBeNull();
        expect(document.querySelector('.spotlight__slide--entering')).not.toBeNull();
    });

    it('keeps going by itself while the screen around is drawn again', () => {
        const slides = [slide(1), slide(2)];
        const { rerender } = render(<Spotlight slides={slides} label="Highlights" />);
        act(() => {
            vi.advanceTimersByTime(SPOTLIGHT_ROTATE_MS - 1000);
        });
        rerender(<Spotlight slides={slides} label="Highlights" />);
        act(() => {
            vi.advanceTimersByTime(1000);
        });
        expect(shownTitle()).toBe('Title 2');
    });

    it('draws nothing with no slide', () => {
        const { container } = render(<Spotlight slides={[]} label="Highlights" />);
        expect(container).toBeEmptyDOMElement();
    });

    it('is a carousel that shows the first slide: its art, words, bar and buttons', () => {
        const secondary = { label: 'DETAILS', ariaLabel: 'DETAILS: Title 1', onClick: vi.fn() };
        render(<Spotlight slides={[slide(1, { secondary }), slide(2)]} label="Highlights" />);
        const carousel = screen.getByRole('region', { name: 'Highlights' });
        expect(carousel).toHaveAttribute('aria-roledescription', 'carousel');
        const current = within(carousel).getByRole('group', { name: '1 of 2' });
        expect(current).toHaveAttribute('aria-roledescription', 'slide');
        expect(current).toHaveClass('spotlight__slide', 'hero');
        expect(current.style.getPropertyValue('--hero-image')).toBe('url("https://img/1.jpg")');
        expect(within(current).getByTestId('art-1')).toBeInTheDocument();
        expect(current.querySelector('.hero__eyebrow')).toHaveTextContent('CONTINUE WATCHING');
        expect(shownTitle()).toBe('Title 1');
        expect(current.querySelector('.hero__meta')).toHaveTextContent('Episode 1');
        expect(current.querySelector('.hero__progress-fill')).toHaveStyle({ width: '50%' });
        fireEvent.click(within(current).getByRole('button', { name: 'DETAILS: Title 1' }));
        expect(secondary.onClick).toHaveBeenCalledTimes(1);
    });

    it('calls the action of the main button', () => {
        const first = slide(1);
        render(<Spotlight slides={[first]} label="Highlights" />);
        fireEvent.click(screen.getByRole('button', { name: '▶ CONTINUE: Title 1' }));
        expect(first.primary.onClick).toHaveBeenCalledTimes(1);
    });

    it('has no bar, no second button and no controls for a single slide with no progress', () => {
        render(<Spotlight slides={[slide(1, { progress: null, imageUrl: null })]} label="Highlights" />);
        const current = screen.getByRole('group', { name: '1 of 1' });
        expect(current.querySelector('.hero__progress')).toBeNull();
        expect(current.querySelectorAll('button')).toHaveLength(1);
        expect(current.style.getPropertyValue('--hero-image')).toBe('');
        expect(screen.queryByRole('button', { name: 'Next highlight' })).not.toBeInTheDocument();
    });

    it('goes to the next and previous slide with the arrows, going round, and to a slide with its dot', () => {
        render(<Spotlight slides={[slide(1), slide(2), slide(3)]} label="Highlights" />);
        fireEvent.click(screen.getByRole('button', { name: 'Next highlight' }));
        expect(shownTitle()).toBe('Title 2');
        fireEvent.click(screen.getByRole('button', { name: 'Previous highlight' }));
        fireEvent.click(screen.getByRole('button', { name: 'Previous highlight' }));
        expect(shownTitle()).toBe('Title 3');
        fireEvent.click(screen.getByRole('button', { name: 'Highlight 2 of 3' }));
        expect(shownTitle()).toBe('Title 2');
        expect(screen.getByRole('button', { name: 'Highlight 2 of 3' })).toHaveAttribute('aria-current', 'true');
        expect(screen.getByRole('button', { name: 'Highlight 2 of 3' })).toHaveClass('spotlight__dot', 'spotlight__dot--current');
        expect(screen.getByRole('button', { name: 'Highlight 1 of 3' })).not.toHaveAttribute('aria-current');
    });

    it('goes to the next slide by itself every five seconds, and never stops: not with the mouse on it, nor with the focus in it', () => {
        render(<Spotlight slides={[slide(1), slide(2)]} label="Highlights" />);
        act(() => {
            vi.advanceTimersByTime(SPOTLIGHT_ROTATE_MS);
        });
        expect(shownTitle()).toBe('Title 2');
        act(() => {
            vi.advanceTimersByTime(SPOTLIGHT_ROTATE_MS);
        });
        expect(shownTitle()).toBe('Title 1');
        const carousel = screen.getByRole('region', { name: 'Highlights' });
        fireEvent.mouseEnter(carousel);
        act(() => {
            vi.advanceTimersByTime(SPOTLIGHT_ROTATE_MS);
        });
        expect(shownTitle()).toBe('Title 2');
        fireEvent.focus(screen.getByRole('button', { name: 'Next highlight' }));
        act(() => {
            vi.advanceTimersByTime(SPOTLIGHT_ROTATE_MS);
        });
        expect(shownTitle()).toBe('Title 1');
    });

    it('starts the five seconds again from the slide chosen with an arrow or a dot', () => {
        render(<Spotlight slides={[slide(1), slide(2), slide(3)]} label="Highlights" />);
        act(() => {
            vi.advanceTimersByTime(SPOTLIGHT_ROTATE_MS - 1000);
        });
        fireEvent.click(screen.getByRole('button', { name: 'Highlight 3 of 3' }));
        act(() => {
            vi.advanceTimersByTime(SPOTLIGHT_ROTATE_MS - 1);
        });
        expect(shownTitle()).toBe('Title 3');
        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(shownTitle()).toBe('Title 1');
    });

    it('goes on by itself also when the system asks for less motion (D-130), and not with a single slide', () => {
        reduceMotion = true;
        const { unmount } = render(<Spotlight slides={[slide(1), slide(2)]} label="Highlights" />);
        act(() => {
            vi.advanceTimersByTime(SPOTLIGHT_ROTATE_MS);
        });
        expect(shownTitle()).toBe('Title 2');
        unmount();
        reduceMotion = false;
        render(<Spotlight slides={[slide(1)]} label="Highlights" />);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('puts the cover of the slide shown behind the screen, and leaves it alone for a slide with none', () => {
        render(<Spotlight slides={[slide(1), slide(2, { imageUrl: null })]} label="Highlights" />);
        expect(useBackdropStore.getState().url).toBe('https://img/1.jpg');
        fireEvent.click(screen.getByRole('button', { name: 'Next highlight' }));
        expect(useBackdropStore.getState().url).toBe('https://img/1.jpg');
    });

    it('shows the last slide when the list gets shorter than the slide shown', () => {
        const { rerender } = render(<Spotlight slides={[slide(1), slide(2), slide(3)]} label="Highlights" />);
        fireEvent.click(screen.getByRole('button', { name: 'Highlight 3 of 3' }));
        rerender(<Spotlight slides={[slide(1), slide(2)]} label="Highlights" />);
        expect(shownTitle()).toBe('Title 2');
        expect(screen.getByRole('group', { name: '2 of 2' })).toBeInTheDocument();
    });

    it('stops going on by itself when it goes away', () => {
        const { unmount } = render(<Spotlight slides={[slide(1), slide(2)]} label="Highlights" />);
        unmount();
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('Spotlight: the parallax', () => {
    it('gives the pointer to the style sheet, from -1 to 1 across the carousel, and puts it back at the middle when it leaves', () => {
        render(<Spotlight slides={[slide(1), slide(2)]} label="Highlights" />);
        const stage = document.querySelector('.spotlight__stage') as HTMLElement;
        stage.getBoundingClientRect = () => { return { left: 0, top: 0, width: 400, height: 200 } as DOMRect; };
        fireEvent.pointerMove(stage, { clientX: 300, clientY: 50 });
        expect(stage.style.getPropertyValue('--px')).toBe('0.500');
        expect(stage.style.getPropertyValue('--py')).toBe('-0.500');
        fireEvent.pointerLeave(stage);
        expect(stage.style.getPropertyValue('--px')).toBe('0');
        expect(stage.style.getPropertyValue('--py')).toBe('0');
    });
});
