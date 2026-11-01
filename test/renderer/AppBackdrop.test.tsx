// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { App } from '@renderer/App';
import { useDetailBackdrop } from '@renderer/hooks/useDetailBackdrop';
import { UNSUPPORTED_STATUS, useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { useBackdropStore } from '@renderer/store/backdropStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeMangaStatus } from '../helpers/mangaFixtures';
import { APP_UPDATE_IDLE, installMockApi } from '../helpers/mockApi';

const COVER = 'https://img/one-piece.jpg';

// The home screen stands in for a screen that puts a cover behind the whole screen as soon as it opens (the page of a manga or an anime).
vi.mock('@renderer/home/HomePanel', () => {
    return {
        HomePanel: () => {
            useDetailBackdrop(COVER);
            return <section aria-label="Home">A screen with a cover</section>;
        }
    };
});

const initial = useAppStore.getState();

beforeEach(() => {
    installMockApi();
    useAnimeStore.setState({ status: UNSUPPORTED_STATUS, jobs: [], library: [], selection: null, playing: null });
    useMangaStore.setState({ status: makeMangaStatus({ supported: false, tool: null }), jobs: [], library: [], selection: null, view: 'browse' });
    useAppStore.setState({ ...initial, tab: 'home', jobs: [], history: [], settings: DEFAULT_SETTINGS, binaries: null, notice: null, appUpdate: { ...APP_UPDATE_IDLE, currentVersion: '' } });
    useBackdropStore.setState({ url: null });
});

describe('App backdrop', () => {
    it('keeps the cover a screen shows as it opens: the clearing of the change of section runs before it', async () => {
        render(<App />);
        await screen.findByRole('region', { name: 'Home' });
        expect(useBackdropStore.getState().url).toBe(COVER);
    });

    it('clears the cover when the user goes to another section, and the screen shows it again when the user comes back', async () => {
        render(<App />);
        await screen.findByRole('region', { name: 'Home' });
        fireEvent.click(screen.getByRole('button', { name: 'SETTINGS (GLOBAL)' }));
        await waitFor(() => {
            expect(useBackdropStore.getState().url).toBeNull();
        });
        fireEvent.click(screen.getByRole('button', { name: 'HOME' }));
        await screen.findByRole('region', { name: 'Home' });
        expect(useBackdropStore.getState().url).toBe(COVER);
    });

    it('clears a cover a screen left behind (one shown on hover) when the section changes', async () => {
        render(<App />);
        await screen.findByRole('region', { name: 'Home' });
        fireEvent.click(screen.getByRole('button', { name: 'SETTINGS (GLOBAL)' }));
        await screen.findByText('Changes are saved automatically.');
        useBackdropStore.getState().show('https://img/hovered.jpg');
        fireEvent.click(screen.getByRole('button', { name: 'VIDEO DOWNLOADER' }));
        await screen.findByLabelText('Link 1');
        expect(useBackdropStore.getState().url).toBeNull();
    });
});
