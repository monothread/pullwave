import type { ReactNode } from 'react';
import type { MessageKey } from '@shared/i18n';
import { useTranslator } from '../i18n/useTranslator';
import { LIBRARY_SORTS, type LibraryFilter, type LibrarySort } from '../spotlight/spotlightData';

interface LibraryControlsProps {
    kind: 'anime' | 'manga';
    filter: LibraryFilter;
    sort: LibrarySort;
    allCount: number;
    newsCount: number;
    completeCount?: number;
    ongoingCount?: number;
    beforeSort?: ReactNode;
    onFilter: (filter: LibraryFilter) => void;
    onSort: (sort: LibrarySort) => void;
}

const SORT_KEYS = {
    anime: { recent: 'library.sort.recent', last: 'library.sort.lastWatched', arrival: 'library.sort.lastEpisode', az: 'library.sort.az', za: 'library.sort.za' },
    manga: { recent: 'library.sort.recent', last: 'library.sort.lastRead', arrival: 'library.sort.lastChapter', az: 'library.sort.az', za: 'library.sort.za' }
} as const;

interface FilterChipProps {
    filter: LibraryFilter;
    current: LibraryFilter;
    count: number;
    label: MessageKey;
    hint?: MessageKey;
    onFilter: (filter: LibraryFilter) => void;
}

function FilterChip({ filter, current, count, label, hint, onFilter }: FilterChipProps) {
    const t = useTranslator();
    return (
        <button
            type="button"
            className={`chip-toggle${current === filter ? ' chip-toggle--on' : ''}`}
            aria-pressed={current === filter}
            title={hint === undefined ? undefined : t(hint)}
            onClick={() => {
                onFilter(filter);
            }}
        >
            {t(label, { count })}
        </button>
    );
}

export function LibraryControls({ kind, filter, sort, allCount, newsCount, completeCount, ongoingCount, beforeSort, onFilter, onSort }: LibraryControlsProps) {
    const t = useTranslator();
    return (
        <div className="library-controls">
            <div className="library-controls__chips" role="group" aria-label={t('library.filter.aria')}>
                <FilterChip filter="all" current={filter} count={allCount} label="library.filter.all" onFilter={onFilter} />
                <FilterChip filter="news" current={filter} count={newsCount} label="library.filter.news" hint="library.filter.newsHint" onFilter={onFilter} />
                {completeCount !== undefined && ongoingCount !== undefined && (
                    <>
                        <FilterChip filter="ongoing" current={filter} count={ongoingCount} label="library.filter.ongoing" hint="library.filter.ongoingHint" onFilter={onFilter} />
                        <FilterChip filter="complete" current={filter} count={completeCount} label="library.filter.complete" hint="library.filter.completeHint" onFilter={onFilter} />
                    </>
                )}
            </div>
            <div className="library-controls__end">
                {beforeSort}
                <label className="library-controls__sort">
                    <span className="field__label">{t('library.sort')}</span>
                    <select
                        className="input"
                        value={sort}
                        onChange={(event) => {
                            onSort(event.target.value as LibrarySort);
                        }}
                    >
                        {LIBRARY_SORTS.map((option) => {
                            return (
                                <option key={option} value={option}>
                                    {t(SORT_KEYS[kind][option])}
                                </option>
                            );
                        })}
                    </select>
                </label>
            </div>
        </div>
    );
}
