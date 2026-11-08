// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { SECTION_TABS, SideNav } from '@renderer/components/SideNav';

function renderNav(open: boolean, active: 'home' | 'downloads' = 'home') {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const view = render(<SideNav tabs={SECTION_TABS} active={active} open={open} onSelect={onSelect} onClose={onClose} />);
    return { ...view, onSelect, onClose };
}

describe('SECTION_TABS', () => {
    it('lists home, the three sections and the settings, each with its picture (the gear for the settings)', () => {
        expect(SECTION_TABS).toEqual([
            { id: 'home', label: 'tab.home', picture: 'home' },
            { id: 'downloads', label: 'tab.downloads', picture: 'downloads' },
            { id: 'anime', label: 'tab.anime', picture: 'anime' },
            { id: 'manga', label: 'tab.manga', picture: 'manga' },
            { id: 'settings', label: 'tab.settings', picture: 'settings' }
        ]);
    });
});

describe('SideNav', () => {
    it('is the navigation of the sections, a rail while closed, with the active section marked', () => {
        renderNav(false, 'downloads');
        const nav = screen.getByRole('navigation', { name: 'Sections' });
        expect(nav).toHaveAttribute('id', 'side-nav');
        expect(nav).toHaveClass('tabs', 'tabs--main', 'sidenav');
        expect(nav).not.toHaveClass('sidenav--open');
        expect(
            within(nav)
                .getAllByRole('button')
                .map((button) => {
                    return button.getAttribute('aria-label') ?? button.textContent;
                })
        ).toEqual(['HOME', 'VIDEO DOWNLOADER', 'ANIME', 'MANGA', 'SETTINGS (GLOBAL)']);
        expect(screen.getByRole('button', { name: 'VIDEO DOWNLOADER' })).toHaveAttribute('aria-current', 'page');
        expect(document.querySelector('.sidenav__scrim')).toBeNull();
    });

    it('shows only the sections it is given', () => {
        render(<SideNav tabs={SECTION_TABS.filter((tab) => { return tab.id !== 'anime'; })} active="home" open={false} onSelect={vi.fn()} onClose={vi.fn()} />);
        expect(screen.queryByRole('button', { name: 'ANIME' })).not.toBeInTheDocument();
    });

    it('chooses a section and closes', () => {
        const { onSelect, onClose } = renderNav(false);
        fireEvent.click(screen.getByRole('button', { name: 'MANGA' }));
        expect(onSelect).toHaveBeenCalledWith('manga');
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('opens over the page with a shade, gives the focus to the active section and closes with Esc or the shade', () => {
        const { onClose } = renderNav(true);
        expect(screen.getByRole('navigation', { name: 'Sections' })).toHaveClass('sidenav--open');
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'HOME' }));
        const scrim = document.querySelector('.sidenav__scrim') as HTMLElement;
        expect(scrim).toHaveAttribute('aria-hidden', 'true');
        fireEvent.keyDown(document, { key: 'Escape' });
        fireEvent.keyDown(document, { key: 'Enter' });
        expect(onClose).toHaveBeenCalledTimes(1);
        fireEvent.click(scrim);
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('stops listening to Esc once it is closed', () => {
        const { onClose, rerender, onSelect } = renderNav(true);
        rerender(<SideNav tabs={SECTION_TABS} active="home" open={false} onSelect={onSelect} onClose={onClose} />);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
    });
});

describe('SideNav: the sections and the pill', () => {
    it('gives each tab the section it leads to', () => {
        renderNav(false);
        const nav = screen.getByRole('navigation', { name: 'Sections' });
        expect(
            Array.from(nav.querySelectorAll('button')).map((button) => {
                return button.getAttribute('data-section-id');
            })
        ).toEqual(['home', 'downloads', 'anime', 'manga', 'settings']);
    });

    it('puts the pill that slides in the active tab only', () => {
        renderNav(false, 'downloads');
        const nav = screen.getByRole('navigation', { name: 'Sections' });
        const withPill = Array.from(nav.querySelectorAll('button')).filter((button) => {
            return button.querySelector('.tab__pill') !== null;
        });
        expect(withPill.map((button) => { return button.getAttribute('data-section-id'); })).toEqual(['downloads']);
    });
});
