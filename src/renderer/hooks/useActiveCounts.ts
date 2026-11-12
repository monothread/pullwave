import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { withoutHiddenSources } from '../components/mangaText';
import { statusCounts, type ActiveDownloadKind, type StatusCounts } from '../home/homeData';
import { useAnimeStore } from '../store/animeStore';
import { useAppStore } from '../store/appStore';
import { useMangaStore } from '../store/mangaStore';
import { useHiddenSourceIds } from './useShownManga';

export type ActiveCounts = Record<ActiveDownloadKind, StatusCounts>;

// How many downloads of each section are running, waiting and paused. Only the numbers are watched: the progress of a download changes
// its list many times a second, and what shows the numbers is drawn again only when one of them changes.
export function useActiveCounts(): ActiveCounts {
    const hidden = useHiddenSourceIds();
    const video = useAppStore(
        useShallow((state) => {
            return statusCounts(state.jobs);
        })
    );
    const anime = useAnimeStore(
        useShallow((state) => {
            return statusCounts(state.jobs);
        })
    );
    const manga = useMangaStore(
        useShallow((state) => {
            return statusCounts(withoutHiddenSources(state.jobs, hidden));
        })
    );
    return useMemo(() => {
        return { video, anime, manga };
    }, [video, anime, manga]);
}
