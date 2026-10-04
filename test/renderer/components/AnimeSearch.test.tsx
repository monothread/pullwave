// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnimeSearchResult } from '@shared/anime';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { AnimeSearch } from '@renderer/components/AnimeSearch';
import { INITIAL_SEARCH, UNSUPPORTED_STATUS, useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { makeAnime, makeEpisode } from '../../helpers/animeFixtures';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialAnime = useAnimeStore.getState();

const RESULTS: AnimeSearchResult[] = [
    { index: 1, title: 'Cyberpunk: Edgerunners' },
    { index: 2, title: 'Cyberpunk: Edgerunners 2' }
];

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS, notice: null });
    useAnimeStore.setState({ ...initialAnime, status: UNSUPPORTED_STATUS, jobs: [], library: [], search: INITIAL_SEARCH, selection: null, playing: null, streaming: null });
});

describe('AnimeSearch form', () => {
    it('starts with an empty form and a disabled button', () => {
        render(<AnimeSearch />);
        expect(screen.getByLabelText('Anime name')).toHaveValue('');
        expect(screen.getByLabelText('Anime name')).toHaveAttribute('placeholder', 'Search an anime…');
        expect(screen.getByLabelText('Audio')).toHaveValue('sub');
        expect(screen.getByRole('button', { name: 'SEARCH' })).toBeDisabled();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('offers the audio of the settings and the two audios', () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, animeAudio: 'dub' } });
        render(<AnimeSearch />);
        expect(screen.getByLabelText('Audio')).toHaveValue('dub');
        expect(
            within(screen.getByLabelText('Audio'))
                .getAllByRole('option')
                .map((option) => {
                    return option.textContent;
                })
        ).toEqual(['SUBTITLED', 'DUBBED']);
    });

    it('searches when the form is submitted', async () => {
        const user = userEvent.setup();
        mock.api.searchAnime.mockResolvedValue({ ok: true, results: RESULTS });
        render(<AnimeSearch />);

        await user.type(screen.getByLabelText('Anime name'), 'cyberpunk');
        await user.selectOptions(screen.getByLabelText('Audio'), 'dub');
        await user.click(screen.getByRole('button', { name: 'SEARCH' }));

        expect(mock.api.searchAnime).toHaveBeenCalledWith('cyberpunk', 'dub');
        expect(await screen.findByText('2 RESULTS')).toBeInTheDocument();
    });

    it('clears the results when the name is emptied', async () => {
        const user = userEvent.setup();
        mock.api.searchAnime.mockResolvedValue({ ok: true, results: RESULTS });
        render(<AnimeSearch />);

        await user.type(screen.getByLabelText('Anime name'), 'cyberpunk{Enter}');
        expect(await screen.findByText('2 RESULTS')).toBeInTheDocument();

        await user.clear(screen.getByLabelText('Anime name'));

        expect(screen.queryByText('2 RESULTS')).not.toBeInTheDocument();
        expect(screen.queryAllByRole('listitem')).toHaveLength(0);
        expect(screen.getByLabelText('Anime name')).toHaveValue('');
        expect(screen.getByRole('button', { name: 'SEARCH' })).toBeDisabled();
    });

    it('searches with Enter', async () => {
        const user = userEvent.setup();
        mock.api.searchAnime.mockResolvedValue({ ok: true, results: [] });
        render(<AnimeSearch />);
        await user.type(screen.getByLabelText('Anime name'), 'naruto{Enter}');
        expect(mock.api.searchAnime).toHaveBeenCalledWith('naruto', 'sub');
    });

    it('disables the button and says so while searching', async () => {
        const user = userEvent.setup();
        mock.api.searchAnime.mockReturnValue(
            new Promise(() => {
                return undefined;
            })
        );
        render(<AnimeSearch />);
        await user.type(screen.getByLabelText('Anime name'), 'naruto');
        await user.click(screen.getByRole('button', { name: 'SEARCH' }));
        expect(screen.getByRole('button', { name: 'SEARCHING…' })).toBeDisabled();
    });
});

describe('AnimeSearch results', () => {
    it('lists the results', () => {
        useAnimeStore.setState({ search: { ...INITIAL_SEARCH, status: 'done', results: RESULTS, searchedQuery: 'cyberpunk' } });
        render(<AnimeSearch />);
        expect(screen.getByText('2 RESULTS')).toBeInTheDocument();
        const open = screen.getByRole('button', { name: 'OPEN: Cyberpunk: Edgerunners 2' });
        expect(open).toHaveAttribute('title', 'Cyberpunk: Edgerunners 2');
        expect(open).toHaveTextContent('Cyberpunk: Edgerunners 2');
        expect(open).toHaveClass('row-link');
        expect(screen.getByText('Cyberpunk: Edgerunners')).toBeInTheDocument();
    });

    it('opens a result from its card: the title is the button and the card is a link row, with no OPEN button of its own', () => {
        useAnimeStore.setState({ search: { ...INITIAL_SEARCH, status: 'done', results: RESULTS, searchedQuery: 'cyberpunk' } });
        render(<AnimeSearch />);
        screen.getAllByRole('listitem').forEach((card) => {
            expect(card).toHaveClass('history__item', 'row--link');
        });
        expect(screen.queryByText('OPEN')).not.toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: /^OPEN: / })).toHaveLength(RESULTS.length);
    });

    it('has a button to the library on the results that are in the library for this audio, and only on them', async () => {
        const user = userEvent.setup();
        const showInLibrary = vi.fn();
        useAnimeStore.setState({
            search: { ...INITIAL_SEARCH, status: 'done', results: RESULTS, searchedQuery: 'cyberpunk', searchedAudio: 'sub' },
            library: [
                makeAnime([makeEpisode({ id: 1 })], { id: 4, title: 'Cyberpunk: Edgerunners', audio: 'sub' }),
                makeAnime([makeEpisode({ id: 2 })], { id: 5, title: 'Cyberpunk: Edgerunners 2', audio: 'dub' })
            ],
            showInLibrary
        });
        render(<AnimeSearch />);

        expect(screen.getAllByRole('button', { name: /^VIEW IN LIBRARY/ })).toHaveLength(1);
        expect(screen.queryByRole('button', { name: 'VIEW IN LIBRARY: Cyberpunk: Edgerunners 2' })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'VIEW IN LIBRARY: Cyberpunk: Edgerunners' }));
        expect(showInLibrary).toHaveBeenCalledTimes(1);
        expect(showInLibrary).toHaveBeenCalledWith(4);
    });

    it('tags a result with the name it is shown with in its series when it has one', () => {
        useAnimeStore.setState({
            search: { ...INITIAL_SEARCH, status: 'done', results: RESULTS, searchedQuery: 'cyberpunk', searchedAudio: 'sub' },
            library: [makeAnime([], { id: 1, title: 'Cyberpunk: Edgerunners', audio: 'sub', series: 'Cyberpunk', season: 1, seasonName: 'Final Cut' })]
        });
        render(<AnimeSearch />);
        expect(screen.getByText('Cyberpunk · Final Cut')).toHaveClass('history__meta');
    });

    it('tags a result that is in the library with its series and season, and no other', () => {
        useAnimeStore.setState({
            search: { ...INITIAL_SEARCH, status: 'done', results: RESULTS, searchedQuery: 'cyberpunk', searchedAudio: 'sub' },
            library: [
                makeAnime([], { id: 1, title: 'Cyberpunk: Edgerunners', audio: 'sub', series: 'Cyberpunk', season: 1 }),
                makeAnime([], { id: 2, title: 'Cyberpunk: Edgerunners 2', audio: 'dub', series: 'Cyberpunk', season: 2 }),
                makeAnime([], { id: 3, title: 'Cyberpunk: Edgerunners', audio: 'dub' })
            ]
        });
        render(<AnimeSearch />);
        expect(screen.getAllByText(/SEASON|Final/)).toHaveLength(1);
        expect(screen.getByText('Cyberpunk · SEASON 1')).toHaveClass('history__meta');
    });

    it('says when nothing was found', () => {
        useAnimeStore.setState({ search: { ...INITIAL_SEARCH, status: 'done', results: [] } });
        render(<AnimeSearch />);
        expect(screen.getByText('// NOTHING FOUND.')).toBeInTheDocument();
    });

    it('explains an error and keeps the raw text as a tooltip', () => {
        useAnimeStore.setState({ search: { ...INITIAL_SEARCH, status: 'error', error: { code: 'BLOCKED', raw: 'Blocked by cloudflare.' } } });
        render(<AnimeSearch />);
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('The source blocked the request. Try again later.');
        expect(alert).toHaveAttribute('title', 'Blocked by cloudflare.');
    });

    it('opens a result and shows its episodes', async () => {
        const user = userEvent.setup();
        mock.api.listAnimeEpisodes.mockResolvedValue({ ok: true, episodes: ['1', '2', '3'] });
        useAnimeStore.setState({ search: { ...INITIAL_SEARCH, status: 'done', results: RESULTS, searchedQuery: 'cyberpunk', searchedAudio: 'dub' } });
        render(<AnimeSearch />);

        await user.click(screen.getByRole('button', { name: 'OPEN: Cyberpunk: Edgerunners 2' }));

        expect(mock.api.listAnimeEpisodes).toHaveBeenCalledWith('cyberpunk', 2, 'dub');
        expect(await screen.findByText('3 EPISODES', { selector: '.section-label' })).toBeInTheDocument();
        expect(screen.queryByLabelText('Anime name')).not.toBeInTheDocument();
    });
});

describe('AnimeDetail', () => {
    function open(episodes: string[], overrides: Partial<NonNullable<ReturnType<typeof useAnimeStore.getState>['selection']>> = {}): void {
        useAnimeStore.setState({
            search: { ...INITIAL_SEARCH, status: 'done', results: RESULTS, searchedQuery: 'cyberpunk' },
            selection: { result: RESULTS[0] as AnimeSearchResult, query: 'cyberpunk', audio: 'sub', status: 'ready', episodes, error: null, ...overrides }
        });
    }

    it('says it is loading, and cannot add the anime until its episodes are known', () => {
        open([], { status: 'loading' });
        render(<AnimeSearch />);
        expect(screen.getByText('LOADING EPISODES…')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /DOWNLOAD/ })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'ADD TO LIBRARY' })).toBeDisabled();
    });

    it('explains why the episodes could not be loaded, and cannot add the anime', () => {
        open([], { status: 'error', error: { code: 'NETWORK', raw: 'curl exit 6' } });
        render(<AnimeSearch />);
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('Network failure. Check your connection and try again.');
        expect(alert).toHaveAttribute('title', 'curl exit 6');
        expect(screen.getByRole('button', { name: 'ADD TO LIBRARY' })).toBeDisabled();
    });

    it('goes back to the results', async () => {
        const user = userEvent.setup();
        open(['1', '2']);
        render(<AnimeSearch />);
        await user.click(screen.getByRole('button', { name: 'BACK' }));
        expect(useAnimeStore.getState().selection).toBeNull();
    });

    it('shows one button per episode and the title, with a hint that a click watches it', () => {
        open(['1', '2', '3']);
        render(<AnimeSearch />);
        expect(screen.getByRole('region', { name: 'Cyberpunk: Edgerunners' })).toBeInTheDocument();
        expect(
            screen.getAllByRole('button', { name: /^EP \d+$/ }).map((button) => {
                return button.textContent;
            })
        ).toEqual(['EP 1', 'EP 2', 'EP 3']);
        expect(screen.getByText('3 EPISODES')).toBeInTheDocument();
        expect(screen.getByText('Click an episode to watch it. Nothing is downloaded: for that, add the anime to the library.')).toHaveClass('field__hint');
        expect(screen.getByRole('button', { name: 'ADD TO LIBRARY' })).toBeEnabled();
    });

    it('has no buttons to pick episodes, to watch the pick or to download it: an episode is watched by clicking on it', () => {
        open(['1', '2', '3']);
        render(<AnimeSearch />);
        ['SELECT ALL', 'CLEAR SELECTION', 'WATCH'].forEach((name) => {
            expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
        });
        expect(screen.queryByRole('button', { name: /^DOWNLOAD SELECTED/ })).not.toBeInTheDocument();
        screen.getAllByRole('button', { name: /^EP \d+$/ }).forEach((chip) => {
            expect(chip).not.toHaveAttribute('aria-pressed');
        });
        expect(screen.getAllByRole('button').map((button) => {
            return button.textContent;
        })).toEqual(['BACK', 'ADD TO LIBRARY', 'EP 1', 'EP 2', 'EP 3']);
    });

    it('has no separate button for the whole season', () => {
        open(['1', '2', '3']);
        render(<AnimeSearch />);
        expect(screen.queryByRole('button', { name: /WHOLE SEASON/ })).not.toBeInTheDocument();
    });

    describe('watching an episode by clicking on it', () => {
        it('opens the player with the episode that was clicked, without downloading it or adding it to the library', async () => {
            const user = userEvent.setup();
            mock.api.openAnimeStream.mockReturnValue(
                new Promise(() => {
                    return undefined;
                })
            );
            open(['1', '2', '3']);
            render(<AnimeSearch />);

            await user.click(screen.getByRole('button', { name: 'EP 2' }));

            expect(mock.api.openAnimeStream).toHaveBeenCalledTimes(1);
            expect(mock.api.openAnimeStream).toHaveBeenCalledWith({ query: 'cyberpunk', index: 1, audio: 'sub', episode: '2' });
            expect(useAnimeStore.getState().streaming).toMatchObject({ episode: '2', status: 'loading' });
            expect(mock.api.downloadAnime).not.toHaveBeenCalled();
            expect(mock.api.addAnimeToLibrary).not.toHaveBeenCalled();
            expect(mock.api.downloadMissingAnime).not.toHaveBeenCalled();
        });

        it('opens the one that was clicked, whichever it is, and does not keep a selection', async () => {
            const user = userEvent.setup();
            mock.api.openAnimeStream.mockReturnValue(
                new Promise(() => {
                    return undefined;
                })
            );
            open(['1', '2']);
            render(<AnimeSearch />);

            await user.click(screen.getByRole('button', { name: 'EP 1' }));
            await user.click(screen.getByRole('button', { name: 'EP 2' }));

            expect(mock.api.openAnimeStream.mock.calls.map(([request]) => {
                return request.episode;
            })).toEqual(['1', '2']);
            expect(screen.getByRole('button', { name: 'EP 1' })).not.toHaveAttribute('aria-pressed');
        });

        it('also opens an episode that is in the library, whether it is downloaded or not', async () => {
            const user = userEvent.setup();
            mock.api.openAnimeStream.mockReturnValue(
                new Promise(() => {
                    return undefined;
                })
            );
            open(['1', '2']);
            useAnimeStore.setState({
                library: [makeAnime([makeEpisode({ id: 1, number: '1' }), makeEpisode({ id: 2, number: '2', status: 'idle', filePath: null, sizeBytes: null })], { id: 4, title: 'Cyberpunk: Edgerunners', audio: 'sub' })]
            });
            render(<AnimeSearch />);

            await user.click(screen.getByRole('button', { name: 'EP 1' }));
            await user.click(screen.getByRole('button', { name: 'EP 2' }));

            expect(mock.api.openAnimeStream).toHaveBeenCalledTimes(2);
        });
    });

    it('marks the episodes that are downloaded for this audio, and no other', () => {
        open(['1', '2', '3', '4']);
        useAnimeStore.setState({
            library: [
                makeAnime(
                    [makeEpisode({ id: 1, number: '1' }), makeEpisode({ id: 2, number: '2', status: 'error' }), makeEpisode({ id: 4, number: '4', status: 'idle', filePath: null, sizeBytes: null })],
                    { title: 'Cyberpunk: Edgerunners', audio: 'sub' }
                ),
                makeAnime([makeEpisode({ id: 3, number: '3' })], { id: 2, title: 'Cyberpunk: Edgerunners', audio: 'dub' })
            ]
        });
        render(<AnimeSearch />);

        expect(screen.getByRole('button', { name: 'EP 1' })).toHaveClass('episode-chip--done');
        expect(screen.getByRole('button', { name: 'EP 1' })).toHaveAttribute('title', 'IN LIBRARY');
        expect(screen.getByRole('button', { name: 'EP 2' })).not.toHaveClass('episode-chip--done');
        expect(screen.getByRole('button', { name: 'EP 2' })).not.toHaveAttribute('title');
        expect(screen.getByRole('button', { name: 'EP 3' })).not.toHaveClass('episode-chip--done');
        expect(screen.getByRole('button', { name: 'EP 4' })).not.toHaveClass('episode-chip--done');
    });

    it('has a button to the library, instead of the one that adds, when the anime is in the library', async () => {
        const user = userEvent.setup();
        const showInLibrary = vi.fn();
        open(['1', '2']);
        useAnimeStore.setState({ library: [makeAnime([makeEpisode({ id: 1, number: '1' })], { id: 4, title: 'Cyberpunk: Edgerunners', audio: 'sub' })], showInLibrary });
        render(<AnimeSearch />);

        expect(screen.queryByRole('button', { name: 'ADD TO LIBRARY' })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'VIEW IN LIBRARY' }));
        expect(showInLibrary).toHaveBeenCalledTimes(1);
        expect(showInLibrary).toHaveBeenCalledWith(4);
    });

    it('has the button to the library even when no episode of the anime was downloaded, because it is in the library from the moment it is added', () => {
        open(['1', '2']);
        useAnimeStore.setState({
            library: [makeAnime([makeEpisode({ id: 1, number: '1', status: 'idle', filePath: null, sizeBytes: null })], { id: 4, title: 'Cyberpunk: Edgerunners', audio: 'sub' })]
        });
        render(<AnimeSearch />);
        expect(screen.getByRole('button', { name: 'VIEW IN LIBRARY' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'ADD TO LIBRARY' })).not.toBeInTheDocument();
    });

    it('offers to add the anime when only the other audio of it is in the library', () => {
        open(['1']);
        useAnimeStore.setState({
            library: [makeAnime([makeEpisode({ id: 2 })], { id: 5, title: 'Cyberpunk: Edgerunners', audio: 'dub' })]
        });
        render(<AnimeSearch />);
        expect(screen.queryByRole('button', { name: 'VIEW IN LIBRARY' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'ADD TO LIBRARY' })).toBeEnabled();
    });

    it('goes to the library with that anime open when the button is used', async () => {
        const user = userEvent.setup();
        open(['1']);
        useAnimeStore.setState({ library: [makeAnime([makeEpisode({ id: 1, number: '1' })], { id: 4, title: 'Cyberpunk: Edgerunners', audio: 'sub' })] });
        render(<AnimeSearch />);
        await user.click(screen.getByRole('button', { name: 'VIEW IN LIBRARY' }));
        expect(useAnimeStore.getState()).toMatchObject({ view: 'library', selection: null, libraryFocus: 4 });
    });

    describe('series and season', () => {
        async function openDialog(user: ReturnType<typeof userEvent.setup>): Promise<ReturnType<typeof within>> {
            await user.click(screen.getByRole('button', { name: 'ADD TO LIBRARY' }));
            return within(screen.getByRole('dialog', { name: 'Add to the library' }));
        }

        it('does not show the fields of the series on the page of an anime that is not in the library yet: they are asked when it is added', () => {
            open(['1']);
            render(<AnimeSearch />);
            expect(screen.queryByRole('textbox', { name: 'Series' })).not.toBeInTheDocument();
            expect(screen.queryByRole('spinbutton', { name: 'Order' })).not.toBeInTheDocument();
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });

        it('opens a window that explains the series and the order, and that the series cannot change afterwards', async () => {
            const user = userEvent.setup();
            open(['1']);
            render(<AnimeSearch />);
            const dialog = await openDialog(user);

            expect(dialog.getByRole('heading', { name: 'Add to the library' })).toBeInTheDocument();
            expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
            expect(dialog.getByText('Adds the anime and all its episodes to the library. Nothing is downloaded.')).toBeInTheDocument();
            expect(dialog.getByText('Series: the group the anime belongs to, such as all the seasons of the same show.')).toBeInTheDocument();
            expect(dialog.getByText('Order: the place of this season in the series (1, 2, 3…). Each order is used once per series.')).toBeInTheDocument();
            expect(dialog.getByText('The series cannot be changed after adding.')).toBeInTheDocument();
            expect(dialog.getByRole('button', { name: 'CONFIRM' })).toBeEnabled();
            expect(dialog.getByRole('button', { name: 'CANCEL' })).toBeEnabled();
            expect(mock.api.addAnimeToLibrary).not.toHaveBeenCalled();
        });

        it('suggests the series and the season from the title', async () => {
            const user = userEvent.setup();
            useAnimeStore.setState({
                search: { ...INITIAL_SEARCH, status: 'done', results: RESULTS, searchedQuery: 'cyberpunk' },
                selection: { result: { index: 3, title: 'Frieren: Beyond Journey\'s End Season 2' }, query: 'frieren', audio: 'sub', status: 'ready', episodes: ['1'], error: null }
            });
            render(<AnimeSearch />);
            const dialog = await openDialog(user);
            expect(dialog.getByRole('textbox', { name: 'Series' })).toHaveValue('Frieren: Beyond Journey\'s End');
            expect(dialog.getByRole('spinbutton', { name: 'Order' })).toHaveValue(2);
        });

        it.each([
            ['CANCEL', async (user: ReturnType<typeof userEvent.setup>) => { await user.click(screen.getByRole('button', { name: 'CANCEL' })); }],
            ['Escape', async (user: ReturnType<typeof userEvent.setup>) => { await user.keyboard('{Escape}'); }]
        ] as const)('closes the window without adding anything with %s', async (_label, close) => {
            const user = userEvent.setup();
            open(['1']);
            render(<AnimeSearch />);
            await openDialog(user);
            await close(user);

            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            expect(mock.api.addAnimeToLibrary).not.toHaveBeenCalled();
            expect(screen.getByRole('button', { name: 'ADD TO LIBRARY' })).toBeInTheDocument();
        });

        it('does not offer to change the series of an anime that is in the library: it shows the one it has, as text', () => {
            open(['1']);
            useAnimeStore.setState({
                library: [makeAnime([makeEpisode({ id: 1 })], { id: 4, title: 'Cyberpunk: Edgerunners', audio: 'sub', series: 'Cyberpunk', season: 5, seasonName: 'The Fifth' })]
            });
            render(<AnimeSearch />);
            expect(screen.queryByRole('textbox', { name: 'Series' })).not.toBeInTheDocument();
            expect(screen.queryByRole('spinbutton', { name: 'Order' })).not.toBeInTheDocument();
            expect(screen.queryByRole('textbox', { name: 'Name shown' })).not.toBeInTheDocument();
            expect(screen.getByTestId('anime-series-info')).toHaveTextContent('In the series "Cyberpunk", order 5.');
        });

        it('shows nothing about a series for an anime in the library that is on its own', () => {
            open(['1']);
            useAnimeStore.setState({ library: [makeAnime([makeEpisode({ id: 1 })], { id: 4, title: 'Cyberpunk: Edgerunners', audio: 'sub' })] });
            render(<AnimeSearch />);
            expect(screen.queryByRole('textbox', { name: 'Series' })).not.toBeInTheDocument();
            expect(screen.queryByTestId('anime-series-info')).not.toBeInTheDocument();
        });

        it('starts with no name, and says in its hint what is shown instead', async () => {
            const user = userEvent.setup();
            open(['1']);
            render(<AnimeSearch />);
            const dialog = await openDialog(user);
            const name = dialog.getByRole('textbox', { name: 'Name shown' });
            expect(name).toHaveValue('');
            expect(name).toHaveAttribute('placeholder', 'Shown instead of "SEASON 1" (optional)');
        });

        it('does not take more of a name than can be kept', async () => {
            const user = userEvent.setup();
            open(['1']);
            render(<AnimeSearch />);
            const dialog = await openDialog(user);
            await user.type(dialog.getByRole('textbox', { name: 'Name shown' }), 'a'.repeat(70));
            expect(dialog.getByRole('textbox', { name: 'Name shown' })).toHaveValue('a'.repeat(60));
        });

        it('offers the series of the library, once each, matching what is typed', async () => {
            const user = userEvent.setup();
            open(['1']);
            useAnimeStore.setState({
                library: [
                    makeAnime([], { id: 1, title: 'Bleach', series: 'Bleach', season: 1 }),
                    makeAnime([], { id: 2, title: 'Frieren 2', series: 'Frieren', season: 2 }),
                    makeAnime([], { id: 3, title: 'Frieren', series: 'frieren', season: 1 })
                ]
            });
            render(<AnimeSearch />);
            const dialog = await openDialog(user);
            const field = dialog.getByRole('textbox', { name: 'Series' });
            expect(field).toHaveValue('Cyberpunk: Edgerunners');
            expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

            await user.clear(field);
            expect(
                within(screen.getByRole('listbox', { name: 'In the library' }))
                    .getAllByRole('option')
                    .map((option) => {
                        return option.textContent;
                    })
            ).toEqual(['Bleach', 'Frieren']);
            await user.type(field, 'fri');
            expect(screen.getAllByRole('option')).toHaveLength(1);
        });

        it('puts the series that is picked in the field, and keeps a new name when none is picked', async () => {
            const user = userEvent.setup();
            open(['1']);
            useAnimeStore.setState({ library: [makeAnime([], { id: 2, title: 'Frieren', series: 'Frieren', season: 1 })] });
            render(<AnimeSearch />);
            const dialog = await openDialog(user);
            const field = dialog.getByRole('textbox', { name: 'Series' });

            await user.clear(field);
            await user.click(screen.getByRole('option', { name: 'Frieren' }));
            expect(field).toHaveValue('Frieren');
            expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

            await user.clear(field);
            await user.type(field, 'Brand new');
            expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
            expect(field).toHaveValue('Brand new');
        });

        it('offers nothing when the library has no series', async () => {
            const user = userEvent.setup();
            open(['1']);
            render(<AnimeSearch />);
            const dialog = await openDialog(user);
            await user.click(dialog.getByRole('textbox', { name: 'Series' }));
            expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        });

        it('adds the anime to the library with all its episodes, under the series and the season that were typed, once it is confirmed', async () => {
            const user = userEvent.setup();
            const added = makeAnime(
                [makeEpisode({ id: 1, number: '1', status: 'idle', filePath: null, sizeBytes: null }), makeEpisode({ id: 2, number: '2', status: 'idle', filePath: null, sizeBytes: null })],
                { id: 4, title: 'Cyberpunk: Edgerunners', audio: 'sub', series: 'Cyberpunk', season: 3, seasonName: 'The Third' }
            );
            mock.api.addAnimeToLibrary.mockResolvedValue({ ok: true, anime: added });
            mock.api.listAnimeLibrary.mockResolvedValue([added]);
            open(['1', '2']);
            render(<AnimeSearch />);
            const dialog = await openDialog(user);

            await user.clear(dialog.getByRole('textbox', { name: 'Series' }));
            await user.type(dialog.getByRole('textbox', { name: 'Series' }), 'Cyberpunk');
            await user.clear(dialog.getByRole('spinbutton', { name: 'Order' }));
            await user.type(dialog.getByRole('spinbutton', { name: 'Order' }), '3');
            await user.type(dialog.getByRole('textbox', { name: 'Name shown' }), 'The Third');
            // Nothing is added until the window is confirmed.
            expect(mock.api.addAnimeToLibrary).not.toHaveBeenCalled();
            await user.click(dialog.getByRole('button', { name: 'CONFIRM' }));

            expect(mock.api.addAnimeToLibrary).toHaveBeenCalledTimes(1);
            expect(mock.api.addAnimeToLibrary).toHaveBeenCalledWith({
                title: 'Cyberpunk: Edgerunners',
                query: 'cyberpunk',
                index: 1,
                audio: 'sub',
                episodes: ['1', '2'],
                series: 'Cyberpunk',
                season: 3,
                seasonName: 'The Third'
            });
            expect(mock.api.downloadAnime).not.toHaveBeenCalled();
            expect(await screen.findByRole('button', { name: 'VIEW IN LIBRARY' })).toBeInTheDocument();
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            expect(useAppStore.getState().notice).toEqual({ kind: 'info', message: 'Added to the library: Cyberpunk: Edgerunners (2 episodes).' });
            // Once it is in the library its series cannot be changed from here: the page shows what it has.
            expect(screen.queryByRole('textbox', { name: 'Series' })).not.toBeInTheDocument();
            expect(screen.getByTestId('anime-series-info')).toHaveTextContent('In the series "Cyberpunk", order 3.');
            expect(screen.queryByRole('button', { name: 'ADD TO LIBRARY' })).not.toBeInTheDocument();
        });

        it('adds the anime on its own when the series is left empty', async () => {
            const user = userEvent.setup();
            mock.api.addAnimeToLibrary.mockResolvedValue({ ok: true, anime: makeAnime([makeEpisode({ id: 1, status: 'idle' })], { title: 'Cyberpunk: Edgerunners' }) });
            open(['1']);
            render(<AnimeSearch />);
            const dialog = await openDialog(user);
            await user.clear(dialog.getByRole('textbox', { name: 'Series' }));
            await user.click(dialog.getByRole('button', { name: 'CONFIRM' }));
            expect(mock.api.addAnimeToLibrary).toHaveBeenCalledWith({
                title: 'Cyberpunk: Edgerunners',
                query: 'cyberpunk',
                index: 1,
                audio: 'sub',
                episodes: ['1'],
                series: null,
                season: null,
                seasonName: null
            });
        });

        describe('an order that the series already uses', () => {
            const IN_SERIES = [
                makeAnime([], { id: 1, title: 'Frieren', series: 'Frieren', season: 1 }),
                makeAnime([], { id: 2, title: 'Frieren 2', series: 'frieren', season: 3 }),
                makeAnime([], { id: 3, title: 'Frieren (dub)', series: 'Frieren', season: 7, audio: 'dub' })
            ];

            it('is not allowed: the window says so, with the next order, and the anime cannot be confirmed', async () => {
                const user = userEvent.setup();
                open(['1']);
                useAnimeStore.setState({ library: IN_SERIES });
                render(<AnimeSearch />);
                const dialog = await openDialog(user);
                await user.clear(dialog.getByRole('textbox', { name: 'Series' }));
                await user.type(dialog.getByRole('textbox', { name: 'Series' }), 'FRIEREN');
                await user.clear(dialog.getByRole('spinbutton', { name: 'Order' }));
                await user.type(dialog.getByRole('spinbutton', { name: 'Order' }), '3');

                expect(dialog.getByRole('alert')).toHaveTextContent('Order 3 is already used by another anime of the series. Use 4, the next one.');
                expect(dialog.getByRole('button', { name: 'CONFIRM' })).toBeDisabled();
                await user.click(dialog.getByRole('button', { name: 'CONFIRM' }));
                expect(mock.api.addAnimeToLibrary).not.toHaveBeenCalled();
            });

            it('is allowed again once another order is chosen', async () => {
                const user = userEvent.setup();
                mock.api.addAnimeToLibrary.mockResolvedValue({ ok: true, anime: makeAnime([makeEpisode({ id: 1, status: 'idle' })], { title: 'Cyberpunk: Edgerunners', series: 'Frieren', season: 4 }) });
                open(['1']);
                useAnimeStore.setState({ library: IN_SERIES });
                render(<AnimeSearch />);
                const dialog = await openDialog(user);
                await user.clear(dialog.getByRole('textbox', { name: 'Series' }));
                await user.type(dialog.getByRole('textbox', { name: 'Series' }), 'Frieren');
                await user.clear(dialog.getByRole('spinbutton', { name: 'Order' }));
                await user.type(dialog.getByRole('spinbutton', { name: 'Order' }), '1');
                expect(dialog.getByRole('button', { name: 'CONFIRM' })).toBeDisabled();

                await user.clear(dialog.getByRole('spinbutton', { name: 'Order' }));
                await user.type(dialog.getByRole('spinbutton', { name: 'Order' }), '4');

                expect(dialog.queryByRole('alert')).not.toBeInTheDocument();
                expect(dialog.getByRole('button', { name: 'CONFIRM' })).toBeEnabled();
                await user.click(dialog.getByRole('button', { name: 'CONFIRM' }));
                expect(mock.api.addAnimeToLibrary).toHaveBeenCalledWith(expect.objectContaining({ series: 'Frieren', season: 4 }));
            });

            it('only counts the orders of the same audio and of the same series', async () => {
                const user = userEvent.setup();
                open(['1']);
                useAnimeStore.setState({ library: IN_SERIES });
                render(<AnimeSearch />);
                const dialog = await openDialog(user);
                await user.clear(dialog.getByRole('textbox', { name: 'Series' }));
                await user.type(dialog.getByRole('textbox', { name: 'Series' }), 'Frieren');
                await user.clear(dialog.getByRole('spinbutton', { name: 'Order' }));
                await user.type(dialog.getByRole('spinbutton', { name: 'Order' }), '7');
                // 7 is used by the dubbed one only, and this anime is subtitled.
                expect(dialog.queryByRole('alert')).not.toBeInTheDocument();

                await user.clear(dialog.getByRole('textbox', { name: 'Series' }));
                await user.type(dialog.getByRole('textbox', { name: 'Series' }), 'Bleach');
                await user.clear(dialog.getByRole('spinbutton', { name: 'Order' }));
                await user.type(dialog.getByRole('spinbutton', { name: 'Order' }), '1');
                expect(dialog.queryByRole('alert')).not.toBeInTheDocument();
                expect(dialog.getByRole('button', { name: 'CONFIRM' })).toBeEnabled();
            });

            it('is not checked when the anime stays on its own', async () => {
                const user = userEvent.setup();
                open(['1']);
                useAnimeStore.setState({ library: IN_SERIES });
                render(<AnimeSearch />);
                const dialog = await openDialog(user);
                await user.clear(dialog.getByRole('textbox', { name: 'Series' }));
                expect(dialog.queryByRole('alert')).not.toBeInTheDocument();
                expect(dialog.getByRole('button', { name: 'CONFIRM' })).toBeEnabled();
            });
        });

        it('says so when the season typed is not valid, adds nothing and keeps the window open', async () => {
            const user = userEvent.setup();
            open(['1']);
            render(<AnimeSearch />);
            const dialog = await openDialog(user);
            await user.clear(dialog.getByRole('spinbutton', { name: 'Order' }));
            await user.type(dialog.getByRole('spinbutton', { name: 'Order' }), '0');
            await user.click(dialog.getByRole('button', { name: 'CONFIRM' }));
            expect(mock.api.addAnimeToLibrary).not.toHaveBeenCalled();
            expect(useAppStore.getState().notice).toEqual({ kind: 'error', message: 'Give a series name (up to 100 characters), an order from 1 to 99 and a name of up to 60 characters.' });
            expect(screen.getByRole('dialog')).toBeInTheDocument();
        });

        it('says which order the series could take when the one that was typed is already used, adds nothing and keeps the window open to change it', async () => {
            const user = userEvent.setup();
            mock.api.addAnimeToLibrary.mockResolvedValue({ ok: false, reason: 'season-taken', suggested: 4 });
            open(['1']);
            render(<AnimeSearch />);
            const dialog = await openDialog(user);
            await user.click(dialog.getByRole('button', { name: 'CONFIRM' }));
            expect(useAppStore.getState().notice).toEqual({ kind: 'error', message: 'Order 1 is already used by another anime of the series. Use 4, the next one.' });
            expect(screen.getByRole('dialog')).toBeInTheDocument();
            expect(dialog.getByRole('button', { name: 'CONFIRM' })).toBeEnabled();
            expect(useAnimeStore.getState().library).toEqual([]);
        });

        it.each([
            ['busy', 'The anime folder is being migrated. Try again when it is done.'],
            ['invalid', 'The anime could not be added to the library.']
        ] as const)('says why the anime could not be added when the app answers %s', async (reason, message) => {
            const user = userEvent.setup();
            mock.api.addAnimeToLibrary.mockResolvedValue({ ok: false, reason });
            open(['1']);
            render(<AnimeSearch />);
            const dialog = await openDialog(user);
            await user.click(dialog.getByRole('button', { name: 'CONFIRM' }));
            expect(useAppStore.getState().notice).toEqual({ kind: 'error', message });
        });
    });

    it('does not mark anything when the anime is not in the library', () => {
        open(['1']);
        render(<AnimeSearch />);
        expect(screen.getByRole('button', { name: 'EP 1' })).not.toHaveClass('episode-chip--done');
    });
});

describe('AnimeSearch cards with a cover', () => {
    function showResults(library: ReturnType<typeof makeAnime>[] = []): void {
        useAnimeStore.setState({ search: { ...INITIAL_SEARCH, status: 'done', results: RESULTS, searchedQuery: 'cyberpunk', searchedAudio: 'sub' }, library });
    }

    it('lists the results as cards of a grid, each with a cover', () => {
        showResults();
        render(<AnimeSearch />);

        const list = screen.getByRole('list');
        expect(list).toHaveClass('cover-grid');
        const cards = screen.getAllByRole('listitem');
        expect(cards).toHaveLength(2);
        cards.forEach((card) => {
            expect(card).toHaveClass('history__item', 'cover-card', 'row--link');
            expect(card.querySelector('.cover')).not.toBeNull();
            expect(card.firstElementChild).toHaveClass('cover');
        });
    });

    it('looks the cover of each result up by its title', async () => {
        mock.api.findAnimeCover.mockImplementation(async (title: string) => {
            return title === 'Cyberpunk: Edgerunners' ? 'https://s4.anilist.co/cyberpunk.jpg' : null;
        });
        showResults();
        render(<AnimeSearch />);

        await waitFor(() => {
            expect(mock.api.findAnimeCover.mock.calls.map((call) => {
                return call[0];
            }).sort()).toEqual(['Cyberpunk: Edgerunners', 'Cyberpunk: Edgerunners 2']);
        });
        const [first, second] = screen.getAllByRole('listitem');
        await waitFor(() => {
            expect(first?.querySelector('img')).toHaveAttribute('src', 'https://s4.anilist.co/cyberpunk.jpg');
        });
        expect(within(second as HTMLElement).getByText('COVER NOT FOUND')).toBeInTheDocument();
    });

    it('puts the series and the button to the library at the bottom of the card, the series just above the button', () => {
        showResults([makeAnime([makeEpisode({ id: 1 })], { id: 4, title: 'Cyberpunk: Edgerunners', audio: 'sub', series: 'Cyberpunk', season: 1 })]);
        render(<AnimeSearch />);

        const [card] = screen.getAllByRole('listitem');
        const main = (card as HTMLElement).querySelector('.history__main') as HTMLElement;
        const footer = main.querySelector('.cover-card__footer') as HTMLElement;
        expect(main.lastElementChild).toBe(footer);
        expect(footer.children).toHaveLength(2);
        expect(footer.firstElementChild).toHaveTextContent('Cyberpunk · SEASON 1');
        expect(footer.firstElementChild).toHaveClass('history__meta');
        expect(footer.lastElementChild).toBe(within(footer).getByRole('button', { name: 'VIEW IN LIBRARY: Cyberpunk: Edgerunners' }));
        // The title is above all of it.
        expect(main.firstElementChild).toHaveClass('history__title');
    });

    it('keeps the button alone in the footer when the anime is in the library but not in a series', () => {
        showResults([makeAnime([makeEpisode({ id: 1 })], { id: 4, title: 'Cyberpunk: Edgerunners', audio: 'sub' })]);
        render(<AnimeSearch />);

        const [card] = screen.getAllByRole('listitem');
        const footer = (card as HTMLElement).querySelector('.cover-card__footer') as HTMLElement;
        expect(footer.children).toHaveLength(1);
        expect(footer.firstElementChild).toBe(within(footer).getByRole('button', { name: 'VIEW IN LIBRARY: Cyberpunk: Edgerunners' }));
    });

    it('keeps the series and the button when the anime is in a series, whether or not an episode of it was downloaded', () => {
        showResults([makeAnime([makeEpisode({ id: 1, status: 'idle', filePath: null, sizeBytes: null })], { id: 4, title: 'Cyberpunk: Edgerunners', audio: 'sub', series: 'Cyberpunk', season: 1 })]);
        render(<AnimeSearch />);

        const [card] = screen.getAllByRole('listitem');
        const footer = (card as HTMLElement).querySelector('.cover-card__footer') as HTMLElement;
        expect(footer.children).toHaveLength(2);
        expect(footer.firstElementChild).toHaveTextContent('Cyberpunk · SEASON 1');
        expect(within(card as HTMLElement).getByRole('button', { name: 'VIEW IN LIBRARY: Cyberpunk: Edgerunners' })).toBeInTheDocument();
    });

    it('has no footer on a result that is not in the library, so its card is the same size as the others', () => {
        showResults();
        render(<AnimeSearch />);

        screen.getAllByRole('listitem').forEach((card) => {
            expect(card.querySelector('.cover-card__footer')).toBeNull();
            expect(within(card).getAllByRole('button')).toHaveLength(1);
        });
    });

    it('gives a card in the library and one that is not the same parts: the cover and the title, then the footer only where there is something for it', () => {
        showResults([makeAnime([makeEpisode({ id: 1 })], { id: 4, title: 'Cyberpunk: Edgerunners', audio: 'sub', series: 'Cyberpunk', season: 1 })]);
        render(<AnimeSearch />);

        const [inLibrary, other] = screen.getAllByRole('listitem') as [HTMLElement, HTMLElement];
        expect(inLibrary.firstElementChild).toHaveClass('cover');
        expect(other.firstElementChild).toHaveClass('cover');
        expect(inLibrary.querySelector('.history__main > .history__title')).not.toBeNull();
        expect(other.querySelector('.history__main > .history__title')).not.toBeNull();
        expect(inLibrary.querySelector('.cover-card__footer')).not.toBeNull();
        expect(other.querySelector('.cover-card__footer')).toBeNull();
    });
});
