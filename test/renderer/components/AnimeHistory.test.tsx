// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnimeHistoryEntry } from '@shared/anime';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { makeAnime } from '../../helpers/animeFixtures';
import { AnimeHistory } from '@renderer/components/AnimeHistory';
import { INITIAL_SEARCH, useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

const initialApp = useAppStore.getState();
const initialAnime = useAnimeStore.getState();
let mock: MockApiHandle;

const OPENED: AnimeHistoryEntry = { id: 1, title: 'Naruto', query: 'naruto', searchIndex: 2, audio: 'dub', episode: null, openedAt: 1700000000000 };
const WATCHED: AnimeHistoryEntry = { id: 2, title: 'Bleach', query: 'bleach', searchIndex: 4, audio: 'sub', episode: '12', openedAt: 1700000001000 };

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS });
    useAnimeStore.setState({ ...initialAnime, view: 'history', returnView: 'history', history: [], library: [], search: INITIAL_SEARCH, selection: null });
});

describe('AnimeHistory', () => {
    it('shows an empty state and nothing else', () => {
        render(<AnimeHistory />);
        expect(screen.getByText('// NOTHING OPENED YET. SEARCH AN ANIME OR PLAY AN EPISODE.')).toBeInTheDocument();
        expect(screen.queryByRole('region', { name: 'Anime history' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'CLEAR HISTORY' })).not.toBeInTheDocument();
    });

    it('lists the anime in the order of the store with the count, the audio, the last episode and the time', () => {
        useAnimeStore.setState({ history: [WATCHED, OPENED] });
        render(<AnimeHistory />);

        expect(screen.getByRole('region', { name: 'Anime history' })).toBeInTheDocument();
        expect(screen.getByText('HISTORY [2]')).toBeInTheDocument();
        const items = screen.getAllByRole('listitem');
        expect(items).toHaveLength(2);
        expect(within(items[0] as HTMLElement).getByRole('button', { name: 'OPEN: Bleach' })).toHaveAttribute('title', 'Bleach');
        expect(within(items[0] as HTMLElement).getByText(/^SUB · EP 12 · /)).toBeInTheDocument();
        expect(within(items[0] as HTMLElement).getByText(new RegExp(new Date(WATCHED.openedAt).toLocaleString('en').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument();
        expect(within(items[1] as HTMLElement).getByText('Naruto')).toBeInTheDocument();
        expect(within(items[1] as HTMLElement).getByText(/^DUB · /)).toBeInTheDocument();
        expect(within(items[1] as HTMLElement).queryByText(/EP /)).not.toBeInTheDocument();
    });

    it('opens an entry in the search with its episodes', async () => {
        const user = userEvent.setup();
        mock.api.listAnimeEpisodes.mockResolvedValue({ ok: true, episodes: ['1', '2'] });
        useAnimeStore.setState({ history: [WATCHED, OPENED] });
        render(<AnimeHistory />);

        await user.click(screen.getByRole('button', { name: 'OPEN: Naruto' }));
        expect(mock.api.listAnimeEpisodes).toHaveBeenCalledWith('naruto', 2, 'dub');
        expect(useAnimeStore.getState()).toMatchObject({
            view: 'search',
            selection: { result: { index: 2, title: 'Naruto' }, query: 'naruto', audio: 'dub', status: 'ready', episodes: ['1', '2'] }
        });
    });

    it('opens an entry that is in the library on its series, and not in the search', async () => {
        const user = userEvent.setup();
        mock.api.listAnimeLibrary.mockResolvedValue([makeAnime([], { id: 7, title: 'Naruto', audio: 'dub' })]);
        useAnimeStore.setState({ history: [WATCHED, OPENED], library: [makeAnime([], { id: 7, title: 'Naruto', audio: 'dub' })] });
        render(<AnimeHistory />);

        await user.click(screen.getByRole('button', { name: 'OPEN: Naruto' }));
        expect(mock.api.listAnimeEpisodes).not.toHaveBeenCalled();
        expect(useAnimeStore.getState()).toMatchObject({ view: 'library', returnView: 'library', selection: null, libraryFocus: 7, librarySeries: 'anime-7' });
    });

    it('opens an entry that is in the library with another audio in the search', async () => {
        const user = userEvent.setup();
        mock.api.listAnimeEpisodes.mockResolvedValue({ ok: true, episodes: ['1'] });
        useAnimeStore.setState({ history: [OPENED], library: [makeAnime([], { id: 7, title: 'Naruto', audio: 'sub' })] });
        render(<AnimeHistory />);

        await user.click(screen.getByRole('button', { name: 'OPEN: Naruto' }));
        expect(mock.api.listAnimeEpisodes).toHaveBeenCalledWith('naruto', 2, 'dub');
        expect(useAnimeStore.getState()).toMatchObject({ view: 'search', librarySeries: null });
    });

    it('removes one entry', async () => {
        const user = userEvent.setup();
        mock.api.listAnimeHistory.mockResolvedValue([OPENED]);
        useAnimeStore.setState({ history: [WATCHED, OPENED] });
        render(<AnimeHistory />);

        await user.click(screen.getByRole('button', { name: 'REMOVE FROM HISTORY: Bleach' }));
        expect(mock.api.removeAnimeHistory).toHaveBeenCalledWith(2);
        expect(useAnimeStore.getState().history).toEqual([OPENED]);
        expect(screen.queryByText('Bleach')).not.toBeInTheDocument();
    });

    it('clears the history and shows the empty state', async () => {
        const user = userEvent.setup();
        useAnimeStore.setState({ history: [WATCHED, OPENED] });
        render(<AnimeHistory />);

        await user.click(screen.getByRole('button', { name: 'CLEAR HISTORY' }));
        expect(mock.api.clearAnimeHistory).toHaveBeenCalledTimes(1);
        expect(useAnimeStore.getState().history).toEqual([]);
        expect(screen.getByText('// NOTHING OPENED YET. SEARCH AN ANIME OR PLAY AN EPISODE.')).toBeInTheDocument();
    });
});

describe('AnimeHistory cards with a cover', () => {
    it('lists the anime as cards of a grid, each with a cover and the title as the button that opens it', () => {
        useAnimeStore.setState({ history: [WATCHED, OPENED] });
        render(<AnimeHistory />);

        expect(screen.getByRole('list')).toHaveClass('cover-grid');
        screen.getAllByRole('listitem').forEach((card) => {
            expect(card).toHaveClass('history__item', 'cover-card', 'row--link');
            expect(card.firstElementChild).toHaveClass('cover');
            expect(card.querySelector('.history__title .row-link')).not.toBeNull();
        });
    });

    it('has no OPEN button of its own: the card opens by a click on its title, which is stretched over it', () => {
        useAnimeStore.setState({ history: [WATCHED, OPENED] });
        render(<AnimeHistory />);

        expect(screen.queryByText('OPEN', { selector: 'button' })).not.toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: /^OPEN: / })).toHaveLength(2);
        screen.getAllByRole('listitem').forEach((card) => {
            expect(within(card).getAllByRole('button')).toHaveLength(2);
        });
    });

    it('puts what was watched and the button that removes at the bottom of the card, what was watched just above the button', () => {
        useAnimeStore.setState({ history: [WATCHED] });
        render(<AnimeHistory />);

        const [card] = screen.getAllByRole('listitem');
        const main = (card as HTMLElement).querySelector('.history__main') as HTMLElement;
        const footer = main.querySelector('.cover-card__footer') as HTMLElement;
        expect(main.lastElementChild).toBe(footer);
        expect(footer.children).toHaveLength(2);
        expect(footer.firstElementChild).toHaveClass('history__meta');
        expect(footer.firstElementChild).toHaveTextContent(/^SUB · EP 12 · /);
        expect(footer.lastElementChild).toHaveClass('anime__actions');
        expect(within(footer).getByRole('button', { name: 'REMOVE FROM HISTORY: Bleach' })).toBeInTheDocument();
        expect(main.firstElementChild).toHaveClass('history__title');
    });

    it('opens an entry by its title, wherever the card is clicked, and removing does not open it', async () => {
        const user = userEvent.setup();
        mock.api.listAnimeEpisodes.mockResolvedValue({ ok: true, episodes: ['1'] });
        useAnimeStore.setState({ history: [OPENED] });
        render(<AnimeHistory />);

        await user.click(screen.getByRole('button', { name: 'REMOVE FROM HISTORY: Naruto' }));

        expect(mock.api.removeAnimeHistory).toHaveBeenCalledWith(1);
        expect(mock.api.listAnimeEpisodes).not.toHaveBeenCalled();
    });

    it('looks the cover of each anime up by its title', async () => {
        useAnimeStore.setState({ history: [WATCHED, OPENED] });
        render(<AnimeHistory />);

        await vi.waitFor(() => {
            expect(mock.api.findAnimeCover.mock.calls.map((call) => {
                return call[0];
            }).sort()).toEqual(['Bleach', 'Naruto']);
        });
    });
});
