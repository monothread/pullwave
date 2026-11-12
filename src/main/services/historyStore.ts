import type { HistoryEntry } from '@shared/types';
import { JsonStore } from './jsonStore';

export const HISTORY_LIMIT = 500;

export class HistoryStore {
    private readonly store: JsonStore<HistoryEntry[]>;

    constructor(filePath: string) {
        this.store = new JsonStore<HistoryEntry[]>(filePath, [], { compact: true });
    }

    list(): HistoryEntry[] {
        const entries = this.store.read();
        return Array.isArray(entries) ? entries : [];
    }

    add(entry: HistoryEntry): void {
        this.store.write([entry, ...this.list()].slice(0, HISTORY_LIMIT));
    }

    clear(): void {
        this.store.write([]);
    }
}
