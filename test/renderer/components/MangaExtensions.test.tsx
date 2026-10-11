// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { MangaExtensions } from '@renderer/components/MangaExtensions';
import { STORE_PLACEHOLDER } from '@renderer/components/mangaText';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeExtension } from '../../helpers/mangaFixtures';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialManga = useMangaStore.getState();

const STORE = { indexUrl: 'https://store.example/index.min.json', name: 'My store' };
const EXTENSIONS = [
    makeExtension({ pkgName: 'a.pt', name: 'Alpha', lang: 'pt', isInstalled: true, hasUpdate: true }),
    makeExtension({ pkgName: 'b.en', name: 'Beta', lang: 'en', isInstalled: true }),
    makeExtension({ pkgName: 'c.en', name: 'Gamma', lang: 'en', contentWarning: 'NSFW', isObsolete: true }),
    makeExtension({ pkgName: 'd.ja', name: 'Delta', lang: 'ja' })
];

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS, toasts: [] });
    useMangaStore.setState({ ...initialManga });
    mock.api.manga.stores.mockResolvedValue({ ok: true, value: [STORE] });
    mock.api.manga.extensions.mockResolvedValue({ ok: true, value: EXTENSIONS });
});

function names(): Array<string | null | undefined> {
    return screen.queryAllByTestId('manga-extension').map((row) => {
        return row.querySelector('.history__title')?.textContent;
    });
}

describe('MangaExtensions', () => {
    it('reads the stores and the extensions when it opens', async () => {
        render(<MangaExtensions />);
        expect(await screen.findByText('My store')).toBeInTheDocument();
        expect(mock.api.manga.extensions).toHaveBeenCalledWith(false);
        expect(screen.getByText('https://store.example/index.min.json')).toBeInTheDocument();
        expect(screen.getByText(/Extensions are small programs/)).toBeInTheDocument();
    });

    it('lists the installed extensions first, then the others by name', async () => {
        render(<MangaExtensions />);
        await screen.findByText('Alpha');
        expect(names()).toEqual(['Alpha', 'Beta', 'Delta', 'Gamma']);
    });

    it('shows what each extension is: its language, version, install state, 18+ and obsolete', async () => {
        render(<MangaExtensions />);
        await screen.findByText('Alpha');
        const [alpha, , delta, gamma] = screen.getAllByTestId('manga-extension');
        expect(within(alpha!).getByText('pt · 1.4.2')).toBeInTheDocument();
        expect(within(alpha!).getByText('INSTALLED')).toHaveClass('badge--done');
        expect(within(delta!).queryByText('INSTALLED')).not.toBeInTheDocument();
        expect(within(gamma!).getByText('18+')).toBeInTheDocument();
        expect(within(gamma!).getByText('OBSOLETE')).toBeInTheDocument();
    });

    it('says there is no store yet, and suggests none: the user adds the stores', async () => {
        mock.api.manga.stores.mockResolvedValue({ ok: true, value: [] });
        mock.api.manga.extensions.mockResolvedValue({ ok: true, value: [] });
        render(<MangaExtensions />);
        expect(await screen.findByText('No store yet. Add one to see its extensions.')).toBeInTheDocument();
        expect(screen.queryByLabelText('Filter extensions')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /KEIYOUSHI/ })).not.toBeInTheDocument();
        expect(screen.getAllByRole('button').map((button) => {
            return button.textContent;
        })).not.toContain('ADD KEIYOUSHI');
        expect(screen.getByLabelText('Address of a store (index.min.json)')).toHaveAttribute('placeholder', STORE_PLACEHOLDER);
        expect(mock.api.manga.addStore).not.toHaveBeenCalled();
    });

    it('adds a store from the address typed, and clears the field', async () => {
        const user = userEvent.setup();
        render(<MangaExtensions />);
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

    it('keeps the address typed when the store is refused, and shows why', async () => {
        const user = userEvent.setup();
        mock.api.manga.addStore.mockResolvedValue({ ok: false, error: { code: 'API_ERROR', message: 'bad index' } });
        render(<MangaExtensions />);
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
        render(<MangaExtensions />);
        await screen.findByText('My store');
        await user.click(screen.getByRole('button', { name: 'REMOVE: My store' }));
        expect(mock.api.manga.removeStore).toHaveBeenCalledWith(STORE.indexUrl);
    });

    it('filters by text, language and what is installed', async () => {
        const user = userEvent.setup();
        render(<MangaExtensions />);
        await screen.findByText('Alpha');
        await user.type(screen.getByLabelText('Filter extensions'), 'ta');
        expect(names()).toEqual(['Beta', 'Delta']);
        await user.selectOptions(screen.getByLabelText('Language'), 'en');
        expect(names()).toEqual(['Beta']);
        await user.clear(screen.getByLabelText('Filter extensions'));
        await user.selectOptions(screen.getByLabelText('Language'), 'all-languages');
        await user.click(screen.getByRole('checkbox', { name: 'Installed only' }));
        expect(names()).toEqual(['Alpha', 'Beta']);
    });

    it('lists the languages of the extensions', async () => {
        render(<MangaExtensions />);
        await screen.findByText('Alpha');
        expect(
            within(screen.getByLabelText('Language'))
                .getAllByRole('option')
                .map((option) => {
                    return option.textContent;
                })
        ).toEqual(['All', 'en', 'ja', 'pt']);
    });

    it('says when no extension matches', async () => {
        const user = userEvent.setup();
        render(<MangaExtensions />);
        await screen.findByText('Alpha');
        await user.type(screen.getByLabelText('Filter extensions'), 'zzz');
        expect(screen.getByText('No extension found.')).toBeInTheDocument();
    });

    it('asks the stores for their lists again', async () => {
        const user = userEvent.setup();
        render(<MangaExtensions />);
        await screen.findByText('Alpha');
        await user.click(screen.getByRole('button', { name: 'REFRESH LIST' }));
        expect(mock.api.manga.extensions).toHaveBeenLastCalledWith(true);
    });

    it('installs, updates and uninstalls an extension with the buttons that fit its state', async () => {
        const user = userEvent.setup();
        render(<MangaExtensions />);
        await screen.findByText('Alpha');
        const [alpha, beta, delta] = screen.getAllByTestId('manga-extension');
        expect(within(alpha!).getByRole('button', { name: 'UPDATE: Alpha' })).toBeInTheDocument();
        expect(within(alpha!).getByRole('button', { name: 'UNINSTALL: Alpha' })).toBeInTheDocument();
        expect(within(alpha!).queryByRole('button', { name: 'INSTALL: Alpha' })).not.toBeInTheDocument();
        expect(within(beta!).queryByRole('button', { name: 'UPDATE: Beta' })).not.toBeInTheDocument();
        expect(within(delta!).queryByRole('button', { name: 'UNINSTALL: Delta' })).not.toBeInTheDocument();
        await user.click(within(delta!).getByRole('button', { name: 'INSTALL: Delta' }));
        await user.click(within(alpha!).getByRole('button', { name: 'UPDATE: Alpha' }));
        await user.click(within(beta!).getByRole('button', { name: 'UNINSTALL: Beta' }));
        expect(mock.api.manga.changeExtension.mock.calls).toEqual([
            ['d.ja', 'install'],
            ['a.pt', 'update'],
            ['b.en', 'uninstall']
        ]);
    });

    it('disables the buttons of an extension while it changes', async () => {
        const user = userEvent.setup();
        let finish: (value: unknown) => void = () => {return undefined};
        mock.api.manga.changeExtension.mockReturnValue(
            new Promise((resolve) => {
                finish = resolve;
            })
        );
        render(<MangaExtensions />);
        await screen.findByText('Alpha');
        const delta = screen.getAllByTestId('manga-extension')[2]!;
        await user.click(within(delta).getByRole('button', { name: 'INSTALL: Delta' }));
        expect(within(delta).getByRole('button', { name: 'INSTALL: Delta' })).toBeDisabled();
        expect(within(delta).getByRole('button', { name: 'INSTALL: Delta' })).toHaveTextContent('WORKING…');
        finish({ ok: true, value: null });
        await vi.waitFor(() => {
            expect(within(screen.getAllByTestId('manga-extension')[2]!).getByRole('button', { name: 'INSTALL: Delta' })).toBeEnabled();
        });
    });

    it('says while the extensions are loading, and shows why they could not be', async () => {
        let answer: (value: unknown) => void = () => {return undefined};
        mock.api.manga.extensions.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        render(<MangaExtensions />);
        expect(await screen.findByText('LOADING…')).toBeInTheDocument();
        answer({ ok: false, error: { code: 'REQUEST_FAILED', message: 'offline' } });
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('The request to the manga server failed.');
        expect(alert).toHaveAttribute('title', 'offline');
    });
});
