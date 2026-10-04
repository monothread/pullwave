// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnimeScheduleEntry } from '@shared/anime';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { machineTimeZone } from '@shared/timezone';
import { AnimeSchedule } from '@renderer/components/AnimeSchedule';
import { INITIAL_SCHEDULE, INITIAL_SEARCH, useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { makeScheduleEntry } from '../../helpers/animeFixtures';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

const initialApp = useAppStore.getState();
const initialAnime = useAnimeStore.getState();
let mock: MockApiHandle;

// Saturday, October 3, 2026, 15:30 UTC. Its day in UTC runs from 1_790_985_600 to 1_791_072_000.
const NOW = new Date('2026-10-03T15:30:00Z');
const DAY_START = 1_790_985_600;

const MORNING = makeScheduleEntry({ anilistId: 1, title: 'Sousou no Frieren', episode: 12, airingAt: DAY_START + 9 * 3600 });
const NIGHT = makeScheduleEntry({ anilistId: 2, title: 'Dandadan', english: 'Dandadan', romaji: 'Dan Da Dan', names: ['Dandadan', 'Dan Da Dan'], episode: 3, airingAt: DAY_START + 22 * 3600 + 30 * 60, coverUrl: null });
const TOMORROW = makeScheduleEntry({ anilistId: 3, title: 'Blue Lock', english: 'Blue Lock', romaji: null, names: ['Blue Lock'], episode: 5, airingAt: DAY_START + 86_400 + 10 * 3600 });

function timeOf(entry: AnimeScheduleEntry, timeZone = 'UTC'): string {
    return new Date(entry.airingAt * 1000).toLocaleTimeString('en', { timeZone, hour: '2-digit', minute: '2-digit' });
}

function dayOf(heading: string): HTMLElement {
    return screen.getByRole('region', { name: heading });
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    mock = installMockApi();
    mock.api.listAnimeSchedule.mockResolvedValue({ ok: true, entries: [MORNING, NIGHT] });
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS, notice: null });
    useAnimeStore.setState({ ...initialAnime, view: 'schedule', returnView: 'schedule', search: INITIAL_SEARCH, schedule: { ...INITIAL_SCHEDULE, timeZone: 'UTC' } });
});

afterEach(() => {
    vi.useRealTimers();
});

describe('AnimeSchedule', () => {
    it('asks for the day of today in the time zone when it is shown', async () => {
        render(<AnimeSchedule />);

        await screen.findByText('Sousou no Frieren');

        expect(mock.api.listAnimeSchedule).toHaveBeenCalledTimes(1);
        expect(mock.api.listAnimeSchedule).toHaveBeenCalledWith({ from: DAY_START, to: DAY_START + 86_400, refresh: false });
    });

    it('starts with the time zone of the machine and the day view', async () => {
        useAnimeStore.setState({ schedule: INITIAL_SCHEDULE });
        render(<AnimeSchedule />);
        await screen.findByText('Sousou no Frieren');

        expect(screen.getByLabelText('Time zone')).toHaveValue(machineTimeZone());
        expect(screen.getByLabelText('View')).toHaveValue('day');
    });

    it('shows a message while the first listing is loading', async () => {
        mock.api.listAnimeSchedule.mockImplementation(() => {
            return new Promise(() => {
                return undefined;
            });
        });
        render(<AnimeSchedule />);

        expect(await screen.findByText('LOADING THE SCHEDULE…')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'REFRESH' })).toBeDisabled();
        expect(screen.queryByText('// NOTHING AIRS IN THIS PERIOD.')).not.toBeInTheDocument();
    });

    it('lists the day with its heading, marked as today, the count, the episode and the time of each episode', async () => {
        render(<AnimeSchedule />);

        await screen.findByText('Sousou no Frieren');

        expect(screen.getByRole('region', { name: 'Anime schedule' })).toBeInTheDocument();
        expect(screen.getByText('AIRING [2]')).toBeInTheDocument();
        const day = dayOf('Saturday, Oct 3');
        expect(within(day).getByRole('heading', { name: 'Saturday, Oct 3 · TODAY' })).toBeInTheDocument();
        const items = within(day).getAllByRole('listitem');
        expect(items).toHaveLength(2);
        expect(within(items[0] as HTMLElement).getByRole('button', { name: 'OPEN: Sousou no Frieren, EP 12' })).toHaveAttribute('title', 'Sousou no Frieren');
        expect(within(items[0] as HTMLElement).getByText(`EP 12 · ${timeOf(MORNING)}`)).toBeInTheDocument();
        expect(within(items[1] as HTMLElement).getByText('Dandadan')).toBeInTheDocument();
        expect(within(items[1] as HTMLElement).getByText(`EP 3 · ${timeOf(NIGHT)}`)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /DOWNLOAD/ })).not.toBeInTheDocument();
    });

    it('shows the cover of each anime, and a placeholder where there is none', async () => {
        render(<AnimeSchedule />);
        await screen.findByText('Sousou no Frieren');

        const items = screen.getAllByRole('listitem');
        const cover = (items[0] as HTMLElement).querySelector('img');
        expect(cover).toHaveAttribute('src', 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/frieren.jpg');
        expect(cover).toHaveClass('cover');
        expect(cover).toHaveAttribute('alt', '');
        expect(cover).toHaveAttribute('loading', 'lazy');
        expect((items[1] as HTMLElement).querySelector('img')).toBeNull();
        expect(within(items[1] as HTMLElement).getByText('COVER NOT FOUND')).toHaveClass('cover', 'cover--none');
        expect(within(items[0] as HTMLElement).queryByText('COVER NOT FOUND')).not.toBeInTheDocument();
    });

    it('shows the times in the time zone that is set', async () => {
        useAnimeStore.setState({ schedule: { ...INITIAL_SCHEDULE, timeZone: 'Asia/Tokyo' } });
        render(<AnimeSchedule />);

        await screen.findByText('Dandadan');

        // Tokyo is 9 hours ahead: at 15:30 UTC it is already October 4 there, and that day starts at 15:00 UTC of October 3.
        expect(mock.api.listAnimeSchedule).toHaveBeenCalledWith({ from: DAY_START + 15 * 3600, to: DAY_START + 39 * 3600, refresh: false });
        expect(within(dayOf('Sunday, Oct 4')).getByText(`EP 3 · ${timeOf(NIGHT, 'Asia/Tokyo')}`)).toBeInTheDocument();
        // What airs before that day starts in Tokyo is not part of it.
        expect(screen.queryByText('Sousou no Frieren')).not.toBeInTheDocument();
    });

    it('lists the day again for the time zone that is picked', async () => {
        const user = userEvent.setup();
        render(<AnimeSchedule />);
        await screen.findByText('Sousou no Frieren');
        mock.api.listAnimeSchedule.mockResolvedValue({ ok: true, entries: [NIGHT] });

        await user.selectOptions(screen.getByLabelText('Time zone'), 'America/Sao_Paulo');

        await vi.waitFor(() => {
            expect(screen.queryByText('Sousou no Frieren')).not.toBeInTheDocument();
        });
        expect(mock.api.listAnimeSchedule).toHaveBeenCalledTimes(2);
        expect(mock.api.listAnimeSchedule).toHaveBeenLastCalledWith({ from: DAY_START + 3 * 3600, to: DAY_START + 3 * 3600 + 86_400, refresh: false });
        expect(useAnimeStore.getState().schedule.timeZone).toBe('America/Sao_Paulo');
        expect(screen.getByLabelText('Time zone')).toHaveValue('America/Sao_Paulo');
        expect(screen.getByText('Dandadan')).toBeInTheDocument();
    });

    it('offers the time zones with their names readable', async () => {
        render(<AnimeSchedule />);
        await screen.findByText('Sousou no Frieren');

        const select = screen.getByLabelText('Time zone');
        expect(within(select).getByRole('option', { name: 'America/Sao Paulo' })).toHaveValue('America/Sao_Paulo');
        expect(within(select).getByRole('option', { name: 'UTC' })).toHaveValue('UTC');
        expect(within(select).getByRole('option', { name: 'Asia/Tokyo' })).toHaveValue('Asia/Tokyo');
    });

    it('shows the week divided by days, each one with the episodes that air on it', async () => {
        const user = userEvent.setup();
        render(<AnimeSchedule />);
        await screen.findByText('Sousou no Frieren');
        mock.api.listAnimeSchedule.mockResolvedValue({ ok: true, entries: [MORNING, NIGHT, TOMORROW] });

        await user.selectOptions(screen.getByLabelText('View'), 'week');

        await screen.findByText('Blue Lock');
        expect(mock.api.listAnimeSchedule).toHaveBeenLastCalledWith({ from: DAY_START, to: DAY_START + 7 * 86_400, refresh: false });
        expect(screen.getByText('AIRING [3]')).toBeInTheDocument();
        const headings = ['Saturday, Oct 3', 'Sunday, Oct 4', 'Monday, Oct 5', 'Tuesday, Oct 6', 'Wednesday, Oct 7', 'Thursday, Oct 8', 'Friday, Oct 9'];
        headings.forEach((heading) => {
            expect(dayOf(heading)).toBeInTheDocument();
        });
        expect(screen.getAllByText(/ · TODAY$/)).toHaveLength(1);
        expect(within(dayOf('Saturday, Oct 3')).getAllByRole('heading')[0]).toHaveTextContent('Saturday, Oct 3 · TODAY');
        expect(
            within(dayOf('Saturday, Oct 3'))
                .getAllByRole('listitem')
                .map((item) => {
                    return within(item).getByText(/^(Sousou no Frieren|Dandadan)$/).textContent;
                })
        ).toEqual(['Sousou no Frieren', 'Dandadan']);
        expect(within(dayOf('Sunday, Oct 4')).getAllByRole('listitem')).toHaveLength(1);
        expect(within(dayOf('Sunday, Oct 4')).getByText('Blue Lock')).toBeInTheDocument();
        expect(within(dayOf('Sunday, Oct 4')).getByText(`EP 5 · ${timeOf(TOMORROW)}`)).toBeInTheDocument();
        ['Monday, Oct 5', 'Tuesday, Oct 6', 'Wednesday, Oct 7', 'Thursday, Oct 8', 'Friday, Oct 9'].forEach((heading) => {
            expect(within(dayOf(heading)).getByText('// NOTHING AIRS.')).toBeInTheDocument();
            expect(within(dayOf(heading)).queryByRole('listitem')).not.toBeInTheDocument();
        });
        expect(useAnimeStore.getState().schedule.view).toBe('week');
    });

    it('goes back to the day of today from the week', async () => {
        const user = userEvent.setup();
        render(<AnimeSchedule />);
        await screen.findByText('Sousou no Frieren');
        await user.selectOptions(screen.getByLabelText('View'), 'week');
        await vi.waitFor(() => {
            expect(mock.api.listAnimeSchedule).toHaveBeenCalledTimes(2);
        });

        await user.selectOptions(screen.getByLabelText('View'), 'day');

        await vi.waitFor(() => {
            expect(mock.api.listAnimeSchedule).toHaveBeenCalledTimes(3);
        });
        expect(mock.api.listAnimeSchedule).toHaveBeenLastCalledWith({ from: DAY_START, to: DAY_START + 86_400, refresh: false });
        await vi.waitFor(() => {
            expect(screen.getAllByRole('region').filter((region) => {
                return region.className === 'schedule__day';
            })).toHaveLength(1);
        });
    });

    it('goes to the search and looks the anime up when its card is clicked', async () => {
        const user = userEvent.setup();
        mock.api.searchAnime.mockResolvedValue({ ok: true, results: [{ index: 1, title: 'Frieren: Beyond Journey\'s End' }] });
        render(<AnimeSchedule />);
        await screen.findByText('Sousou no Frieren');

        await user.click(screen.getByRole('button', { name: 'OPEN: Sousou no Frieren, EP 12' }));

        expect(mock.api.searchAnime).toHaveBeenCalledWith('Sousou no Frieren', 'sub');
        await vi.waitFor(() => {
            expect(useAnimeStore.getState().search.status).toBe('done');
        });
        expect(useAnimeStore.getState()).toMatchObject({ view: 'search', returnView: 'search' });
        expect(useAnimeStore.getState().search.results).toEqual([{ index: 1, title: 'Frieren: Beyond Journey\'s End' }]);
    });

    it('has a card that is one button, with no other button on it', async () => {
        render(<AnimeSchedule />);
        await screen.findByText('Sousou no Frieren');

        const items = screen.getAllByRole('listitem');
        items.forEach((item) => {
            expect(item).toHaveClass('history__item', 'row--link');
            expect(within(item).getAllByRole('button')).toHaveLength(1);
        });
    });

    it('shows that nothing airs when the period is empty', async () => {
        mock.api.listAnimeSchedule.mockResolvedValue({ ok: true, entries: [] });
        render(<AnimeSchedule />);

        expect(await screen.findByText('// NOTHING AIRS IN THIS PERIOD.')).toBeInTheDocument();
        expect(screen.getByText('AIRING [0]')).toBeInTheDocument();
        expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    });

    it('says what went wrong, with the details on hover, when the schedule could not be had', async () => {
        mock.api.listAnimeSchedule.mockResolvedValue({ ok: false, error: { code: 'NETWORK', raw: 'AniList answered with status 429.' } });
        render(<AnimeSchedule />);

        const alert = await screen.findByRole('alert');

        expect(alert).toHaveTextContent('Network failure. Check your connection and try again.');
        expect(alert).toHaveAttribute('title', 'AniList answered with status 429.');
        expect(screen.queryByText('// NOTHING AIRS IN THIS PERIOD.')).not.toBeInTheDocument();
        expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    });

    it('lists the period again when REFRESH is pressed', async () => {
        const user = userEvent.setup();
        render(<AnimeSchedule />);
        await screen.findByText('Sousou no Frieren');
        mock.api.listAnimeSchedule.mockResolvedValue({ ok: true, entries: [NIGHT] });

        await user.click(screen.getByRole('button', { name: 'REFRESH' }));

        await vi.waitFor(() => {
            expect(screen.queryByText('Sousou no Frieren')).not.toBeInTheDocument();
        });
        expect(mock.api.listAnimeSchedule).toHaveBeenCalledTimes(2);
        expect(mock.api.listAnimeSchedule).toHaveBeenLastCalledWith({ from: DAY_START, to: DAY_START + 86_400, refresh: true });
        expect(screen.getByText('AIRING [1]')).toBeInTheDocument();
    });

    describe('availability in the source', () => {
        it('asks which of the anime of the day the source has, by their ids and their two names', async () => {
            render(<AnimeSchedule />);
            await screen.findByText('Sousou no Frieren');

            await vi.waitFor(() => {
                expect(mock.api.checkAnimeAvailability).toHaveBeenCalledTimes(1);
            });
            expect(mock.api.checkAnimeAvailability).toHaveBeenCalledWith([
                { anilistId: 1, english: 'Frieren: Beyond Journey\'s End', romaji: 'Sousou no Frieren' },
                { anilistId: 2, english: 'Dandadan', romaji: 'Dan Da Dan' }
            ]);
        });

        it('says CHECKING… on each card while the source is being asked, and the cards can be clicked meanwhile', async () => {
            render(<AnimeSchedule />);
            await screen.findByText('Sousou no Frieren');

            const items = screen.getAllByRole('listitem');
            items.forEach((item) => {
                expect(within(item).getByText('CHECKING…')).toBeInTheDocument();
                expect(within(item).getAllByRole('button')).toHaveLength(1);
                expect(item).not.toHaveAttribute('aria-disabled');
            });
        });

        it('marks the anime the source has as AVAILABLE, keeping the card a button', async () => {
            mock.api.checkAnimeAvailability.mockResolvedValue([{ anilistId: 1, state: 'available', query: 'Frieren: Beyond Journey\'s End', index: 1, title: 'Frieren: Beyond Journey\'s End' }]);
            render(<AnimeSchedule />);
            await screen.findByText('Sousou no Frieren');

            const first = screen.getAllByRole('listitem')[0] as HTMLElement;
            expect(await within(first).findByText('AVAILABLE')).toHaveClass('badge', 'badge--done');
            expect(within(first).getByRole('button', { name: 'OPEN: Sousou no Frieren, EP 12' })).toBeEnabled();
            expect(first).toHaveClass('row--link');
            expect(first).not.toHaveClass('cover-card--unavailable');
        });

        it('shows the anime the source does not have faded, as NOT AVAILABLE, without a button and with the reason on hover', async () => {
            mock.api.checkAnimeAvailability.mockResolvedValue([{ anilistId: 2, state: 'unavailable' }]);
            render(<AnimeSchedule />);
            await screen.findByText('Sousou no Frieren');

            const second = screen.getAllByRole('listitem')[1] as HTMLElement;
            expect(await within(second).findByText('NOT AVAILABLE')).toHaveClass('badge');
            expect(second).toHaveClass('cover-card--unavailable');
            expect(second).not.toHaveClass('row--link');
            expect(second).toHaveAttribute('aria-disabled', 'true');
            expect(second).toHaveAttribute('title', 'The source does not have this anime.');
            expect(within(second).queryByRole('button')).not.toBeInTheDocument();
            expect(within(second).getByText('Dandadan')).toBeInTheDocument();
            // The other card keeps being a button.
            expect(within(screen.getAllByRole('listitem')[0] as HTMLElement).getByRole('button', { name: 'OPEN: Sousou no Frieren, EP 12' })).toBeInTheDocument();
        });

        it('does nothing when a card that is not available is clicked', async () => {
            const user = userEvent.setup();
            mock.api.checkAnimeAvailability.mockResolvedValue([{ anilistId: 2, state: 'unavailable' }]);
            render(<AnimeSchedule />);
            await screen.findByText('Dandadan');
            await screen.findByText('NOT AVAILABLE');

            await user.click(screen.getByText('Dandadan'));

            expect(mock.api.searchAnime).not.toHaveBeenCalled();
            expect(useAnimeStore.getState().view).toBe('schedule');
        });

        it('shows no badge, and a card that can be clicked, when it could not be checked', async () => {
            mock.api.checkAnimeAvailability.mockResolvedValue([{ anilistId: 1, state: 'unknown' }]);
            render(<AnimeSchedule />);
            await screen.findByText('Sousou no Frieren');

            const first = screen.getAllByRole('listitem')[0] as HTMLElement;
            await vi.waitFor(() => {
                expect(within(first).queryByText('CHECKING…')).not.toBeInTheDocument();
            });
            expect(within(first).queryByText('AVAILABLE')).not.toBeInTheDocument();
            expect(within(first).queryByText('NOT AVAILABLE')).not.toBeInTheDocument();
            expect(within(first).getByRole('button', { name: 'OPEN: Sousou no Frieren, EP 12' })).toBeEnabled();
        });

        it('updates a card when the answer comes later', async () => {
            render(<AnimeSchedule />);
            await screen.findByText('Sousou no Frieren');
            const second = screen.getAllByRole('listitem')[1] as HTMLElement;
            expect(within(second).getByText('CHECKING…')).toBeInTheDocument();

            act(() => {
                // What the store does with the event of the main process.
                useAnimeStore.setState({ availability: { 2: { anilistId: 2, state: 'unavailable' } } });
            });

            expect(within(second).getByText('NOT AVAILABLE')).toBeInTheDocument();
            expect(second).toHaveClass('cover-card--unavailable');
        });

        it('opens the search by the name that found the anime when an available card is clicked', async () => {
            const user = userEvent.setup();
            mock.api.checkAnimeAvailability.mockResolvedValue([{ anilistId: 1, state: 'available', query: 'Frieren: Beyond Journey\'s End', index: 1, title: 'Frieren: Beyond Journey\'s End' }]);
            mock.api.searchAnime.mockResolvedValue({ ok: true, results: [{ index: 1, title: 'Frieren: Beyond Journey\'s End' }] });
            render(<AnimeSchedule />);
            await screen.findByText('AVAILABLE');

            await user.click(screen.getByRole('button', { name: 'OPEN: Sousou no Frieren, EP 12' }));

            expect(mock.api.searchAnime).toHaveBeenCalledTimes(1);
            expect(mock.api.searchAnime).toHaveBeenCalledWith('Frieren: Beyond Journey\'s End', 'sub');
        });

        it('also marks the cards of the search when the schedule is narrowed', async () => {
            mock.api.checkAnimeAvailability.mockResolvedValue([{ anilistId: 2, state: 'unavailable' }]);
            const user = userEvent.setup();
            render(<AnimeSchedule />);
            await screen.findByText('NOT AVAILABLE');

            await user.type(screen.getByRole('textbox', { name: 'Search the schedule' }), 'dandadan');

            const items = screen.getAllByRole('listitem');
            expect(items).toHaveLength(1);
            expect(within(items[0] as HTMLElement).getByText('NOT AVAILABLE')).toBeInTheDocument();
        });
    });

    describe('searching', () => {
        function dateOf(entry: AnimeScheduleEntry): string {
            return new Intl.DateTimeFormat('en', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(entry.airingAt * 1000));
        }

        async function showWeek(): Promise<ReturnType<typeof userEvent.setup>> {
            const user = userEvent.setup();
            render(<AnimeSchedule />);
            await screen.findByText('Sousou no Frieren');
            mock.api.listAnimeSchedule.mockResolvedValue({ ok: true, entries: [MORNING, NIGHT, TOMORROW] });
            await user.selectOptions(screen.getByLabelText('View'), 'week');
            await screen.findByText('Blue Lock');
            return user;
        }

        it('has a field to search, empty at first, and shows every episode with only its time', async () => {
            render(<AnimeSchedule />);
            await screen.findByText('Sousou no Frieren');

            const field = screen.getByRole('textbox', { name: 'Search the schedule' });
            expect(field).toHaveValue('');
            expect(field).toHaveAttribute('placeholder', 'Anime name…');
            expect(screen.getByText('AIRING [2]')).toBeInTheDocument();
            expect(screen.getByText(`EP 12 · ${timeOf(MORNING)}`)).toBeInTheDocument();
        });

        it('narrows the list to the anime that match, with the date and the time of each episode', async () => {
            const user = userEvent.setup();
            render(<AnimeSchedule />);
            await screen.findByText('Sousou no Frieren');

            await user.type(screen.getByRole('textbox', { name: 'Search the schedule' }), 'frieren');

            expect(screen.getByText('AIRING [1]')).toBeInTheDocument();
            expect(screen.getByText('Sousou no Frieren')).toBeInTheDocument();
            expect(screen.queryByText('Dandadan')).not.toBeInTheDocument();
            expect(screen.getByText(`EP 12 · ${dateOf(MORNING)} · ${timeOf(MORNING)}`)).toBeInTheDocument();
            expect(mock.api.listAnimeSchedule).toHaveBeenCalledTimes(1);
        });

        it('finds an anime by another name it is known by, whatever the case', async () => {
            const user = userEvent.setup();
            render(<AnimeSchedule />);
            await screen.findByText('Dandadan');

            await user.type(screen.getByRole('textbox', { name: 'Search the schedule' }), 'DAN DA DAN');

            expect(screen.getByText(`EP 3 · ${dateOf(NIGHT)} · ${timeOf(NIGHT)}`)).toBeInTheDocument();
            expect(screen.queryByText('Sousou no Frieren')).not.toBeInTheDocument();
        });

        it('finds the day of the episode in the week, leaving out the days where nothing matches', async () => {
            const user = await showWeek();

            await user.type(screen.getByRole('textbox', { name: 'Search the schedule' }), 'blue');

            expect(screen.getByText('AIRING [1]')).toBeInTheDocument();
            expect(within(dayOf('Sunday, Oct 4')).getByText(`EP 5 · ${dateOf(TOMORROW)} · ${timeOf(TOMORROW)}`)).toBeInTheDocument();
            expect(screen.queryByRole('region', { name: 'Saturday, Oct 3' })).not.toBeInTheDocument();
            expect(screen.queryByRole('region', { name: 'Monday, Oct 5' })).not.toBeInTheDocument();
            expect(screen.queryByText('// NOTHING AIRS.')).not.toBeInTheDocument();
        });

        it('says that nothing matches, with what was typed, and the full list comes back when it is cleared', async () => {
            const user = userEvent.setup();
            render(<AnimeSchedule />);
            await screen.findByText('Sousou no Frieren');
            const field = screen.getByRole('textbox', { name: 'Search the schedule' });

            await user.type(field, '  naruto ');

            expect(screen.getByText('// NO ANIME MATCHES "naruto".')).toBeInTheDocument();
            expect(screen.getByText('AIRING [0]')).toBeInTheDocument();
            expect(screen.queryByText('Sousou no Frieren')).not.toBeInTheDocument();
            expect(screen.queryByText('// NOTHING AIRS IN THIS PERIOD.')).not.toBeInTheDocument();

            await user.clear(field);

            expect(screen.queryByText(/NO ANIME MATCHES/)).not.toBeInTheDocument();
            expect(screen.getByText('AIRING [2]')).toBeInTheDocument();
            expect(screen.getByText(`EP 12 · ${timeOf(MORNING)}`)).toBeInTheDocument();
        });

        it('shows the message of an empty period, not of a search, when nothing airs', async () => {
            mock.api.listAnimeSchedule.mockResolvedValue({ ok: true, entries: [] });
            const user = userEvent.setup();
            render(<AnimeSchedule />);
            await screen.findByText('// NOTHING AIRS IN THIS PERIOD.');

            await user.type(screen.getByRole('textbox', { name: 'Search the schedule' }), 'frieren');

            expect(screen.getByText('// NOTHING AIRS IN THIS PERIOD.')).toBeInTheDocument();
            expect(screen.queryByText(/NO ANIME MATCHES/)).not.toBeInTheDocument();
        });

        it('keeps the search when the view changes, and opens the card that was found', async () => {
            const user = userEvent.setup();
            render(<AnimeSchedule />);
            await screen.findByText('Sousou no Frieren');
            const field = screen.getByRole('textbox', { name: 'Search the schedule' });
            await user.type(field, 'dandadan');
            mock.api.searchAnime.mockResolvedValue({ ok: true, results: [{ index: 1, title: 'Dandadan' }] });

            await user.click(screen.getByRole('button', { name: 'OPEN: Dandadan, EP 3' }));

            expect(useAnimeStore.getState().view).toBe('search');
            expect(useAnimeStore.getState().search.query).toBe('Dandadan');
            expect(field).toHaveValue('dandadan');
        });
    });
});
