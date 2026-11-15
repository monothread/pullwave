import { keyedRefresh, type KeyedRefresh } from './keyedRefresh';

export interface LibraryEntrySource<T extends { id: number }> {
    read: (id: number) => Promise<T | null>;
    current: () => readonly T[];
    put: (entry: T) => void;
    refreshAll: () => Promise<void>;
}

export function withEntry<T extends { id: number }>(library: readonly T[], entry: T): T[] {
    return library.map((item) => {
        return item.id === entry.id ? entry : item;
    });
}

export function libraryEntryRefresh<T extends { id: number }>(source: LibraryEntrySource<T>): KeyedRefresh<number> {
    return keyedRefresh<number>(async (id) => {
        let entry: T | null;
        try {
            entry = await source.read(id);
        } catch {
            await source.refreshAll();
            return;
        }
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
