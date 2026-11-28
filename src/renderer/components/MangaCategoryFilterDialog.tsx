import { useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useModalDialog } from '../hooks/useModalDialog';
import { useTranslator } from '../i18n/useTranslator';
import { TextField } from './fields';
import { foldedGenreKey, foldedGenreKeySet, type LibraryGenreMode } from './mangaText';
import { NotFound } from './NotFound';

interface MangaCategoryFilterDialogProps {
    categories: readonly string[];
    selected: readonly string[];
    mode: LibraryGenreMode;
    emptyMessage: string;
    onApply: (genres: string[], mode: LibraryGenreMode) => void;
    onClose: () => void;
}

export function MangaCategoryFilterDialog({ categories, selected, mode, emptyMessage, onApply, onClose }: MangaCategoryFilterDialogProps) {
    const t = useTranslator();
    const titleId = useId();
    const applyButtonRef = useRef<HTMLButtonElement>(null);
    const { dialogRef, handleKeyDown } = useModalDialog(onClose, true);
    const [picked, setPicked] = useState<string[]>(() => {
        return [...selected];
    });
    const [matchMode, setMatchMode] = useState<LibraryGenreMode>(mode);
    const [query, setQuery] = useState('');

    const indexedCategories = useMemo(() => {
        return categories.map((label) => {
            return { label, key: foldedGenreKey(label) };
        });
    }, [categories]);

    const availableKeys = useMemo(() => {
        const keys = new Set<string>();
        indexedCategories.forEach((category) => {
            if (category.key.length > 0) {
                keys.add(category.key);
            }
        });
        return keys;
    }, [indexedCategories]);

    const validPicked = useMemo(() => {
        return picked.filter((item) => {
            return availableKeys.has(foldedGenreKey(item));
        });
    }, [picked, availableKeys]);

    const pickedKeys = useMemo(() => {
        return foldedGenreKeySet(validPicked);
    }, [validPicked]);

    const visible = useMemo(() => {
        const needle = foldedGenreKey(query);
        if (needle.length === 0) {
            return indexedCategories;
        }
        return indexedCategories.filter((category) => {
            return category.key.includes(needle);
        });
    }, [indexedCategories, query]);

    function toggle(label: string, key: string): void {
        setPicked((current) => {
            const next = current.filter((item) => {
                return foldedGenreKey(item) !== key;
            });
            return next.length === current.length ? [...current, label] : next;
        });
    }

    return createPortal(
        <div
            className="modal-backdrop"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                    onClose();
                }
            }}
        >
            <div ref={dialogRef} className="modal modal--categories" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={handleKeyDown}>
                <h2 id={titleId} className="modal__title">
                    {t('manga.library.categories.title')}
                </h2>
                <div className="manga__category-mode" role="group" aria-label={t('manga.library.categories.match')}>
                    <button
                        type="button"
                        className={`chip-toggle${matchMode === 'or' ? ' chip-toggle--on' : ''}`}
                        aria-pressed={matchMode === 'or'}
                        onClick={() => {
                            setMatchMode('or');
                        }}
                    >
                        {t('manga.library.categories.or')}
                    </button>
                    <button
                        type="button"
                        className={`chip-toggle${matchMode === 'and' ? ' chip-toggle--on' : ''}`}
                        aria-pressed={matchMode === 'and'}
                        onClick={() => {
                            setMatchMode('and');
                        }}
                    >
                        {t('manga.library.categories.and')}
                    </button>
                </div>
                {indexedCategories.length > 0 && (
                    <TextField
                        search
                        label={t('manga.library.categories.search')}
                        value={query}
                        placeholder={t('manga.library.categories.searchPlaceholder')}
                        onChange={setQuery}
                    />
                )}
                {indexedCategories.length === 0 ? (
                    <p className="empty">{emptyMessage}</p>
                ) : visible.length === 0 ? (
                    <NotFound text={t('manga.library.categories.noMatch')} size="tiny" />
                ) : (
                    <ul className="manga__tags manga__category-list" aria-label={t('manga.library.categories.list')}>
                        {visible.map((category) => {
                            const active = pickedKeys.has(category.key);
                            return (
                                <li key={category.label}>
                                    <button
                                        type="button"
                                        className={`manga__tag${active ? ' manga__tag--on' : ''}`}
                                        aria-pressed={active}
                                        onClick={() => {
                                            toggle(category.label, category.key);
                                        }}
                                    >
                                        {category.label}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
                <div className="modal__actions">
                    {validPicked.length > 0 && (
                        <button
                            type="button"
                            className="btn btn--small btn--ghost"
                            onClick={() => {
                                setPicked([]);
                                applyButtonRef.current?.focus();
                            }}
                        >
                            {t('manga.library.categories.clear')}
                        </button>
                    )}
                    <button
                        type="button"
                        className="btn btn--small btn--ghost"
                        onClick={() => {
                            onClose();
                        }}
                    >
                        {t('manga.library.categories.cancel')}
                    </button>
                    <button
                        ref={applyButtonRef}
                        type="button"
                        className="btn btn--small btn--primary"
                        onClick={() => {
                            onApply(validPicked, matchMode);
                        }}
                    >
                        {t('manga.library.categories.apply')}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}
