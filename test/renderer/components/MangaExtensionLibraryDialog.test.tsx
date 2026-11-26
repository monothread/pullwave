// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MangaExtensionLibraryDialog } from '@renderer/components/MangaExtensionLibraryDialog';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeChapterRecord, makeLibraryManga, makeSource } from '../../helpers/mangaFixtures';
import { installMockApi } from '../../helpers/mockApi';

const initialManga = useMangaStore.getState();

const ONE_PIECE = makeLibraryManga([makeChapterRecord({ id: 1, mangaId: 1, status: 'done' })], { id: 1, sourceId: '1', remoteId: 7, title: 'One Piece' });
const BLEACH = makeLibraryManga([makeChapterRecord({ id: 2, mangaId: 2, status: 'idle' })], { id: 2, sourceId: '1', remoteId: 8, title: 'Bleach' });

beforeEach(() => {
    installMockApi();
    useMangaStore.setState({ ...initialManga, browse: { ...initialManga.browse, sources: [makeSource({ id: '1', name: 'MangaDex', lang: 'en' })], sourcesStatus: 'ready' } });
});

function renderDialog(mangas = [ONE_PIECE, BLEACH]) {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    render(<MangaExtensionLibraryDialog extensionName="MangaDex" mangas={mangas} onOpen={onOpen} onClose={onClose} />);
    return { onOpen, onClose, dialog: screen.getByRole('dialog', { name: 'Manga of MangaDex in the library' }) };
}

describe('MangaExtensionLibraryDialog', () => {
    it('is a modal window named after the extension, put on the body', () => {
        const { dialog } = renderDialog();
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveClass('modal', 'modal--library');
        expect(dialog.parentElement).toHaveClass('modal-backdrop');
        expect(dialog.parentElement?.parentElement).toBe(document.body);
        expect(within(dialog).getByRole('heading', { level: 2 })).toHaveTextContent('Manga of MangaDex in the library');
    });

    it('lists the library cards of the mangas it was given, in their order, with their progress and source and no way to remove them', () => {
        const { dialog } = renderDialog();
        const grid = within(dialog).getByTestId('manga-extension-library');
        expect(grid.tagName).toBe('UL');
        expect(grid).toHaveClass('cover-grid', 'modal__grid');
        const cards = within(grid).getAllByTestId('manga-entry');
        expect(
            cards.map((card) => {
                return card.querySelector('h3')?.textContent;
            })
        ).toEqual(['One Piece', 'Bleach']);
        expect(within(cards[0]!).getByText('1 of 1 downloaded')).toBeInTheDocument();
        expect(within(cards[1]!).getByText('0 of 1 downloaded')).toBeInTheDocument();
        expect(within(cards[0]!).getByTestId('manga-source-name')).toHaveTextContent('MangaDex · EN');
        expect(within(dialog).queryByRole('button', { name: /^REMOVE/ })).not.toBeInTheDocument();
    });

    it('lists no card when it is given no manga', () => {
        const { dialog } = renderDialog([]);
        expect(within(dialog).queryAllByTestId('manga-entry')).toEqual([]);
        expect(within(dialog).getByRole('button', { name: 'CLOSE' })).toBeInTheDocument();
    });

    it('gives the id of the manga whose card is clicked, and does not close by itself', async () => {
        const { dialog, onOpen, onClose } = renderDialog();
        await userEvent.click(within(dialog).getByRole('button', { name: 'Open: Bleach' }));
        await userEvent.click(within(dialog).getByRole('button', { name: 'Open: One Piece' }));
        expect(onOpen.mock.calls).toEqual([[2], [1]]);
        expect(onClose).not.toHaveBeenCalled();
    });

    it('puts the focus on the first card when it opens, and gives it back to what opened it when it closes', () => {
        const opener = document.createElement('button');
        document.body.appendChild(opener);
        opener.focus();
        const { unmount } = render(<MangaExtensionLibraryDialog extensionName="MangaDex" mangas={[ONE_PIECE, BLEACH]} onOpen={vi.fn()} onClose={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Open: One Piece' })).toHaveFocus();
        unmount();
        expect(opener).toHaveFocus();
        opener.remove();
    });

    it('asks to close with CLOSE, with Escape and with a press outside the window, not with a press inside it', async () => {
        const { dialog, onClose, onOpen } = renderDialog();
        fireEvent.mouseDown(dialog);
        expect(onClose).not.toHaveBeenCalled();
        await userEvent.click(within(dialog).getByRole('button', { name: 'CLOSE' }));
        fireEvent.keyDown(dialog, { key: 'Escape' });
        fireEvent.mouseDown(dialog.parentElement!);
        expect(onClose).toHaveBeenCalledTimes(3);
        expect(onOpen).not.toHaveBeenCalled();
    });
});
