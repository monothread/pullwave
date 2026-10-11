import { useId, useState } from 'react';
import { useTranslator } from '../i18n/useTranslator';
import { FieldShell } from './fields';

interface MangaOptionComboProps {
    label: string;
    options: readonly string[];
    // The place of the option that is chosen.
    value: number;
    onChange: (index: number) => void;
}

// A field that lists its options when it is clicked and narrows the list as the user types, instead of a closed list: the option that is
// chosen is what the field shows, and picking another one is a click on it (or Enter on the first of the ones that match).
export function MangaOptionCombo({ label, options, value, onChange }: MangaOptionComboProps) {
    const t = useTranslator();
    const listId = useId();
    // What the user typed; null while they have not typed anything, when the field shows the option that is chosen.
    const [typed, setTyped] = useState<string | null>(null);
    const [open, setOpen] = useState(false);
    const needle = typed?.trim().toLowerCase() ?? '';
    const matches = options
        .map((option, index) => {
            return { option, index };
        })
        .filter((entry) => {
            return needle.length === 0 || entry.option.toLowerCase().includes(needle);
        });

    function pick(index: number): void {
        onChange(index);
        setTyped(null);
        setOpen(false);
    }

    return (
        <FieldShell label={label}>
            <div className="manga__picker-box">
                <input
                    className="input"
                    type="text"
                    role="combobox"
                    aria-label={label}
                    aria-expanded={open}
                    aria-controls={listId}
                    aria-autocomplete="list"
                    autoComplete="off"
                    value={typed ?? options[value] ?? ''}
                    onChange={(event) => {
                        setTyped(event.target.value);
                        setOpen(true);
                    }}
                    onFocus={(event) => {
                        // What is shown is selected, so typing replaces it.
                        event.target.select();
                        setOpen(true);
                    }}
                    onClick={() => {
                        setOpen(true);
                    }}
                    onBlur={() => {
                        setTyped(null);
                        setOpen(false);
                    }}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            const first = matches[0];
                            if (open && first !== undefined) {
                                pick(first.index);
                            }
                        } else if (event.key === 'Escape' && open) {
                            event.stopPropagation();
                            setTyped(null);
                            setOpen(false);
                        }
                    }}
                />
                {open && (
                    <ul id={listId} className="manga__picker-list" role="listbox" aria-label={label}>
                        {matches.length === 0 && <li className="manga__picker-empty">{t('manga.filters.noMatch')}</li>}
                        {matches.map((entry) => {
                            return (
                                <li key={`${entry.option}-${String(entry.index)}`} role="presentation">
                                    <button
                                        type="button"
                                        role="option"
                                        aria-selected={entry.index === value}
                                        className={`manga__picker-option${entry.index === value ? ' manga__picker-option--chosen' : ''}`}
                                        // The click is taken before the field loses the focus, which would close the list first.
                                        onMouseDown={(event) => {
                                            event.preventDefault();
                                        }}
                                        onClick={() => {
                                            pick(entry.index);
                                        }}
                                    >
                                        {entry.option}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </FieldShell>
    );
}
