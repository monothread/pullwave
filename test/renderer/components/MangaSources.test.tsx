// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { MangaSources, searchedSources, sourceLanguages } from '@renderer/components/MangaSources';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeSource } from '../../helpers/mangaFixtures';
import { installMockApi } from '../../helpers/mockApi';

const initialApp = useAppStore.getState();
const initialManga = useMangaStore.getState();

const SOURCES = [
    makeSource({ id: '1', name: 'Zeta Scans', lang: 'pt', supportsLatest: true }),
    makeSource({ id: '2', name: 'Alpha Scans', lang: 'en', supportsLatest: false, iconUrl: 'http://127.0.0.1:4321/api/v1/extension/icon/alpha' }),
    makeSource({ id: '3', name: 'Mixed Site', lang: 'all', supportsLatest: true }),
    makeSource({ id: '4', name: 'Beta Scans', lang: 'en', supportsLatest: true, contentWarning: 'NSFW' })
];

beforeEach(() => {
    installMockApi();
    window.localStorage.clear();
    useAppStore.setState({ ...initialApp, settings: { ...DEFAULT_SETTINGS, mangaShowAdult: true }, toasts: [] });
    useMangaStore.setState({ ...initialManga, browse: { ...initialManga.browse, sources: SOURCES, sourcesStatus: 'ready' } });
});

describe('sourceLanguages', () => {
    it('lists each language once, by code, with the sources of several languages last', () => {
        expect(sourceLanguages(SOURCES)).toEqual(['en', 'pt', 'all']);
        expect(sourceLanguages([])).toEqual([]);
    });
});

describe('searchedSources', () => {
    const LIST = [makeSource({ id: '1', name: 'Zeta Scans' }), makeSource({ id: '2', name: 'alpha scans' }), makeSource({ id: '3', name: 'Beta Reader' })];

    it('lists the sources by name, whatever the case', () => {
        expect(
            searchedSources(LIST, '').map((source) => {
                return source.name;
            })
        ).toEqual(['alpha scans', 'Beta Reader', 'Zeta Scans']);
    });

    it('keeps the sources that have the text in the name, ignoring case and the spaces around it', () => {
        expect(
            searchedSources(LIST, '  SCANS ').map((source) => {
                return source.name;
            })
        ).toEqual(['alpha scans', 'Zeta Scans']);
        expect(searchedSources(LIST, 'nothing')).toEqual([]);
    });

    it('does not change the list it was given', () => {
        const copy = [...LIST];
        searchedSources(LIST, '');
        expect(LIST).toEqual(copy);
    });
});

describe('MangaSources', () => {
    function groupNames(): Array<string | null | undefined> {
        return screen.getAllByTestId('manga-source-group').map((group) => {
            return group.querySelector('h3')?.textContent;
        });
    }

    it('groups the sources by language, the several-languages ones last', () => {
        render(<MangaSources />);
        expect(groupNames()).toEqual(['EN', 'PT', 'Several languages']);
        expect(screen.getByText('Sources: 4')).toBeInTheDocument();
    });

    it('lists the sources of a group by name, whatever order they come in', () => {
        useMangaStore.setState({
            browse: {
                ...useMangaStore.getState().browse,
                sources: [makeSource({ id: '1', name: 'Zeta Scans', lang: 'en' }), makeSource({ id: '2', name: 'beta site', lang: 'en' }), makeSource({ id: '3', name: 'Alpha Scans', lang: 'en' })]
            }
        });
        render(<MangaSources />);
        expect(
            screen.getAllByTestId('manga-source').map((row) => {
                return row.querySelector('.row-link__text')?.textContent;
            })
        ).toEqual(['Alpha Scans', 'beta site', 'Zeta Scans']);
    });

    it('filters the sources by what is typed in the search, and counts what is left', async () => {
        const user = userEvent.setup();
        render(<MangaSources />);
        await user.type(screen.getByLabelText('Search sources'), 'scans');
        expect(screen.getByText('Sources: 3')).toBeInTheDocument();
        expect(
            screen.getAllByTestId('manga-source').map((row) => {
                return row.querySelector('.row-link__text')?.textContent;
            })
        ).toEqual(['Alpha Scans', 'Beta Scans', 'Zeta Scans']);
        expect(groupNames()).toEqual(['EN', 'PT']);
        await user.clear(screen.getByLabelText('Search sources'));
        expect(screen.getByText('Sources: 4')).toBeInTheDocument();
    });

    it('says when no source has the name, and lists them again when the search is cleared', async () => {
        const user = userEvent.setup();
        render(<MangaSources />);
        expect(screen.queryByText('No source matches that name.')).not.toBeInTheDocument();
        await user.type(screen.getByLabelText('Search sources'), 'zzz');
        expect(screen.getByText('No source matches that name.')).toBeInTheDocument();
        expect(screen.getByText('Sources: 0')).toBeInTheDocument();
        expect(screen.queryAllByTestId('manga-source')).toHaveLength(0);
        await user.clear(screen.getByLabelText('Search sources'));
        expect(screen.queryByText('No source matches that name.')).not.toBeInTheDocument();
        expect(screen.getAllByTestId('manga-source')).toHaveLength(4);
    });

    it('searches inside the language that is chosen', async () => {
        const user = userEvent.setup();
        render(<MangaSources />);
        await user.selectOptions(screen.getByLabelText('Language'), 'pt');
        await user.type(screen.getByLabelText('Search sources'), 'scans');
        expect(
            screen.getAllByTestId('manga-source').map((row) => {
                return row.querySelector('.row-link__text')?.textContent;
            })
        ).toEqual(['Zeta Scans']);
    });

    it('lists the sources of a group in the order they come', () => {
        render(<MangaSources />);
        const english = screen.getAllByTestId('manga-source-group')[0]!;
        expect(
            within(english)
                .getAllByTestId('manga-source')
                .map((row) => {
                    return row.querySelector('.row-link__text')?.textContent;
                })
        ).toEqual(['Alpha Scans', 'Beta Scans']);
    });

    it('marks the sources that are for adults', () => {
        render(<MangaSources />);
        const rows = screen.getAllByTestId('manga-source');
        expect(within(rows.find((row) => {return row.textContent?.includes('Beta Scans')})!).getByText(/18\+/)).toBeInTheDocument();
        expect(within(rows.find((row) => {return row.textContent?.includes('Alpha Scans')})!).queryByText(/18\+/)).not.toBeInTheDocument();
    });

    it('says which store each source comes from, by its name, or by its address when the store is not known', () => {
        useMangaStore.setState({
            extensions: { ...useMangaStore.getState().extensions, stores: [{ indexUrl: 'https://store.example/index.min.json', name: 'My store' }] },
            browse: {
                ...useMangaStore.getState().browse,
                sources: [
                    makeSource({ id: '1', name: 'Zeta Scans', lang: 'pt', storeIndexUrl: 'https://store.example/index.min.json' }),
                    makeSource({ id: '2', name: 'Alpha Scans', lang: 'en', storeIndexUrl: 'https://other.example/index.min.json', contentWarning: 'NSFW' }),
                    makeSource({ id: '3', name: 'Mixed Site', lang: 'all', storeIndexUrl: null })
                ]
            }
        });
        render(<MangaSources />);
        const meta = (name: string): string | null | undefined => {
            return screen
                .getAllByTestId('manga-source')
                .find((row) => {
                    return row.textContent?.includes(name);
                })
                ?.querySelector('.history__meta')?.textContent;
        };
        expect(meta('Zeta Scans')).toBe('Store: My store');
        expect(meta('Alpha Scans')).toBe('Store: https://other.example/index.min.json · 18+');
        expect(meta('Mixed Site')).toBe('');
    });

    it('shows the icon a source has, and a plain block for one that has none or whose icon does not load', () => {
        render(<MangaSources />);
        const alpha = screen.getAllByTestId('manga-source').find((row) => {return row.textContent?.includes('Alpha Scans')})!;
        const icon = alpha.querySelector('img.manga__source-icon');
        expect(icon).toHaveAttribute('src', 'http://127.0.0.1:4321/api/v1/extension/icon/alpha');
        const zeta = screen.getAllByTestId('manga-source').find((row) => {return row.textContent?.includes('Zeta Scans')})!;
        expect(zeta.querySelector('img')).toBeNull();
        expect(zeta.querySelector('span.manga__source-icon--none')).not.toBeNull();
        fireEvent.error(icon!);
        expect(alpha.querySelector('img')).toBeNull();
        expect(alpha.querySelector('span.manga__source-icon--none')).not.toBeNull();
    });

    it('limits the list to a language', async () => {
        const user = userEvent.setup();
        render(<MangaSources />);
        expect(
            within(screen.getByLabelText('Language'))
                .getAllByRole('option')
                .map((option) => {
                    return [option.getAttribute('value'), option.textContent];
                })
        ).toEqual([
            ['all-languages', 'All languages'],
            ['en', 'EN'],
            ['pt', 'PT'],
            ['all', 'Several languages']
        ]);
        await user.selectOptions(screen.getByLabelText('Language'), 'pt');
        expect(groupNames()).toEqual(['PT']);
        expect(screen.getByText('Sources: 1')).toBeInTheDocument();
        await user.selectOptions(screen.getByLabelText('Language'), 'all');
        expect(groupNames()).toEqual(['Several languages']);
        await user.selectOptions(screen.getByLabelText('Language'), 'all-languages');
        expect(groupNames()).toHaveLength(3);
    });

    it('opens a source on its popular mangas from its button, and on the latest from the other', async () => {
        const user = userEvent.setup();
        render(<MangaSources />);
        await user.click(screen.getByRole('button', { name: 'POPULAR: Zeta Scans' }));
        expect(useMangaStore.getState().browse).toMatchObject({ sourceId: '1', mode: 'popular' });
        await user.click(screen.getByRole('button', { name: 'LATEST: Beta Scans' }));
        expect(useMangaStore.getState().browse).toMatchObject({ sourceId: '4', mode: 'latest' });
    });

    it('offers the latest only for a source that has them', () => {
        render(<MangaSources />);
        expect(screen.getByRole('button', { name: 'LATEST: Zeta Scans' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'LATEST: Alpha Scans' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'POPULAR: Alpha Scans' })).toBeInTheDocument();
    });

    it('opens a source on its popular mangas from its row', async () => {
        const user = userEvent.setup();
        render(<MangaSources />);
        await user.click(screen.getByRole('button', { name: 'Open: Mixed Site' }));
        expect(useMangaStore.getState().browse).toMatchObject({ sourceId: '3', mode: 'popular' });
    });

    it('hides the sources for adults by default, and the languages only they have', () => {
        useAppStore.setState({ settings: DEFAULT_SETTINGS });
        render(<MangaSources />);
        expect(screen.getByText('Sources: 3')).toBeInTheDocument();
        expect(screen.queryByText('Beta Scans')).not.toBeInTheDocument();
        expect(screen.queryByText(/18\+/)).not.toBeInTheDocument();
        expect(
            screen.getAllByTestId('manga-source').map((row) => {
                return row.querySelector('.row-link__text')?.textContent;
            })
        ).toEqual(['Alpha Scans', 'Zeta Scans', 'Mixed Site']);
    });

    it('lists everything when the language that was remembered has no source left', () => {
        useAppStore.setState({ settings: DEFAULT_SETTINGS });
        useMangaStore.setState({ browse: { ...useMangaStore.getState().browse, sourceLanguage: 'ja' } });
        render(<MangaSources />);
        expect(screen.getByLabelText('Language')).toHaveValue('all-languages');
        expect(screen.getByText('Sources: 3')).toBeInTheDocument();
    });

    it('remembers the language that was picked', async () => {
        const user = userEvent.setup();
        render(<MangaSources />);
        await user.selectOptions(screen.getByLabelText('Language'), 'pt');
        expect(JSON.parse(window.localStorage.getItem('pullwave.manga.ui') ?? '{}')).toMatchObject({ sourceLanguage: 'pt' });
    });
});
