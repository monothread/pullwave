import { useId, useState } from 'react';
import { useTranslator } from '../i18n/useTranslator';
import { FieldShell } from './fields';
import { NotFound } from './NotFound';

interface MangaOptionComboProps {
    label: string;
    options: readonly string[];
    value: number;
    onChange: (index: number) => void;
}

export function MangaOptionCombo({ label, options, value, onChange }: MangaOptionComboProps) {
    const t = useTranslator();
    const listId = useId();
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
                        {matches.length === 0 && <li className="manga__picker-empty">
                                <NotFound text={t('manga.filters.noMatch')} size="tiny" />
                            </li>}
                        {matches.map((entry) => {
                            return (
                                <li key={`${entry.option}-${String(entry.index)}`} role="presentation">
                                    <button
                                        type="button"
                                        role="option"
                                        aria-selected={entry.index === value}
                                        className={`manga__picker-option${entry.index === value ? ' manga__picker-option--chosen' : ''}`}
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
