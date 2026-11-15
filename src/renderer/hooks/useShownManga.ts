import { useEffect, useMemo } from 'react';
import type { LibraryManga, MangaJob, MangaUpdateEntry, ReadingEntry } from '@shared/manga';
import { hiddenSourceIds, withoutHiddenSources, withoutHiddenUpdates } from '../components/mangaText';
import { useAppStore } from '../store/appStore';
import { useMangaStore } from '../store/mangaStore';

export function useHiddenSourceIds(): ReadonlySet<string> {
    const showAdult = useAppStore((state) => {
        return state.settings.mangaShowAdult;
    });
    const sources = useMangaStore((state) => {
        return state.browse.sources;
    });
    const sourcesRead = useMangaStore((state) => {
        return state.browse.sourcesStatus !== 'idle';
    });
    const serverRunning = useMangaStore((state) => {
        return state.status.supported && state.status.server === 'running';
    });
    const loadSources = useMangaStore((state) => {
        return state.loadSources;
    });
    useEffect(() => {
        if (!showAdult && serverRunning && !sourcesRead && useMangaStore.getState().browse.sourcesStatus === 'idle') {
            void loadSources();
        }
    }, [showAdult, serverRunning, sourcesRead, loadSources]);
    return useMemo(() => {
        return hiddenSourceIds(sources, showAdult);
    }, [sources, showAdult]);
}

export function useShownLibrary(): LibraryManga[] {
    const hidden = useHiddenSourceIds();
    const library = useMangaStore((state) => {
        return state.library;
    });
    return useMemo(() => {
        return withoutHiddenSources(library, hidden);
    }, [library, hidden]);
}

export function useShownHistory(): ReadingEntry[] {
    const hidden = useHiddenSourceIds();
    const history = useMangaStore((state) => {
        return state.history;
    });
    return useMemo(() => {
        return withoutHiddenSources(history, hidden);
    }, [history, hidden]);
}

export function useShownUpdates(): MangaUpdateEntry[] {
    const hidden = useHiddenSourceIds();
    const updates = useMangaStore((state) => {
        return state.updates;
    });
    const library = useMangaStore((state) => {
        return state.library;
    });
    return useMemo(() => {
        return withoutHiddenUpdates(updates, library, hidden);
    }, [updates, library, hidden]);
}

export function useShownJobs(): MangaJob[] {
    const hidden = useHiddenSourceIds();
    const jobs = useMangaStore((state) => {
        return state.jobs;
    });
    return useMemo(() => {
        return withoutHiddenSources(jobs, hidden);
    }, [jobs, hidden]);
}
