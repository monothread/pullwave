import { useMemo } from 'react';
import { activeDownloads } from '../home/homeData';
import { useShownJobs } from '../hooks/useShownManga';
import { useAnimeStore } from '../store/animeStore';
import { useAppStore } from '../store/appStore';

export type ActivityLevel = 'idle' | 'busy' | 'rush';

// More than this many downloads at once is a rush.
export const RUSH_FROM = 4;

export function activityOf(count: number): ActivityLevel {
    if (count === 0) {
        return 'idle';
    }
    return count >= RUSH_FROM ? 'rush' : 'busy';
}

// How busy the app is, from the downloads going on in every section: the wave of the name follows it.
export function useActivityLevel(): ActivityLevel {
    const videoJobs = useAppStore((state) => {
        return state.jobs;
    });
    const animeJobs = useAnimeStore((state) => {
        return state.jobs;
    });
    const mangaJobs = useShownJobs();
    return useMemo(() => {
        return activityOf(activeDownloads(videoJobs, animeJobs, mangaJobs).length);
    }, [videoJobs, animeJobs, mangaJobs]);
}
