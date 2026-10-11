// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { MangaGroupsPanel } from '@renderer/components/MangaGroupsPanel';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialManga = useMangaStore.getState();

const GROUPS = [{ id: 1, name: 'Mangas' }, { id: 2, name: 'Manhwas' }];

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS });
    useMangaStore.setState({ ...initialManga, groups: GROUPS });
    mock.api.manga.groups.mockResolvedValue(GROUPS);
});

describe('MangaGroupsPanel', () => {
    it('explains what groups are and lists them', () => {
        render(<MangaGroupsPanel />);
        expect(screen.getByText('Groups', { selector: 'legend' })).toBeInTheDocument();
        expect(screen.getByText(/Make groups \(Mangas, Manhwas, \.\.\.\)/)).toBeInTheDocument();
        expect(
            screen.getAllByTestId('manga-group').map((row) => {
                return row.querySelector('.history__title')?.textContent;
            })
        ).toEqual(['Mangas', 'Manhwas']);
    });

    it('says there is no group yet', () => {
        useMangaStore.setState({ groups: [] });
        render(<MangaGroupsPanel />);
        expect(screen.getByText('No group yet.')).toBeInTheDocument();
    });

    it('makes a group from the name typed, with the button and with Enter, and clears the field', async () => {
        const user = userEvent.setup();
        render(<MangaGroupsPanel />);
        const field = screen.getByLabelText('Name of the group');
        const create = screen.getByRole('button', { name: 'CREATE' });
        expect(create).toBeDisabled();
        await user.type(field, 'H-Mangas');
        await user.click(create);
        expect(mock.api.manga.createGroup).toHaveBeenCalledWith('H-Mangas');
        await vi.waitFor(() => {
            expect(field).toHaveValue('');
        });
        await user.type(field, 'Webtoons{Enter}');
        expect(mock.api.manga.createGroup).toHaveBeenLastCalledWith('Webtoons');
    });

    it('keeps the name typed and says why when the group is refused', async () => {
        const user = userEvent.setup();
        mock.api.manga.createGroup.mockResolvedValue({ ok: false, reason: 'taken' });
        render(<MangaGroupsPanel />);
        await user.type(screen.getByLabelText('Name of the group'), 'mangas');
        await user.click(screen.getByRole('button', { name: 'CREATE' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('There is a group with this name already.');
        expect(screen.getByLabelText('Name of the group')).toHaveValue('mangas');
        mock.api.manga.createGroup.mockResolvedValue({ ok: false, reason: 'invalid' });
        await user.click(screen.getByRole('button', { name: 'CREATE' }));
        await vi.waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent('Give a name of up to 60 characters.');
        });
    });

    it('cuts a name that is too long', async () => {
        const user = userEvent.setup();
        render(<MangaGroupsPanel />);
        await user.type(screen.getByLabelText('Name of the group'), 'x'.repeat(70));
        expect(screen.getByLabelText('Name of the group')).toHaveValue('x'.repeat(60));
    });

    it('renames a group', async () => {
        const user = userEvent.setup();
        render(<MangaGroupsPanel />);
        await user.click(screen.getByRole('button', { name: 'RENAME: Mangas' }));
        const row = screen.getAllByTestId('manga-group')[0]!;
        const field = within(row).getByLabelText('Name of the group');
        expect(field).toHaveValue('Mangas');
        await user.clear(field);
        await user.type(field, 'Shonen');
        await user.click(within(row).getByRole('button', { name: 'SAVE' }));
        expect(mock.api.manga.renameGroup).toHaveBeenCalledWith(1, 'Shonen');
        await vi.waitFor(() => {
            expect(screen.queryByRole('button', { name: 'SAVE' })).not.toBeInTheDocument();
        });
    });

    it('keeps the editing open and says why when the new name is refused, and can be called off', async () => {
        const user = userEvent.setup();
        mock.api.manga.renameGroup.mockResolvedValue({ ok: false, reason: 'taken' });
        render(<MangaGroupsPanel />);
        await user.click(screen.getByRole('button', { name: 'RENAME: Mangas' }));
        await user.click(screen.getByRole('button', { name: 'SAVE' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('There is a group with this name already.');
        expect(screen.getByRole('button', { name: 'SAVE' })).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'CANCEL' }));
        expect(screen.queryByRole('button', { name: 'SAVE' })).not.toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('asks before deleting a group, and says the mangas stay', async () => {
        const user = userEvent.setup();
        render(<MangaGroupsPanel />);
        await user.click(screen.getByRole('button', { name: 'DELETE: Manhwas' }));
        expect(mock.api.manga.deleteGroup).not.toHaveBeenCalled();
        await user.click(screen.getByRole('button', { name: 'DELETE THE GROUP? (THE MANGAS STAY): Manhwas' }));
        expect(mock.api.manga.deleteGroup).toHaveBeenCalledWith(2);
    });

    it('keeps the group when the deletion is called off', async () => {
        const user = userEvent.setup();
        render(<MangaGroupsPanel />);
        await user.click(screen.getByRole('button', { name: 'DELETE: Manhwas' }));
        await user.click(screen.getByRole('button', { name: 'KEEP' }));
        expect(mock.api.manga.deleteGroup).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'DELETE: Manhwas' })).toBeInTheDocument();
    });

    it('closes the question of a deletion when another group is renamed', async () => {
        const user = userEvent.setup();
        render(<MangaGroupsPanel />);
        await user.click(screen.getByRole('button', { name: 'DELETE: Manhwas' }));
        await user.click(screen.getByRole('button', { name: 'RENAME: Mangas' }));
        expect(screen.queryByRole('button', { name: 'KEEP' })).not.toBeInTheDocument();
    });
});
