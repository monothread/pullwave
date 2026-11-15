import { keyedRefresh, type KeyedRefresh } from './keyedRefresh';

// What a library (of mangas, of animes) gives to refresh one of its items alone.
export interface LibraryEntrySource<T extends { id: number }> {
    // The item as it is now, null when it is no longer in the library.
    read: (id: number) => Promise<T | null>;
    // The library the screen has now.
    current: () => readonly T[];
    // Puts the item read in the place of the one the screen has.
    put: (entry: T) => void;
    // Reads the whole library again.
    refreshAll: () => Promise<void>;
}

// The library with this item in the place of the one with its id: the other items keep their objects, so nothing that shows them is drawn
// again.
export function withEntry<T extends { id: number }>(library: readonly T[], entry: T): T[] {
    return library.map((item) => {
        return item.id === entry.id ? entry : item;
    });
}

// Refreshes one item of the library at a time (see keyedRefresh): when an episode or a chapter starts or ends only its anime or manga changed,
// and reading the whole library again for each one blocked the main process and filled the memory of the window. An item the screen does not
// have, no longer in the library, or that cannot be read alone, makes the whole library be read, as before.
export function libraryEntryRefresh<T extends { id: number }>(source: LibraryEntrySource<T>): KeyedRefresh<number> {
    return keyedRefresh<number>(async (id) => {
        let entry: T | null;
        try {
            entry = await source.read(id);
        } catch {
            await source.refreshAll();
            return;
        }
        // Looked at after the answer: the library may have changed while the item was asked for.
        const known = source.current().some((item) => {
            return item.id === id;
        });
        if (entry === null || !known) {
            await source.refreshAll();
            return;
        }
        source.put(entry);
    });
}
