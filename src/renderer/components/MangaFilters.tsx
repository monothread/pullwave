import type { MangaFilter, MangaTriState } from '@shared/manga';
import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';
import { FieldShell, TextField } from './fields';
import { isPickable, MangaFilterPicker, type PickableFilter } from './MangaFilterPicker';

const NEXT_STATE: Record<MangaTriState, MangaTriState> = { ignore: 'include', include: 'exclude', exclude: 'ignore' };
const SYMBOL: Record<MangaTriState, string> = { ignore: '·', include: '+', exclude: '−' };

interface FilterListProps {
    filters: MangaFilter[];
    onChange: (filters: MangaFilter[]) => void;
}

function replaceAt(filters: MangaFilter[], position: number, filter: MangaFilter): MangaFilter[] {
    return filters.map((current, index) => {
        return index === position ? filter : current;
    });
}

function FilterItem({ filter, onChange }: { filter: MangaFilter; onChange: (filter: MangaFilter) => void }) {
    const t = useTranslator();
    switch (filter.type) {
        case 'header':
            return <span className="section-label manga__filter-header">{filter.name}</span>;
        case 'separator':
            return <hr className="manga__filter-separator" />;
        case 'text':
            return (
                <TextField
                    label={filter.name}
                    value={filter.value}
                    onChange={(value) => {
                        onChange({ ...filter, value });
                    }}
                />
            );
        case 'checkbox':
            return (
                <label className="toggle">
                    <input
                        type="checkbox"
                        checked={filter.value}
                        aria-label={filter.name}
                        onChange={(event) => {
                            onChange({ ...filter, value: event.target.checked });
                        }}
                    />
                    <span>{filter.name}</span>
                </label>
            );
        case 'tristate':
            return (
                <button
                    type="button"
                    role="checkbox"
                    aria-checked={filter.value === 'ignore' ? false : filter.value === 'include' ? true : 'mixed'}
                    aria-label={filter.name}
                    title={t(`manga.filters.state.${filter.value}`)}
                    className={`btn btn--small manga__tri manga__tri--${filter.value}`}
                    onClick={() => {
                        onChange({ ...filter, value: NEXT_STATE[filter.value] });
                    }}
                >
                    <span aria-hidden="true">{SYMBOL[filter.value]}</span> {filter.name}
                </button>
            );
        case 'select':
            return (
                <FieldShell label={filter.name}>
                    <select
                        className="input"
                        aria-label={filter.name}
                        value={filter.value}
                        onChange={(event) => {
                            onChange({ ...filter, value: Number(event.target.value) });
                        }}
                    >
                        {filter.options.map((option, index) => {
                            return (
                                <option key={`${option}-${String(index)}`} value={index}>
                                    {option}
                                </option>
                            );
                        })}
                    </select>
                </FieldShell>
            );
        case 'sort':
            return (
                <FieldShell label={filter.name}>
                    <div className="field-row">
                        <select
                            className="input"
                            aria-label={filter.name}
                            value={filter.value.index}
                            onChange={(event) => {
                                onChange({ ...filter, value: { ...filter.value, index: Number(event.target.value) } });
                            }}
                        >
                            {filter.options.map((option, index) => {
                                return (
                                    <option key={`${option}-${String(index)}`} value={index}>
                                        {option}
                                    </option>
                                );
                            })}
                        </select>
                        <button
                            type="button"
                            className="btn btn--small"
                            aria-label={`${filter.name}: ${t(filter.value.ascending ? 'manga.filters.ascending' : 'manga.filters.descending')}`}
                            onClick={() => {
                                onChange({ ...filter, value: { ...filter.value, ascending: !filter.value.ascending } });
                            }}
                        >
                            {filter.value.ascending ? '↑' : '↓'}
                        </button>
                    </div>
                </FieldShell>
            );
        case 'group':
            // The options of a group (genres, tags, artists...) are picked by typing, not ticked in a list of thousands.
            if (filter.filters.length > 0 && filter.filters.every(isPickable)) {
                return (
                    <MangaFilterPicker
                        name={filter.name}
                        filters={filter.filters as PickableFilter[]}
                        onChange={(filters) => {
                            onChange({ ...filter, filters });
                        }}
                    />
                );
            }
            return (
                <details className="manga__filter-group">
                    <summary>{filter.name}</summary>
                    <FilterList
                        filters={filter.filters}
                        onChange={(filters) => {
                            onChange({ ...filter, filters });
                        }}
                    />
                </details>
            );
    }
}

function FilterList({ filters, onChange }: FilterListProps) {
    return (
        <div className="manga__filter-list">
            {filters.map((filter, position) => {
                return (
                    <FilterItem
                        key={`${filter.type}-${filter.name}-${String(position)}`}
                        filter={filter}
                        onChange={(next) => {
                            onChange(replaceAt(filters, position, next));
                        }}
                    />
                );
            })}
        </div>
    );
}

// The filters a source offers for its search (genres, tags, status, order...), the way the WebUI of Suwayomi shows them: the user sets
// them and applies them with the search.
export function MangaFilters({ onApply }: { onApply: () => void }) {
    const t = useTranslator();
    const filters = useMangaStore((state) => {
        return state.browse.filters;
    });
    const status = useMangaStore((state) => {
        return state.browse.filtersStatus;
    });
    const open = useMangaStore((state) => {
        return state.browse.filtersOpen;
    });
    const setFilters = useMangaStore((state) => {
        return state.setFilters;
    });
    const resetFilters = useMangaStore((state) => {
        return state.resetFilters;
    });
    const toggleFilters = useMangaStore((state) => {
        return state.toggleFilters;
    });
    if (status === 'ready' && filters.length === 0) {
        return null;
    }
    return (
        <section className="manga__filters" aria-label={t('manga.filters.title')}>
            <div>
                <button type="button" className="btn btn--small" aria-expanded={open} onClick={toggleFilters}>
                    {open ? t('manga.filters.hide') : t('manga.filters.show')}
                </button>
            </div>
            {open && status === 'loading' && <p className="empty">{t('manga.filters.loading')}</p>}
            {open && status === 'error' && (
                <p className="field__warning" role="alert">
                    {t('manga.filters.error')}
                </p>
            )}
            {open && status === 'ready' && (
                <div className="panel">
                    <FilterList filters={filters} onChange={setFilters} />
                    <div className="job__actions">
                        <button type="button" className="btn btn--primary" onClick={onApply}>
                            {t('manga.filters.apply')}
                        </button>
                        <button type="button" className="btn" onClick={resetFilters}>
                            {t('manga.filters.reset')}
                        </button>
                    </div>
                </div>
            )}
        </section>
    );
}
