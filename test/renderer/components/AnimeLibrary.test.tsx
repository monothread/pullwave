// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { AnimeLibrary } from '@renderer/components/AnimeLibrary';
import { INITIAL_SEARCH, UNSUPPORTED_STATUS, useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { makeAnime, makeEpisode } from '../../helpers/animeFixtures';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialAnime = useAnimeStore.getState();

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS });
    useAnimeStore.setState({ ...initialAnime, status: UNSUPPORTED_STATUS, jobs: [], library: [], search: INITIAL_SEARCH, selection: null, playing: null });
});

const LIBRARY = [
    makeAnime(
        [
            makeEpisode({ id: 1, number: '1', sizeBytes: 2 * 1024 ** 2 }),
            makeEpisode({ id: 2, number: '2', sizeBytes: 3 * 1024 ** 2, positionSeconds: 600, durationSeconds: 1440 }),
            makeEpisode({ id: 3, number: '3', sizeBytes: 1024, watched: true, positionSeconds: 1400, durationSeconds: 1440 }),
            makeEpisode({ id: 4, number: '4', status: 'error', sizeBytes: null, filePath: null, error: { code: 'NO_SOURCES', raw: 'No sources found for sub!' } }),
            makeEpisode({ id: 5, number: '5', status: 'cancelled', sizeBytes: null, filePath: null }),
            makeEpisode({ id: 6, number: '6', status: 'queued', sizeBytes: null, filePath: null })
        ],
        { id: 10, title: 'Naruto', audio: 'sub' }
    ),
    makeAnime([], { id: 11, title: 'Naruto', audio: 'dub' })
];

describe('AnimeLibrary', () => {
    it('shows an empty state, with a way to import a folder', () => {
        render(<AnimeLibrary />);
        expect(screen.getByText('// THE LIBRARY IS EMPTY. SEARCH AN ANIME AND ADD IT TO THE LIBRARY.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'IMPORT LIBRARY' })).toBeInTheDocument();
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    describe('series', () => {
        const SERIES_LIBRARY = [
            makeAnime([makeEpisode({ id: 1, number: '1' }), makeEpisode({ id: 2, number: '2', status: 'queued', filePath: null })], { id: 40, title: 'Frieren Season 2', series: 'Frieren', season: 2 }),
            makeAnime([makeEpisode({ id: 3, number: '1', filePath: '/lib/Frieren/Season 1/Episode 1/a.mp4' })], { id: 41, title: 'Frieren', series: 'Frieren', season: 1 }),
            makeAnime([makeEpisode({ id: 4, number: '1' })], { id: 42, title: 'Naruto' })
        ];

        it('joins the seasons of a series in one card, in order, and leaves the others on their own', () => {
            useAnimeStore.setState({ library: SERIES_LIBRARY });
            render(<AnimeLibrary />);

            const [series, alone] = screen.getAllByTestId('anime-card');
            expect(within(series as HTMLElement).getByRole('heading', { level: 3, name: 'Frieren' })).toBeInTheDocument();
            expect(within(series as HTMLElement).getByText('2 SEASONS')).toBeInTheDocument();
            expect(within(series as HTMLElement).queryByTestId('series-row')).not.toBeInTheDocument();
            expect(within(alone as HTMLElement).getByRole('heading', { level: 3, name: 'Naruto' })).toBeInTheDocument();
            expect(within(alone as HTMLElement).getByText('1 SEASON')).toBeInTheDocument();
            expect(within(alone as HTMLElement).getByRole('button', { name: 'OPEN SERIES: Naruto' })).toBeInTheDocument();
            // The card has the name, how many seasons and the two buttons; the seasons are on the screen of the series.
            expect(screen.queryByTestId('anime-season')).not.toBeInTheDocument();
            expect(within(series as HTMLElement).getByRole('button', { name: 'OPEN SERIES: Frieren' })).toBeInTheDocument();
            expect(screen.getByText('2 ANIMES')).toBeInTheDocument();
        });

        it('gives an anime on its own and a series the same card: the cover, the name, and at the bottom the number of seasons and the remove button', () => {
            useAnimeStore.setState({ library: SERIES_LIBRARY });
            render(<AnimeLibrary />);
            screen.getAllByTestId('anime-card').forEach((card) => {
                expect(card).toHaveClass('library__card', 'cover-card');
                expect(card.parentElement).toHaveClass('cover-grid');
                expect(card.querySelector('.cover')).not.toBeNull();
                expect(card.querySelector('header.job__head')).not.toBeNull();
                expect(card.querySelector('header.job__head .badge')).toBeNull();
                expect(card.querySelector('.library__body')).toBeNull();
                expect(within(card).getAllByRole('button')).toHaveLength(2);
                const footer = card.querySelector('.cover-card__footer') as HTMLElement;
                expect(footer.querySelector('.job__badges .badge')).not.toBeNull();
                expect(footer.querySelector('.library__footer')).not.toBeNull();
                // The seasons are above the button that removes, both at the bottom of the card.
                expect(footer.firstElementChild).toHaveClass('job__badges');
                expect(footer.lastElementChild).toHaveClass('library__footer');
            });
            expect(screen.queryByTestId('anime-episode')).not.toBeInTheDocument();
        });

        it('only counts the seasons of a series on its card, however many there are', () => {
            const many = Array.from({ length: 8 }, (_unused, index) => {
                return makeAnime([makeEpisode({ id: 100 + index })], { id: 100 + index, title: `Big ${index + 1}`, series: 'Big', season: index + 1 });
            });
            useAnimeStore.setState({ library: many });
            render(<AnimeLibrary />);
            const [card] = screen.getAllByTestId('anime-card');
            expect(screen.getAllByTestId('anime-card')).toHaveLength(1);
            expect(within(card as HTMLElement).getByText('8 SEASONS')).toBeInTheDocument();
            expect(screen.queryByRole('list', { name: 'Seasons of Big' })).not.toBeInTheDocument();
        });

        it('opens the screen of a series, with every season and a way back to the cards', async () => {
            const user = userEvent.setup();
            useAnimeStore.setState({ library: SERIES_LIBRARY });
            render(<AnimeLibrary />);

            await user.click(screen.getByRole('button', { name: 'OPEN SERIES: Frieren' }));
            expect(screen.getByTestId('series-view')).toBeInTheDocument();
            expect(screen.getAllByTestId('anime-season')).toHaveLength(2);
            expect(screen.queryByRole('textbox', { name: 'Search the library' })).not.toBeInTheDocument();
            expect(screen.queryByTestId('anime-card')).not.toBeInTheDocument();
            expect(screen.getByRole('heading', { level: 3, name: 'Frieren' })).toBeInTheDocument();

            await user.click(screen.getByRole('button', { name: 'BACK TO LIBRARY' }));
            expect(screen.queryByTestId('series-view')).not.toBeInTheDocument();
            expect(screen.getAllByTestId('anime-card')).toHaveLength(2);
            expect(screen.getByRole('textbox', { name: 'Search the library' })).toBeInTheDocument();
        });

        it('opens the screen of an anime on its own from its card, where there is no season to edit because it has no series to order it in', async () => {
            const user = userEvent.setup();
            useAnimeStore.setState({ library: SERIES_LIBRARY });
            render(<AnimeLibrary />);
            await user.click(screen.getByRole('button', { name: 'OPEN SERIES: Naruto' }));
            expect(screen.getByRole('button', { name: 'BACK TO LIBRARY' })).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'EDIT SEASON: Naruto' })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'EDIT SERIES: Naruto' })).not.toBeInTheDocument();
            expect(screen.queryByTestId('anime-episode')).not.toBeInTheDocument();
            await user.click(screen.getByRole('button', { name: /^SHOW EPISODES: / }));
            expect(screen.getAllByTestId('anime-episode')).toHaveLength(1);
            await user.click(screen.getByRole('button', { name: 'BACK TO LIBRARY' }));
            expect(screen.getAllByTestId('anime-card')).toHaveLength(2);
        });

        it('goes back to the cards when what was open is gone (the series was removed)', async () => {
            const user = userEvent.setup();
            useAnimeStore.setState({ library: SERIES_LIBRARY });
            render(<AnimeLibrary />);
            await user.click(screen.getByRole('button', { name: 'OPEN SERIES: Frieren' }));
            act(() => {
                useAnimeStore.setState({ library: [SERIES_LIBRARY[2] as (typeof SERIES_LIBRARY)[number]] });
            });
            expect(screen.queryByTestId('series-view')).not.toBeInTheDocument();
            expect(screen.getAllByTestId('anime-card')).toHaveLength(1);
        });

        it('counts a series as one anime, however many seasons it has', () => {
            const three = [
                makeAnime([], { id: 50, title: 'Bleach', series: 'Bleach', season: 1 }),
                makeAnime([], { id: 51, title: 'Bleach: Arc', series: 'Bleach', season: 2 }),
                makeAnime([], { id: 52, title: 'Bleach: Another Arc', series: 'Bleach', season: 3 }),
                makeAnime([], { id: 53, title: 'Naruto' }),
                makeAnime([], { id: 54, title: 'One Piece', series: 'One Piece', season: 1 })
            ];
            useAnimeStore.setState({ library: three });
            render(<AnimeLibrary />);
            expect(screen.getByText('3 ANIMES')).toBeInTheDocument();
            expect(screen.getAllByTestId('anime-card')).toHaveLength(3);
        });

        it('counts what the search leaves, a series as one', async () => {
            const user = userEvent.setup();
            useAnimeStore.setState({ library: SERIES_LIBRARY });
            render(<AnimeLibrary />);
            await user.type(screen.getByRole('textbox', { name: 'Search the library' }), 'frieren');
            expect(screen.getByText('1 ANIMES')).toBeInTheDocument();
        });

        it('shows the name given to a season on its chip, and the number of its place when it has none', async () => {
            const user = userEvent.setup();
            useAnimeStore.setState({
                library: [
                    makeAnime([], { id: 60, title: 'Bleach', series: 'Bleach', season: 1 }),
                    makeAnime([], { id: 61, title: 'Bleach: Thousand-Year Blood War Arc', series: 'Bleach', season: 2, seasonName: 'Blood War' })
                ]
            });
            render(<AnimeLibrary />);
            await user.click(screen.getByRole('button', { name: 'OPEN SERIES: Bleach' }));
            const chips = screen.getAllByTestId('anime-season').map((season) => {
                return season.querySelector('.season__chip');
            });
            expect(chips.map((chip) => { return chip?.textContent; })).toEqual(['SEASON 1', 'Blood War']);
            expect(screen.getAllByRole('heading', { level: 4 })[1]).toHaveTextContent('Bleach: Thousand-Year Blood War Arc');
        });

        it('puts the seasons in the order of their place and not of their names', async () => {
            const user = userEvent.setup();
            useAnimeStore.setState({
                library: [
                    makeAnime([], { id: 70, title: 'C', series: 'Series', season: 1, seasonName: 'Zebra' }),
                    makeAnime([], { id: 71, title: 'B', series: 'Series', season: 3, seasonName: 'Apple' }),
                    makeAnime([], { id: 72, title: 'A', series: 'Series', season: 2, seasonName: 'Mango' })
                ]
            });
            render(<AnimeLibrary />);
            await user.click(screen.getByRole('button', { name: 'OPEN SERIES: Series' }));
            expect(screen.getAllByTestId('anime-season').map((season) => { return season.querySelector('.season__chip')?.textContent; })).toEqual(['Zebra', 'Mango', 'Apple']);
        });

        it('lists the cards in alphabetical order: a series by its name and an anime on its own by its title', () => {
            useAnimeStore.setState({
                library: [
                    makeAnime([], { id: 80, title: 'Zero no Tsukaima' }),
                    makeAnime([], { id: 81, title: 'Bleach: Arc', series: 'Bleach', season: 2 }),
                    makeAnime([], { id: 82, title: 'cowboy bebop' }),
                    makeAnime([], { id: 83, title: 'Bleach', series: 'Bleach', season: 1 }),
                    makeAnime([], { id: 84, title: 'Árvore' }),
                    makeAnime([], { id: 85, title: 'Attack on Titan Season 2', series: 'Attack on Titan', season: 2 }),
                    makeAnime([], { id: 86, title: 'Attack on Titan', series: 'Attack on Titan', season: 1 })
                ]
            });
            render(<AnimeLibrary />);
            expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => { return heading.textContent; })).toEqual(['Árvore', 'Attack on Titan', 'Bleach', 'cowboy bebop', 'Zero no Tsukaima']);
        });

        it('has the episodes of each season on its row, and the folder is on the screen of the series, not on a season', async () => {
            const user = userEvent.setup();
            useAnimeStore.setState({ library: SERIES_LIBRARY });
            render(<AnimeLibrary />);
            await user.click(screen.getByRole('button', { name: 'OPEN SERIES: Frieren' }));
            const [first, second] = screen.getAllByTestId('anime-season');

            expect(within(second as HTMLElement).queryByRole('button', { name: 'OPEN FOLDER: Frieren Season 2' })).not.toBeInTheDocument();
            await user.click(within(second as HTMLElement).getByRole('button', { name: /^SHOW EPISODES: / }));
            expect(within(second as HTMLElement).queryByRole('button', { name: /^OPEN FOLDER/ })).not.toBeInTheDocument();
            expect(within(first as HTMLElement).queryByRole('button', { name: /^OPEN FOLDER/ })).not.toBeInTheDocument();
            await user.click(within(first as HTMLElement).getByRole('button', { name: /^SHOW EPISODES: / }));
            expect(within(first as HTMLElement).getAllByTestId('anime-episode')).toHaveLength(1);
            expect(within(second as HTMLElement).getAllByTestId('anime-episode')).toHaveLength(2);
            expect(mock.api.openAnimeFolder).not.toHaveBeenCalled();
        });

        it('keeps the secondary buttons and the editor of a season inside it, and the main ones on its row', async () => {
            const user = userEvent.setup();
            useAnimeStore.setState({ library: SERIES_LIBRARY });
            render(<AnimeLibrary />);
            await user.click(screen.getByRole('button', { name: 'OPEN SERIES: Frieren' }));
            const [first] = screen.getAllByTestId('anime-season');
            expect(within(first as HTMLElement).getByRole('button', { name: 'GO TO SOURCE: Frieren' })).toBeInTheDocument();
            expect(within(first as HTMLElement).getByRole('button', { name: /^SHOW EPISODES: / })).toBeInTheDocument();
            expect(within(first as HTMLElement).queryByRole('button', { name: /^EDIT SEASON/ })).not.toBeInTheDocument();
            expect(within(first as HTMLElement).queryByRole('button', { name: /^REMOVE ANIME/ })).not.toBeInTheDocument();
            expect(within(first as HTMLElement).queryByRole('button', { name: /^GET MORE EPISODES/ })).not.toBeInTheDocument();
            await user.click(within(first as HTMLElement).getByRole('button', { name: /^SHOW EPISODES: / }));
            expect(within(first as HTMLElement).getByRole('button', { name: 'EDIT SEASON: Frieren' })).toBeInTheDocument();
            expect(within(first as HTMLElement).getByRole('button', { name: 'REMOVE ANIME: Frieren' })).toBeInTheDocument();
        });

        it('opens the screen of the series, with the season in view and every season closed, when it comes from the search', () => {
            const scrollIntoView = vi.fn();
            Element.prototype.scrollIntoView = scrollIntoView;
            useAnimeStore.setState({ library: SERIES_LIBRARY, libraryFocus: 40 });
            render(<AnimeLibrary />);
            expect(screen.getByTestId('series-view')).toBeInTheDocument();
            expect(screen.getAllByTestId('anime-season')).toHaveLength(2);
            expect(screen.queryByTestId('anime-episode')).not.toBeInTheDocument();
            screen.getAllByRole('button', { name: /^SHOW EPISODES: / }).forEach((button) => {
                expect(button).toHaveAttribute('aria-expanded', 'false');
            });
            expect(scrollIntoView).toHaveBeenCalledTimes(1);
        });

        it('finds a series by its name, and a season by its title', async () => {
            const user = userEvent.setup();
            useAnimeStore.setState({ library: SERIES_LIBRARY });
            render(<AnimeLibrary />);
            const field = screen.getByRole('textbox', { name: 'Search the library' });

            await user.type(field, 'frieren');
            expect(screen.getAllByTestId('anime-card')).toHaveLength(1);
            expect(screen.getByText('2 SEASONS')).toBeInTheDocument();

            await user.clear(field);
            await user.type(field, 'season 2');
            expect(screen.getAllByTestId('anime-card')).toHaveLength(1);
            expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Frieren');
        });

        async function openSeasonEditor(user: ReturnType<typeof userEvent.setup>, season = 1): Promise<HTMLElement> {
            await user.click(screen.getByRole('button', { name: 'OPEN SERIES: Frieren' }));
            const seasons = screen.getAllByTestId('anime-season');
            const chosen = seasons[season - 1] as HTMLElement;
            await user.click(within(chosen).getByRole('button', { name: /^SHOW EPISODES: / }));
            await user.click(within(chosen).getByRole('button', { name: /^EDIT SEASON: / }));
            return within(chosen).getByRole('group', { name: /^EDIT SEASON: / });
        }

        it('edits the season of an anime in a series: it starts with the order and the name it has, and saves them', async () => {
            const user = userEvent.setup();
            const setSeries = vi.fn(async () => {
                return { ok: true as const };
            });
            useAnimeStore.setState({ library: SERIES_LIBRARY, setSeries });
            render(<AnimeLibrary />);

            const editor = await openSeasonEditor(user, 2);
            expect(within(editor).getByRole('spinbutton', { name: 'Order' })).toHaveValue(2);
            expect(within(editor).getByRole('textbox', { name: 'Name shown' })).toHaveValue('');
            expect(within(editor).getByRole('textbox', { name: 'Name shown' })).toHaveAttribute('placeholder', 'Shown instead of "SEASON 2" (optional)');

            await user.clear(within(editor).getByRole('spinbutton', { name: 'Order' }));
            await user.type(within(editor).getByRole('spinbutton', { name: 'Order' }), '3');
            await user.type(within(editor).getByRole('textbox', { name: 'Name shown' }), '  The  Second ');
            await user.click(within(editor).getByRole('button', { name: 'SAVE' }));

            expect(setSeries).toHaveBeenCalledTimes(1);
            expect(setSeries).toHaveBeenCalledWith(40, 'Frieren', 3, 'The Second');
            expect(screen.queryByRole('group', { name: /^EDIT SEASON: / })).not.toBeInTheDocument();
        });

        it('puts the name shown above the order', async () => {
            const user = userEvent.setup();
            useAnimeStore.setState({ library: SERIES_LIBRARY });
            render(<AnimeLibrary />);
            const editor = await openSeasonEditor(user, 2);
            const name = within(editor).getByRole('textbox', { name: 'Name shown' });
            const order = within(editor).getByRole('spinbutton', { name: 'Order' });
            expect(name.compareDocumentPosition(order) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            expect(order.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
        });

        it('starts the name shown with the one the season has', async () => {
            const user = userEvent.setup();
            const setSeries = vi.fn(async () => {
                return { ok: true as const };
            });
            const named = [
                makeAnime([makeEpisode({ id: 90 })], { id: 90, title: 'Bleach', series: 'Bleach', season: 1, seasonName: 'The Start' }),
                makeAnime([makeEpisode({ id: 91 })], { id: 91, title: 'Bleach 2', series: 'Bleach', season: 2 })
            ];
            useAnimeStore.setState({ library: named, setSeries });
            render(<AnimeLibrary />);
            await user.click(screen.getByRole('button', { name: 'OPEN SERIES: Bleach' }));
            await user.click(within(screen.getAllByTestId('anime-season')[0] as HTMLElement).getByRole('button', { name: /^SHOW EPISODES: / }));
            await user.click(screen.getByRole('button', { name: 'EDIT SEASON: Bleach' }));
            const editor = screen.getByRole('group', { name: 'EDIT SEASON: Bleach' });
            expect(within(editor).getByRole('textbox', { name: 'Name shown' })).toHaveValue('The Start');

            await user.clear(within(editor).getByRole('textbox', { name: 'Name shown' }));
            await user.type(within(editor).getByRole('textbox', { name: 'Name shown' }), 'The Beginning');
            await user.click(within(editor).getByRole('button', { name: 'SAVE' }));
            expect(setSeries).toHaveBeenCalledWith(90, 'Bleach', 1, 'The Beginning');
        });

        it('saves no name when the field is left empty, and keeps the series the anime has', async () => {
            const user = userEvent.setup();
            const setSeries = vi.fn(async () => {
                return { ok: true as const };
            });
            useAnimeStore.setState({ library: SERIES_LIBRARY, setSeries });
            render(<AnimeLibrary />);
            const editor = await openSeasonEditor(user, 2);
            await user.click(within(editor).getByRole('button', { name: 'SAVE' }));
            expect(setSeries).toHaveBeenCalledWith(40, 'Frieren', 2, null);
        });

        it('cannot change the series of the anime, nor take it out of it: the editor has no field for the series and no button to leave', async () => {
            const user = userEvent.setup();
            useAnimeStore.setState({ library: SERIES_LIBRARY });
            render(<AnimeLibrary />);
            const editor = await openSeasonEditor(user, 2);
            expect(within(editor).queryByRole('textbox', { name: 'Series' })).not.toBeInTheDocument();
            expect(within(editor).queryByRole('listbox')).not.toBeInTheDocument();
            expect(within(editor).queryByRole('button', { name: 'REMOVE FROM SERIES' })).not.toBeInTheDocument();
            expect(
                within(editor)
                    .getAllByRole('button')
                    .map((button) => {
                        return button.textContent;
                    })
            ).toEqual(['SAVE', 'CANCEL']);
        });

        it('says why the order was refused, with the one it could take, and keeps the editor open', async () => {
            const user = userEvent.setup();
            const setSeries = vi.fn(async () => {
                return { ok: false as const, reason: 'season-taken' as const, suggested: 3 };
            });
            useAnimeStore.setState({ library: SERIES_LIBRARY, setSeries });
            render(<AnimeLibrary />);
            const editor = await openSeasonEditor(user, 2);
            await user.click(within(editor).getByRole('button', { name: 'SAVE' }));
            expect(screen.getByRole('alert')).toHaveTextContent('Order 2 is already used by another anime of the series. Use 3, the next one.');
            expect(screen.getByRole('group', { name: 'EDIT SEASON: Frieren Season 2' })).toBeInTheDocument();
        });

        it('says what was refused when the app answers that it was invalid, and keeps the editor open', async () => {
            const user = userEvent.setup();
            const setSeries = vi.fn(async () => {
                return { ok: false as const, reason: 'invalid' as const };
            });
            useAnimeStore.setState({ library: SERIES_LIBRARY, setSeries });
            render(<AnimeLibrary />);
            const editor = await openSeasonEditor(user, 2);
            await user.click(within(editor).getByRole('button', { name: 'SAVE' }));
            expect(screen.getByRole('alert')).toHaveTextContent('Give an order from 1 to 99 and a name of up to 60 characters.');
            expect(screen.getByRole('group', { name: 'EDIT SEASON: Frieren Season 2' })).toBeInTheDocument();
        });

        it('says so, without asking the app, when the order cannot be used', async () => {
            const user = userEvent.setup();
            const setSeries = vi.fn();
            useAnimeStore.setState({ library: SERIES_LIBRARY, setSeries });
            render(<AnimeLibrary />);
            const editor = await openSeasonEditor(user, 2);
            await user.clear(within(editor).getByRole('spinbutton', { name: 'Order' }));
            await user.type(within(editor).getByRole('spinbutton', { name: 'Order' }), '100');
            await user.click(within(editor).getByRole('button', { name: 'SAVE' }));
            expect(screen.getByRole('alert')).toHaveTextContent('Give an order from 1 to 99 and a name of up to 60 characters.');
            expect(setSeries).not.toHaveBeenCalled();
        });

        it('closes the editor without changing anything', async () => {
            const user = userEvent.setup();
            const setSeries = vi.fn();
            useAnimeStore.setState({ library: SERIES_LIBRARY, setSeries });
            render(<AnimeLibrary />);
            const editor = await openSeasonEditor(user, 2);
            await user.click(within(editor).getByRole('button', { name: 'CANCEL' }));
            expect(screen.queryByRole('group', { name: /^EDIT SEASON: / })).not.toBeInTheDocument();
            expect(setSeries).not.toHaveBeenCalled();
        });

        it('removes the whole series from its card, after the confirmation', async () => {
            const user = userEvent.setup();
            const removeAnime = vi.fn(async () => {
                return undefined;
            });
            useAnimeStore.setState({ library: SERIES_LIBRARY, removeAnime });
            render(<AnimeLibrary />);
            await user.click(screen.getByRole('button', { name: 'REMOVE SERIES: Frieren' }));
            expect(removeAnime).not.toHaveBeenCalled();
            await user.click(screen.getByRole('button', { name: 'CONFIRM' }));
            await vi.waitFor(() => {
                expect(removeAnime.mock.calls).toEqual([[41], [40]]);
            });
        });

        it('removes one season, or the whole series from the gear of its screen, after the confirmation', async () => {
            const user = userEvent.setup();
            const removeAnime = vi.fn(async () => {
                return undefined;
            });
            useAnimeStore.setState({ library: SERIES_LIBRARY, removeAnime });
            render(<AnimeLibrary />);

            await user.click(screen.getByRole('button', { name: 'OPEN SERIES: Frieren' }));
            await user.click(within(screen.getAllByTestId('anime-season')[1] as HTMLElement).getByRole('button', { name: /^SHOW EPISODES: / }));
            await user.click(screen.getByRole('button', { name: 'REMOVE ANIME: Frieren Season 2' }));
            await user.click(screen.getByRole('button', { name: 'CONFIRM' }));
            expect(removeAnime.mock.calls).toEqual([[40]]);

            await user.click(screen.getByRole('button', { name: 'Series options: Frieren' }));
            await user.click(screen.getByRole('button', { name: 'REMOVE SERIES: Frieren' }));
            expect(removeAnime).toHaveBeenCalledTimes(1);
            await user.click(screen.getByRole('button', { name: 'CONFIRM' }));
            await vi.waitFor(() => {
                expect(removeAnime.mock.calls).toEqual([[40], [41], [40]]);
            });
        });

    });

    describe('importing a folder', () => {
        it('asks for the import from the empty library and from one that has animes', async () => {
            const user = userEvent.setup();
            const importLibrary = vi.fn(async () => {
                return undefined;
            });
            useAnimeStore.setState({ importLibrary });
            const { unmount } = render(<AnimeLibrary />);
            await user.click(screen.getByRole('button', { name: 'IMPORT LIBRARY' }));
            expect(importLibrary).toHaveBeenCalledTimes(1);
            unmount();

            useAnimeStore.setState({ library: LIBRARY, importLibrary });
            render(<AnimeLibrary />);
            expect(screen.getByRole('button', { name: 'IMPORT LIBRARY' })).toHaveAttribute('title', 'Choose a folder of anime and add what is in it to the library');
            await user.click(screen.getByRole('button', { name: 'IMPORT LIBRARY' }));
            expect(importLibrary).toHaveBeenCalledTimes(2);
        });

        it('shows what the import added and says what it did', async () => {
            const user = userEvent.setup();
            mock.api.importAnimeLibrary.mockResolvedValue({ ok: true, added: 1, relinked: 0, skipped: 0, ignored: 0 });
            mock.api.listAnimeLibrary.mockResolvedValue([makeAnime([makeEpisode({ id: 1 })], { id: 20, title: 'Bleach' })]);
            render(<AnimeLibrary />);
            await user.click(screen.getByRole('button', { name: 'IMPORT LIBRARY' }));
            expect(await screen.findByRole('heading', { name: 'Bleach' })).toBeInTheDocument();
            expect(useAppStore.getState().notice).toEqual({ kind: 'info', message: 'IMPORT DONE: 1 ADDED · 0 POINTED TO A NEW PLACE · 0 ALREADY IN THE LIBRARY · 0 NOT RECOGNIZED' });
        });
    });

    describe('an episode whose file is gone', () => {
        const GONE = makeAnime([makeEpisode({ id: 1, number: '1', fileMissing: true }), makeEpisode({ id: 2, number: '2' })], { id: 30 });

        it('is marked, and cannot be played, while the others can', async () => {
            const user = userEvent.setup();
            useAnimeStore.setState({ library: [GONE] });
            render(<AnimeLibrary />);
            await user.click(screen.getByRole('button', { name: 'OPEN SERIES: Naruto' }));
            await user.click(screen.getByRole('button', { name: /^SHOW EPISODES: / }));
            const [gone, fine] = screen.getAllByTestId('anime-episode');

            const mark = within(gone as HTMLElement).getByRole('img', { name: 'FILE NOT FOUND' });
            expect(mark).toHaveClass('missing-mark');
            expect(mark).toHaveAttribute('title', 'The file of this episode is not on the disk. Use IMPORT LIBRARY to point it to its new place.');
            expect(gone).toHaveClass('history__item--error');
            expect(within(gone as HTMLElement).queryByRole('button', { name: 'PLAY: Naruto EP 1' })).not.toBeInTheDocument();
            expect(gone).not.toHaveClass('row--link');

            expect(within(fine as HTMLElement).queryByRole('img', { name: 'FILE NOT FOUND' })).not.toBeInTheDocument();
            expect(fine).not.toHaveClass('history__item--error');
            expect(within(fine as HTMLElement).getByRole('button', { name: 'PLAY: Naruto EP 2' })).toBeEnabled();
            expect(fine).toHaveClass('row--link');
        });

        it('does not start the player', async () => {
            const user = userEvent.setup();
            useAnimeStore.setState({ library: [GONE] });
            render(<AnimeLibrary />);
            await user.click(screen.getByRole('button', { name: 'OPEN SERIES: Naruto' }));
            await user.click(screen.getByRole('button', { name: /^SHOW EPISODES: / }));
            expect(screen.queryByRole('button', { name: 'PLAY: Naruto EP 1' })).not.toBeInTheDocument();
            await user.click(screen.getByText('EP 1'));
            expect(useAnimeStore.getState().playing).toBeNull();
        });
    });

    describe('searching the library', () => {
        const MANY = [
            makeAnime([makeEpisode({ id: 1 })], { id: 1, title: 'Naruto', audio: 'sub' }),
            makeAnime([makeEpisode({ id: 2 })], { id: 2, title: 'Naruto', audio: 'dub' }),
            makeAnime([makeEpisode({ id: 3 })], { id: 3, title: 'Pokémon' }),
            makeAnime([makeEpisode({ id: 4 })], { id: 4, title: 'Cyberpunk: Edgerunners' })
        ];

        function titles(): Array<string | null> {
            return screen.getAllByRole('heading', { level: 3 }).map((heading) => {
                return heading.textContent;
            });
        }

        it('has a search field above the animes', () => {
            useAnimeStore.setState({ library: MANY });
            render(<AnimeLibrary />);
            const field = screen.getByRole('textbox', { name: 'Search the library' });
            expect(field).toHaveValue('');
            expect(field).toHaveAttribute('placeholder', 'Search your animes…');
            expect(screen.getByText('4 ANIMES')).toBeInTheDocument();
            expect(titles()).toEqual(['Cyberpunk: Edgerunners', 'Naruto', 'Naruto', 'Pokémon']);
        });

        it('has none while the library is empty', () => {
            render(<AnimeLibrary />);
            expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
        });

        it('shows only the animes that match, and counts them', async () => {
            const user = userEvent.setup();
            useAnimeStore.setState({ library: MANY });
            render(<AnimeLibrary />);

            await user.type(screen.getByRole('textbox', { name: 'Search the library' }), 'naru');
            expect(titles()).toEqual(['Naruto', 'Naruto']);
            expect(screen.getByText('2 ANIMES')).toBeInTheDocument();
            expect(screen.getAllByTestId('anime-card')).toHaveLength(2);
        });

        it('does not mind the case or the accents', async () => {
            const user = userEvent.setup();
            useAnimeStore.setState({ library: MANY });
            render(<AnimeLibrary />);

            await user.type(screen.getByRole('textbox', { name: 'Search the library' }), 'POKEMON');
            expect(titles()).toEqual(['Pokémon']);
            expect(screen.getByText('1 ANIMES')).toBeInTheDocument();
        });

        it('says when nothing matches, and shows everything again when the search is cleared', async () => {
            const user = userEvent.setup();
            useAnimeStore.setState({ library: MANY });
            render(<AnimeLibrary />);
            const field = screen.getByRole('textbox', { name: 'Search the library' });

            await user.type(field, 'bleach');
            expect(screen.getByText('// NO ANIME IN THE LIBRARY MATCHES THIS SEARCH.')).toBeInTheDocument();
            expect(screen.queryByTestId('anime-card')).not.toBeInTheDocument();
            expect(screen.getByText('0 ANIMES')).toBeInTheDocument();
            expect(field).toBeInTheDocument();

            await user.clear(field);
            expect(screen.queryByText('// NO ANIME IN THE LIBRARY MATCHES THIS SEARCH.')).not.toBeInTheDocument();
            expect(titles()).toHaveLength(4);
        });

        it('keeps the buttons of the animes that are shown working', async () => {
            const user = userEvent.setup();
            useAnimeStore.setState({ library: MANY });
            render(<AnimeLibrary />);
            await user.type(screen.getByRole('textbox', { name: 'Search the library' }), 'cyber');
            await user.click(screen.getByRole('button', { name: 'OPEN SERIES: Cyberpunk: Edgerunners' }));
            await user.click(screen.getByRole('button', { name: 'OPEN FOLDER: Cyberpunk: Edgerunners' }));
            expect(mock.api.openAnimeSeriesFolder).toHaveBeenCalledWith(4);
            expect(mock.api.openAnimeFolder).not.toHaveBeenCalled();
        });

    });

    it('lists the animes as cards with how many seasons they have, and their audio and progress on the screen of the series', async () => {
        const user = userEvent.setup();
        useAnimeStore.setState({ library: LIBRARY });
        render(<AnimeLibrary />);

        expect(screen.getByText('2 ANIMES')).toBeInTheDocument();
        const [subbed, dubbed] = screen.getAllByTestId('anime-card');
        expect(within(subbed as HTMLElement).getByRole('heading', { name: 'Naruto' })).toBeInTheDocument();
        expect(within(subbed as HTMLElement).getByText('1 SEASON')).toBeInTheDocument();
        expect(within(dubbed as HTMLElement).getByText('1 SEASON')).toBeInTheDocument();
        expect(screen.queryByText('3/6 DOWNLOADED')).not.toBeInTheDocument();
        expect(screen.queryByTestId('anime-episode')).not.toBeInTheDocument();

        await user.click(within(subbed as HTMLElement).getByRole('button', { name: 'OPEN SERIES: Naruto' }));
        expect(screen.getByText('SUBTITLED')).toBeInTheDocument();
        expect(screen.getByText('3/6 DOWNLOADED')).toBeInTheDocument();
    });

    it('has a button on each anime that opens it in the search, where its source is', async () => {
        const user = userEvent.setup();
        const openLibraryAnime = vi.fn(async () => {
            return undefined;
        });
        useAnimeStore.setState({ library: LIBRARY, openLibraryAnime });
        render(<AnimeLibrary />);

        await user.click(screen.getAllByRole('button', { name: 'OPEN SERIES: Naruto' })[1] as HTMLElement);
        await user.click(screen.getByRole('button', { name: 'GO TO SOURCE: Naruto' }));
        expect(openLibraryAnime).toHaveBeenCalledTimes(1);
        expect(openLibraryAnime).toHaveBeenCalledWith(LIBRARY[1]);
        expect(screen.queryByRole('button', { name: /^GET MORE EPISODES/ })).not.toBeInTheDocument();
    });

    it('shows the anime in the search with its episodes when the button is used', async () => {
        const user = userEvent.setup();
        mock.api.listAnimeEpisodes.mockResolvedValue({ ok: true, episodes: ['1', '2'] });
        useAnimeStore.setState({ library: [LIBRARY[0] as (typeof LIBRARY)[number]], view: 'library' });
        render(<AnimeLibrary />);
        await user.click(screen.getByRole('button', { name: 'OPEN SERIES: Naruto' }));
        await user.click(screen.getByRole('button', { name: 'GO TO SOURCE: Naruto' }));

        expect(useAnimeStore.getState().view).toBe('search');
        expect(mock.api.listAnimeEpisodes).toHaveBeenCalledWith('naruto', 1, 'sub');
        expect(useAnimeStore.getState().selection).toMatchObject({ result: { index: 1, title: 'Naruto' }, status: 'ready', episodes: ['1', '2'] });
    });

    describe('coming from the search', () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('opens the screen of the anime that was looked at, in view and closed, even when it is the only season', () => {
            const scrollIntoView = vi.fn();
            Element.prototype.scrollIntoView = scrollIntoView;
            useAnimeStore.setState({ library: LIBRARY, libraryFocus: 10 });
            render(<AnimeLibrary />);

            expect(screen.getByTestId('series-view')).toBeInTheDocument();
            expect(screen.getByRole('heading', { level: 3, name: 'Naruto' })).toBeInTheDocument();
            expect(screen.queryByTestId('anime-episode')).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: /^SHOW EPISODES: / })).toHaveAttribute('aria-expanded', 'false');
            expect(screen.getByRole('button', { name: 'BACK TO LIBRARY' })).toBeInTheDocument();
            expect(scrollIntoView).toHaveBeenCalledTimes(1);
            expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
        });

        it('keeps every anime closed when none was looked at', () => {
            const scrollIntoView = vi.fn();
            Element.prototype.scrollIntoView = scrollIntoView;
            useAnimeStore.setState({ library: LIBRARY, libraryFocus: null });
            render(<AnimeLibrary />);
            expect(screen.queryByTestId('anime-episode')).not.toBeInTheDocument();
            expect(scrollIntoView).not.toHaveBeenCalled();
        });

        it('works where the browser cannot scroll an element into view', () => {
            Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
            useAnimeStore.setState({ library: LIBRARY, libraryFocus: 10 });
            expect(() => {
                render(<AnimeLibrary />);
            }).not.toThrow();
            expect(screen.queryByTestId('anime-episode')).not.toBeInTheDocument();
        });
    });

    describe('marking an episode as watched', () => {
        function open(): void {
            useAnimeStore.setState({ library: [LIBRARY[0] as (typeof LIBRARY)[number]] });
        }

        it('offers to mark a downloaded episode as watched, and to undo it when it is', async () => {
            const user = userEvent.setup();
            const setWatched = vi.fn(async () => {
                return undefined;
            });
            open();
            useAnimeStore.setState({ setWatched });
            render(<AnimeLibrary />);
            await user.click(screen.getByRole('button', { name: 'OPEN SERIES: Naruto' }));
            await user.click(screen.getByRole('button', { name: /^SHOW EPISODES: / }));

            const unwatched = screen.getByRole('button', { name: 'MARK AS WATCHED: Naruto EP 1' });
            expect(unwatched).toHaveAttribute('aria-pressed', 'false');
            await user.click(unwatched);
            expect(setWatched).toHaveBeenLastCalledWith(1, true);

            const watched = screen.getByRole('button', { name: 'MARK AS UNWATCHED: Naruto EP 3' });
            expect(watched).toHaveAttribute('aria-pressed', 'true');
            await user.click(watched);
            expect(setWatched).toHaveBeenLastCalledWith(3, false);
            expect(setWatched).toHaveBeenCalledTimes(2);
        });

        it('has the button only on downloaded episodes', async () => {
            const user = userEvent.setup();
            open();
            render(<AnimeLibrary />);
            await user.click(screen.getByRole('button', { name: 'OPEN SERIES: Naruto' }));
            await user.click(screen.getByRole('button', { name: /^SHOW EPISODES: / }));
            expect(screen.getAllByRole('button', { name: /^MARK AS (UN)?WATCHED/ })).toHaveLength(3);
            ['4', '5', '6'].forEach((number) => {
                expect(screen.queryByRole('button', { name: new RegExp(`MARK AS (UN)?WATCHED: Naruto EP ${number}$`) })).not.toBeInTheDocument();
            });
        });

        it('saves the mark and shows the episode as watched', async () => {
            const user = userEvent.setup();
            open();
            const episode = makeEpisode({ id: 1, number: '1', sizeBytes: 2 * 1024 ** 2, watched: true });
            mock.api.listAnimeLibrary.mockResolvedValue([makeAnime([episode], { id: 10, title: 'Naruto', audio: 'sub' })]);
            render(<AnimeLibrary />);
            await user.click(screen.getByRole('button', { name: 'OPEN SERIES: Naruto' }));
            await user.click(screen.getByRole('button', { name: /^SHOW EPISODES: / }));
            await user.click(screen.getByRole('button', { name: 'MARK AS WATCHED: Naruto EP 1' }));

            expect(mock.api.saveAnimeProgress).toHaveBeenCalledWith({ episodeId: 1, positionSeconds: 0, durationSeconds: 0, watched: true });
            expect(await screen.findByRole('button', { name: 'MARK AS UNWATCHED: Naruto EP 1' })).toBeInTheDocument();
            expect(screen.getByRole('img', { name: 'WATCHED' })).toBeInTheDocument();
            expect(screen.getByTestId('anime-episode')).toHaveClass('history__item--watched');
        });
    });

    describe('the folder of the videos', () => {
        it('opens the folder of the series, from its screen, through an anime of it that has an episode downloaded', async () => {
            const user = userEvent.setup();
            useAnimeStore.setState({ library: LIBRARY });
            render(<AnimeLibrary />);

            await user.click(screen.getAllByRole('button', { name: 'OPEN SERIES: Naruto' })[0] as HTMLElement);
            const buttons = screen.getAllByRole('button', { name: 'OPEN FOLDER: Naruto' });
            expect(buttons).toHaveLength(1);
            await user.click(buttons[0] as HTMLElement);
            expect(mock.api.openAnimeSeriesFolder).toHaveBeenCalledTimes(1);
            expect(mock.api.openAnimeSeriesFolder).toHaveBeenCalledWith(10);
            expect(mock.api.openAnimeFolder).not.toHaveBeenCalled();
            expect(mock.api.showItemInFolder).not.toHaveBeenCalled();
        });

        it('uses the first season that has something downloaded, whatever the ones before it have', async () => {
            const user = userEvent.setup();
            useAnimeStore.setState({
                library: [
                    makeAnime([makeEpisode({ id: 1, status: 'idle', filePath: null })], { id: 20, title: 'Bleach', series: 'Bleach', season: 1 }),
                    makeAnime([makeEpisode({ id: 2 })], { id: 21, title: 'Bleach 2', series: 'Bleach', season: 2 }),
                    makeAnime([makeEpisode({ id: 3 })], { id: 22, title: 'Bleach 3', series: 'Bleach', season: 3 })
                ]
            });
            render(<AnimeLibrary />);
            await user.click(screen.getByRole('button', { name: 'OPEN SERIES: Bleach' }));
            await user.click(screen.getByRole('button', { name: 'OPEN FOLDER: Bleach' }));
            expect(mock.api.openAnimeSeriesFolder).toHaveBeenCalledWith(21);
        });

        it('is on the row of the series, to the left of the gear and not in a season', async () => {
            const user = userEvent.setup();
            useAnimeStore.setState({ library: LIBRARY });
            render(<AnimeLibrary />);
            await user.click(screen.getAllByRole('button', { name: 'OPEN SERIES: Naruto' })[0] as HTMLElement);
            const badges = screen.getByTestId('series-view').querySelector('header.job__head .job__badges') as HTMLElement;
            const folder = within(badges).getByRole('button', { name: 'OPEN FOLDER: Naruto' });
            const gear = within(badges).getByRole('button', { name: 'Series options: Naruto' });
            expect(folder.compareDocumentPosition(gear) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            expect(within(screen.getByTestId('anime-season')).queryByRole('button', { name: /^OPEN FOLDER/ })).not.toBeInTheDocument();
        });

        it('is not offered when nothing is downloaded', async () => {
            const user = userEvent.setup();
            useAnimeStore.setState({
                library: [makeAnime([makeEpisode({ id: 1, status: 'error', filePath: null }), makeEpisode({ id: 2, status: 'queued', filePath: null })], { id: 12 })]
            });
            render(<AnimeLibrary />);
            await user.click(screen.getByRole('button', { name: 'OPEN SERIES: Naruto' }));
            expect(screen.queryByRole('button', { name: /OPEN FOLDER/ })).not.toBeInTheDocument();
        });
    });

    it('shows and hides the episodes', async () => {
        const user = userEvent.setup();
        useAnimeStore.setState({ library: [LIBRARY[0] as (typeof LIBRARY)[number]] });
        render(<AnimeLibrary />);

        // On the card there are no episodes: the button takes to the screen of the anime, where they are shown.
        expect(screen.queryByTestId('anime-episode')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'OPEN SERIES: Naruto' }));
        // Even the only season of a series opens closed.
        expect(screen.queryByTestId('anime-episode')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^SHOW EPISODES: / })).toHaveAttribute('aria-expanded', 'false');

        await user.click(screen.getByRole('button', { name: /^SHOW EPISODES: / }));
        expect(screen.getAllByTestId('anime-episode')).toHaveLength(6);
        expect(screen.getByRole('button', { name: /^HIDE EPISODES: / })).toHaveAttribute('aria-expanded', 'true');

        await user.click(screen.getByRole('button', { name: /^HIDE EPISODES: / }));
        expect(screen.queryByTestId('anime-episode')).not.toBeInTheDocument();
    });

    describe('episodes', () => {
        async function expand() {
            const user = userEvent.setup();
            useAnimeStore.setState({ library: [LIBRARY[0] as (typeof LIBRARY)[number]] });
            render(<AnimeLibrary />);
            await user.click(screen.getByRole('button', { name: 'OPEN SERIES: Naruto' }));
            await user.click(screen.getByRole('button', { name: /^SHOW EPISODES: / }));
            return { user, rows: screen.getAllByTestId('anime-episode') };
        }

        it('describes each episode: status, size and where it stopped', async () => {
            const { rows } = await expand();
            const meta = rows.map((row) => {
                return row.querySelector('.history__meta')?.textContent;
            });
            expect(meta).toEqual([
                'DOWNLOADED · 2.0 MiB',
                'DOWNLOADED · 3.0 MiB · RESUME 10:00',
                'DOWNLOADED · 1.0 KiB',
                'FAILED',
                'CANCELLED',
                'QUEUED'
            ]);
            expect(rows[3]).toHaveClass('history__item--error');
            expect(rows[0]).not.toHaveClass('history__item--error');
        });

        it('marks only the watched episode with a visual indicator, not with a word', async () => {
            const { rows } = await expand();
            const watched = within(rows[2] as HTMLElement).getByRole('img', { name: 'WATCHED' });
            expect(watched).toHaveClass('watched-mark');
            expect(watched).toHaveTextContent('✓');
            expect(watched).toHaveAttribute('title', 'WATCHED');
            expect(rows[2]).toHaveClass('history__item--watched');
            expect(rows[2]?.querySelector('.history__meta')?.textContent).not.toContain('WATCHED');
            expect(screen.getAllByRole('img', { name: 'WATCHED' })).toHaveLength(1);
            [0, 1, 3, 4, 5].forEach((position) => {
                expect(rows[position]).not.toHaveClass('history__item--watched');
                expect(within(rows[position] as HTMLElement).queryByRole('img', { name: 'WATCHED' })).not.toBeInTheDocument();
            });
        });

        it('explains why an episode failed', async () => {
            const { rows } = await expand();
            const reason = within(rows[3] as HTMLElement).getByText('No video source was found for this episode.');
            expect(reason).toHaveAttribute('title', 'No sources found for sub!');
        });

        it('plays a downloaded episode', async () => {
            const { user } = await expand();
            await user.click(screen.getByRole('button', { name: 'PLAY: Naruto EP 2' }));
            expect(useAnimeStore.getState().playing).toEqual({ animeId: 10, episodeId: 2 });
        });

        it('has no button to show the file of an episode, which is what the button of the anime is for', async () => {
            await expand();
            expect(screen.queryByRole('button', { name: /^SHOW FILE/ })).not.toBeInTheDocument();
            expect(screen.getAllByRole('button', { name: 'OPEN FOLDER: Naruto' })).toHaveLength(1);
        });

        it('does not offer to play anything that is not downloaded', async () => {
            const { rows } = await expand();
            [3, 4, 5].forEach((position) => {
                expect(within(rows[position] as HTMLElement).queryByRole('button', { name: /^PLAY/ })).not.toBeInTheDocument();
            });
        });

        it('retries a failed or cancelled episode', async () => {
            const { user } = await expand();
            await user.click(screen.getByRole('button', { name: 'RETRY: Naruto EP 4' }));
            await user.click(screen.getByRole('button', { name: 'RETRY: Naruto EP 5' }));
            expect(mock.api.retryAnimeJob.mock.calls).toEqual([[4], [5]]);
            expect(screen.queryByRole('button', { name: 'RETRY: Naruto EP 6' })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'RETRY: Naruto EP 1' })).not.toBeInTheDocument();
        });

        it('has no button to remove an episode: an anime leaves the library whole, with its series', async () => {
            const { rows } = await expand();
            rows.forEach((row, index) => {
                expect(within(row).queryByRole('button', { name: new RegExp(`^REMOVE: Naruto EP ${index + 1}$`) })).not.toBeInTheDocument();
                expect(within(row).queryByRole('button', { name: /^REMOVE/ })).not.toBeInTheDocument();
            });
            expect(screen.queryByRole('button', { name: /^REMOVE: / })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'CONFIRM' })).not.toBeInTheDocument();
            expect(mock.api.removeAnimeEpisode).not.toHaveBeenCalled();
        });

    });

    it('removes an anime that is not the one that names its series, asking first', async () => {
        const user = userEvent.setup();
        const library = [
            makeAnime([makeEpisode({ id: 1 })], { id: 10, title: 'Naruto', series: 'Naruto', season: 1 }),
            makeAnime([makeEpisode({ id: 2 })], { id: 11, title: 'Naruto Shippuden', series: 'Naruto', season: 2 })
        ];
        useAnimeStore.setState({ library });
        render(<AnimeLibrary />);

        await user.click(screen.getByRole('button', { name: 'OPEN SERIES: Naruto' }));
        await user.click(within(screen.getAllByTestId('anime-season')[1] as HTMLElement).getByRole('button', { name: /^SHOW EPISODES: / }));
        await user.click(screen.getByRole('button', { name: 'REMOVE ANIME: Naruto Shippuden' }));
        expect(mock.api.removeAnime).not.toHaveBeenCalled();
        await user.click(screen.getByRole('button', { name: 'CONFIRM' }));
        expect(mock.api.removeAnime).toHaveBeenCalledWith(11);
    });

    describe('rows and cards that open by clicking on them', () => {
        it('opens a series from its card: the name is the button, the card is a link row and the only other button is REMOVE SERIES', async () => {
            const user = userEvent.setup();
            useAnimeStore.setState({ library: [LIBRARY[0] as (typeof LIBRARY)[number]] });
            render(<AnimeLibrary />);
            const card = screen.getByTestId('anime-card');
            expect(card).toHaveClass('row--link');
            const open = within(card).getByRole('button', { name: 'OPEN SERIES: Naruto' });
            expect(open).toHaveClass('row-link');
            expect(open).toHaveAttribute('title', 'Naruto');
            expect(open).toHaveTextContent('Naruto');
            expect(within(card).queryByText('OPEN SERIES')).not.toBeInTheDocument();
            expect(within(card).getByRole('button', { name: 'REMOVE SERIES: Naruto' })).toBeInTheDocument();
            expect(within(card).getAllByRole('button')).toHaveLength(2);

            await user.click(open);
            expect(screen.getByTestId('series-view')).toBeInTheDocument();
        });

        it('shows and hides the episodes of a season from its row, with no SHOW EPISODES button of its own', async () => {
            const user = userEvent.setup();
            useAnimeStore.setState({ library: [LIBRARY[0] as (typeof LIBRARY)[number]] });
            render(<AnimeLibrary />);
            await user.click(screen.getByRole('button', { name: 'OPEN SERIES: Naruto' }));
            const season = screen.getByTestId('anime-season');
            const row = season.querySelector('.season__row') as HTMLElement;
            expect(row).toHaveClass('row--link');
            expect(within(season).queryByText('SHOW EPISODES')).not.toBeInTheDocument();
            expect(within(season).queryByText('HIDE EPISODES')).not.toBeInTheDocument();

            // The only season of a series starts closed too.
            const toggle = within(row).getByRole('button', { name: 'SHOW EPISODES: Naruto' });
            expect(toggle).toHaveAttribute('aria-expanded', 'false');
            expect(toggle).toHaveClass('row-link');
            expect(toggle).toHaveTextContent('Naruto');
            expect(within(season).queryByTestId('anime-episode')).not.toBeInTheDocument();

            await user.click(toggle);
            expect(within(row).getByRole('button', { name: 'HIDE EPISODES: Naruto' })).toHaveAttribute('aria-expanded', 'true');
            expect(within(season).getAllByTestId('anime-episode')).toHaveLength(6);

            await user.click(within(row).getByRole('button', { name: 'HIDE EPISODES: Naruto' }));
            expect(within(row).getByRole('button', { name: 'SHOW EPISODES: Naruto' })).toHaveAttribute('aria-expanded', 'false');
            expect(within(season).queryByTestId('anime-episode')).not.toBeInTheDocument();
        });

        it('keeps GO TO SOURCE on the row of a season without opening it', async () => {
            const user = userEvent.setup();
            const openLibraryAnime = vi.fn();
            useAnimeStore.setState({ library: [LIBRARY[0] as (typeof LIBRARY)[number]], openLibraryAnime });
            render(<AnimeLibrary />);
            await user.click(screen.getByRole('button', { name: 'OPEN SERIES: Naruto' }));
            await user.click(screen.getByRole('button', { name: /^SHOW EPISODES: / }));
            await user.click(screen.getByRole('button', { name: 'GO TO SOURCE: Naruto' }));
            expect(openLibraryAnime).toHaveBeenCalledTimes(1);
            expect(openLibraryAnime).toHaveBeenCalledWith(LIBRARY[0]);
            expect(screen.getAllByTestId('anime-episode')).toHaveLength(6);
        });

        it('plays a downloaded episode from its row, and only that kind of episode has a link row', async () => {
            const user = userEvent.setup();
            const play = vi.fn();
            useAnimeStore.setState({ library: [LIBRARY[0] as (typeof LIBRARY)[number]], play });
            render(<AnimeLibrary />);
            await user.click(screen.getByRole('button', { name: 'OPEN SERIES: Naruto' }));
            await user.click(screen.getByRole('button', { name: /^SHOW EPISODES: / }));
            const rows = screen.getAllByTestId('anime-episode');

            // Downloaded: episodes 1 to 3 are links, with the title as the button and no PLAY button of its own.
            [0, 1, 2].forEach((index) => {
                expect(rows[index]).toHaveClass('row--link');
                expect(within(rows[index] as HTMLElement).getByRole('button', { name: `PLAY: Naruto EP ${index + 1}` })).toHaveClass('row-link');
                expect(within(rows[index] as HTMLElement).queryByText('PLAY')).not.toBeInTheDocument();
            });
            // Error, cancelled and queued ones cannot be played.
            [3, 4, 5].forEach((index) => {
                expect(rows[index]).not.toHaveClass('row--link');
                expect(within(rows[index] as HTMLElement).queryByRole('button', { name: /^PLAY: / })).not.toBeInTheDocument();
            });

            await user.click(within(rows[1] as HTMLElement).getByRole('button', { name: 'PLAY: Naruto EP 2' }));
            expect(play).toHaveBeenCalledTimes(1);
            expect(play).toHaveBeenCalledWith(10, 2);
        });

        it('keeps MARK WATCHED and RETRY on the row of an episode without playing it', async () => {
            const user = userEvent.setup();
            const play = vi.fn();
            useAnimeStore.setState({ library: [LIBRARY[0] as (typeof LIBRARY)[number]], play });
            render(<AnimeLibrary />);
            await user.click(screen.getByRole('button', { name: 'OPEN SERIES: Naruto' }));
            await user.click(screen.getByRole('button', { name: /^SHOW EPISODES: / }));
            await user.click(screen.getByRole('button', { name: 'RETRY: Naruto EP 4' }));
            expect(mock.api.retryAnimeJob).toHaveBeenCalledWith(4);
            await user.click(screen.getByRole('button', { name: 'MARK AS WATCHED: Naruto EP 1' }));
            expect(mock.api.saveAnimeProgress).toHaveBeenCalledTimes(1);
            expect(play).not.toHaveBeenCalled();
        });
    });
});


describe('AnimeLibrary paused episodes', () => {
    const PAUSED_LIBRARY = [
        makeAnime(
            [
                makeEpisode({ id: 1, number: '1', status: 'paused', sizeBytes: null, filePath: null }),
                makeEpisode({ id: 2, number: '2', status: 'downloading', sizeBytes: null, filePath: null }),
                makeEpisode({ id: 3, number: '3', status: 'done' })
            ],
            { id: 10, title: 'Naruto', audio: 'sub' }
        )
    ];

    async function openSeries() {
        const user = userEvent.setup();
        useAnimeStore.setState({ library: PAUSED_LIBRARY });
        render(<AnimeLibrary />);
        await user.click(screen.getByRole('button', { name: 'OPEN SERIES: Naruto' }));
        await user.click(screen.getByRole('button', { name: /^SHOW EPISODES: / }));
        return { user, rows: screen.getAllByTestId('anime-episode') };
    }

    it('says an episode is paused', async () => {
        const { rows } = await openSeries();

        expect(rows[0]?.querySelector('.history__meta')?.textContent).toBe('PAUSED');
        expect(rows[0]).not.toHaveClass('history__item--error');
    });

    it('offers RESUME for a paused episode, and resumes it by its id', async () => {
        const { user } = await openSeries();

        await user.click(screen.getByRole('button', { name: 'RESUME: Naruto EP 1' }));

        expect(mock.api.resumeAnimeJob).toHaveBeenCalledTimes(1);
        expect(mock.api.resumeAnimeJob).toHaveBeenCalledWith(1);
    });

    it('does not offer RESUME for an episode that is downloading or downloaded, nor RETRY for a paused one', async () => {
        await openSeries();

        expect(screen.queryByRole('button', { name: 'RESUME: Naruto EP 2' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'RESUME: Naruto EP 3' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'RETRY: Naruto EP 1' })).not.toBeInTheDocument();
    });

    it('has no button to remove a paused episode either', async () => {
        const { rows } = await openSeries();

        expect(within(rows[0] as HTMLElement).queryByRole('button', { name: /^REMOVE/ })).not.toBeInTheDocument();
    });

});


describe('AnimeLibrary anime that cannot be removed alone', () => {
    async function openSeries(library: ReturnType<typeof makeAnime>[], name: string) {
        const user = userEvent.setup();
        useAnimeStore.setState({ library });
        render(<AnimeLibrary />);
        await user.click(screen.getByRole('button', { name: `OPEN SERIES: ${name}` }));
        return user;
    }

    it('turns off REMOVE ANIME for the anime that gives its name to the series, and says why', async () => {
        const user = await openSeries(
            [
                makeAnime([makeEpisode({ id: 1 })], { id: 41, title: 'Frieren', series: 'Frieren', season: 1 }),
                makeAnime([makeEpisode({ id: 2 })], { id: 40, title: 'Frieren Season 2', series: 'Frieren', season: 2 })
            ],
            'Frieren'
        );
        const [first, second] = screen.getAllByTestId('anime-season');
        await user.click(within(first as HTMLElement).getByRole('button', { name: /^SHOW EPISODES: / }));
        await user.click(within(second as HTMLElement).getByRole('button', { name: /^SHOW EPISODES: / }));

        const blocked = within(first as HTMLElement).getByRole('button', { name: 'REMOVE ANIME: Frieren' });
        expect(blocked).toBeDisabled();
        expect(blocked).toHaveAttribute('title', 'This anime gives its name to the series. To remove it, remove the whole series.');
        await user.click(blocked);
        expect(within(first as HTMLElement).queryByRole('button', { name: 'CONFIRM' })).not.toBeInTheDocument();
        expect(mock.api.removeAnime).not.toHaveBeenCalled();
        expect(within(second as HTMLElement).getByRole('button', { name: 'REMOVE ANIME: Frieren Season 2' })).toBeEnabled();
        expect(within(second as HTMLElement).getByRole('button', { name: 'REMOVE ANIME: Frieren Season 2' })).not.toHaveAttribute('title');
    });

    it('compares the title with the name of the series without the case, the accents or the spaces', async () => {
        const user = await openSeries(
            [
                makeAnime([makeEpisode({ id: 1 })], { id: 50, title: '  pokémon   JOURNEYS', series: 'Pokemon Journeys', season: 1 }),
                makeAnime([makeEpisode({ id: 2 })], { id: 51, title: 'Pokemon Journeys 2', series: 'Pokemon Journeys', season: 2 })
            ],
            'Pokemon Journeys'
        );
        const [first, second] = screen.getAllByTestId('anime-season');
        await user.click(within(first as HTMLElement).getByRole('button', { name: /^SHOW EPISODES: / }));
        await user.click(within(second as HTMLElement).getByRole('button', { name: /^SHOW EPISODES: / }));
        expect(within(first as HTMLElement).getByRole('button', { name: /^REMOVE ANIME: / })).toBeDisabled();
        expect(within(second as HTMLElement).getByRole('button', { name: /^REMOVE ANIME: / })).toBeEnabled();
    });

    it('turns it off for an anime on its own too, whose series is its title', async () => {
        const user = await openSeries([makeAnime([makeEpisode({ id: 1 })], { id: 10, title: 'Naruto' })], 'Naruto');
        await user.click(screen.getByRole('button', { name: /^SHOW EPISODES: / }));
        expect(screen.getByRole('button', { name: 'REMOVE ANIME: Naruto' })).toBeDisabled();
        // The series is removed whole from the gear, which takes the anime with it.
        await user.click(screen.getByRole('button', { name: 'Series options: Naruto' }));
        await user.click(screen.getByRole('button', { name: 'REMOVE SERIES: Naruto' }));
        await user.click(screen.getByRole('button', { name: 'CONFIRM' }));
        await vi.waitFor(() => {
            expect(mock.api.removeAnime).toHaveBeenCalledWith(10);
        });
    });

    it('lets the series be removed whole even though it holds an anime that cannot be removed alone', async () => {
        await openSeries(
            [
                makeAnime([makeEpisode({ id: 1 })], { id: 41, title: 'Frieren', series: 'Frieren', season: 1 }),
                makeAnime([makeEpisode({ id: 2 })], { id: 40, title: 'Frieren Season 2', series: 'Frieren', season: 2 })
            ],
            'Frieren'
        );
        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: 'Series options: Frieren' }));
        await user.click(screen.getByRole('button', { name: 'REMOVE SERIES: Frieren' }));
        await user.click(screen.getByRole('button', { name: 'CONFIRM' }));
        await vi.waitFor(() => {
            expect(mock.api.removeAnime.mock.calls).toEqual([[41], [40]]);
        });
    });
});

describe('AnimeLibrary the gear of a series', () => {
    const LIBRARY_OF_SERIES = [
        makeAnime([makeEpisode({ id: 1 })], { id: 41, title: 'Frieren', series: 'Frieren', season: 1 }),
        makeAnime([makeEpisode({ id: 2 })], { id: 40, title: 'Frieren Season 2', series: 'Frieren', season: 2 })
    ];

    async function openSeries() {
        const user = userEvent.setup();
        useAnimeStore.setState({ library: LIBRARY_OF_SERIES });
        render(<AnimeLibrary />);
        await user.click(screen.getByRole('button', { name: 'OPEN SERIES: Frieren' }));
        return user;
    }

    function row(): HTMLElement {
        return screen.getByTestId('series-view').querySelector('header.job__head .job__badges') as HTMLElement;
    }

    it('is the last element on the right of the row of the series', async () => {
        await openSeries();
        const last = row().lastElementChild as HTMLElement;
        expect(last).toHaveClass('series-menu');
        expect(within(last).getByRole('button', { name: 'Series options: Frieren' })).toBeInTheDocument();
        expect(within(last).getByRole('button', { name: 'Series options: Frieren' })).toHaveClass('series-menu__button');
        expect(within(last).getByRole('button', { name: 'Series options: Frieren' })).toHaveAttribute('title', 'Series options');
    });

    it('is a gear, and is closed at first: renaming and removing are not on the row', async () => {
        await openSeries();
        const gear = screen.getByRole('button', { name: 'Series options: Frieren' });
        expect(gear).toHaveTextContent('⚙');
        expect(gear).toHaveAttribute('aria-expanded', 'false');
        expect(gear).toHaveAttribute('aria-haspopup', 'true');
        expect(within(row()).queryByRole('button', { name: 'RENAME SERIES: Frieren' })).not.toBeInTheDocument();
        expect(within(row()).queryByRole('button', { name: 'REMOVE SERIES: Frieren' })).not.toBeInTheDocument();
        expect(screen.queryByRole('group', { name: 'Series options: Frieren' })).not.toBeInTheDocument();
    });

    it('opens with renaming and removing inside it, and closes when the gear is used again', async () => {
        const user = await openSeries();
        const gear = screen.getByRole('button', { name: 'Series options: Frieren' });

        await user.click(gear);
        expect(gear).toHaveAttribute('aria-expanded', 'true');
        const panel = screen.getByRole('group', { name: 'Series options: Frieren' });
        expect(panel).toHaveClass('series-menu__panel');
        expect(within(panel).getByRole('button', { name: 'RENAME SERIES: Frieren' })).toBeInTheDocument();
        expect(within(panel).getByRole('button', { name: 'REMOVE SERIES: Frieren' })).toBeInTheDocument();

        await user.click(gear);
        expect(gear).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('group', { name: 'Series options: Frieren' })).not.toBeInTheDocument();
    });

    it('closes with Escape, and with a click anywhere else, but not with a click inside it', async () => {
        const user = await openSeries();
        await user.click(screen.getByRole('button', { name: 'Series options: Frieren' }));
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('group', { name: 'Series options: Frieren' })).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Series options: Frieren' }));
        await user.click(screen.getByRole('group', { name: 'Series options: Frieren' }));
        expect(screen.getByRole('group', { name: 'Series options: Frieren' })).toBeInTheDocument();
        await user.click(document.body);
        expect(screen.queryByRole('group', { name: 'Series options: Frieren' })).not.toBeInTheDocument();
    });

    it('stays out of the way of other keys: only Escape closes it', async () => {
        const user = await openSeries();
        await user.click(screen.getByRole('button', { name: 'Series options: Frieren' }));
        await user.keyboard('a');
        expect(screen.getByRole('group', { name: 'Series options: Frieren' })).toBeInTheDocument();
    });

    it('closes when RENAME SERIES is used, and the editor opens on the screen', async () => {
        const user = await openSeries();
        await user.click(screen.getByRole('button', { name: 'Series options: Frieren' }));
        await user.click(screen.getByRole('button', { name: 'RENAME SERIES: Frieren' }));
        expect(screen.queryByRole('group', { name: 'Series options: Frieren' })).not.toBeInTheDocument();
        expect(screen.getByRole('group', { name: 'RENAME SERIES: Frieren' })).toBeInTheDocument();
    });

    it('asks for a second click before the series is removed, with the gear still open meanwhile', async () => {
        const removeAnime = vi.fn(async () => {
            return undefined;
        });
        const user = await openSeries();
        useAnimeStore.setState({ removeAnime });
        await user.click(screen.getByRole('button', { name: 'Series options: Frieren' }));
        await user.click(screen.getByRole('button', { name: 'REMOVE SERIES: Frieren' }));

        expect(screen.getByText('The files are deleted from the disk too.')).toBeInTheDocument();
        expect(screen.getByRole('group', { name: 'Series options: Frieren' })).toBeInTheDocument();
        expect(removeAnime).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: 'KEEP' }));
        expect(removeAnime).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'REMOVE SERIES: Frieren' })).toBeInTheDocument();
    });

    it('does not put the gear on the card of the series: the card keeps its own remove button', () => {
        useAnimeStore.setState({ library: LIBRARY_OF_SERIES });
        render(<AnimeLibrary />);
        const card = screen.getByTestId('anime-card');
        expect(within(card).queryByRole('button', { name: /^Series options/ })).not.toBeInTheDocument();
        expect(within(card).getByRole('button', { name: 'REMOVE SERIES: Frieren' })).toBeInTheDocument();
        expect(within(card).queryByRole('button', { name: /^RENAME SERIES/ })).not.toBeInTheDocument();
    });
});

describe('AnimeLibrary renaming a series', () => {
    const LIBRARY_OF_SERIES = [
        makeAnime([makeEpisode({ id: 1 })], { id: 41, title: 'Frieren', series: 'Frieren', season: 1 }),
        makeAnime([makeEpisode({ id: 2 })], { id: 40, title: 'Frieren Season 2', series: 'Frieren', season: 2 })
    ];

    async function openEditor(library = LIBRARY_OF_SERIES, name = 'Frieren') {
        const user = userEvent.setup();
        useAnimeStore.setState({ library });
        render(<AnimeLibrary />);
        await user.click(screen.getByRole('button', { name: `OPEN SERIES: ${name}` }));
        await user.click(screen.getByRole('button', { name: `Series options: ${name}` }));
        await user.click(screen.getByRole('button', { name: `RENAME SERIES: ${name}` }));
        return { user, editor: screen.getByRole('group', { name: `RENAME SERIES: ${name}` }) };
    }

    it('starts with the name the series has, and has only a field, SAVE and CANCEL', async () => {
        const { editor } = await openEditor();
        expect(within(editor).getByRole('textbox', { name: 'Series name' })).toHaveValue('Frieren');
        expect(
            within(editor)
                .getAllByRole('button')
                .map((button) => {
                    return button.textContent;
                })
        ).toEqual(['SAVE', 'CANCEL']);
    });

    it('renames the series for every anime in it at once, and goes on with the series under its new name', async () => {
        const renamed = LIBRARY_OF_SERIES.map((anime) => {
            return { ...anime, series: 'Sousou no Frieren' };
        });
        mock.api.renameAnimeSeries.mockResolvedValue({ ok: true });
        mock.api.listAnimeLibrary.mockResolvedValue(renamed);
        const { user, editor } = await openEditor();

        await user.clear(within(editor).getByRole('textbox', { name: 'Series name' }));
        await user.type(within(editor).getByRole('textbox', { name: 'Series name' }), '  Sousou   no Frieren ');
        await user.click(within(editor).getByRole('button', { name: 'SAVE' }));

        expect(mock.api.renameAnimeSeries).toHaveBeenCalledTimes(1);
        expect(mock.api.renameAnimeSeries).toHaveBeenCalledWith([41, 40], 'Sousou no Frieren');
        expect(await screen.findByRole('heading', { level: 3, name: 'Sousou no Frieren' })).toBeInTheDocument();
        expect(screen.getByTestId('series-view')).toBeInTheDocument();
        expect(screen.getAllByTestId('anime-season')).toHaveLength(2);
        expect(screen.queryByRole('group', { name: /^RENAME SERIES/ })).not.toBeInTheDocument();
        expect(useAnimeStore.getState().library.map((anime) => {
            return anime.series;
        })).toEqual(['Sousou no Frieren', 'Sousou no Frieren']);
    });

    it('goes on with the series of an anime that was on its own, which gets its name', async () => {
        const alone = [makeAnime([makeEpisode({ id: 1 })], { id: 10, title: 'Naruto' })];
        mock.api.renameAnimeSeries.mockResolvedValue({ ok: true });
        mock.api.listAnimeLibrary.mockResolvedValue([{ ...(alone[0] as (typeof alone)[number]), series: 'Naruto Classic', season: 1 }]);
        const { user, editor } = await openEditor(alone, 'Naruto');

        await user.clear(within(editor).getByRole('textbox', { name: 'Series name' }));
        await user.type(within(editor).getByRole('textbox', { name: 'Series name' }), 'Naruto Classic');
        await user.click(within(editor).getByRole('button', { name: 'SAVE' }));

        expect(mock.api.renameAnimeSeries).toHaveBeenCalledWith([10], 'Naruto Classic');
        expect(await screen.findByRole('heading', { level: 3, name: 'Naruto Classic' })).toBeInTheDocument();
        expect(screen.getByTestId('series-view')).toBeInTheDocument();
    });

    it('goes on with the series that the new name joined when it is the name of another one, written in another case', async () => {
        const joined = LIBRARY_OF_SERIES.map((anime) => {
            return { ...anime, series: 'Journeys' };
        });
        mock.api.renameAnimeSeries.mockResolvedValue({ ok: true });
        mock.api.listAnimeLibrary.mockResolvedValue(joined);
        const { user, editor } = await openEditor();

        await user.clear(within(editor).getByRole('textbox', { name: 'Series name' }));
        await user.type(within(editor).getByRole('textbox', { name: 'Series name' }), 'JOURNEYS');
        await user.click(within(editor).getByRole('button', { name: 'SAVE' }));

        expect(await screen.findByRole('heading', { level: 3, name: 'Journeys' })).toBeInTheDocument();
        expect(screen.getByTestId('series-view')).toBeInTheDocument();
    });

    it('refuses a season the other series already has, saying which anime, which order and the next one, and keeps the editor open', async () => {
        mock.api.renameAnimeSeries.mockResolvedValue({ ok: false, reason: 'season-taken', anime: 'Frieren', season: 1, suggested: 4 });
        const { user, editor } = await openEditor();

        await user.clear(within(editor).getByRole('textbox', { name: 'Series name' }));
        await user.type(within(editor).getByRole('textbox', { name: 'Series name' }), 'Journeys');
        await user.click(within(editor).getByRole('button', { name: 'SAVE' }));

        expect(screen.getByRole('alert')).toHaveTextContent('Order 1 of "Frieren" is already used in "Journeys". Change its order to 4, the next one of that series, and try again.');
        expect(screen.getByRole('group', { name: 'RENAME SERIES: Frieren' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 3, name: 'Frieren' })).toBeInTheDocument();
        expect(useAnimeStore.getState().library.map((anime) => {
            return anime.series;
        })).toEqual(['Frieren', 'Frieren']);
    });

    it('says the name cannot be used when the app answers that it is invalid, and keeps the editor open', async () => {
        mock.api.renameAnimeSeries.mockResolvedValue({ ok: false, reason: 'invalid' });
        const { user, editor } = await openEditor();
        await user.click(within(editor).getByRole('button', { name: 'SAVE' }));
        expect(screen.getByRole('alert')).toHaveTextContent('Give a series name of up to 100 characters.');
        expect(screen.getByRole('group', { name: 'RENAME SERIES: Frieren' })).toBeInTheDocument();
    });

    it('says so, without asking the app, when the name is empty or too long', async () => {
        const { user, editor } = await openEditor();
        const field = within(editor).getByRole('textbox', { name: 'Series name' });
        await user.clear(field);
        await user.click(within(editor).getByRole('button', { name: 'SAVE' }));
        expect(screen.getByRole('alert')).toHaveTextContent('Give a series name of up to 100 characters.');

        await user.click(field);
        await user.paste('a'.repeat(101));
        await user.click(within(editor).getByRole('button', { name: 'SAVE' }));
        expect(screen.getByRole('alert')).toHaveTextContent('Give a series name of up to 100 characters.');
        expect(mock.api.renameAnimeSeries).not.toHaveBeenCalled();
    });

    it('closes the editor without renaming anything', async () => {
        const { user, editor } = await openEditor();
        await user.clear(within(editor).getByRole('textbox', { name: 'Series name' }));
        await user.type(within(editor).getByRole('textbox', { name: 'Series name' }), 'Something else');
        await user.click(within(editor).getByRole('button', { name: 'CANCEL' }));
        expect(screen.queryByRole('group', { name: 'RENAME SERIES: Frieren' })).not.toBeInTheDocument();
        expect(mock.api.renameAnimeSeries).not.toHaveBeenCalled();
        expect(screen.getByRole('heading', { level: 3, name: 'Frieren' })).toBeInTheDocument();
    });
});

describe('AnimeLibrary downloading the episodes of a series', () => {
    const MISSING = [
        makeAnime([makeEpisode({ id: 1, number: '1' }), makeEpisode({ id: 2, number: '2', status: 'idle', filePath: null, sizeBytes: null })], { id: 41, title: 'Frieren', series: 'Frieren', season: 1 }),
        makeAnime([makeEpisode({ id: 3, number: '1' })], { id: 40, title: 'Frieren Season 2', series: 'Frieren', season: 2 })
    ];

    async function openSeries(library: typeof MISSING, name = 'Frieren') {
        const user = userEvent.setup();
        useAnimeStore.setState({ library });
        render(<AnimeLibrary />);
        await user.click(screen.getByRole('button', { name: `OPEN SERIES: ${name}` }));
        return user;
    }

    it('has DOWNLOAD ALL on the screen of the series, to the left of how many seasons it has, when an episode is not downloaded', async () => {
        await openSeries(MISSING);
        const badges = screen.getByTestId('series-view').querySelector('header.job__head .job__badges') as HTMLElement;
        const button = within(badges).getByRole('button', { name: 'DOWNLOAD ALL: Frieren' });
        expect(button).toHaveTextContent('DOWNLOAD ALL');
        expect(badges.firstElementChild).toBe(button);
        expect(button.nextElementSibling).toHaveTextContent('2 SEASONS');
    });

    it('does not put DOWNLOAD ALL on the card of the series', () => {
        useAnimeStore.setState({ library: MISSING });
        render(<AnimeLibrary />);
        const card = screen.getByTestId('anime-card');
        expect(within(card).queryByRole('button', { name: /^DOWNLOAD ALL/ })).not.toBeInTheDocument();
        expect(within(card).getAllByRole('button')).toHaveLength(2);
    });

    it('queues what is missing in every season of the series, and reads the library again', async () => {
        const user = await openSeries(MISSING);
        mock.api.listAnimeLibrary.mockClear();

        await user.click(screen.getByRole('button', { name: 'DOWNLOAD ALL: Frieren' }));

        expect(mock.api.downloadMissingAnime).toHaveBeenCalledTimes(1);
        expect(mock.api.downloadMissingAnime).toHaveBeenCalledWith([41, 40]);
        expect(mock.api.listAnimeLibrary).toHaveBeenCalledTimes(1);
    });

    it.each(['idle', 'error', 'cancelled', 'paused'] as const)('is there when the only episode that is not downloaded is %s, so it is tried again', async (status) => {
        const library = [makeAnime([makeEpisode({ id: 1, number: '1' }), makeEpisode({ id: 2, number: '2', status, filePath: null, sizeBytes: null })], { id: 41, title: 'Frieren', series: 'Frieren', season: 1 })];
        const user = await openSeries(library);
        await user.click(screen.getByRole('button', { name: 'DOWNLOAD ALL: Frieren' }));
        expect(mock.api.downloadMissingAnime).toHaveBeenCalledWith([41]);
    });

    it.each(['done', 'queued', 'downloading'] as const)('is not there when every episode is %s', async (status) => {
        const library = [makeAnime([makeEpisode({ id: 1, number: '1', status }), makeEpisode({ id: 2, number: '2', status })], { id: 41, title: 'Frieren', series: 'Frieren', season: 1 })];
        await openSeries(library);
        expect(screen.queryByRole('button', { name: /^DOWNLOAD ALL/ })).not.toBeInTheDocument();
    });

    it('is there when some episodes are downloaded or on their way and another one failed', async () => {
        const library = [
            makeAnime(
                [makeEpisode({ id: 1, number: '1' }), makeEpisode({ id: 2, number: '2', status: 'queued', filePath: null }), makeEpisode({ id: 3, number: '3', status: 'error', filePath: null, sizeBytes: null })],
                { id: 41, title: 'Frieren', series: 'Frieren', season: 1 }
            )
        ];
        await openSeries(library);
        expect(screen.getByRole('button', { name: 'DOWNLOAD ALL: Frieren' })).toBeInTheDocument();
    });

    it('is not there for an anime without episodes', async () => {
        await openSeries([makeAnime([], { id: 41, title: 'Frieren', series: 'Frieren', season: 1 })]);
        expect(screen.queryByRole('button', { name: /^DOWNLOAD ALL/ })).not.toBeInTheDocument();
    });

    it('goes away once everything is downloaded', async () => {
        await openSeries(MISSING);
        expect(screen.getByRole('button', { name: 'DOWNLOAD ALL: Frieren' })).toBeInTheDocument();
        act(() => {
            useAnimeStore.setState({
                library: MISSING.map((anime) => {
                    return { ...anime, episodes: anime.episodes.map((episode) => { return { ...episode, status: 'done' as const }; }) };
                })
            });
        });
        expect(screen.queryByRole('button', { name: /^DOWNLOAD ALL/ })).not.toBeInTheDocument();
    });
});

describe('AnimeLibrary downloading the episodes of one season', () => {
    const SEASONS = [
        makeAnime([makeEpisode({ id: 1, number: '1' }), makeEpisode({ id: 2, number: '2', status: 'idle', filePath: null, sizeBytes: null })], { id: 41, title: 'Frieren', series: 'Frieren', season: 1 }),
        makeAnime([makeEpisode({ id: 3, number: '1', status: 'error', filePath: null, sizeBytes: null })], { id: 40, title: 'Frieren Season 2', series: 'Frieren', season: 2 }),
        makeAnime([makeEpisode({ id: 4, number: '1' })], { id: 42, title: 'Frieren Season 3', series: 'Frieren', season: 3 })
    ];

    async function openSeries(library: typeof SEASONS = SEASONS) {
        const user = userEvent.setup();
        useAnimeStore.setState({ library });
        render(<AnimeLibrary />);
        await user.click(screen.getByRole('button', { name: 'OPEN SERIES: Frieren' }));
        return user;
    }

    function season(title: string): HTMLElement {
        return screen
            .getAllByTestId('anime-season')
            .find((candidate) => {
                return within(candidate).queryByRole('heading', { level: 4, name: title }) !== null;
            }) as HTMLElement;
    }

    it('has a DOWNLOAD SEASON button on the row of each season that has something to download, with the other buttons of the row, and none on the one that is complete', async () => {
        await openSeries();

        const first = season('Frieren');
        const button = within(first).getByRole('button', { name: 'DOWNLOAD SEASON: Frieren' });
        expect(button).toHaveTextContent('DOWNLOAD SEASON');
        expect(first.querySelector('.season__row')).toContainElement(button);
        expect(within(first.querySelector('.season__actions') as HTMLElement).getAllByRole('button').map((action) => {
            return action.textContent;
        })).toEqual(['DOWNLOAD SEASON', 'GO TO SOURCE']);
        expect(within(season('Frieren Season 2')).getByRole('button', { name: 'DOWNLOAD SEASON: Frieren Season 2' })).toBeInTheDocument();
        expect(within(season('Frieren Season 3')).queryByRole('button', { name: /^DOWNLOAD SEASON/ })).not.toBeInTheDocument();
        expect(within(season('Frieren Season 3')).getAllByRole('button').map((action) => {
            return action.textContent;
        })).toEqual(['Frieren Season 3', 'GO TO SOURCE']);
    });

    it('queues only the episodes of that season, by the id of the anime, and reads the library again', async () => {
        const user = await openSeries();
        mock.api.listAnimeLibrary.mockClear();

        await user.click(screen.getByRole('button', { name: 'DOWNLOAD SEASON: Frieren Season 2' }));

        expect(mock.api.downloadMissingAnime).toHaveBeenCalledTimes(1);
        expect(mock.api.downloadMissingAnime).toHaveBeenCalledWith([40]);
        expect(mock.api.listAnimeLibrary).toHaveBeenCalledTimes(1);
    });

    it('does not open or close the season, and works with the season closed', async () => {
        const user = await openSeries();
        mock.api.listAnimeLibrary.mockResolvedValue(SEASONS);

        await user.click(screen.getByRole('button', { name: 'DOWNLOAD SEASON: Frieren' }));

        expect(mock.api.downloadMissingAnime).toHaveBeenCalledWith([41]);
        expect(screen.queryByTestId('anime-episode')).not.toBeInTheDocument();
        expect(within(season('Frieren')).getByRole('button', { name: 'SHOW EPISODES: Frieren' })).toHaveAttribute('aria-expanded', 'false');
    });

    it('is on the only season of a series too, next to DOWNLOAD ALL of the series, with names that tell them apart', async () => {
        const user = userEvent.setup();
        useAnimeStore.setState({ library: [SEASONS[0] as (typeof SEASONS)[number]] });
        render(<AnimeLibrary />);
        await user.click(screen.getByRole('button', { name: 'OPEN SERIES: Frieren' }));

        expect(screen.getByRole('button', { name: 'DOWNLOAD ALL: Frieren' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'DOWNLOAD SEASON: Frieren' })).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'DOWNLOAD SEASON: Frieren' }));
        expect(mock.api.downloadMissingAnime).toHaveBeenCalledWith([41]);
    });

    it.each(['idle', 'error', 'cancelled', 'paused'] as const)('is there when the only episode that is not downloaded is %s', async (status) => {
        await openSeries([makeAnime([makeEpisode({ id: 1, number: '1' }), makeEpisode({ id: 2, number: '2', status, filePath: null, sizeBytes: null })], { id: 41, title: 'Frieren', series: 'Frieren', season: 1 })]);
        expect(screen.getByRole('button', { name: 'DOWNLOAD SEASON: Frieren' })).toBeInTheDocument();
    });

    it.each(['done', 'queued', 'downloading'] as const)('is not there when every episode is %s', async (status) => {
        await openSeries([makeAnime([makeEpisode({ id: 1, number: '1', status }), makeEpisode({ id: 2, number: '2', status })], { id: 41, title: 'Frieren', series: 'Frieren', season: 1 })]);
        expect(screen.queryByRole('button', { name: /^DOWNLOAD SEASON/ })).not.toBeInTheDocument();
    });

    it('is not there for an anime without episodes', async () => {
        await openSeries([makeAnime([], { id: 41, title: 'Frieren', series: 'Frieren', season: 1 })]);
        expect(screen.queryByRole('button', { name: /^DOWNLOAD SEASON/ })).not.toBeInTheDocument();
    });

    it('goes away from a season once everything in it is downloaded', async () => {
        await openSeries();
        expect(screen.getByRole('button', { name: 'DOWNLOAD SEASON: Frieren Season 2' })).toBeInTheDocument();
        act(() => {
            useAnimeStore.setState({
                library: SEASONS.map((anime) => {
                    return anime.id === 40 ? { ...anime, episodes: anime.episodes.map((episode) => { return { ...episode, status: 'done' as const }; }) } : anime;
                })
            });
        });
        expect(screen.queryByRole('button', { name: 'DOWNLOAD SEASON: Frieren Season 2' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'DOWNLOAD SEASON: Frieren' })).toBeInTheDocument();
    });
});

describe('AnimeLibrary episodes that are not downloaded', () => {
    const IDLE = makeAnime(
        [
            makeEpisode({ id: 1, number: '1' }),
            makeEpisode({ id: 2, number: '2', status: 'idle', filePath: null, sizeBytes: null }),
            makeEpisode({ id: 3, number: '3', status: 'idle', filePath: null, sizeBytes: null })
        ],
        { id: 10, title: 'Naruto', audio: 'sub' }
    );

    async function openSeries() {
        const user = userEvent.setup();
        useAnimeStore.setState({ library: [IDLE] });
        render(<AnimeLibrary />);
        await user.click(screen.getByRole('button', { name: 'OPEN SERIES: Naruto' }));
        await user.click(screen.getByRole('button', { name: /^SHOW EPISODES: / }));
        return { user, rows: screen.getAllByTestId('anime-episode') };
    }

    it('says they are not downloaded, which is not an error', async () => {
        const { rows } = await openSeries();
        expect(rows[1]?.querySelector('.history__meta')?.textContent).toBe('NOT DOWNLOADED');
        expect(rows[1]).not.toHaveClass('history__item--error');
        expect(rows[1]).not.toHaveClass('row--link');
        expect(within(rows[1] as HTMLElement).queryByRole('button', { name: /^PLAY/ })).not.toBeInTheDocument();
    });

    it('counts only the downloaded ones in the progress of the anime', async () => {
        await openSeries();
        expect(screen.getByText('1/3 DOWNLOADED')).toBeInTheDocument();
    });

    it('has a DOWNLOAD button on each one, which queues that episode by its id', async () => {
        const { user } = await openSeries();
        await user.click(screen.getByRole('button', { name: 'DOWNLOAD: Naruto EP 3' }));
        expect(mock.api.retryAnimeJob).toHaveBeenCalledTimes(1);
        expect(mock.api.retryAnimeJob).toHaveBeenCalledWith(3);
    });

    it('has the button only on the ones that are not downloaded, and not RETRY or RESUME', async () => {
        await openSeries();
        expect(screen.queryByRole('button', { name: 'DOWNLOAD: Naruto EP 1' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'DOWNLOAD: Naruto EP 2' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^RETRY: / })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^RESUME: / })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^MARK AS (UN)?WATCHED: Naruto EP 2$/ })).not.toBeInTheDocument();
    });

    it('has no button to remove one from the library', async () => {
        const { rows } = await openSeries();
        expect(within(rows[1] as HTMLElement).queryByRole('button', { name: /^REMOVE/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^REMOVE: / })).not.toBeInTheDocument();
    });

});
