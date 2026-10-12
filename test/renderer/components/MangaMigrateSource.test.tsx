// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { MangaMigrateSource } from '@renderer/components/MangaMigrateSource';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeChapter, makeChapterRecord, makeDetails, makeLibraryManga, makeSource, makeSummary } from '../../helpers/mangaFixtures';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialManga = useMangaStore.getState();

const MANGA = makeLibraryManga(
    [
        makeChapterRecord({ id: 1, remoteId: 101, number: 1, name: 'One', status: 'done' }),
        makeChapterRecord({ id: 2, remoteId: 102, number: 2, name: 'Two', status: 'idle' }),
        makeChapterRecord({ id: 3, remoteId: 103, number: 3, name: 'Three', status: 'done' })
    ],
    { id: 9, sourceId: '123', remoteId: 7, title: 'One Piece' }
);
const SOURCES = [
    makeSource({ id: '123', name: 'Current Dex', lang: 'en' }),
    makeSource({ id: '200', name: 'Other Dex', lang: 'en' }),
    makeSource({ id: '300', name: 'Third Scans', lang: 'pt' }),
    makeSource({ id: '400', name: 'Adult Site', lang: 'en', contentWarning: 'NSFW' })
];

function chapters(...numbers: number[]) {
    return numbers.map((number) => {
        return makeChapter({ remoteId: 700 + number, number, name: `Chapter ${number}`, sourceOrder: number });
    });
}

function renderPanel(onClose = vi.fn()) {
    render(<MangaMigrateSource manga={MANGA} onClose={onClose} />);
    return onClose;
}

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS });
    useMangaStore.setState({ ...initialManga, library: [MANGA], browse: { ...initialManga.browse, sources: SOURCES, sourcesStatus: 'ready' } });
    mock.api.manga.library.mockResolvedValue([MANGA]);
    mock.api.manga.list.mockImplementation(async (request: { sourceId: string }) => {
        return { ok: true, value: { items: request.sourceId === '200' ? [makeSummary({ remoteId: 70, sourceId: '200', title: 'One Piece' })] : [makeSummary({ remoteId: 80, sourceId: '300', title: 'One Piece (pt)' })], hasNextPage: false } };
    });
    mock.api.manga.details.mockResolvedValue({ ok: true, value: { details: makeDetails({ remoteId: 70, sourceId: '200' }), chapters: chapters(1, 2, 4) } });
});

describe('MangaMigrateSource', () => {
    it('explains what the move does and starts on all the sources but the one the manga is in and the ones for adults', () => {
        renderPanel();
        expect(screen.getByText(/The chapters you downloaded stay and are matched to the chapters of the new source by their number/)).toBeInTheDocument();
        const options = within(screen.getByLabelText('Search in'))
            .getAllByRole('option')
            .map((option) => {
                return option.textContent;
            });
        expect(options).toEqual(['All sources', 'Other Dex (en)', 'Third Scans (pt)']);
        expect(screen.getByLabelText('Title to look for')).toHaveValue('One Piece');
        expect(screen.getByRole('button', { name: 'MIGRATE' })).toBeDisabled();
    });

    it('lists the sources in alphabetical order, whatever order the server gave them in, and searches them in that order', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({
            browse: {
                ...initialManga.browse,
                sourcesStatus: 'ready',
                sources: [
                    makeSource({ id: '300', name: 'Zeta Scans', lang: 'pt' }),
                    makeSource({ id: '123', name: 'Fake Dex', lang: 'en' }),
                    makeSource({ id: '210', name: 'alpha reader', lang: 'es' }),
                    makeSource({ id: '200', name: 'Other Dex', lang: 'pt' }),
                    makeSource({ id: '201', name: 'Other Dex', lang: 'en' })
                ]
            }
        });
        renderPanel();
        expect(
            within(screen.getByLabelText('Search in'))
                .getAllByRole('option')
                .map((option) => {
                    return option.textContent;
                })
        ).toEqual(['All sources', 'alpha reader (es)', 'Other Dex (en)', 'Other Dex (pt)', 'Zeta Scans (pt)']);
        await user.click(screen.getByRole('button', { name: 'SEARCH' }));
        await vi.waitFor(() => {
            expect(mock.api.manga.list).toHaveBeenCalledTimes(4);
        });
        expect(
            mock.api.manga.list.mock.calls.map((call) => {
                return (call[0] as { sourceId: string }).sourceId;
            })
        ).toEqual(['210', '201', '200', '300']);
    });

    it('offers the sources for adults when the user asked for them', () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, mangaShowAdult: true } });
        renderPanel();
        expect(within(screen.getByLabelText('Search in')).getAllByRole('option')).toHaveLength(4);
    });

    it('reads the sources when they were not read yet', () => {
        useMangaStore.setState({ browse: { ...initialManga.browse, sources: [], sourcesStatus: 'idle' } });
        mock.api.manga.sources.mockResolvedValue({ ok: true, value: SOURCES });
        renderPanel();
        expect(mock.api.manga.sources).toHaveBeenCalledTimes(1);
    });

    it('says there is no other source to look in', () => {
        useMangaStore.setState({ browse: { ...initialManga.browse, sources: [SOURCES[0]!], sourcesStatus: 'ready' } });
        renderPanel();
        expect(screen.getByText('There is no other source: install another extension first.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'SEARCH' })).not.toBeInTheDocument();
    });

    it('searches every source one after the other, and lists what each one has', async () => {
        const user = userEvent.setup();
        renderPanel();
        await user.click(screen.getByRole('button', { name: 'SEARCH' }));
        expect(await screen.findAllByTestId('manga-candidate')).toHaveLength(2);
        expect(mock.api.manga.list.mock.calls).toEqual([
            [{ sourceId: '200', kind: 'search', page: 1, query: 'One Piece' }],
            [{ sourceId: '300', kind: 'search', page: 1, query: 'One Piece' }]
        ]);
        const rows = screen.getAllByTestId('manga-candidate');
        expect(rows[0]).toHaveTextContent('One Piece');
        expect(rows[0]).toHaveTextContent('Other Dex · en');
        expect(rows[1]).toHaveTextContent('One Piece (pt)');
        expect(rows[1]).toHaveTextContent('Third Scans · pt');
    });

    it('says which source is being searched and how far it is', async () => {
        const user = userEvent.setup();
        const answers: Array<(value: unknown) => void> = [];
        mock.api.manga.list.mockImplementation(() => {
            return new Promise((resolve) => {
                answers.push(resolve);
            });
        });
        renderPanel();
        await user.click(screen.getByRole('button', { name: 'SEARCH' }));
        expect(await screen.findByText('Searching Other Dex… (1/2)')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'SEARCH' })).toBeDisabled();
        answers[0]!({ ok: true, value: { items: [], hasNextPage: false } });
        expect(await screen.findByText('Searching Third Scans… (2/2)')).toBeInTheDocument();
        answers[1]!({ ok: true, value: { items: [], hasNextPage: false } });
        expect(await screen.findByText('Nothing found in these sources.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'SEARCH' })).toBeEnabled();
    });

    it('searches only the source that was picked, with the title that was typed', async () => {
        const user = userEvent.setup();
        renderPanel();
        await user.selectOptions(screen.getByLabelText('Search in'), '300');
        const query = screen.getByLabelText('Title to look for');
        await user.clear(query);
        await user.type(query, 'Wan Pisu{Enter}');
        await screen.findAllByTestId('manga-candidate');
        expect(mock.api.manga.list.mock.calls).toEqual([[{ sourceId: '300', kind: 'search', page: 1, query: 'Wan Pisu' }]]);
    });

    it('does not search for an empty title', async () => {
        const user = userEvent.setup();
        renderPanel();
        await user.clear(screen.getByLabelText('Title to look for'));
        expect(screen.getByRole('button', { name: 'SEARCH' })).toBeDisabled();
    });

    it('skips a source that fails and goes on with the others, showing at most twelve results of each', async () => {
        const user = userEvent.setup();
        const many = Array.from({ length: 20 }, (_value, index) => {
            return makeSummary({ remoteId: 1000 + index, sourceId: '300', title: `Result ${index}` });
        });
        mock.api.manga.list.mockImplementation(async (request: { sourceId: string }) => {
            return request.sourceId === '200' ? { ok: false, error: { code: 'REQUEST_FAILED', message: 'offline' } } : { ok: true, value: { items: many, hasNextPage: true } };
        });
        renderPanel();
        await user.click(screen.getByRole('button', { name: 'SEARCH' }));
        expect(await screen.findAllByTestId('manga-candidate')).toHaveLength(12);
    });

    it('reads the chapters of the one that is picked and shows what the move would do', async () => {
        const user = userEvent.setup();
        renderPanel();
        await user.click(screen.getByRole('button', { name: 'SEARCH' }));
        await user.click(await screen.findByRole('button', { name: 'Pick: One Piece (Other Dex)' }));
        expect(mock.api.manga.details).toHaveBeenCalledWith(70);
        expect(await screen.findByTestId('manga-migration-preview')).toHaveTextContent(
            '2 of the 3 chapters of the library match chapters of the new source. 1 new chapter(s) will be added, 1 downloaded chapter(s) the new source lacks will be kept and 0 chapter(s) not downloaded will be removed.'
        );
        expect(screen.getByRole('button', { name: 'MIGRATE' })).toBeEnabled();
    });

    it('counts the chapters that are not downloaded and the new source lacks as removed', async () => {
        const user = userEvent.setup();
        mock.api.manga.details.mockResolvedValue({ ok: true, value: { details: makeDetails(), chapters: chapters(1, 3) } });
        renderPanel();
        await user.click(screen.getByRole('button', { name: 'SEARCH' }));
        await user.click(await screen.findByRole('button', { name: 'Pick: One Piece (Other Dex)' }));
        expect(await screen.findByTestId('manga-migration-preview')).toHaveTextContent('2 of the 3 chapters of the library match chapters of the new source. 0 new chapter(s) will be added, 0 downloaded chapter(s) the new source lacks will be kept and 1 chapter(s) not downloaded will be removed.');
    });

    it('says the chapters are being read, and why they could not be', async () => {
        const user = userEvent.setup();
        let answer: (value: unknown) => void = () => {return undefined};
        mock.api.manga.details.mockReturnValueOnce(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        renderPanel();
        await user.click(screen.getByRole('button', { name: 'SEARCH' }));
        await user.click(await screen.findByRole('button', { name: 'Pick: One Piece (Other Dex)' }));
        expect(screen.getByText('Reading the chapters…')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'MIGRATE' })).toBeDisabled();
        answer({ ok: false, error: { code: 'API_ERROR', message: 'bad' } });
        expect(await screen.findByRole('alert')).toHaveTextContent('The site or the extension reported an error.');
        expect(screen.queryByTestId('manga-migration-preview')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'MIGRATE' })).toBeDisabled();
    });

    it('moves the manga to the one that was picked, with its chapters and details', async () => {
        const user = userEvent.setup();
        const moved = makeLibraryManga([], { id: 9, sourceId: '200', remoteId: 70 });
        mock.api.manga.migrateSource.mockResolvedValue({ ok: true, manga: moved, matched: 2, added: 1, dropped: 0 });
        renderPanel();
        await user.click(screen.getByRole('button', { name: 'SEARCH' }));
        await user.click(await screen.findByRole('button', { name: 'Pick: One Piece (Other Dex)' }));
        await user.click(await screen.findByRole('button', { name: 'MIGRATE' }));
        expect(mock.api.manga.migrateSource).toHaveBeenCalledWith({
            mangaId: 9,
            target: { manga: makeSummary({ remoteId: 70, sourceId: '200', title: 'One Piece' }), details: makeDetails({ remoteId: 70, sourceId: '200' }), chapters: chapters(1, 2, 4) }
        });
    });

    it.each([
        ['exists', 'That manga is in the library already.'],
        ['busy', 'The manga is being downloaded or the folder is being moved. Try again when that is done.'],
        ['invalid', 'The manga could not be migrated. Nothing changed.'],
        ['not-found', 'The manga could not be migrated. Nothing changed.'],
        ['same', 'The manga could not be migrated. Nothing changed.']
    ] as const)('says why the move did not happen (%s)', async (reason, message) => {
        const user = userEvent.setup();
        mock.api.manga.migrateSource.mockResolvedValue({ ok: false, reason });
        renderPanel();
        await user.click(screen.getByRole('button', { name: 'SEARCH' }));
        await user.click(await screen.findByRole('button', { name: 'Pick: One Piece (Other Dex)' }));
        await user.click(await screen.findByRole('button', { name: 'MIGRATE' }));
        expect(await screen.findByRole('alert')).toHaveTextContent(message);
        expect(screen.getByRole('button', { name: 'MIGRATE' })).toBeEnabled();
    });

    it('clears an old problem when another manga is picked or a new search is made', async () => {
        const user = userEvent.setup();
        mock.api.manga.migrateSource.mockResolvedValue({ ok: false, reason: 'busy' });
        renderPanel();
        await user.click(screen.getByRole('button', { name: 'SEARCH' }));
        await user.click(await screen.findByRole('button', { name: 'Pick: One Piece (Other Dex)' }));
        await user.click(await screen.findByRole('button', { name: 'MIGRATE' }));
        await screen.findByRole('alert');
        await user.click(screen.getByRole('button', { name: 'Pick: One Piece (pt) (Third Scans)' }));
        await vi.waitFor(() => {
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });
        await user.click(screen.getByRole('button', { name: 'SEARCH' }));
        await vi.waitFor(() => {
            expect(screen.queryByTestId('manga-migration-preview')).not.toBeInTheDocument();
        });
    });

    it('does nothing when the move is asked for before a manga is picked', async () => {
        const user = userEvent.setup();
        renderPanel();
        await user.click(screen.getByRole('button', { name: 'MIGRATE' }));
        expect(mock.api.manga.migrateSource).not.toHaveBeenCalled();
    });

    it('is closed with the button to cancel', async () => {
        const user = userEvent.setup();
        const onClose = renderPanel();
        await user.click(screen.getByRole('button', { name: 'CANCEL' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
