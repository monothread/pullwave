// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { MangaExtensions } from '@renderer/components/MangaExtensions';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeChapterRecord, makeExtension, makeLibraryManga, makeMangaStatus, makeSource } from '../../helpers/mangaFixtures';
import { answerDialog, confirmDialog } from '../../helpers/confirmDialog';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';
import { seeEnd, stubIntersectionObserver, type ObservedEnd } from '../../helpers/intersectionObserver';
import { expectNotFound } from '../../helpers/notFound';

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
    useAppStore.setState({ ...initialApp, settings: { ...DEFAULT_SETTINGS, mangaShowAdult: true, mangaLanguage: 'all-languages' }, toasts: [] });
    useMangaStore.setState({ ...initialManga, extensions: { ...initialManga.extensions, filter: { query: '', onlyInstalled: false } } });
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
        expect(within(alert).getByRole('button')).toHaveAttribute('title', 'Click to see the technical error');
        expect(mock.api.manga.extensions).toHaveBeenCalledTimes(1);
    });

    it('filters by text and by what is installed', async () => {
        const user = userEvent.setup();
        render(<MangaExtensions />);
        await screen.findByText('Alpha');
        expect(screen.getByLabelText('Filter extensions')).toHaveAttribute('data-search-field', '');
        await user.type(screen.getByLabelText('Filter extensions'), 'ta');
        expect(names()).toEqual(['Beta', 'Delta']);
        await user.clear(screen.getByLabelText('Filter extensions'));
        await user.click(screen.getByRole('switch', { name: 'Installed only' }));
        expect(names()).toEqual(['Alpha', 'Beta']);
    });

    it('has no field to pick the language: it is a setting of the manga section', async () => {
        render(<MangaExtensions />);
        await screen.findByText('Alpha');
        expect(screen.queryByLabelText('Language')).not.toBeInTheDocument();
        expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    });

    it.each([
        ['en', ['Beta']],
        ['pt', ['Alpha']],
        ['ja', ['Delta']],
        ['all-languages', ['Alpha', 'Beta', 'Delta']]
    ])('lists the extensions of the language of the settings: %s', async (mangaLanguage, expected) => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, mangaShowAdult: false, mangaLanguage } });
        render(<MangaExtensions />);
        await screen.findByText(expected[0]!);
        expect(names()).toEqual(expected);
    });

    it('lists the extensions in the language of the computer when the settings are on automatic', async () => {
        vi.spyOn(navigator, 'language', 'get').mockReturnValue('pt-BR');
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, mangaShowAdult: false, mangaLanguage: '', language: 'en' } });
        render(<MangaExtensions />);
        await screen.findByText('Alpha');
        expect(names()).toEqual(['Alpha']);
        vi.restoreAllMocks();
    });

    it('falls back to English on automatic when no extension is in the language of the computer', async () => {
        vi.spyOn(navigator, 'language', 'get').mockReturnValue('fr-FR');
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, mangaShowAdult: false, mangaLanguage: '', language: 'en' } });
        render(<MangaExtensions />);
        await screen.findByText('Beta');
        expect(names()).toEqual(['Beta']);
        vi.restoreAllMocks();
    });

    it('says when no extension matches', async () => {
        const user = userEvent.setup();
        render(<MangaExtensions />);
        await screen.findByText('Alpha');
        await user.type(screen.getByLabelText('Filter extensions'), 'zzz');
        expect(screen.getByText('No extension found.')).toBeInTheDocument();
        expectNotFound(screen.getByText('No extension found.'), 'screen');
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
        expect(mock.api.manga.changeExtension).toHaveBeenCalledTimes(2);
        expect(within(confirmDialog('Uninstall "Beta"?')).getByText('The extension and its sources are removed from the app. You can install it again later.')).toBeInTheDocument();
        await answerDialog(user, 'Uninstall "Beta"?', 'UNINSTALL');
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
        expect(within(alert).getByRole('button')).toHaveAttribute('title', 'Click to see the technical error');
    });

    describe('with the choices the app starts from', () => {
        beforeEach(() => {
            window.localStorage.clear();
            useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, mangaLanguage: 'all-languages' } });
            useMangaStore.setState({ extensions: { ...initialManga.extensions, filter: { query: '', onlyInstalled: true } } });
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
            expect(screen.getByText('No extension is installed. Turn off "Installed only" to see the ones you can install.')).toHaveClass('empty');
            expect(screen.queryByTestId('not-found')).not.toBeInTheDocument();
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
            useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, mangaShowAdult: true, mangaLanguage: 'all-languages' } });
            expect(await screen.findByText('Gamma')).toBeInTheDocument();
        });

        it('remembers the switch, and nothing about the language', async () => {
            const user = userEvent.setup();
            render(<MangaExtensions />);
            await screen.findByText('Alpha');
            await user.click(screen.getByRole('switch', { name: 'Installed only' }));
            expect(JSON.parse(window.localStorage.getItem('pullwave.manga.ui') ?? '{}')).toEqual({ onlyInstalled: false });
        });

        it('lists everything when the language of the settings has no extension left', async () => {
            useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, mangaLanguage: 'zz' } });
            render(<MangaExtensions />);
            await screen.findByText('Alpha');
            expect(names()).toEqual(['Alpha', 'Beta']);
        });
    });
});

describe('MangaExtensions: the mangas of each extension in the library', () => {
    const SOURCES = [
        makeSource({ id: '1', name: 'Alpha', lang: 'pt', extensionPkg: 'a.pt' }),
        makeSource({ id: '2', name: 'Alpha', lang: 'en', extensionPkg: 'a.pt', contentWarning: 'NSFW' }),
        makeSource({ id: '3', name: 'Beta', lang: 'en', extensionPkg: 'b.en' })
    ];
    const ONE_PIECE = makeLibraryManga([makeChapterRecord({ id: 1, mangaId: 1, status: 'done' }), makeChapterRecord({ id: 2, mangaId: 1, remoteId: 12, status: 'idle' })], { id: 1, sourceId: '1', remoteId: 7, title: 'One Piece' });
    const BLEACH = makeLibraryManga([], { id: 2, sourceId: '2', remoteId: 8, title: 'Bleach', thumbnailUrl: null });
    const NARUTO = makeLibraryManga([], { id: 3, sourceId: '9', remoteId: 9, title: 'Naruto' });

    beforeEach(() => {
        mock.api.manga.sources.mockResolvedValue({ ok: true, value: SOURCES });
        useMangaStore.setState({ library: [ONE_PIECE, BLEACH, NARUTO], view: 'extensions' });
    });

    function rowOf(name: string): HTMLElement {
        const row = screen.getAllByTestId('manga-extension').find((candidate) => {
            return candidate.querySelector('.history__title')?.textContent === name;
        });
        if (row === undefined) {
            throw new Error(`No row for ${name}`);
        }
        return row;
    }

    async function openAlpha(): Promise<HTMLElement> {
        render(<MangaExtensions />);
        await screen.findByText('Alpha');
        const count = await screen.findByRole('button', { name: '2 manga(s) in the library: Alpha' });
        await userEvent.click(count);
        return screen.getByRole('dialog', { name: 'Manga of Alpha in the library' });
    }

    function cardTitles(dialog: HTMLElement): string[] {
        return within(dialog)
            .getAllByRole('heading', { level: 3 })
            .map((heading) => {
                return heading.textContent ?? '';
            });
    }

    it('reads the sources to know the extension of each manga', async () => {
        render(<MangaExtensions />);
        await screen.findByText('Alpha');
        await waitFor(() => {
            expect(mock.api.manga.sources).toHaveBeenCalledTimes(1);
        });
        expect(useMangaStore.getState().browse.sources).toEqual(SOURCES);
    });

    it.each([
        ['on', true],
        ['off', false]
    ])('reads the sources and the stores only once with the adult content %s and the server running', async (_label, showAdult) => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, mangaShowAdult: showAdult, mangaLanguage: 'all-languages' } });
        useMangaStore.setState({ status: makeMangaStatus() });
        render(<MangaExtensions />);
        await screen.findByText('Alpha');
        await screen.findByRole('button', { name: `${showAdult ? 2 : 1} manga(s) in the library: Alpha` });
        expect(mock.api.manga.sources).toHaveBeenCalledTimes(1);
        expect(mock.api.manga.stores).toHaveBeenCalledTimes(2);
    });

    it('does not read the sources when the library is empty, as every count would be 0', async () => {
        useMangaStore.setState({ library: [] });
        render(<MangaExtensions />);
        await screen.findByText('Alpha');
        expect(mock.api.manga.sources).not.toHaveBeenCalled();
        expect(mock.api.manga.stores).toHaveBeenCalledTimes(1);
        expect(within(rowOf('Alpha')).getByTestId('manga-extension-library-count')).toHaveTextContent('0');
    });

    it('shows on the left of INSTALLED how many mangas of the extension the library has, joining all its languages, and 0 disabled when none', async () => {
        render(<MangaExtensions />);
        await screen.findByText('Alpha');
        const alpha = await screen.findByRole('button', { name: '2 manga(s) in the library: Alpha' });
        expect(alpha).toHaveTextContent('2');
        expect(alpha).toBeEnabled();
        expect(alpha).toHaveAttribute('title', '2 manga(s) in the library');
        expect(alpha).toHaveClass('btn', 'btn--small');
        const installed = within(rowOf('Alpha')).getByText('INSTALLED');
        expect(alpha.nextElementSibling).toBe(installed);
        const beta = within(rowOf('Beta')).getByTestId('manga-extension-library-count');
        expect(beta).toHaveTextContent('0');
        expect(beta).toBeDisabled();
        expect(beta).toHaveAccessibleName('0 manga(s) in the library: Beta');
        expect(beta.nextElementSibling).toBe(within(rowOf('Beta')).getByText('INSTALLED'));
    });

    it('shows no count for an extension that is not installed', async () => {
        render(<MangaExtensions />);
        await screen.findByText('Alpha');
        expect(within(rowOf('Delta')).queryByTestId('manga-extension-library-count')).not.toBeInTheDocument();
        expect(within(rowOf('Gamma')).queryByTestId('manga-extension-library-count')).not.toBeInTheDocument();
        expect(screen.getAllByTestId('manga-extension-library-count')).toHaveLength(2);
    });

    it('does not count the mangas of a source hidden while the adult content is off', async () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, mangaShowAdult: false, mangaLanguage: 'all-languages' } });
        render(<MangaExtensions />);
        await screen.findByText('Alpha');
        const alpha = await screen.findByRole('button', { name: '1 manga(s) in the library: Alpha' });
        await userEvent.click(alpha);
        expect(cardTitles(screen.getByRole('dialog', { name: 'Manga of Alpha in the library' }))).toEqual(['One Piece']);
    });

    it('opens a window with the cards of the mangas of the extension, as in the library', async () => {
        const dialog = await openAlpha();
        expect(cardTitles(dialog)).toEqual(['One Piece', 'Bleach']);
        const [onePiece, bleach] = within(dialog).getAllByTestId('manga-entry');
        expect(within(onePiece!).getByText('1 of 2 downloaded')).toBeInTheDocument();
        expect(within(onePiece!).getByTestId('manga-source-name')).toHaveTextContent('Alpha · PT');
        expect(within(bleach!).getByText('0 of 0 downloaded')).toBeInTheDocument();
        expect(within(bleach!).getByTestId('manga-source-name')).toHaveTextContent('Alpha · EN');
        expect(within(dialog).queryByRole('button', { name: /^REMOVE/ })).not.toBeInTheDocument();
    });

    it('takes the user to the page of the manga in the library when its card is clicked, closing the window', async () => {
        mock.api.manga.details.mockResolvedValue({ ok: false, error: { code: 'REQUEST_FAILED', message: 'offline' } });
        const dialog = await openAlpha();
        await userEvent.click(within(dialog).getByRole('button', { name: 'Open: Bleach' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await waitFor(() => {
            expect(useMangaStore.getState().view).toBe('library');
        });
        expect(useMangaStore.getState().selectionFrom).toBe('library');
        expect(useMangaStore.getState().selection?.manga).toEqual({ remoteId: 8, sourceId: '2', title: 'Bleach', thumbnailUrl: null });
        expect(mock.api.manga.details.mock.calls).toEqual([[8]]);
    });

    it('closes the window with CLOSE, with Escape and with a click outside it, leaving the user on the extensions', async () => {
        await userEvent.click(within(await openAlpha()).getByRole('button', { name: 'CLOSE' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: '2 manga(s) in the library: Alpha' }));
        await userEvent.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: '2 manga(s) in the library: Alpha' }));
        const backdrop = screen.getByRole('dialog').parentElement!;
        fireEvent.mouseDown(backdrop);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(useMangaStore.getState().view).toBe('extensions');
        expect(mock.api.manga.details).not.toHaveBeenCalled();
    });
});

describe('MangaExtensions with a long catalog', () => {
    let observers: ObservedEnd[] = [];

    beforeEach(() => {
        observers = stubIntersectionObserver();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const CATALOG = Array.from({ length: 70 }, (_unused, index) => {
        const number = String(index + 1).padStart(2, '0');
        return makeExtension({ pkgName: `ext.${number}`, name: `Extension ${number}`, lang: 'en' });
    });

    function catalogNames(count: number): string[] {
        return CATALOG.slice(0, count).map((extension) => {
            return extension.name;
        });
    }

    it('draws the first 60 extensions, and the others when the end of the list comes into view', async () => {
        mock.api.manga.extensions.mockResolvedValue({ ok: true, value: CATALOG });
        render(<MangaExtensions />);
        expect(await screen.findByText('Extension 01')).toBeInTheDocument();
        expect(names()).toEqual(catalogNames(60));
        expect(screen.getByTestId('list-more').tagName).toBe('LI');
        seeEnd(observers);
        expect(names()).toEqual(catalogNames(70));
        expect(screen.queryByTestId('list-more')).not.toBeInTheDocument();
    });
});
