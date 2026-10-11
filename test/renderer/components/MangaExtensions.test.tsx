// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { MangaExtensions } from '@renderer/components/MangaExtensions';
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
    window.localStorage.clear();
    useAppStore.setState({ ...initialApp, settings: { ...DEFAULT_SETTINGS, mangaShowAdult: true }, toasts: [] });
    useMangaStore.setState({ ...initialManga, extensions: { ...initialManga.extensions, filter: { query: '', lang: 'all-languages', onlyInstalled: false } } });
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
        expect(await screen.findByText('Alpha')).toBeInTheDocument();
        expect(mock.api.manga.stores).toHaveBeenCalledTimes(1);
        expect(mock.api.manga.extensions).toHaveBeenCalledWith(false);
        expect(screen.queryByText('My store')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Address of a store (index.min.json)')).not.toBeInTheDocument();
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

    it('explains what extensions are and whose responsibility they are', async () => {
        render(<MangaExtensions />);
        await screen.findByText('Alpha');
        const about = screen.getByRole('region', { name: 'WHAT ARE EXTENSIONS?' });
        expect(within(about).getByText(/Extensions are small programs, made by the Mihon\/Tachiyomi community/)).toBeInTheDocument();
        expect(within(about).getByText(/you alone are responsible for installing them/)).toBeInTheDocument();
        expect(within(about).getByText(/The authors of Pullwave take no responsibility/)).toBeInTheDocument();
    });

    it('says there is no store yet, suggests none, and takes the user to the settings to add one', async () => {
        const user = userEvent.setup();
        mock.api.manga.stores.mockResolvedValue({ ok: true, value: [] });
        mock.api.manga.extensions.mockResolvedValue({ ok: true, value: [] });
        render(<MangaExtensions />);
        expect(await screen.findByText('No store yet. Add one in the manga SETTINGS to see its extensions.')).toBeInTheDocument();
        expect(screen.queryByLabelText('Filter extensions')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Address of a store (index.min.json)')).not.toBeInTheDocument();
        expect(mock.api.manga.addStore).not.toHaveBeenCalled();
        await user.click(screen.getByRole('button', { name: 'OPEN SETTINGS' }));
        expect(useMangaStore.getState().view).toBe('settings');
    });

    it('marks an extension the server cannot run, with the version it was made for, and offers no install for it', async () => {
        mock.api.manga.extensions.mockResolvedValue({
            ok: true,
            value: [
                makeExtension({ pkgName: 'old.en', name: 'Old', lang: 'en', extensionLib: '1.2', isCompatible: false }),
                makeExtension({ pkgName: 'ok.en', name: 'Fine', lang: 'en' })
            ]
        });
        render(<MangaExtensions />);
        await screen.findByText('Old');
        const old = screen.getAllByTestId('manga-extension').find((row) => {
            return row.textContent?.includes('Old');
        })!;
        const fine = screen.getAllByTestId('manga-extension').find((row) => {
            return row.textContent?.includes('Fine');
        })!;
        expect(within(old).getByText('INCOMPATIBLE')).toHaveAttribute('title', 'Made for version 1.2 of the extension library, which the server does not support.');
        expect(within(old).queryByRole('button', { name: 'INSTALL: Old' })).not.toBeInTheDocument();
        expect(within(fine).queryByText('INCOMPATIBLE')).not.toBeInTheDocument();
        expect(within(fine).getByRole('button', { name: 'INSTALL: Fine' })).toBeInTheDocument();
    });

    it('still offers to remove an installed extension that is no longer compatible', async () => {
        mock.api.manga.extensions.mockResolvedValue({ ok: true, value: [makeExtension({ pkgName: 'old.en', name: 'Old', isInstalled: true, extensionLib: '1.9', isCompatible: false })] });
        render(<MangaExtensions />);
        await screen.findByText('Old');
        expect(screen.getByText('INCOMPATIBLE')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'UNINSTALL: Old' })).toBeInTheDocument();
    });

    it('updates every extension that has an update with one button that counts them', async () => {
        const user = userEvent.setup();
        render(<MangaExtensions />);
        await screen.findByText('Alpha');
        mock.api.manga.updateAllExtensions.mockResolvedValue({ ok: true, value: 1 });
        await user.click(screen.getByRole('button', { name: 'UPDATE ALL (1)' }));
        expect(mock.api.manga.updateAllExtensions).toHaveBeenCalledTimes(1);
        await vi.waitFor(() => {
            expect(mock.api.manga.extensions).toHaveBeenCalledTimes(2);
        });
        expect(mock.api.manga.sources).toHaveBeenCalledTimes(1);
    });

    it('shows no button to update all when no installed extension has an update', async () => {
        mock.api.manga.extensions.mockResolvedValue({
            ok: true,
            value: [makeExtension({ pkgName: 'a', name: 'Alpha', isInstalled: true, hasUpdate: false }), makeExtension({ pkgName: 'b', name: 'Beta', isInstalled: false, hasUpdate: true })]
        });
        render(<MangaExtensions />);
        await screen.findByText('Alpha');
        expect(screen.queryByRole('button', { name: /UPDATE ALL/ })).not.toBeInTheDocument();
    });

    it('disables the button to update all while it works, and shows why it failed', async () => {
        const user = userEvent.setup();
        let finish: (value: unknown) => void = () => {return undefined};
        mock.api.manga.updateAllExtensions.mockReturnValue(
            new Promise((resolve) => {
                finish = resolve;
            })
        );
        render(<MangaExtensions />);
        await screen.findByText('Alpha');
        await user.click(screen.getByRole('button', { name: 'UPDATE ALL (1)' }));
        expect(screen.getByRole('button', { name: 'UPDATING…' })).toBeDisabled();
        finish({ ok: false, error: { code: 'API_ERROR', message: 'boom' } });
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveAttribute('title', 'boom');
        expect(mock.api.manga.extensions).toHaveBeenCalledTimes(1);
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
        await user.click(screen.getByRole('switch', { name: 'Installed only' }));
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

    describe('with the choices the app starts from', () => {
        beforeEach(() => {
            window.localStorage.clear();
            useAppStore.setState({ settings: DEFAULT_SETTINGS });
            useMangaStore.setState({ extensions: { ...initialManga.extensions, filter: { query: '', lang: 'all-languages', onlyInstalled: true } } });
        });

        it('lists only the installed extensions, with the switch on', async () => {
            render(<MangaExtensions />);
            await screen.findByText('Alpha');
            expect(screen.getByRole('switch', { name: 'Installed only' })).toBeChecked();
            expect(names()).toEqual(['Alpha', 'Beta']);
        });

        it('says that the switch is what hides the extensions to install when none is installed', async () => {
            mock.api.manga.extensions.mockResolvedValue({ ok: true, value: [makeExtension({ pkgName: 'd.ja', name: 'Delta', lang: 'ja' })] });
            const user = userEvent.setup();
            render(<MangaExtensions />);
            expect(await screen.findByText('No extension is installed. Turn off "Installed only" to see the ones you can install.')).toBeInTheDocument();
            expect(screen.queryByText('No extension found.')).not.toBeInTheDocument();
            await user.click(screen.getByRole('switch', { name: 'Installed only' }));
            expect(names()).toEqual(['Delta']);
        });

        it('says no extension was found, not that none is installed, when the text typed matches nothing', async () => {
            mock.api.manga.extensions.mockResolvedValue({ ok: true, value: [makeExtension({ pkgName: 'd.ja', name: 'Delta', lang: 'ja' })] });
            const user = userEvent.setup();
            render(<MangaExtensions />);
            await screen.findByText('No extension is installed. Turn off "Installed only" to see the ones you can install.');
            await user.type(screen.getByLabelText('Filter extensions'), 'zzz');
            expect(screen.getByText('No extension found.')).toBeInTheDocument();
        });

        it('says no extension was found when the store has nothing to install either', async () => {
            mock.api.manga.extensions.mockResolvedValue({ ok: true, value: [] });
            render(<MangaExtensions />);
            expect(await screen.findByText('No extension found.')).toBeInTheDocument();
        });

        it('hides the extensions for adults until they are asked for', async () => {
            const user = userEvent.setup();
            await user.click((render(<MangaExtensions />), await screen.findByRole('switch', { name: 'Installed only' })));
            expect(names()).toEqual(['Alpha', 'Beta', 'Delta']);
            expect(screen.queryByText('Gamma')).not.toBeInTheDocument();
            expect(within(screen.getByLabelText('Language')).getAllByRole('option').map((option) => {
                return option.textContent;
            })).toEqual(['All', 'en', 'ja', 'pt']);
            useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, mangaShowAdult: true } });
            expect(await screen.findByText('Gamma')).toBeInTheDocument();
        });

        it('remembers the language and the switch', async () => {
            const user = userEvent.setup();
            render(<MangaExtensions />);
            await screen.findByText('Alpha');
            await user.selectOptions(screen.getByLabelText('Language'), 'en');
            await user.click(screen.getByRole('switch', { name: 'Installed only' }));
            expect(JSON.parse(window.localStorage.getItem('pullwave.manga.ui') ?? '{}')).toEqual({ extensionLanguage: 'en', onlyInstalled: false, sourceLanguage: 'all-languages' });
        });

        it('lists everything when the language that was remembered has no extension left', async () => {
            useMangaStore.setState({ extensions: { ...initialManga.extensions, filter: { query: '', lang: 'zz', onlyInstalled: true } } });
            render(<MangaExtensions />);
            await screen.findByText('Alpha');
            expect(screen.getByLabelText('Language')).toHaveValue('all-languages');
            expect(names()).toEqual(['Alpha', 'Beta']);
        });
    });
});
