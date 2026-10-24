// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { MangaSeriesSettings } from '@renderer/components/MangaSeriesSettings';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeLibraryManga } from '../../helpers/mangaFixtures';
import { answerDialog, confirmDialog } from '../../helpers/confirmDialog';
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

    it('names the series after the manga when the name is left empty', async () => {
        const user = userEvent.setup();
        render(<MangaSeriesSettings manga={ALONE} />);
        await user.click(screen.getByRole('button', { name: 'SAVE SERIES' }));
        expect(mock.api.manga.setSeries).toHaveBeenCalledWith({ mangaId: 3, series: 'Sousou no Frieren Season 2', season: 1, seasonName: null });
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('treats a name that is only spaces as empty', async () => {
        const user = userEvent.setup();
        render(<MangaSeriesSettings manga={ALONE} />);
        await user.type(screen.getByLabelText('Series'), '   ');
        await user.click(screen.getByRole('button', { name: 'SAVE SERIES' }));
        expect(mock.api.manga.setSeries).toHaveBeenCalledWith({ mangaId: 3, series: 'Sousou no Frieren Season 2', season: 1, seasonName: null });
    });

    it('says in the field that an empty name is the name of the manga', () => {
        render(<MangaSeriesSettings manga={ALONE} />);
        expect(screen.getByLabelText('Series')).toHaveAttribute('placeholder', 'Empty: "Sousou no Frieren Season 2", the name of the manga');
    });

    it('joins the series that the title of the manga names when the name is empty and that series exists', async () => {
        const user = userEvent.setup();
        const library = [ALONE, makeLibraryManga([], { id: 8, title: 'Other', series: 'Sousou no Frieren Season 2', season: 1 })];
        useMangaStore.setState({ library });
        render(<MangaSeriesSettings manga={ALONE} />);
        await user.click(screen.getByRole('button', { name: 'SAVE SERIES' }));
        expect(screen.getByRole('alert')).toHaveTextContent('Order 1 is already used by another manga of the series. The next free one is 2.');
        expect(mock.api.manga.setSeries).not.toHaveBeenCalled();
    });

    it('does not save an order that is not valid, or a name shown that is too long', async () => {
        const user = userEvent.setup();
        render(<MangaSeriesSettings manga={ALONE} />);
        const order = screen.getByLabelText('Order');
        await user.clear(order);
        await user.type(order, '100');
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

    it('keeps the manga in its series when the user keeps it or presses Esc', async () => {
        const user = userEvent.setup();
        render(<MangaSeriesSettings manga={JOINED} />);
        await user.click(screen.getByRole('button', { name: 'LEAVE SERIES' }));
        await answerDialog(user, /^Take ".*" out of the series\?$/, 'KEEP');
        await user.click(screen.getByRole('button', { name: 'LEAVE SERIES' }));
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(mock.api.manga.setSeries).not.toHaveBeenCalled();
    });

    it('takes the manga out of its series and clears the fields', async () => {
        const user = userEvent.setup();
        render(<MangaSeriesSettings manga={JOINED} />);
        await user.click(screen.getByRole('button', { name: 'LEAVE SERIES' }));
        expect(mock.api.manga.setSeries).not.toHaveBeenCalled();
        expect(within(confirmDialog(/^Take ".*" out of the series\?$/)).getByText('The manga stays in the library with its chapters and files.')).toBeInTheDocument();
        await answerDialog(user, /^Take ".*" out of the series\?$/, 'LEAVE SERIES');
        expect(mock.api.manga.setSeries).toHaveBeenCalledWith({ mangaId: 4, series: null, season: null, seasonName: null });
        await vi.waitFor(() => {
            expect(screen.getByLabelText('Series')).toHaveValue('');
        });
        expect(screen.getByLabelText('Order')).toHaveValue(1);
        expect(screen.getByLabelText('Name shown')).toHaveValue('');
    });
});

describe('MangaSeriesSettings the orders that are taken', () => {
    const FIRST = makeLibraryManga([], { id: 5, title: 'Frieren', series: 'Frieren', season: 1 });

    beforeEach(() => {
        useMangaStore.setState({ library: [ALONE, FIRST, JOINED] });
    });

    it('offers the next order when the series that is picked has the one that was in the field', async () => {
        const user = userEvent.setup();
        render(<MangaSeriesSettings manga={ALONE} />);
        await user.click(screen.getByLabelText('Series'));
        await user.keyboard('fri');
        await user.pointer({ keys: '[MouseLeft]', target: await screen.findByRole('option', { name: 'Frieren' }) });
        expect(screen.getByLabelText('Series')).toHaveValue('Frieren');
        expect(screen.getByLabelText('Order')).toHaveValue(3);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'SAVE SERIES' })).toBeEnabled();
    });

    it('keeps the order when the series that is typed does not have it', async () => {
        const user = userEvent.setup();
        render(<MangaSeriesSettings manga={ALONE} />);
        const order = screen.getByLabelText('Order');
        await user.clear(order);
        await user.type(order, '5');
        await user.type(screen.getByLabelText('Series'), 'Frieren');
        expect(order).toHaveValue(5);
    });

    it('says the order is used and which is the next free one, and does not let it be saved', async () => {
        const user = userEvent.setup();
        render(<MangaSeriesSettings manga={ALONE} />);
        await user.type(screen.getByLabelText('Series'), 'FRIEREN');
        const order = screen.getByLabelText('Order');
        await user.clear(order);
        await user.type(order, '2');
        expect(screen.getByRole('alert')).toHaveTextContent('Order 2 is already used by another manga of the series. The next free one is 3.');
        expect(screen.getByRole('button', { name: 'SAVE SERIES' })).toBeDisabled();
        await user.click(screen.getByRole('button', { name: 'SAVE SERIES' }));
        expect(mock.api.manga.setSeries).not.toHaveBeenCalled();
        await user.clear(order);
        await user.type(order, '3');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'SAVE SERIES' })).toBeEnabled();
    });

    it('does not count the order the manga has itself', () => {
        render(<MangaSeriesSettings manga={JOINED} />);
        expect(screen.getByLabelText('Order')).toHaveValue(2);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'SAVE SERIES' })).toBeEnabled();
    });

    it('suggests the next free order when the suggestion from the title is taken', async () => {
        const user = userEvent.setup();
        const library = [makeLibraryManga([], { id: 3, title: 'Frieren Season 2' }), FIRST, JOINED];
        useMangaStore.setState({ library });
        render(<MangaSeriesSettings manga={library[0]!} />);
        await user.click(screen.getByRole('button', { name: 'SUGGEST FROM THE TITLE' }));
        expect(screen.getByLabelText('Series')).toHaveValue('Frieren');
        expect(screen.getByLabelText('Order')).toHaveValue(3);
    });
});
