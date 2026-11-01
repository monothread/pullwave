import { useTranslator } from '../i18n/useTranslator';
import { LIBRARY_SORTS, type LibraryFilter, type LibrarySort } from '../spotlight/spotlightData';

interface LibraryControlsProps {
    // Whose library it is: the order by the last one seen is "watched" for the anime and "read" for the manga.
    kind: 'anime' | 'manga';
    filter: LibraryFilter;
    sort: LibrarySort;
    // How many titles each filter shows.
    allCount: number;
    newsCount: number;
    onFilter: (filter: LibraryFilter) => void;
    onSort: (sort: LibrarySort) => void;
}

const SORT_KEYS = {
    anime: { recent: 'library.sort.recent', last: 'library.sort.lastWatched', az: 'library.sort.az' },
    manga: { recent: 'library.sort.recent', last: 'library.sort.lastRead', az: 'library.sort.az' }
} as const;

// Over the grid of a library: the chips ALL and NEW (with what arrived in the last seven days) and the order of the cards.
export function LibraryControls({ kind, filter, sort, allCount, newsCount, onFilter, onSort }: LibraryControlsProps) {
    const t = useTranslator();
    return (
        <div className="library-controls">
            <div className="library-controls__chips" role="group" aria-label={t('library.filter.aria')}>
                <button
                    type="button"
                    className={`chip-toggle${filter === 'all' ? ' chip-toggle--on' : ''}`}
                    aria-pressed={filter === 'all'}
                    onClick={() => {
                        onFilter('all');
                    }}
                >
                    {t('library.filter.all', { count: allCount })}
                </button>
                <button
                    type="button"
                    className={`chip-toggle${filter === 'news' ? ' chip-toggle--on' : ''}`}
                    aria-pressed={filter === 'news'}
                    title={t('library.filter.newsHint')}
                    onClick={() => {
                        onFilter('news');
                    }}
                >
                    {t('library.filter.news', { count: newsCount })}
                </button>
            </div>
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
    );
}
