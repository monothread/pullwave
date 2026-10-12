// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MangaResultCard } from '@renderer/components/MangaResultCard';
import { makeChapterRecord, makeLibraryManga, makeSummary } from '../../helpers/mangaFixtures';
import { installMockApi } from '../../helpers/mockApi';

beforeEach(() => {
    installMockApi();
});

function renderCard(item = makeSummary(), library = [] as ReturnType<typeof makeLibraryManga>[], onOpen = vi.fn()): ReturnType<typeof vi.fn> {
    render(
        <ul>
            <MangaResultCard item={item} library={library} onOpen={onOpen} />
        </ul>
    );
    return onOpen;
}

describe('MangaResultCard', () => {
    it('shows the cover and the title, and opens the manga with a click on the title', async () => {
        const user = userEvent.setup();
        const item = makeSummary({ remoteId: 7, sourceId: '123', title: 'One Piece' });
        const onOpen = renderCard(item);
        expect(document.querySelector('img.cover')).toHaveAttribute('src', 'http://127.0.0.1:4321/api/v1/manga/7/thumbnail');
        await user.click(screen.getByRole('button', { name: 'Open: One Piece' }));
        expect(onOpen).toHaveBeenCalledTimes(1);
        expect(onOpen).toHaveBeenCalledWith(item);
        expect(screen.queryByText(/IN LIBRARY/)).not.toBeInTheDocument();
    });

    it('says the manga is in the library when this source has it', () => {
        renderCard(makeSummary({ remoteId: 7, sourceId: '123' }), [makeLibraryManga([makeChapterRecord()], { sourceId: '123', remoteId: 7 })]);
        const card = screen.getByRole('listitem');
        expect(within(card).getByText('IN LIBRARY')).toBeInTheDocument();
        expect(within(card).queryByText('IN LIBRARY (OTHER SOURCE)')).not.toBeInTheDocument();
    });

    it('says the manga is in the library from another source when only the title is there', () => {
        renderCard(makeSummary({ remoteId: 7, sourceId: '123', title: 'One Piece' }), [makeLibraryManga([], { sourceId: '999', remoteId: 70, title: 'one piece' })]);
        const card = screen.getByRole('listitem');
        expect(within(card).getByText('IN LIBRARY (OTHER SOURCE)')).toBeInTheDocument();
        expect(within(card).queryByText('IN LIBRARY')).not.toBeInTheDocument();
    });

    it('says nothing for another title', () => {
        renderCard(makeSummary({ title: 'One Piece' }), [makeLibraryManga([], { sourceId: '999', remoteId: 70, title: 'Bleach' })]);
        expect(screen.queryByText(/IN LIBRARY/)).not.toBeInTheDocument();
    });
});
