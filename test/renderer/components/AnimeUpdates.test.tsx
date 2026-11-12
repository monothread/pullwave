// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnimeCheckResponse, AnimeUpdateEntry } from '@shared/anime';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { AnimeUpdates } from '@renderer/components/AnimeUpdates';
import { INITIAL_SEARCH, useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { makeAnime, makeEpisode } from '../../helpers/animeFixtures';
import { answerDialog, confirmDialog } from '../../helpers/confirmDialog';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';
import { seeEnd, stubIntersectionObserver, type ObservedEnd } from '../../helpers/intersectionObserver';

const initialApp = useAppStore.getState();
const initialAnime = useAnimeStore.getState();
let mock: MockApiHandle;

// A Wednesday, noon in the time zone of the machine.
const NOON = new Date(2026, 9, 7, 12, 0, 0).getTime();
const HOUR = 60 * 60 * 1000;

function entry(overrides: Partial<AnimeUpdateEntry> = {}): AnimeUpdateEntry {
    return {
        id: 1,
        animeId: 1,
        animeTitle: 'Naruto',
        episodeId: 7,
        episodeNumber: '3',
        foundAt: NOON - HOUR,
        origin: 'auto',
        status: 'idle',
        ...overrides
    };
}

function timeOf(time: number): string {
    return new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOON);
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS, toasts: [] });
    useAnimeStore.setState({ ...initialAnime, view: 'updates', returnView: 'updates', updates: [], checkingNew: null, library: [], search: INITIAL_SEARCH, selection: null });
});

afterEach(() => {
    vi.useRealTimers();
});

describe('AnimeUpdates', () => {
    it('asks for the list when it is shown', async () => {
        mock.api.listAnimeUpdates.mockResolvedValue([entry()]);
        render(<AnimeUpdates />);

        expect(await screen.findByTestId('anime-update')).toBeInTheDocument();
        expect(mock.api.listAnimeUpdates).toHaveBeenCalledTimes(1);
    });

    it('shows the empty state, with the button to look and no button to clear, when nothing arrived', async () => {
        render(<AnimeUpdates />);
        await vi.waitFor(() => {
            expect(mock.api.listAnimeUpdates).toHaveBeenCalledTimes(1);
        });

        expect(screen.getByRole('region', { name: 'UPDATES' })).toBeInTheDocument();
        expect(screen.getByText('No new episodes yet. The check that runs every 3 hours, and the buttons that look for new episodes, list here what they find.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'LOOK FOR NEW EPISODES' })).toBeEnabled();
        expect(screen.queryByRole('button', { name: 'CLEAR LIST' })).not.toBeInTheDocument();
        expect(screen.queryByTestId('anime-update')).not.toBeInTheDocument();
    });

    it('lists each episode with the anime, the number, the time it was found, how it was found and what state it is in', async () => {
        mock.api.listAnimeUpdates.mockResolvedValue([
            entry({ id: 2, animeTitle: 'Bleach', episodeNumber: '12', foundAt: NOON - 2 * HOUR, origin: 'manual', status: 'done' }),
            entry({ id: 1, animeTitle: 'Naruto', episodeNumber: '3', foundAt: NOON - HOUR, origin: 'auto', status: 'idle' })
        ]);
        render(<AnimeUpdates />);

        const rows = await screen.findAllByTestId('anime-update');

        expect(rows).toHaveLength(2);
        const [first, second] = rows as [HTMLElement, HTMLElement];
        expect(within(first).getByRole('button', { name: 'SHOW EPISODES: Bleach EP 12' })).toHaveAttribute('title', 'Bleach');
        expect(within(first).getByText(`EP 12 · Found at ${timeOf(NOON - 2 * HOUR)}`)).toBeInTheDocument();
        expect(within(first).getByText('MANUAL')).toHaveClass('badge');
        expect(within(first).getByText('DOWNLOADED')).toHaveClass('badge', 'badge--done');
        expect(within(second).getByRole('button', { name: 'SHOW EPISODES: Naruto EP 3' })).toHaveAttribute('title', 'Naruto');
        expect(within(second).getByText(`EP 3 · Found at ${timeOf(NOON - HOUR)}`)).toBeInTheDocument();
        expect(within(second).getByText('AUTOMATIC')).toHaveClass('badge');
        expect(within(second).getByText('NOT DOWNLOADED')).toHaveClass('badge', 'badge--idle');
    });

    it('splits the list by day: today, yesterday and the date of the older ones', async () => {
        const older = NOON - 72 * HOUR;
        mock.api.listAnimeUpdates.mockResolvedValue([
            entry({ id: 3, animeTitle: 'Naruto', foundAt: NOON - HOUR }),
            entry({ id: 2, animeTitle: 'Bleach', foundAt: NOON - 24 * HOUR }),
            entry({ id: 1, animeTitle: 'Gintama', foundAt: older })
        ]);
        render(<AnimeUpdates />);

        await screen.findAllByTestId('anime-update');

        const days = screen.getAllByTestId('anime-update-day');
        expect(
            days.map((day) => {
                return day.getAttribute('aria-label');
            })
        ).toEqual(['Today', 'Yesterday', new Date(older).toLocaleDateString()]);
        expect(within(days[0] as HTMLElement).getByText('Naruto')).toBeInTheDocument();
        expect(within(days[1] as HTMLElement).getByText('Bleach')).toBeInTheDocument();
        expect(within(days[2] as HTMLElement).getByText('Gintama')).toBeInTheDocument();
    });

    it('keeps the episodes of a day together, in the order they come', async () => {
        mock.api.listAnimeUpdates.mockResolvedValue([entry({ id: 2, episodeNumber: '4', foundAt: NOON - HOUR }), entry({ id: 1, episodeNumber: '3', foundAt: NOON - 2 * HOUR })]);
        render(<AnimeUpdates />);

        await screen.findAllByTestId('anime-update');

        const days = screen.getAllByTestId('anime-update-day');
        expect(days).toHaveLength(1);
        expect(
            within(days[0] as HTMLElement)
                .getAllByTestId('anime-update')
                .map((row) => {
                    return within(row).getByText(/^EP /).textContent;
                })
        ).toEqual([`EP 4 · Found at ${timeOf(NOON - HOUR)}`, `EP 3 · Found at ${timeOf(NOON - 2 * HOUR)}`]);
    });

    it('shows the cover of each anime, looked up by its title', async () => {
        mock.api.findAnimeCover.mockResolvedValue('https://s4.anilist.co/cover/naruto.jpg');
        mock.api.listAnimeUpdates.mockResolvedValue([entry()]);
        render(<AnimeUpdates />);

        const row = await screen.findByTestId('anime-update');

        await vi.waitFor(() => {
            expect(row.querySelector('img.cover')).toHaveAttribute('src', 'https://s4.anilist.co/cover/naruto.jpg');
        });
        expect(mock.api.findAnimeCover).toHaveBeenCalledWith('Naruto');
    });

    it('lists each day as a grid of cards, like the library, with the cover, the title and what was found in the head, and the badges at the bottom', async () => {
        mock.api.listAnimeUpdates.mockResolvedValue([entry({ origin: 'manual', status: 'done' })]);
        render(<AnimeUpdates />);

        const card = await screen.findByTestId('anime-update');

        const day = screen.getByTestId('anime-update-day');
        expect(day.querySelector('ul')).toHaveClass('cover-grid');
        expect(day.querySelector('ul')).not.toHaveClass('history__list');
        expect(card.tagName).toBe('LI');
        expect(card).toHaveClass('job', 'job--done', 'series', 'cover-card', 'row--link');
        expect(card).not.toHaveClass('history__item');
        expect(card.firstElementChild).toHaveClass('cover');
        const head = card.querySelector('.cover-card__body > .job__head') as HTMLElement;
        expect(head.firstElementChild).toHaveClass('series__title');
        expect(head.lastElementChild).toHaveClass('history__meta');
        expect(head.lastElementChild).toHaveTextContent(`EP 3 · Found at ${timeOf(NOON - HOUR)}`);
        const footer = card.querySelector('.cover-card__body > .cover-card__footer') as HTMLElement;
        expect(footer.children).toHaveLength(1);
        expect(footer.firstElementChild).toHaveClass('job__badges');
        expect(
            Array.from(footer.querySelectorAll('.badge')).map((badge) => {
                return [badge.textContent, badge.className];
            })
        ).toEqual([
            ['MANUAL', 'badge'],
            ['DOWNLOADED', 'badge badge--done']
        ]);
        expect(card.querySelector('.job__actions')).toBeNull();
    });

    it('opens the anime in the library when its name is clicked', async () => {
        const user = userEvent.setup();
        mock.api.listAnimeUpdates.mockResolvedValue([entry({ animeId: 7, animeTitle: 'Naruto' })]);
        useAnimeStore.setState({ library: [makeAnime([makeEpisode({ id: 7, animeId: 7, number: '3' })], { id: 7, title: 'Naruto' })] });
        render(<AnimeUpdates />);

        await user.click(await screen.findByRole('button', { name: 'SHOW EPISODES: Naruto EP 3' }));

        expect(useAnimeStore.getState()).toMatchObject({ view: 'library', returnView: 'library', selection: null, libraryFocus: 7, librarySeries: 'anime-7' });
    });

    describe('looking for new episodes', () => {
        it('asks for all the anime, says it is looking meanwhile, and lists what was found', async () => {
            const user = userEvent.setup();
            let release: (value: AnimeCheckResponse) => void = () => {
                return undefined;
            };
            mock.api.checkNewAnimeEpisodes.mockImplementation(() => {
                return new Promise((resolve) => {
                    release = resolve;
                });
            });
            render(<AnimeUpdates />);

            await user.click(screen.getByRole('button', { name: 'LOOK FOR NEW EPISODES' }));

            expect(mock.api.checkNewAnimeEpisodes).toHaveBeenCalledTimes(1);
            expect(mock.api.checkNewAnimeEpisodes).toHaveBeenCalledWith(null);
            expect(screen.getByRole('button', { name: 'LOOKING…' })).toBeDisabled();
            mock.api.listAnimeUpdates.mockResolvedValue([entry({ animeTitle: 'Bleach', episodeNumber: '5' })]);
            release({ ok: true, count: 1, titles: ['Bleach'], notDownloaded: [], failed: 0, skipped: 0 });
            expect(await screen.findByRole('button', { name: 'SHOW EPISODES: Bleach EP 5' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'LOOK FOR NEW EPISODES' })).toBeEnabled();
        });

        it('keeps the button off, still saying what it does, while the check of a single anime goes on', async () => {
            useAnimeStore.setState({ checkingNew: 4 });
            render(<AnimeUpdates />);

            expect(screen.getByRole('button', { name: 'LOOK FOR NEW EPISODES' })).toBeDisabled();
        });

        it('does not ask a second time while it is looking', () => {
            useAnimeStore.setState({ checkingNew: 'all' });
            render(<AnimeUpdates />);

            fireEvent.click(screen.getByRole('button', { name: 'LOOKING…' }));

            expect(mock.api.checkNewAnimeEpisodes).not.toHaveBeenCalled();
        });
    });

    describe('clearing the list', () => {
        it('asks before clearing, then clears and shows the empty state', async () => {
            const user = userEvent.setup();
            mock.api.listAnimeUpdates.mockResolvedValue([entry()]);
            render(<AnimeUpdates />);
            await screen.findByTestId('anime-update');

            await user.click(screen.getByRole('button', { name: 'CLEAR LIST' }));

            expect(mock.api.clearAnimeUpdates).not.toHaveBeenCalled();
            expect(within(confirmDialog('Clear the list of new episodes?')).getByText('Only the list goes. Nothing is removed from the library or from the disk.')).toBeInTheDocument();
            await answerDialog(user, 'Clear the list of new episodes?', 'CLEAR LIST');
            expect(mock.api.clearAnimeUpdates).toHaveBeenCalledTimes(1);
            expect(useAnimeStore.getState().updates).toEqual([]);
            expect(screen.queryByTestId('anime-update')).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'CLEAR LIST' })).not.toBeInTheDocument();
            expect(screen.getByText('No new episodes yet. The check that runs every 3 hours, and the buttons that look for new episodes, list here what they find.')).toBeInTheDocument();
        });

        it('keeps the list when the user keeps it', async () => {
            const user = userEvent.setup();
            mock.api.listAnimeUpdates.mockResolvedValue([entry()]);
            render(<AnimeUpdates />);
            await screen.findByTestId('anime-update');

            await user.click(screen.getByRole('button', { name: 'CLEAR LIST' }));
            await answerDialog(user, 'Clear the list of new episodes?', 'KEEP');

            expect(mock.api.clearAnimeUpdates).not.toHaveBeenCalled();
            expect(screen.getByTestId('anime-update')).toBeInTheDocument();
        });
    });
});

describe('AnimeUpdates while a check is going on', () => {
    const AUTO = { running: true, origin: 'auto', done: 12, total: 200, current: 'Frieren: Beyond Journey\'s End' } as const;
    const MANUAL = { running: true, origin: 'manual', done: 3, total: 10, current: 'Naruto' } as const;
    const IDLE = { running: false, origin: null, done: 0, total: 0, current: null } as const;

    it('shows nothing about a check, and has the button ready, when none is going on', () => {
        render(<AnimeUpdates />);

        expect(screen.getByRole('button', { name: 'LOOK FOR NEW EPISODES' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'LOOK FOR NEW EPISODES' })).not.toHaveAttribute('title');
        expect(screen.queryByTestId('anime-check-current')).not.toBeInTheDocument();
    });

    it('turns the button off and says the automatic look is going on, how far it is and which anime it asks about', () => {
        useAnimeStore.setState({ checkState: AUTO });
        render(<AnimeUpdates />);

        const button = screen.getByRole('button', { name: 'AUTOMATIC LOOK… 12/200' });
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute('title', 'The automatic look is going on. Wait for it to end.');
        const current = screen.getByTestId('anime-check-current');
        expect(current).toHaveTextContent('Now: Frieren: Beyond Journey\'s End');
        expect(current).toHaveAttribute('role', 'status');
        expect(current).toHaveAttribute('title', 'Frieren: Beyond Journey\'s End');
    });

    it('turns the button off too for the look the user asked for, with its progress and no explanation of the automatic one', () => {
        useAnimeStore.setState({ checkState: MANUAL });
        render(<AnimeUpdates />);

        const button = screen.getByRole('button', { name: 'LOOKING… 3/10' });
        expect(button).toBeDisabled();
        expect(button).not.toHaveAttribute('title');
        expect(screen.getByTestId('anime-check-current')).toHaveTextContent('Now: Naruto');
    });

    it('says only that it is looking while the main process has not said how many anime there are', () => {
        useAnimeStore.setState({ checkState: { running: true, origin: 'auto', done: 0, total: 0, current: null } });
        render(<AnimeUpdates />);

        expect(screen.getByRole('button', { name: 'LOOKING…' })).toBeDisabled();
        expect(screen.queryByTestId('anime-check-current')).not.toBeInTheDocument();
    });

    it('does not ask for another check when the button is pressed meanwhile', () => {
        useAnimeStore.setState({ checkState: AUTO });
        render(<AnimeUpdates />);

        fireEvent.click(screen.getByRole('button', { name: 'AUTOMATIC LOOK… 12/200' }));

        expect(mock.api.checkNewAnimeEpisodes).not.toHaveBeenCalled();
    });

    it('follows the check: the anime changes, and when it ends the button is ready and the indicator is gone', () => {
        useAnimeStore.setState({ checkState: AUTO });
        render(<AnimeUpdates />);

        act(() => {
            useAnimeStore.setState({ checkState: { ...AUTO, done: 13, current: 'Bleach' } });
        });
        expect(screen.getByRole('button', { name: 'AUTOMATIC LOOK… 13/200' })).toBeDisabled();
        expect(screen.getByTestId('anime-check-current')).toHaveTextContent('Now: Bleach');

        act(() => {
            useAnimeStore.setState({ checkState: IDLE });
        });
        expect(screen.getByRole('button', { name: 'LOOK FOR NEW EPISODES' })).toBeEnabled();
        expect(screen.queryByTestId('anime-check-current')).not.toBeInTheDocument();
    });

    it('keeps the list and the button to clear it while a check is going on', async () => {
        mock.api.listAnimeUpdates.mockResolvedValue([entry()]);
        useAnimeStore.setState({ checkState: AUTO });
        render(<AnimeUpdates />);

        expect(await screen.findByTestId('anime-update')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'CLEAR LIST' })).toBeEnabled();
    });
});

describe('AnimeUpdates with a long list', () => {
    let observers: ObservedEnd[] = [];

    beforeEach(() => {
        observers = stubIntersectionObserver();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    // 35 episodes found today and 35 yesterday, the newest first.
    const LONG = Array.from({ length: 70 }, (_unused, index) => {
        return entry({ id: index + 1, episodeId: index + 1, episodeNumber: String(index + 1), foundAt: NOON - (index < 35 ? HOUR : 24 * HOUR) - index * 1000 });
    });

    function perDay(): number[] {
        return screen.getAllByTestId('anime-update-day').map((day) => {
            return within(day).getAllByTestId('anime-update').length;
        });
    }

    it('draws the first 60 episodes split by day, and the others when the end of the list comes into view', async () => {
        mock.api.listAnimeUpdates.mockResolvedValue(LONG);
        render(<AnimeUpdates />);
        await waitForDays(2);
        expect(perDay()).toEqual([35, 25]);
        expect(screen.getByTestId('list-more')).toBeInTheDocument();
        seeEnd(observers);
        expect(perDay()).toEqual([35, 35]);
        expect(screen.queryByTestId('list-more')).not.toBeInTheDocument();
    });

    async function waitForDays(count: number): Promise<void> {
        await vi.waitFor(() => {
            expect(screen.getAllByTestId('anime-update-day')).toHaveLength(count);
        });
    }
});
