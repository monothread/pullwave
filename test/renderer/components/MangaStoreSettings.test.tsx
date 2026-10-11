// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
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
        expect(alert).toHaveAttribute('title', 'bad index');
        expect(field).toHaveValue('https://bad.example/i.json');
    });

    it('removes a store', async () => {
        const user = userEvent.setup();
        render(<MangaStoreSettings />);
        const row = (await screen.findByTestId('manga-store')) as HTMLElement;
        await user.click(within(row).getByRole('button', { name: 'REMOVE: My store' }));
        expect(mock.api.manga.removeStore).toHaveBeenCalledWith(STORE.indexUrl);
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
        expect(screen.getByRole('button', { name: 'REMOVE: My store' })).toBeDisabled();
        finish({ ok: true, value: null });
        await vi.waitFor(() => {
            expect(screen.getByRole('button', { name: 'REMOVE: My store' })).toBeEnabled();
        });
    });
});
