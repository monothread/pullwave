// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { MangaSeriesSettings } from '@renderer/components/MangaSeriesSettings';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeLibraryManga } from '../../helpers/mangaFixtures';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialManga = useMangaStore.getState();

const ALONE = makeLibraryManga([], { id: 3, title: 'Sousou no Frieren Season 2' });
const JOINED = makeLibraryManga([], { id: 4, title: 'Frieren 2', series: 'Frieren', season: 2, seasonName: 'Beyond' });

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS });
    useMangaStore.setState({ ...initialManga, library: [ALONE, JOINED] });
    mock.api.manga.library.mockResolvedValue([ALONE, JOINED]);
});

describe('MangaSeriesSettings', () => {
    it('starts empty for a manga that is on its own, with the first season', () => {
        render(<MangaSeriesSettings manga={ALONE} />);
        expect(screen.getByLabelText('Series')).toHaveValue('');
        expect(screen.getByLabelText('Order')).toHaveValue(1);
        expect(screen.getByLabelText('Name shown')).toHaveValue('');
        expect(screen.queryByRole('button', { name: 'LEAVE SERIES' })).not.toBeInTheDocument();
        expect(screen.queryByText(/^In the series/)).not.toBeInTheDocument();
    });

    it('shows where a manga is in its series, and offers to leave it', () => {
        render(<MangaSeriesSettings manga={JOINED} />);
        expect(screen.getByText('In the series "Frieren", order 2.')).toBeInTheDocument();
        expect(screen.getByLabelText('Series')).toHaveValue('Frieren');
        expect(screen.getByLabelText('Order')).toHaveValue(2);
        expect(screen.getByLabelText('Name shown')).toHaveValue('Beyond');
        expect(screen.getByRole('button', { name: 'LEAVE SERIES' })).toBeInTheDocument();
    });

    it('explains the series in terms of mangas', () => {
        render(<MangaSeriesSettings manga={ALONE} />);
        expect(screen.getByTitle(/The seasons of a manga are separate entries in the source/)).toBeInTheDocument();
        expect(screen.getByTitle(/The name only changes what is shown for this manga inside the series/)).toBeInTheDocument();
    });

    it('suggests the series and the season from the title', async () => {
        const user = userEvent.setup();
        render(<MangaSeriesSettings manga={ALONE} />);
        await user.click(screen.getByRole('button', { name: 'SUGGEST FROM THE TITLE' }));
        expect(screen.getByLabelText('Series')).toHaveValue('Sousou no Frieren');
        expect(screen.getByLabelText('Order')).toHaveValue(2);
        expect(mock.api.manga.setSeries).not.toHaveBeenCalled();
    });

    it('offers the series the library already has while the name is typed', async () => {
        const user = userEvent.setup();
        render(<MangaSeriesSettings manga={ALONE} />);
        await user.click(screen.getByLabelText('Series'));
        await user.keyboard('fri');
        const option = await screen.findByRole('option', { name: 'Frieren' });
        await user.pointer({ keys: '[MouseLeft]', target: option });
        expect(screen.getByLabelText('Series')).toHaveValue('Frieren');
    });

    it('saves the series, the place in it and the name shown', async () => {
        const user = userEvent.setup();
        render(<MangaSeriesSettings manga={ALONE} />);
        await user.type(screen.getByLabelText('Series'), 'Frieren');
        const order = screen.getByLabelText('Order');
        await user.clear(order);
        await user.type(order, '3');
        await user.type(screen.getByLabelText('Name shown'), ' Final ');
        await user.click(screen.getByRole('button', { name: 'SAVE SERIES' }));
        expect(mock.api.manga.setSeries).toHaveBeenCalledWith({ mangaId: 3, series: 'Frieren', season: 3, seasonName: 'Final' });
        expect(mock.api.manga.library).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('does not save an empty series name, or a name shown that is too long', async () => {
        const user = userEvent.setup();
        render(<MangaSeriesSettings manga={ALONE} />);
        await user.click(screen.getByRole('button', { name: 'SAVE SERIES' }));
        expect(screen.getByRole('alert')).toHaveTextContent('Give a series name (up to 100 characters), an order from 1 to 99 and a name of up to 60 characters.');
        expect(mock.api.manga.setSeries).not.toHaveBeenCalled();
    });

    it('says the order is taken and which one to use', async () => {
        const user = userEvent.setup();
        mock.api.manga.setSeries.mockResolvedValue({ ok: false, reason: 'season-taken', suggested: 3 });
        render(<MangaSeriesSettings manga={ALONE} />);
        await user.type(screen.getByLabelText('Series'), 'Frieren');
        await user.click(screen.getByRole('button', { name: 'SAVE SERIES' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Order 1 is already used by another manga of the series. Use 3, the next one.');
        expect(mock.api.manga.library).not.toHaveBeenCalled();
    });

    it('says the data is not valid when the main process refuses it for another reason', async () => {
        const user = userEvent.setup();
        mock.api.manga.setSeries.mockResolvedValue({ ok: false, reason: 'invalid' });
        render(<MangaSeriesSettings manga={ALONE} />);
        await user.type(screen.getByLabelText('Series'), 'Frieren');
        await user.click(screen.getByRole('button', { name: 'SAVE SERIES' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Give a series name');
    });

    it('takes the manga out of its series and clears the fields', async () => {
        const user = userEvent.setup();
        render(<MangaSeriesSettings manga={JOINED} />);
        await user.click(screen.getByRole('button', { name: 'LEAVE SERIES' }));
        expect(mock.api.manga.setSeries).toHaveBeenCalledWith({ mangaId: 4, series: null, season: null, seasonName: null });
        await vi.waitFor(() => {
            expect(screen.getByLabelText('Series')).toHaveValue('');
        });
        expect(screen.getByLabelText('Order')).toHaveValue(1);
        expect(screen.getByLabelText('Name shown')).toHaveValue('');
    });
});
