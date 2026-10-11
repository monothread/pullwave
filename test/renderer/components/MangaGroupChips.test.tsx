// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { MangaGroupChips } from '@renderer/components/MangaGroupChips';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeLibraryManga } from '../../helpers/mangaFixtures';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialManga = useMangaStore.getState();

const GROUPS = [{ id: 1, name: 'Mangas' }, { id: 2, name: 'Manhwas' }];

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS });
    useMangaStore.setState({ ...initialManga, groups: GROUPS, library: [] });
    mock.api.manga.groups.mockResolvedValue(GROUPS);
});

describe('MangaGroupChips', () => {
    it('says there is no group to put the manga in when the user made none', () => {
        useMangaStore.setState({ groups: [] });
        render(<MangaGroupChips mangaIds={[1]} title="One Piece" />);
        expect(screen.getByText('Make groups in the library to put this manga in them.')).toBeInTheDocument();
        expect(screen.queryByRole('list')).not.toBeInTheDocument();
    });

    it('shows each group as a button that is on when the manga is in it', () => {
        useMangaStore.setState({ library: [makeLibraryManga([], { id: 1, groupIds: [2] })] });
        render(<MangaGroupChips mangaIds={[1]} title="One Piece" />);
        const list = screen.getByRole('list', { name: 'Groups of One Piece' });
        expect(list).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Mangas' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: 'Manhwas' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Manhwas' })).toHaveClass('manga__tag--on');
    });

    it('puts the manga in a group it is not in, and takes it out of one it is in', async () => {
        const user = userEvent.setup();
        const library = [makeLibraryManga([], { id: 1, groupIds: [2] })];
        mock.api.manga.library.mockResolvedValue(library);
        useMangaStore.setState({ library });
        render(<MangaGroupChips mangaIds={[1]} title="One Piece" />);
        await user.click(screen.getByRole('button', { name: 'Mangas' }));
        expect(mock.api.manga.setGroupMembers).toHaveBeenCalledWith(1, [1], true);
        await user.click(screen.getByRole('button', { name: 'Manhwas' }));
        expect(mock.api.manga.setGroupMembers).toHaveBeenLastCalledWith(2, [1], false);
    });

    it('is half on for a series with only some of its seasons in the group, and a click puts the others in', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ library: [makeLibraryManga([], { id: 1, groupIds: [1] }), makeLibraryManga([], { id: 2, groupIds: [] }), makeLibraryManga([], { id: 3, groupIds: [] })] });
        render(<MangaGroupChips mangaIds={[1, 2]} title="Frieren" />);
        const chip = screen.getByRole('button', { name: 'Mangas' });
        expect(chip).toHaveAttribute('aria-pressed', 'mixed');
        expect(chip).toHaveClass('manga__tag--some');
        expect(screen.getByRole('button', { name: 'Manhwas' })).toHaveAttribute('aria-pressed', 'false');
        await user.click(chip);
        expect(mock.api.manga.setGroupMembers).toHaveBeenCalledWith(1, [1, 2], true);
    });

    it('is on for a series whose seasons are all in the group, and a click takes all of them out', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ library: [makeLibraryManga([], { id: 1, groupIds: [1] }), makeLibraryManga([], { id: 2, groupIds: [1] })] });
        render(<MangaGroupChips mangaIds={[1, 2]} title="Frieren" />);
        expect(screen.getByRole('button', { name: 'Mangas' })).toHaveAttribute('aria-pressed', 'true');
        await user.click(screen.getByRole('button', { name: 'Mangas' }));
        expect(mock.api.manga.setGroupMembers).toHaveBeenCalledWith(1, [1, 2], false);
    });

    it('reads the library again after a change', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ library: [makeLibraryManga([], { id: 1 })] });
        render(<MangaGroupChips mangaIds={[1]} title="One Piece" />);
        await user.click(screen.getByRole('button', { name: 'Mangas' }));
        expect(mock.api.manga.library).toHaveBeenCalledTimes(1);
    });
});
