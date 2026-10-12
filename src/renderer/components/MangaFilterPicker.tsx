import { useId, useState } from 'react';
import type { MangaFilter, MangaTriState } from '@shared/manga';
import { useTranslator } from '../i18n/useTranslator';

export type PickableFilter = Extract<MangaFilter, { type: 'tristate' | 'checkbox' }>;

export const MAX_SUGGESTIONS = 30;

export function isPickable(filter: MangaFilter): filter is PickableFilter {
    return filter.type === 'tristate' || filter.type === 'checkbox';
}

function isChosen(filter: PickableFilter): boolean {
    return filter.type === 'checkbox' ? filter.value : filter.value !== 'ignore';
}

function chosenWith(filter: PickableFilter, state: MangaTriState): PickableFilter {
    return filter.type === 'checkbox' ? { ...filter, value: state === 'include' } : { ...filter, value: state };
}

// The options of a group of filters (genres, tags, artists... some sources have thousands) as a field to type in: the options that match
// what was typed are listed, one is picked with a click, and what was picked stays as a chip that can be turned into "without this" or
// removed.
export function MangaFilterPicker({ name, filters, onChange }: { name: string; filters: PickableFilter[]; onChange: (filters: PickableFilter[]) => void }) {
    const t = useTranslator();
    const listId = useId();
    const [text, setText] = useState('');
    const [focused, setFocused] = useState(false);
    const needle = text.trim().toLowerCase();
    const picked = filters
        .map((filter, position) => {
            return { filter, position };
        })
        .filter((entry) => {
            return isChosen(entry.filter);
        });
    const matches = filters
        .map((filter, position) => {
            return { filter, position };
        })
        .filter((entry) => {
            return !isChosen(entry.filter) && entry.filter.name.toLowerCase().includes(needle);
        });
    const suggestions = matches.slice(0, MAX_SUGGESTIONS);
    // The list opens with a click on the field, with everything that can be picked, and narrows as the user types.
    const showList = focused;

    function set(position: number, state: MangaTriState): void {
        onChange(
            filters.map((filter, index) => {
                return index === position ? chosenWith(filter, state) : filter;
            })
        );
    }

    return (
        <div className="manga__picker field">
            <label className="field__label" htmlFor={`${listId}-input`}>
                {name}
            </label>
            <div className="manga__picker-box">
                <input
                    id={`${listId}-input`}
                    className="input"
                    type="text"
                    role="combobox"
                    aria-expanded={showList}
                    aria-controls={listId}
                    aria-autocomplete="list"
                    autoComplete="off"
                    placeholder={t('manga.filters.search')}
                    value={text}
                    onChange={(event) => {
                        setText(event.target.value);
                        setFocused(true);
                    }}
                    onFocus={() => {
                        setFocused(true);
                    }}
                    onClick={() => {
                        setFocused(true);
                    }}
                    onBlur={() => {
                        setFocused(false);
                    }}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            const first = suggestions[0];
                            if (first !== undefined) {
                                set(first.position, 'include');
                                setText('');
                                setFocused(false);
                            }
                        }
                    }}
                />
                {showList && (
                    <ul id={listId} className="manga__picker-list" role="listbox" aria-label={name}>
                        {suggestions.length === 0 && <li className="manga__picker-empty">{t('manga.filters.noMatch')}</li>}
                        {suggestions.map((entry) => {
                            return (
                                <li key={entry.position} role="presentation">
                                    <button
                                        type="button"
                                        role="option"
                                        aria-selected={false}
                                        className="manga__picker-option"
                                        // The click is taken before the field loses the focus, which would close the list first.
                                        onMouseDown={(event) => {
                                            event.preventDefault();
                                        }}
                                        onClick={() => {
                                            set(entry.position, 'include');
                                            setText('');
                                            // The list closes with the pick (it opens again with the next letter).
                                            setFocused(false);
                                        }}
                                    >
                                        {entry.filter.name}
                                    </button>
                                </li>
                            );
                        })}
                        {matches.length > suggestions.length && <li className="manga__picker-empty">{t('manga.filters.more', { count: matches.length - suggestions.length })}</li>}
                    </ul>
                )}
            </div>
            {picked.length > 0 && (
                <ul className="manga__chips" aria-label={`${name}: ${t('manga.filters.chosen')}`}>
                    {picked.map((entry) => {
                        const excluded = entry.filter.type === 'tristate' && entry.filter.value === 'exclude';
                        return (
                            <li key={entry.position} className={`manga__chip${excluded ? ' manga__chip--exclude' : ''}`}>
                                {entry.filter.type === 'tristate' ? (
                                    <button
                                        type="button"
                                        className="manga__chip-state"
                                        aria-label={`${entry.filter.name}: ${t(excluded ? 'manga.filters.state.exclude' : 'manga.filters.state.include')}`}
                                        title={t(excluded ? 'manga.filters.state.exclude' : 'manga.filters.state.include')}
                                        onClick={() => {
                                            set(entry.position, excluded ? 'include' : 'exclude');
                                        }}
                                    >
                                        <span aria-hidden="true">{excluded ? '−' : '+'}</span> {entry.filter.name}
                                    </button>
                                ) : (
                                    <span className="manga__chip-label">{entry.filter.name}</span>
                                )}
                                <button
                                    type="button"
                                    className="manga__chip-remove"
                                    aria-label={`${t('manga.filters.remove')}: ${entry.filter.name}`}
                                    onClick={() => {
                                        set(entry.position, 'ignore');
                                    }}
                                >
                                    ×
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
