// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { AnimePanel } from '@renderer/components/AnimePanel';
import { SETTINGS_ICON } from '@renderer/components/TabButton';
import { INITIAL_SCHEDULE, INITIAL_SEARCH, useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { makeAnime, makeAnimeJob, makeEpisode, makeStatus } from '../../helpers/animeFixtures';
import { installMockApi } from '../../helpers/mockApi';

const initialApp = useAppStore.getState();
const initialAnime = useAnimeStore.getState();

beforeEach(() => {
    installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS });
    useAnimeStore.setState({
        ...initialAnime,
        status: makeStatus(),
        view: 'search',
        jobs: [],
        library: [],
        search: INITIAL_SEARCH,
        schedule: INITIAL_SCHEDULE,
        selection: null,
        playing: null
    });
});

function subNav(): HTMLElement {
    return screen.getByRole('navigation', { name: 'Anime' });
}

describe('AnimePanel', () => {
    it('warns when the tools of the section are missing and shows nothing else', () => {
        useAnimeStore.setState({ status: makeStatus({ available: false }) });
        render(<AnimePanel />);
        expect(screen.getByRole('alert')).toHaveTextContent('ANIME TOOLS NOT FOUND');
        expect(screen.getByText('The files the anime section runs on are missing from this installation. Reinstall the app.')).toBeInTheDocument();
        expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Anime name')).not.toBeInTheDocument();
    });

    it('opens on the schedule, the first tab, to the left of the search', () => {
        useAnimeStore.setState({ view: initialAnime.view });
        render(<AnimePanel />);
        expect(
            within(subNav())
                .getAllByRole('button')
                .map((button) => {
                    return button.getAttribute('aria-label') ?? button.textContent;
                })
                .slice(0, 2)
        ).toEqual(['SCHEDULE', 'SEARCH']);
        expect(within(subNav()).getByRole('button', { name: 'SCHEDULE' })).toHaveAttribute('aria-current', 'page');
        expect(within(subNav()).getByRole('button', { name: 'SEARCH' })).not.toHaveAttribute('aria-current');
        expect(screen.getByRole('region', { name: 'Anime schedule' })).toBeInTheDocument();
        expect(screen.queryByLabelText('Anime name')).not.toBeInTheDocument();
    });

    it('switches between the schedule and the search', async () => {
        const user = userEvent.setup();
        useAnimeStore.setState({ view: 'schedule' });
        render(<AnimePanel />);

        await user.click(within(subNav()).getByRole('button', { name: 'SEARCH' }));
        expect(screen.getByLabelText('Anime name')).toBeInTheDocument();
        expect(screen.queryByRole('region', { name: 'Anime schedule' })).not.toBeInTheDocument();
        expect(useAnimeStore.getState()).toMatchObject({ view: 'search', returnView: 'search' });

        await user.click(within(subNav()).getByRole('button', { name: 'SCHEDULE' }));
        expect(screen.getByRole('region', { name: 'Anime schedule' })).toBeInTheDocument();
        expect(screen.queryByLabelText('Anime name')).not.toBeInTheDocument();
        expect(within(subNav()).getByRole('button', { name: 'SCHEDULE' })).toHaveAttribute('aria-current', 'page');
        expect(useAnimeStore.getState()).toMatchObject({ view: 'schedule', returnView: 'schedule' });
    });

    it('shows the search as the current view when it is chosen', () => {
        render(<AnimePanel />);
        expect(screen.getByRole('region', { name: 'Anime' })).toBeInTheDocument();
        expect(within(subNav()).getByRole('button', { name: 'SEARCH' })).toHaveAttribute('aria-current', 'page');
        expect(within(subNav()).getByRole('button', { name: 'LIBRARY' })).not.toHaveAttribute('aria-current');
        expect(screen.getByLabelText('Anime name')).toBeInTheDocument();
    });

    it('switches between the search and the library', async () => {
        const user = userEvent.setup();
        render(<AnimePanel />);

        await user.click(screen.getByRole('button', { name: 'LIBRARY' }));
        expect(screen.getByText('// THE LIBRARY IS EMPTY. SEARCH AN ANIME AND ADD IT TO THE LIBRARY.')).toBeInTheDocument();
        expect(within(subNav()).getByRole('button', { name: 'LIBRARY' })).toHaveAttribute('aria-current', 'page');
        expect(screen.queryByLabelText('Anime name')).not.toBeInTheDocument();

        await user.click(within(subNav()).getByRole('button', { name: 'SEARCH' }));
        expect(screen.getByLabelText('Anime name')).toBeInTheDocument();
    });

    it('has a history and settings between the library and the downloads button, and shows the history in place of the search', async () => {
        const user = userEvent.setup();
        useAnimeStore.setState({ history: [{ id: 1, title: 'Naruto', query: 'naruto', searchIndex: 2, audio: 'dub', episode: '3', openedAt: 1700000000000 }] });
        render(<AnimePanel />);
        expect(
            within(subNav())
                .getAllByRole('button')
                .map((button) => {
                    return button.getAttribute('aria-label') ?? button.textContent;
                })
        ).toEqual(['SCHEDULE', 'SEARCH', 'LIBRARY', 'HISTORY', 'SETTINGS']);
        // The settings are a gear at the right end of the bar, not a word.
        const settings = within(subNav()).getByRole('button', { name: 'SETTINGS' });
        expect(settings).toHaveClass('tab--icon');
        expect(settings).toHaveTextContent(SETTINGS_ICON);
        expect(settings).not.toHaveTextContent('SETTINGS');
        expect(settings).toHaveAttribute('title', 'SETTINGS');

        await user.click(within(subNav()).getByRole('button', { name: 'HISTORY' }));
        expect(within(subNav()).getByRole('button', { name: 'HISTORY' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('region', { name: 'Anime history' })).toBeInTheDocument();
        expect(screen.getByText('Naruto')).toBeInTheDocument();
        expect(screen.queryByLabelText('Anime name')).not.toBeInTheDocument();
        expect(useAnimeStore.getState()).toMatchObject({ view: 'history', returnView: 'history' });
    });

    it('shows the settings of the anime section, and only them, in place of the search', async () => {
        const user = userEvent.setup();
        render(<AnimePanel />);

        await user.click(within(subNav()).getByRole('button', { name: 'SETTINGS' }));
        expect(within(subNav()).getByRole('button', { name: 'SETTINGS' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('region', { name: 'Settings' })).toBeInTheDocument();
        expect(screen.getByText('ANIME')).toBeInTheDocument();
        expect(screen.getByLabelText('Anime download folder')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'UPDATE ANI-CLI' })).toBeInTheDocument();
        ['APPEARANCE & WINDOW', 'OUTPUT', 'QUALITY & FORMAT', 'YT-DLP', 'ADVANCED'].forEach((legend) => {
            expect(screen.queryByText(legend)).not.toBeInTheDocument();
        });
        expect(screen.queryByLabelText('Anime name')).not.toBeInTheDocument();
        expect(useAnimeStore.getState()).toMatchObject({ view: 'settings', returnView: 'settings' });
    });

    it('has no settings to reach while the tools of the section are missing', () => {
        useAnimeStore.setState({ status: makeStatus({ available: false }), view: 'settings' });
        render(<AnimePanel />);
        expect(screen.getByRole('alert')).toHaveTextContent('ANIME TOOLS NOT FOUND');
        expect(screen.queryByRole('region', { name: 'Settings' })).not.toBeInTheDocument();
        expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    });

    describe('downloads', () => {
        it('has a button with the number of downloads that are happening or waiting', () => {
            useAnimeStore.setState({
                jobs: [
                    makeAnimeJob({ episodeId: 1, status: 'running' }),
                    makeAnimeJob({ episodeId: 2, status: 'queued' }),
                    makeAnimeJob({ episodeId: 3, status: 'done' }),
                    makeAnimeJob({ episodeId: 4, status: 'error' }),
                    makeAnimeJob({ episodeId: 5, status: 'cancelled' })
                ]
            });
            render(<AnimePanel />);
            expect(screen.getByRole('button', { name: 'DOWNLOADS (2)' })).toBeInTheDocument();
        });

        it('counts zero when nothing is happening, and highlights the button only when something is', () => {
            const { unmount } = render(<AnimePanel />);
            expect(screen.getByRole('button', { name: 'DOWNLOADS (0)' })).not.toHaveClass('btn--primary');
            unmount();

            useAnimeStore.setState({ jobs: [makeAnimeJob({ status: 'running' })] });
            render(<AnimePanel />);
            expect(screen.getByRole('button', { name: 'DOWNLOADS (1)' })).toHaveClass('btn--primary');
        });

        it('does not list the downloads on the search or on the library', async () => {
            const user = userEvent.setup();
            useAnimeStore.setState({ jobs: [makeAnimeJob()] });
            render(<AnimePanel />);
            expect(screen.queryByTestId('anime-job')).not.toBeInTheDocument();
            await user.click(within(subNav()).getByRole('button', { name: 'LIBRARY' }));
            expect(screen.queryByTestId('anime-job')).not.toBeInTheDocument();
        });

        it('opens a screen with the downloads in place of the search, and BACK returns to it', async () => {
            const user = userEvent.setup();
            useAnimeStore.setState({ jobs: [makeAnimeJob()] });
            render(<AnimePanel />);

            await user.click(screen.getByRole('button', { name: 'DOWNLOADS (1)' }));
            expect(useAnimeStore.getState().view).toBe('downloads');
            expect(screen.getByTestId('anime-job')).toBeInTheDocument();
            expect(screen.queryByLabelText('Anime name')).not.toBeInTheDocument();
            expect(screen.queryByRole('navigation', { name: 'Anime' })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'DOWNLOADS (1)' })).not.toBeInTheDocument();

            await user.click(screen.getByRole('button', { name: 'BACK' }));
            expect(useAnimeStore.getState().view).toBe('search');
            expect(screen.getByLabelText('Anime name')).toBeInTheDocument();
            expect(screen.queryByTestId('anime-job')).not.toBeInTheDocument();
        });

        it('goes back to the library when it was opened from there', async () => {
            const user = userEvent.setup();
            render(<AnimePanel />);
            await user.click(within(subNav()).getByRole('button', { name: 'LIBRARY' }));
            await user.click(screen.getByRole('button', { name: 'DOWNLOADS (0)' }));
            expect(screen.getByText('// NO DOWNLOADS YET.')).toBeInTheDocument();

            await user.click(screen.getByRole('button', { name: 'BACK' }));
            expect(useAnimeStore.getState().view).toBe('library');
            expect(within(subNav()).getByRole('button', { name: 'LIBRARY' })).toHaveAttribute('aria-current', 'page');
        });

        it('keeps the opened anime and the search while the downloads are shown', async () => {
            const user = userEvent.setup();
            useAnimeStore.setState({ search: { ...INITIAL_SEARCH, query: 'naruto' } });
            render(<AnimePanel />);
            await user.click(screen.getByRole('button', { name: 'DOWNLOADS (0)' }));
            await user.click(screen.getByRole('button', { name: 'BACK' }));
            expect(screen.getByLabelText('Anime name')).toHaveValue('naruto');
        });

        it('updates the screen as the downloads progress', async () => {
            const user = userEvent.setup();
            render(<AnimePanel />);
            await user.click(screen.getByRole('button', { name: 'DOWNLOADS (0)' }));
            expect(screen.queryByTestId('anime-job')).not.toBeInTheDocument();
            act(() => {
                useAnimeStore.setState({ jobs: [makeAnimeJob({ percent: 10 })] });
            });
            expect(screen.getByTestId('anime-job')).toBeInTheDocument();
        });
    });

    it('opens the player of a stream over the section, on the search and on the downloads screen', async () => {
        const user = userEvent.setup();
        useAnimeStore.setState({ streaming: { title: 'Naruto', episode: '2', status: 'loading', stream: null, error: null } });
        render(<AnimePanel />);
        expect(screen.getByRole('dialog', { name: 'Naruto · EP 2' })).toBeInTheDocument();
        act(() => {
            useAnimeStore.getState().closeStream();
            useAnimeStore.getState().openDownloads();
            useAnimeStore.setState({ streaming: { title: 'Naruto', episode: '3', status: 'loading', stream: null, error: null } });
        });
        expect(screen.getByRole('dialog', { name: 'Naruto · EP 3' })).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'CLOSE' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('opens the player over the section when an episode is played', () => {
        useAnimeStore.setState({ library: [makeAnime([makeEpisode()], { id: 1 })], playing: { animeId: 1, episodeId: 1 } });
        render(<AnimePanel />);
        expect(screen.getByRole('dialog', { name: 'Naruto · EP 1' })).toBeInTheDocument();
    });
});
