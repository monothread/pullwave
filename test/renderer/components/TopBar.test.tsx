// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { TopBar } from '@renderer/components/TopBar';
import { useFxStore } from '@renderer/fx/fxStore';
import { installMockApi } from '../../helpers/mockApi';

beforeEach(() => {
    installMockApi();
});

describe('TopBar', () => {
    it('holds the start (the menu and the name with its wave), the search and the end of the bar, in that order', () => {
        render(<TopBar menuOpen={false} onToggleMenu={vi.fn()} />);
        const header = document.querySelector('header') as HTMLElement;
        expect(header).toHaveClass('app__header', 'topbar');
        expect(
            Array.from(header.children).map((child) => {
                return child.className;
            })
        ).toEqual(['topbar__start', 'global-search', 'topbar__end']);
        const start = header.querySelector('.topbar__start') as HTMLElement;
        expect(
            Array.from(start.children).map((child) => {
                return child.className;
            })
        ).toEqual(['topbar__button topbar__menu', 'brand']);
        expect(screen.getByRole('heading', { level: 1, name: 'PULLWAVE' })).toHaveClass('logo');
        expect(header.querySelectorAll('.brand__wave .brand__bar')).toHaveLength(5);
        expect(header.querySelector('.brand__wave')).toHaveAttribute('aria-hidden', 'true');
        expect(screen.getByRole('combobox', { name: 'Search' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Downloads going on/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Turn the sounds off' })).toBeInTheDocument();
    });

    it('says whether the menu is open and toggles it', () => {
        const onToggleMenu = vi.fn();
        const { rerender } = render(<TopBar menuOpen={false} onToggleMenu={onToggleMenu} />);
        const closed = screen.getByRole('button', { name: 'Open the menu' });
        expect(closed).toHaveAttribute('aria-expanded', 'false');
        expect(closed).toHaveAttribute('aria-controls', 'side-nav');
        fireEvent.click(closed);
        expect(onToggleMenu).toHaveBeenCalledTimes(1);
        rerender(<TopBar menuOpen onToggleMenu={onToggleMenu} />);
        expect(screen.getByRole('button', { name: 'Close the menu' })).toHaveAttribute('aria-expanded', 'true');
    });
});

describe('TopBar: the wave and the name', () => {
    it('lies flat while nothing goes on', () => {
        render(<TopBar menuOpen={false} onToggleMenu={vi.fn()} />);
        expect(document.querySelector('.brand__wave')).toHaveClass('brand__wave--idle');
    });

    it('makes the wave dance after five quick clicks on the name', () => {
        useFxStore.setState({ celebrations: 0, failures: 0, dances: 0, rainbow: false });
        render(<TopBar menuOpen={false} onToggleMenu={vi.fn()} />);
        const brand = document.querySelector('.brand') as HTMLElement;
        for (let click = 0; click < 4; click += 1) {
            fireEvent.click(brand);
        }
        expect(useFxStore.getState().dances).toBe(0);
        fireEvent.click(brand);
        expect(useFxStore.getState().dances).toBe(1);
        expect(document.querySelector('.brand__wave')).toHaveClass('brand__wave--dance');
    });
});
