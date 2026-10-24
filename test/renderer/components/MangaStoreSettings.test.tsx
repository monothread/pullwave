// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { MangaStoreSettings } from '@renderer/components/MangaStoreSettings';
import { STORE_PLACEHOLDER } from '@renderer/components/mangaText';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialManga = useMangaStore.getState();

const STORE = { indexUrl: 'https://store.example/index.min.json', name: 'My store' };

beforeEach(() => {
    mock = installMockApi();
    window.localStorage.clear();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS, toasts: [] });
    useMangaStore.setState({ ...initialManga });
    mock.api.manga.stores.mockResolvedValue({ ok: true, value: [STORE] });
    mock.api.manga.extensions.mockResolvedValue({ ok: true, value: [] });
});

describe('MangaStoreSettings', () => {
    it('reads the stores when it opens and lists each with its name and address', async () => {
        render(<MangaStoreSettings />);
        expect(await screen.findByText('My store')).toBeInTheDocument();
        expect(screen.getByText('Extension stores')).toBeInTheDocument();
        expect(screen.getByText(/A store is a list of extensions/)).toBeInTheDocument();
        expect(screen.getByText('https://store.example/index.min.json')).toBeInTheDocument();
        expect(mock.api.manga.stores).toHaveBeenCalledTimes(1);
    });

    it('says there is no store yet, and suggests none', async () => {
        mock.api.manga.stores.mockResolvedValue({ ok: true, value: [] });
        render(<MangaStoreSettings />);
        expect(await screen.findByText('No store yet. Add one in the manga SETTINGS to see its extensions.')).toBeInTheDocument();
        expect(screen.getByLabelText('Address of a store (index.min.json)')).toHaveAttribute('placeholder', STORE_PLACEHOLDER);
        expect(mock.api.manga.addStore).not.toHaveBeenCalled();
    });

    it('does not read the stores again when they were read already', () => {
        useMangaStore.setState({ extensions: { ...initialManga.extensions, status: 'ready', stores: [STORE] } });
        render(<MangaStoreSettings />);
        expect(screen.getByText('My store')).toBeInTheDocument();
        expect(mock.api.manga.stores).not.toHaveBeenCalled();
    });

    it('adds a store from the address typed, and clears the field', async () => {
        const user = userEvent.setup();
        render(<MangaStoreSettings />);
        await screen.findByText('My store');
        const field = screen.getByLabelText('Address of a store (index.min.json)');
        const add = screen.getByRole('button', { name: 'ADD' });
        expect(add).toBeDisabled();
        await user.type(field, '  https://other.example/index.min.json ');
        await user.click(add);
        expect(mock.api.manga.addStore).toHaveBeenCalledWith('https://other.example/index.min.json');
        await vi.waitFor(() => {
            expect(field).toHaveValue('');
        });
    });

    it('adds a store with the Enter key', async () => {
        const user = userEvent.setup();
        render(<MangaStoreSettings />);
        await screen.findByText('My store');
        await user.type(screen.getByLabelText('Address of a store (index.min.json)'), 'https://other.example/i.json{Enter}');
        expect(mock.api.manga.addStore).toHaveBeenCalledWith('https://other.example/i.json');
    });

    it('keeps the address typed when the store is refused, and shows why', async () => {
        const user = userEvent.setup();
        mock.api.manga.addStore.mockResolvedValue({ ok: false, error: { code: 'API_ERROR', message: 'bad index' } });
        render(<MangaStoreSettings />);
        await screen.findByText('My store');
        const field = screen.getByLabelText('Address of a store (index.min.json)');
        await user.type(field, 'https://bad.example/i.json');
        await user.click(screen.getByRole('button', { name: 'ADD' }));
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('The site or the extension reported an error.');
        expect(within(alert).getByRole('button')).toHaveAttribute('title', 'Click to copy the technical error');
        expect(field).toHaveValue('https://bad.example/i.json');
    });

    const TITLE = 'Remove the store "My store"?';
    const MESSAGE = 'The store leaves the list and its extensions are not offered any more. You can add its address again later.';

    it('asks before removing a store, naming it and saying what happens, with the focus on KEEP', async () => {
        const user = userEvent.setup();
        render(<MangaStoreSettings />);
        const row = (await screen.findByTestId('manga-store')) as HTMLElement;
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await user.click(within(row).getByRole('button', { name: 'REMOVE: My store' }));
        const dialog = screen.getByRole('dialog', { name: TITLE });
        expect(within(dialog).getByText(MESSAGE)).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: 'REMOVE' })).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: 'KEEP' })).toHaveFocus();
        expect(mock.api.manga.removeStore).not.toHaveBeenCalled();
    });

    it('removes the store only after it is confirmed, and closes the window', async () => {
        const user = userEvent.setup();
        render(<MangaStoreSettings />);
        const row = (await screen.findByTestId('manga-store')) as HTMLElement;
        await user.click(within(row).getByRole('button', { name: 'REMOVE: My store' }));
        await user.click(within(screen.getByRole('dialog', { name: TITLE })).getByRole('button', { name: 'REMOVE' }));
        expect(mock.api.manga.removeStore).toHaveBeenCalledTimes(1);
        expect(mock.api.manga.removeStore).toHaveBeenCalledWith(STORE.indexUrl);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('keeps the store when the user chooses KEEP, presses Esc or clicks outside the window', async () => {
        const user = userEvent.setup();
        render(<MangaStoreSettings />);
        const row = (await screen.findByTestId('manga-store')) as HTMLElement;
        await user.click(within(row).getByRole('button', { name: 'REMOVE: My store' }));
        await user.click(within(screen.getByRole('dialog', { name: TITLE })).getByRole('button', { name: 'KEEP' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await user.click(within(row).getByRole('button', { name: 'REMOVE: My store' }));
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await user.click(within(row).getByRole('button', { name: 'REMOVE: My store' }));
        fireEvent.mouseDown(document.querySelector('.modal-backdrop') as HTMLElement);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(mock.api.manga.removeStore).not.toHaveBeenCalled();
        expect(screen.getByText('My store')).toBeInTheDocument();
    });

    it('disables the button of a store while it is removed', async () => {
        const user = userEvent.setup();
        let finish: (value: unknown) => void = () => {return undefined};
        mock.api.manga.removeStore.mockReturnValue(
            new Promise((resolve) => {
                finish = resolve;
            })
        );
        render(<MangaStoreSettings />);
        await screen.findByText('My store');
        await user.click(screen.getByRole('button', { name: 'REMOVE: My store' }));
        await user.click(within(screen.getByRole('dialog', { name: TITLE })).getByRole('button', { name: 'REMOVE' }));
        expect(screen.getByRole('button', { name: 'REMOVE: My store' })).toBeDisabled();
        finish({ ok: true, value: null });
        await vi.waitFor(() => {
            expect(screen.getByRole('button', { name: 'REMOVE: My store' })).toBeEnabled();
        });
    });
});
