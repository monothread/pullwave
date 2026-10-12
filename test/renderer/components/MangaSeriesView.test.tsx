// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { MangaSeriesView } from '@renderer/components/MangaSeriesView';
import { groupLibrary } from '@renderer/components/mangaText';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeChapterRecord, makeLibraryManga } from '../../helpers/mangaFixtures';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialManga = useMangaStore.getState();

const FIRST = makeLibraryManga([makeChapterRecord({ id: 1, status: 'done' })], { id: 1, remoteId: 11, title: 'Frieren', series: 'Sousou no Frieren', season: 1, groupIds: [1] });
const SECOND = makeLibraryManga([makeChapterRecord({ id: 2, status: 'idle' }), makeChapterRecord({ id: 3, status: 'done' })], {
    id: 2,
    remoteId: 12,
    title: 'Frieren 2',
    series: 'Sousou no Frieren',
    season: 2,
    seasonName: 'Beyond Journey'
});
const LIBRARY = [SECOND, FIRST];

function renderView(onBack = vi.fn(), onRenamed = vi.fn()) {
    const group = groupLibrary(LIBRARY)[0]!;
    render(<MangaSeriesView group={group} onBack={onBack} onRenamed={onRenamed} />);
    return { onBack, onRenamed };
}

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS });
    useMangaStore.setState({ ...initialManga, library: LIBRARY, groups: [{ id: 1, name: 'Mangas' }] });
    mock.api.manga.library.mockResolvedValue(LIBRARY);
    mock.api.manga.groups.mockResolvedValue([{ id: 1, name: 'Mangas' }]);
});

describe('MangaSeriesView', () => {
    it('shows the name of the series, how many seasons it has, and its seasons in order with their labels and progress', () => {
        renderView();
        expect(screen.getByTestId('manga-series-view')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Sousou no Frieren', level: 3 })).toBeInTheDocument();
        expect(screen.getByText('2 SEASONS')).toBeInTheDocument();
        const seasons = screen.getAllByTestId('manga-season');
        expect(seasons).toHaveLength(2);
        expect(within(seasons[0]!).getByText('SEASON 1')).toBeInTheDocument();
        expect(within(seasons[0]!).getByRole('button', { name: 'Open: Frieren' })).toBeInTheDocument();
        expect(within(seasons[0]!).getByText('1 of 1 downloaded')).toBeInTheDocument();
        expect(within(seasons[1]!).getByText('Beyond Journey')).toBeInTheDocument();
        expect(within(seasons[1]!).getByText('1 of 2 downloaded')).toBeInTheDocument();
    });

    it('says one season in the singular', () => {
        const group = groupLibrary([FIRST])[0]!;
        render(<MangaSeriesView group={group} onBack={vi.fn()} onRenamed={vi.fn()} />);
        expect(screen.getByText('1 SEASON')).toBeInTheDocument();
    });

    it('goes back to the library', async () => {
        const user = userEvent.setup();
        const { onBack } = renderView();
        await user.click(screen.getByRole('button', { name: 'BACK TO LIBRARY' }));
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('opens a season on the page of its manga in the library', async () => {
        const user = userEvent.setup();
        mock.api.manga.details.mockResolvedValue({ ok: false, error: { code: 'NOT_FOUND', message: 'none' } });
        useMangaStore.setState({ view: 'library' });
        renderView();
        await user.click(screen.getByRole('button', { name: 'Open: Frieren 2' }));
        expect(useMangaStore.getState().selectionFrom).toBe('library');
        expect(useMangaStore.getState().selection?.manga).toMatchObject({ remoteId: 12, title: 'Frieren 2' });
        expect(mock.api.manga.details).toHaveBeenCalledWith(12);
    });

    it('downloads what is missing of every season, only while something is missing', async () => {
        const user = userEvent.setup();
        renderView();
        await user.click(screen.getByRole('button', { name: 'DOWNLOAD MISSING: Sousou no Frieren' }));
        expect(mock.api.manga.downloadMissing.mock.calls).toEqual([[[1]], [[2]]]);
    });

    it('has no button to download when everything is downloaded', () => {
        const done = [{ ...FIRST }, makeLibraryManga([makeChapterRecord({ id: 9, status: 'done' })], { id: 5, title: 'Frieren 2', series: 'Sousou no Frieren', season: 2 })];
        render(<MangaSeriesView group={groupLibrary(done)[0]!} onBack={vi.fn()} onRenamed={vi.fn()} />);
        expect(screen.queryByRole('button', { name: /DOWNLOAD MISSING/ })).not.toBeInTheDocument();
    });

    it('puts every season in a group, or takes them all out, with the chips', async () => {
        const user = userEvent.setup();
        renderView();
        await user.click(screen.getByRole('button', { name: 'Series options: Sousou no Frieren' }));
        const chip = screen.getByRole('button', { name: 'Mangas' });
        expect(chip).toHaveAttribute('aria-pressed', 'mixed');
        await user.click(chip);
        expect(mock.api.manga.setGroupMembers).toHaveBeenCalledWith(1, [1, 2], true);
    });

    it('removes one season, asking in a window first', async () => {
        const user = userEvent.setup();
        renderView();
        await user.click(screen.getByRole('button', { name: 'REMOVE: Frieren 2' }));
        expect(mock.api.manga.removeManga).not.toHaveBeenCalled();
        const dialog = screen.getByRole('dialog', { name: 'Remove "Frieren 2"?' });
        await user.click(within(dialog).getByRole('button', { name: 'REMOVE' }));
        expect(mock.api.manga.removeManga).toHaveBeenCalledWith(2);
    });

    it('does not let the manga that gives its name to the series be removed alone', () => {
        renderView();
        const blocked = screen.getByRole('button', { name: 'REMOVE: Sousou no Frieren' });
        expect(blocked).toBeDisabled();
        expect(blocked).toHaveAttribute('title', 'This manga gives its name to the series. To remove it, remove the whole series.');
        expect(screen.getByRole('button', { name: 'REMOVE: Frieren 2' })).toBeEnabled();
    });

    it('removes the whole series from its menu, asking in a window, one season after the other', async () => {
        const user = userEvent.setup();
        renderView();
        await user.click(screen.getByRole('button', { name: 'Series options: Sousou no Frieren' }));
        await user.click(screen.getByRole('button', { name: 'REMOVE SERIES: Sousou no Frieren' }));
        expect(screen.queryByRole('group', { name: 'Series options: Sousou no Frieren' })).not.toBeInTheDocument();
        const dialog = screen.getByRole('dialog', { name: 'Remove the series "Sousou no Frieren"?' });
        expect(dialog).toHaveTextContent('Every manga of the series leaves the library and their downloaded chapters are deleted from the disk too.');
        await user.click(within(dialog).getByRole('button', { name: 'REMOVE' }));
        await vi.waitFor(() => {
            expect(mock.api.manga.removeManga.mock.calls).toEqual([[1], [2]]);
        });
    });

    it('keeps the series when the window is called off', async () => {
        const user = userEvent.setup();
        renderView();
        await user.click(screen.getByRole('button', { name: 'Series options: Sousou no Frieren' }));
        await user.click(screen.getByRole('button', { name: 'REMOVE SERIES: Sousou no Frieren' }));
        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'KEEP' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(mock.api.manga.removeManga).not.toHaveBeenCalled();
    });

    it('keeps the groups of the series inside the gear, not on the screen', async () => {
        const user = userEvent.setup();
        renderView();
        expect(screen.queryByRole('button', { name: 'Mangas' })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Series options: Sousou no Frieren' }));
        const panel = screen.getByRole('group', { name: 'Series options: Sousou no Frieren' });
        expect(within(panel).getByRole('button', { name: 'Mangas' })).toHaveAttribute('aria-pressed', 'mixed');
    });

    describe('renaming the series', () => {
        async function openRename(user: ReturnType<typeof userEvent.setup>): Promise<void> {
            await user.click(screen.getByRole('button', { name: 'Series options: Sousou no Frieren' }));
            await user.click(screen.getByRole('button', { name: 'RENAME SERIES: Sousou no Frieren' }));
        }

        it('renames it for all the seasons and tells the screen the new name', async () => {
            const user = userEvent.setup();
            const { onRenamed } = renderView();
            await openRename(user);
            const field = screen.getByLabelText('Series name');
            expect(field).toHaveValue('Sousou no Frieren');
            await user.clear(field);
            await user.type(field, '  Frieren  ');
            await user.click(screen.getByRole('button', { name: 'SAVE' }));
            expect(mock.api.manga.renameSeries).toHaveBeenCalledWith([1, 2], 'Frieren');
            await vi.waitFor(() => {
                expect(onRenamed).toHaveBeenCalledWith('Frieren');
            });
        });

        it('does not rename to an empty name', async () => {
            const user = userEvent.setup();
            const { onRenamed } = renderView();
            await openRename(user);
            await user.clear(screen.getByLabelText('Series name'));
            await user.click(screen.getByRole('button', { name: 'SAVE' }));
            expect(screen.getByRole('alert')).toHaveTextContent('Give a series name of up to 100 characters.');
            expect(mock.api.manga.renameSeries).not.toHaveBeenCalled();
            expect(onRenamed).not.toHaveBeenCalled();
        });

        it('says which season clashes with the series that has the new name', async () => {
            const user = userEvent.setup();
            mock.api.manga.renameSeries.mockResolvedValue({ ok: false, reason: 'season-taken', manga: 'Frieren', season: 1, suggested: 3 });
            const { onRenamed } = renderView();
            await openRename(user);
            await user.click(screen.getByRole('button', { name: 'SAVE' }));
            expect(await screen.findByRole('alert')).toHaveTextContent('Order 1 of "Frieren" is already used in "Sousou no Frieren". Change its order to 3, the next one.');
            expect(onRenamed).not.toHaveBeenCalled();
        });

        it('says the name is not valid when the main process refuses it', async () => {
            const user = userEvent.setup();
            mock.api.manga.renameSeries.mockResolvedValue({ ok: false, reason: 'invalid' });
            renderView();
            await openRename(user);
            await user.click(screen.getByRole('button', { name: 'SAVE' }));
            expect(await screen.findByRole('alert')).toHaveTextContent('Give a series name of up to 100 characters.');
        });

        it('can be called off', async () => {
            const user = userEvent.setup();
            renderView();
            await openRename(user);
            await user.click(screen.getByRole('button', { name: 'CANCEL' }));
            expect(screen.queryByLabelText('Series name')).not.toBeInTheDocument();
        });
    });
});
