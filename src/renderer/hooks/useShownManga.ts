import { useEffect, useMemo } from 'react';
import type { LibraryManga, MangaJob, MangaUpdateEntry, ReadingEntry } from '@shared/manga';
import { hiddenSourceIds, withoutHiddenSources, withoutHiddenUpdates } from '../components/mangaText';
import { useAppStore } from '../store/appStore';
import { useMangaStore } from '../store/mangaStore';

// The sources whose mangas are not shown now: the ones for adults while the setting that lists them is off. The sources are read when they
// are needed and the server is up; until then nothing is hidden, and neither is what comes from a source that is not there any more.
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
        // Asked of the store as it is now: another part of the screen may have started to read them in the same moment.
        if (!showAdult && serverRunning && !sourcesRead && useMangaStore.getState().browse.sourcesStatus === 'idle') {
            void loadSources();
        }
    }, [showAdult, serverRunning, sourcesRead, loadSources]);
    return useMemo(() => {
        return hiddenSourceIds(sources, showAdult);
    }, [sources, showAdult]);
}

// The library as the user sees it: without the mangas of the hidden sources. They are still kept, checked and downloaded.
export function useShownLibrary(): LibraryManga[] {
    const hidden = useHiddenSourceIds();
    const library = useMangaStore((state) => {
        return state.library;
    });
    return useMemo(() => {
        return withoutHiddenSources(library, hidden);
    }, [library, hidden]);
}

// The history of reading without the readings of the hidden sources.
export function useShownHistory(): ReadingEntry[] {
    const hidden = useHiddenSourceIds();
    const history = useMangaStore((state) => {
        return state.history;
    });
    return useMemo(() => {
        return withoutHiddenSources(history, hidden);
    }, [history, hidden]);
}

// The new chapters without the ones of the mangas of the hidden sources.
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

// The downloads without the ones of the hidden sources.
export function useShownJobs(): MangaJob[] {
    const hidden = useHiddenSourceIds();
    const jobs = useMangaStore((state) => {
        return state.jobs;
    });
    return useMemo(() => {
        return withoutHiddenSources(jobs, hidden);
    }, [jobs, hidden]);
}
