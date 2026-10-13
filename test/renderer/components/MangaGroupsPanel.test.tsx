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
    useMangaStore.setState({ ...initialManga, groups: GROUPS, hiddenGroupIds: [] });
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

    describe('the order of the groups', () => {
        const THREE = [{ id: 1, name: 'Mangas' }, { id: 2, name: 'Manhwas' }, { id: 3, name: 'Webtoons' }];

        beforeEach(() => {
            useMangaStore.setState({ groups: THREE });
        });

        it('has an arrow up and an arrow down in every group, with the name of the group', () => {
            render(<MangaGroupsPanel />);
            THREE.forEach((group) => {
                const up = screen.getByRole('button', { name: `Move up (towards the left tab): ${group.name}` });
                const down = screen.getByRole('button', { name: `Move down (towards the right tab): ${group.name}` });
                expect(up).toHaveTextContent('↑');
                expect(down).toHaveTextContent('↓');
                expect(up).toHaveAttribute('title', 'Move up (towards the left tab)');
                expect(down).toHaveAttribute('title', 'Move down (towards the right tab)');
            });
        });

        it('cannot move the first group up, nor the last one down', () => {
            render(<MangaGroupsPanel />);
            expect(screen.getByRole('button', { name: 'Move up (towards the left tab): Mangas' })).toBeDisabled();
            expect(screen.getByRole('button', { name: 'Move down (towards the right tab): Mangas' })).toBeEnabled();
            expect(screen.getByRole('button', { name: 'Move up (towards the left tab): Manhwas' })).toBeEnabled();
            expect(screen.getByRole('button', { name: 'Move down (towards the right tab): Manhwas' })).toBeEnabled();
            expect(screen.getByRole('button', { name: 'Move up (towards the left tab): Webtoons' })).toBeEnabled();
            expect(screen.getByRole('button', { name: 'Move down (towards the right tab): Webtoons' })).toBeDisabled();
        });

        it('cannot move a single group anywhere', () => {
            useMangaStore.setState({ groups: [THREE[0]!] });
            render(<MangaGroupsPanel />);
            expect(screen.getByRole('button', { name: 'Move up (towards the left tab): Mangas' })).toBeDisabled();
            expect(screen.getByRole('button', { name: 'Move down (towards the right tab): Mangas' })).toBeDisabled();
        });

        it('moves the group up and down with the arrows, asking the app with its id and the direction', async () => {
            const user = userEvent.setup();
            render(<MangaGroupsPanel />);
            await user.click(screen.getByRole('button', { name: 'Move up (towards the left tab): Webtoons' }));
            expect(mock.api.manga.moveGroup).toHaveBeenCalledTimes(1);
            expect(mock.api.manga.moveGroup).toHaveBeenLastCalledWith(3, 'up');
            await user.click(screen.getByRole('button', { name: 'Move down (towards the right tab): Mangas' }));
            expect(mock.api.manga.moveGroup).toHaveBeenCalledTimes(2);
            expect(mock.api.manga.moveGroup).toHaveBeenLastCalledWith(1, 'down');
        });

        it('shows the groups in the new order once the app says it', async () => {
            const user = userEvent.setup();
            mock.api.manga.groups.mockResolvedValue([THREE[0]!, THREE[2]!, THREE[1]!]);
            render(<MangaGroupsPanel />);
            await user.click(screen.getByRole('button', { name: 'Move down (towards the right tab): Manhwas' }));
            await vi.waitFor(() => {
                expect(
                    screen.getAllByTestId('manga-group').map((row) => {
                        return row.querySelector('.history__title')?.textContent;
                    })
                ).toEqual(['Mangas', 'Webtoons', 'Manhwas']);
            });
            expect(screen.getByRole('button', { name: 'Move down (towards the right tab): Manhwas' })).toBeDisabled();
            expect(screen.getByRole('button', { name: 'Move up (towards the left tab): Webtoons' })).toBeEnabled();
        });

        it('does not show the arrows while a group is being renamed', async () => {
            const user = userEvent.setup();
            render(<MangaGroupsPanel />);
            await user.click(screen.getByRole('button', { name: 'RENAME: Manhwas' }));
            expect(screen.queryByRole('button', { name: /Move up .*: Manhwas/ })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: /Move down .*: Manhwas/ })).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Move up (towards the left tab): Webtoons' })).toBeEnabled();
        });

        it('lets a group that is hidden be moved too', async () => {
            const user = userEvent.setup();
            useMangaStore.setState({ hiddenGroupIds: [2] });
            render(<MangaGroupsPanel />);
            await user.click(screen.getByRole('button', { name: 'Move up (towards the left tab): Manhwas' }));
            expect(mock.api.manga.moveGroup).toHaveBeenCalledWith(2, 'up');
        });
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

    it('asks in a window before deleting a group, and says the mangas stay', async () => {
        const user = userEvent.setup();
        render(<MangaGroupsPanel />);
        await user.click(screen.getByRole('button', { name: 'DELETE: Manhwas' }));
        expect(mock.api.manga.deleteGroup).not.toHaveBeenCalled();
        const dialog = screen.getByRole('dialog', { name: 'Delete the group "Manhwas"?' });
        expect(dialog).toHaveTextContent('Only the group goes. The mangas in it stay in the library.');
        await user.click(within(dialog).getByRole('button', { name: 'DELETE' }));
        expect(mock.api.manga.deleteGroup).toHaveBeenCalledTimes(1);
        expect(mock.api.manga.deleteGroup).toHaveBeenCalledWith(2);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('keeps the group when the deletion is called off', async () => {
        const user = userEvent.setup();
        render(<MangaGroupsPanel />);
        await user.click(screen.getByRole('button', { name: 'DELETE: Manhwas' }));
        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'KEEP' }));
        expect(mock.api.manga.deleteGroup).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'DELETE: Manhwas' })).toBeInTheDocument();
    });
});

describe('MangaGroupsPanel hiding a group', () => {
    function row(name: string): HTMLElement {
        return screen.getAllByTestId('manga-group').find((item) => {
            return item.querySelector('.history__title')?.textContent === name;
        })!;
    }

    it('hides a group with HIDE, which then says it is hidden and offers SHOW', async () => {
        const user = userEvent.setup();
        render(<MangaGroupsPanel />);
        expect(within(row('Manhwas')).queryByText('HIDDEN')).not.toBeInTheDocument();
        const hide = screen.getByRole('button', { name: 'HIDE: Manhwas' });
        expect(hide).toHaveAttribute('aria-pressed', 'false');
        await user.click(hide);
        expect(useMangaStore.getState().hiddenGroupIds).toEqual([2]);
        expect(within(row('Manhwas')).getByText('HIDDEN')).toHaveClass('badge');
        expect(screen.getByRole('button', { name: 'SHOW: Manhwas' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.queryByRole('button', { name: 'HIDE: Manhwas' })).not.toBeInTheDocument();
        expect(within(row('Mangas')).queryByText('HIDDEN')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'HIDE: Mangas' })).toBeInTheDocument();
    });

    it('shows the group again with SHOW', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ hiddenGroupIds: [1, 2] });
        render(<MangaGroupsPanel />);
        await user.click(screen.getByRole('button', { name: 'SHOW: Mangas' }));
        expect(useMangaStore.getState().hiddenGroupIds).toEqual([2]);
        expect(screen.getByRole('button', { name: 'HIDE: Mangas' })).toBeInTheDocument();
        expect(within(row('Manhwas')).getByText('HIDDEN')).toBeInTheDocument();
    });

    it('does not touch the group on the server', async () => {
        const user = userEvent.setup();
        render(<MangaGroupsPanel />);
        await user.click(screen.getByRole('button', { name: 'HIDE: Mangas' }));
        expect(mock.api.manga.deleteGroup).not.toHaveBeenCalled();
        expect(mock.api.manga.renameGroup).not.toHaveBeenCalled();
        expect(mock.api.manga.setGroupMembers).not.toHaveBeenCalled();
    });
});

