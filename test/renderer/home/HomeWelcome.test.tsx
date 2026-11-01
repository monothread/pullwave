// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { HomeWelcome } from '@renderer/home/HomeWelcome';
import { useAppStore } from '@renderer/store/appStore';

const initial = useAppStore.getState();
const setTab = vi.fn();

beforeEach(() => {
    setTab.mockClear();
    useAppStore.setState({ setTab });
});

afterEach(() => {
    useAppStore.setState(initial, true);
});

describe('HomeWelcome', () => {
    it.each(['downloads', 'anime', 'manga'] as const)('welcomes and leads to the section of "Open on" (%s)', (startTab) => {
        render(<HomeWelcome sectionName="THE SECTION" startTab={startTab} />);
        const welcome = screen.getByRole('region', { name: 'WELCOME TO PULLWAVE' });
        expect(welcome).toHaveClass('hero', 'hero--welcome');
        expect(within(welcome).getByRole('heading', { level: 2, name: 'WELCOME TO PULLWAVE' })).toHaveClass('hero__title');
        expect(within(welcome).getByText('Paste a link, find an anime or open a manga: what you watch, read and download shows up here.')).toHaveClass('hero__hint');
        const go = within(welcome).getByRole('button', { name: 'GO TO THE SECTION' });
        expect(go).toHaveClass('btn', 'btn--primary', 'hero__play');
        fireEvent.click(go);
        expect(setTab.mock.calls).toEqual([[startTab]]);
    });
});
