// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { GlobalSearch, moveHighlight } from '@renderer/components/GlobalSearch';
import { useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeAnime, makeEpisode, makeStatus } from '../../helpers/animeFixtures';
import { makeLibraryManga, makeMangaStatus } from '../../helpers/mangaFixtures';

const runSuggestion = vi.fn();
vi.mock('@renderer/home/searchActions', () => {
    return {
        runSuggestion: (suggestion: unknown) => {
            runSuggestion(suggestion);
        }
    };
});

const initialAnime = useAnimeStore.getState();
const initialManga = useMangaStore.getState();
const naruto = makeAnime([makeEpisode()], { id: 1, title: 'Naruto' });
const narutoManga = makeLibraryManga([], { id: 8, title: 'Naruto Gaiden' });

beforeEach(() => {
    runSuggestion.mockClear();
    useAppStore.setState({ settings: { ...useAppStore.getState().settings, language: 'en' } });
    useAnimeStore.setState({ library: [naruto], status: makeStatus() });
    useMangaStore.setState({ library: [narutoManga], status: makeMangaStatus() });
});

afterEach(() => {
    useAnimeStore.setState(initialAnime, true);
    useMangaStore.setState(initialManga, true);
});

function field(): HTMLInputElement {
    return screen.getByRole('combobox', { name: 'Search' });
}

function options(): string[] {
    return screen.getAllByRole('option').map((option) => {
        return option.textContent ?? '';
    });
}

describe('moveHighlight', () => {
    it.each([
        [-1, 1, 3, 0],
        [0, 1, 3, 1],
        [2, 1, 3, 0],
        [0, -1, 3, 2],
        [-1, -1, 3, 1],
        [0, 1, 0, -1]
    ] as Array<[number, 1 | -1, number, number]>)('from %d by %d in %d lines goes to %d', (current, step, count, expected) => {
        expect(moveHighlight(current, step, count)).toBe(expected);
    });
});

describe('GlobalSearch', () => {
    it('is a closed combobox with its placeholder', () => {
        render(<GlobalSearch />);
        expect(field()).toHaveAttribute('placeholder', 'Search anime, manga or your library…');
        expect(field()).toHaveAttribute('aria-expanded', 'false');
        expect(field()).toHaveAttribute('aria-autocomplete', 'list');
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('lists the titles of the libraries that match, then the searches of the text in the sections', () => {
        render(<GlobalSearch />);
        fireEvent.change(field(), { target: { value: 'naru' } });
        expect(field()).toHaveAttribute('aria-expanded', 'true');
        const list = screen.getByRole('listbox', { name: 'Search' });
        expect(field()).toHaveAttribute('aria-controls', list.id);
        expect(options()).toEqual(['NarutoANIME', 'Naruto GaidenMANGA', 'Search “naru” in anime', 'Search “naru” in manga']);
        expect(within(list).getAllByRole('option')[0]).toHaveClass('global-search__option', 'global-search__option--anime');
    });

    it('moves through the list with the arrows and goes with Enter, then empties and closes', () => {
        render(<GlobalSearch />);
        fireEvent.change(field(), { target: { value: 'naru' } });
        fireEvent.keyDown(field(), { key: 'ArrowDown' });
        fireEvent.keyDown(field(), { key: 'ArrowDown' });
        const second = screen.getAllByRole('option')[1] as HTMLElement;
        expect(second).toHaveAttribute('aria-selected', 'true');
        expect(field()).toHaveAttribute('aria-activedescendant', second.id);
        fireEvent.keyDown(field(), { key: 'ArrowUp' });
        expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
        fireEvent.keyDown(field(), { key: 'Enter' });
        expect(runSuggestion.mock.calls).toEqual([[{ kind: 'anime', key: 'anime-anime-1', title: 'Naruto', animeId: 1 }]]);
        expect(field()).toHaveValue('');
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('goes to the first line with Enter when none is highlighted', () => {
        render(<GlobalSearch />);
        fireEvent.change(field(), { target: { value: 'zzz' } });
        fireEvent.keyDown(field(), { key: 'Enter' });
        expect(runSuggestion.mock.calls).toEqual([[{ kind: 'search-anime', key: 'search-anime', query: 'zzz' }]]);
    });

    it('does nothing with Enter when there is no line', () => {
        render(<GlobalSearch />);
        fireEvent.keyDown(field(), { key: 'Enter' });
        expect(runSuggestion).not.toHaveBeenCalled();
    });

    it('goes to a line pressed with the mouse', () => {
        render(<GlobalSearch />);
        fireEvent.change(field(), { target: { value: 'gaiden' } });
        fireEvent.mouseDown(screen.getByRole('option', { name: /Naruto Gaiden/ }));
        expect(runSuggestion.mock.calls).toEqual([[{ kind: 'manga', key: 'manga-8', title: 'Naruto Gaiden', manga: narutoManga }]]);
    });

    it('closes with Esc and when it loses the focus, and opens again when it takes it', () => {
        render(<GlobalSearch />);
        fireEvent.change(field(), { target: { value: 'naru' } });
        fireEvent.keyDown(field(), { key: 'Escape' });
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        fireEvent.focus(field());
        expect(screen.getByRole('listbox')).toBeInTheDocument();
        fireEvent.blur(field());
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        fireEvent.keyDown(field(), { key: 'ArrowDown' });
        expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    });

    it('offers no search of a section that does not exist here', () => {
        useMangaStore.setState({ status: makeMangaStatus({ supported: false }) });
        render(<GlobalSearch />);
        fireEvent.change(field(), { target: { value: 'zzz' } });
        expect(options()).toEqual(['Search “zzz” in anime']);
    });
});
