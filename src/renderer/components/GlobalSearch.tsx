import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { runSuggestion } from '../home/searchActions';
import { searchSuggestions, type SearchSuggestion } from '../home/searchData';
import { useTranslator } from '../i18n/useTranslator';
import { useAnimeStore } from '../store/animeStore';
import { useMangaStore } from '../store/mangaStore';
import { useShownLibrary } from '../hooks/useShownManga';

// What a line of the list says.
function useSuggestionText(): (suggestion: SearchSuggestion) => { text: string; tag: string | null } {
    const t = useTranslator();
    return (suggestion) => {
        switch (suggestion.kind) {
            case 'anime':
                return { text: suggestion.title, tag: t('search.kind.anime') };
            case 'manga':
                return { text: suggestion.title, tag: t('search.kind.manga') };
            case 'search-anime':
                return { text: t('search.anime', { query: suggestion.query }), tag: null };
            case 'search-manga':
                return { text: t('search.manga', { query: suggestion.query }), tag: null };
        }
    };
}

// The next line of the list in a direction, going round at the ends.
export function moveHighlight(current: number, step: 1 | -1, count: number): number {
    if (count === 0) {
        return -1;
    }
    return (current + step + count) % count;
}

// The search of the top bar: it finds the titles of the libraries as they are typed and offers to search the text in the anime and the
// manga sections. The arrows move through the list, Enter goes, Esc closes it.
export function GlobalSearch() {
    const t = useTranslator();
    const listId = useId();
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const [highlight, setHighlight] = useState(-1);
    const animeLibrary = useAnimeStore((state) => {
        return state.library;
    });
    const animeSupported = useAnimeStore((state) => {
        return state.status.supported;
    });
    const mangaLibrary = useShownLibrary();
    const mangaSupported = useMangaStore((state) => {
        return state.status.supported;
    });
    const describe = useSuggestionText();
    const suggestions = useMemo(() => {
        return searchSuggestions(query, animeLibrary, mangaLibrary, animeSupported, mangaSupported);
    }, [query, animeLibrary, mangaLibrary, animeSupported, mangaSupported]);
    const shown = open && suggestions.length > 0;

    const choose = (suggestion: SearchSuggestion): void => {
        runSuggestion(suggestion);
        setOpen(false);
        setQuery('');
        setHighlight(-1);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
            setHighlight(moveHighlight(highlight, event.key === 'ArrowDown' ? 1 : -1, suggestions.length));
            return;
        }
        if (event.key === 'Escape') {
            setOpen(false);
            setHighlight(-1);
            return;
        }
        if (event.key === 'Enter') {
            const chosen = suggestions[highlight] ?? suggestions[0];
            if (chosen !== undefined) {
                event.preventDefault();
                choose(chosen);
            }
        }
    };

    return (
        <div className="global-search">
            <span className="global-search__icon" aria-hidden="true">
                ⌕
            </span>
            <input
                className="input global-search__input"
                type="search"
                role="combobox"
                aria-label={t('search.label')}
                aria-expanded={shown}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={shown && highlight >= 0 ? `${listId}-${String(highlight)}` : undefined}
                placeholder={t('search.placeholder')}
                value={query}
                onChange={(event) => {
                    setQuery(event.target.value);
                    setOpen(true);
                    setHighlight(-1);
                }}
                onFocus={() => {
                    setOpen(true);
                }}
                onBlur={() => {
                    setOpen(false);
                }}
                onKeyDown={onKeyDown}
            />
            {shown && (
                <ul id={listId} className="global-search__list" role="listbox" aria-label={t('search.label')}>
                    {suggestions.map((suggestion, index) => {
                        const { text, tag } = describe(suggestion);
                        return (
                            <li
                                key={suggestion.key}
                                id={`${listId}-${String(index)}`}
                                role="option"
                                aria-selected={index === highlight}
                                className={`global-search__option global-search__option--${suggestion.kind}`}
                                onMouseDown={(event) => {
                                    event.preventDefault();
                                    choose(suggestion);
                                }}
                            >
                                <span className="global-search__text">{text}</span>
                                {tag !== null && <span className="badge global-search__tag">{tag}</span>}
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
