// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { MangaLanguageSetting, mangaLanguageOptions } from '@renderer/components/MangaLanguageSetting';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeSource } from '../../helpers/mangaFixtures';
import { installMockApi } from '../../helpers/mockApi';

const initialApp = useAppStore.getState();
const initialManga = useMangaStore.getState();

const SOURCES = [
    makeSource({ id: '1', name: 'Zeta Scans', lang: 'pt' }),
    makeSource({ id: '2', name: 'Alpha Scans', lang: 'en' }),
    makeSource({ id: '3', name: 'Mixed Site', lang: 'all' }),
    makeSource({ id: '4', name: 'Adults Only', lang: 'ja', contentWarning: 'NSFW' })
];

beforeEach(() => {
    installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS });
    useMangaStore.setState({ ...initialManga, browse: { ...initialManga.browse, sources: SOURCES, sourcesStatus: 'ready' } });
});

function options(): Array<[string | null, string | null]> {
    return within(screen.getByLabelText('Language of the sources'))
        .getAllByRole('option')
        .map((option) => {
            return [option.getAttribute('value'), option.textContent];
        });
}

describe('mangaLanguageOptions', () => {
    it('offers the computer, every language and the languages loaded, in that order', () => {
        expect(mangaLanguageOptions('', ['en', 'pt'])).toEqual(['', 'all-languages', 'en', 'pt']);
    });

    it('keeps the language that is saved even when its sources are not loaded', () => {
        expect(mangaLanguageOptions('ja', ['en', 'pt'])).toEqual(['', 'all-languages', 'en', 'pt', 'ja']);
    });

    it('does not repeat a language that is saved and loaded, nor the choices that are not languages', () => {
        expect(mangaLanguageOptions('pt', ['en', 'pt'])).toEqual(['', 'all-languages', 'en', 'pt']);
        expect(mangaLanguageOptions('', [])).toEqual(['', 'all-languages']);
        expect(mangaLanguageOptions('all-languages', ['en'])).toEqual(['', 'all-languages', 'en']);
    });
});

describe('MangaLanguageSetting', () => {
    it('is a field named after the language of the sources, with its hint', () => {
        render(<MangaLanguageSetting value="" onChange={vi.fn()} />);
        expect(screen.getByLabelText('Language of the sources')).toBeInTheDocument();
        expect(
            screen.getByText('The sources, the search, the extensions and the move of a manga to another source are limited to this language. Automatic uses the language of the computer, or English when there is no source in it.')
        ).toBeInTheDocument();
    });

    it('offers automatic, every language and the languages of the sources that are listed', () => {
        render(<MangaLanguageSetting value="" onChange={vi.fn()} />);
        expect(options()).toEqual([
            ['', 'Automatic (the language of the computer)'],
            ['all-languages', 'All languages'],
            ['en', 'EN'],
            ['pt', 'PT'],
            ['all', 'Several languages']
        ]);
    });

    it('offers the languages of the sources for adults when the user asked for them', () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, mangaShowAdult: true } });
        render(<MangaLanguageSetting value="" onChange={vi.fn()} />);
        expect(
            options().map((option) => {
                return option[0];
            })
        ).toEqual(['', 'all-languages', 'en', 'ja', 'pt', 'all']);
    });

    it('shows the value that is saved as the one chosen', () => {
        render(<MangaLanguageSetting value="pt" onChange={vi.fn()} />);
        expect(screen.getByLabelText('Language of the sources')).toHaveValue('pt');
    });

    it('shows automatic as chosen when nothing is saved', () => {
        render(<MangaLanguageSetting value="" onChange={vi.fn()} />);
        expect(screen.getByLabelText('Language of the sources')).toHaveValue('');
    });

    it('still offers the language that is saved while the sources are not loaded', () => {
        useMangaStore.setState({ browse: { ...initialManga.browse, sources: [], sourcesStatus: 'idle' } });
        render(<MangaLanguageSetting value="ja" onChange={vi.fn()} />);
        expect(options()).toEqual([
            ['', 'Automatic (the language of the computer)'],
            ['all-languages', 'All languages'],
            ['ja', 'JA']
        ]);
        expect(screen.getByLabelText('Language of the sources')).toHaveValue('ja');
    });

    it('tells what was chosen', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<MangaLanguageSetting value="" onChange={onChange} />);
        await user.selectOptions(screen.getByLabelText('Language of the sources'), 'pt');
        await user.selectOptions(screen.getByLabelText('Language of the sources'), 'all-languages');
        expect(onChange.mock.calls).toEqual([['pt'], ['all-languages']]);
    });

    it('speaks the language of the app', () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, language: 'pt' } });
        render(<MangaLanguageSetting value="" onChange={vi.fn()} />);
        expect(screen.getByLabelText('Idioma das fontes')).toBeInTheDocument();
        expect(
            within(screen.getByLabelText('Idioma das fontes'))
                .getAllByRole('option')
                .slice(0, 2)
                .map((option) => {
                    return option.textContent;
                })
        ).toEqual(['Automático (o idioma do computador)', 'Todos os idiomas']);
    });
});
