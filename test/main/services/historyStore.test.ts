import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HistoryEntry } from '@shared/types';
import { HISTORY_LIMIT, HistoryStore } from '@main/services/historyStore';
import { JsonStore } from '@main/services/jsonStore';
import { cleanTempDirs, makeTempDir } from '../../helpers/tempDir';

afterEach(() => {
    cleanTempDirs();
});

function entry(id: string): HistoryEntry {
    return { id, url: `https://x.com/${id}`, title: `t-${id}`, filePath: `/d/${id}.mp4`, status: 'done', errorTitle: null, finishedAt: 1 };
}

describe('HistoryStore', () => {
    it('starts empty', () => {
        expect(new HistoryStore(join(makeTempDir(), 'h.json')).list()).toEqual([]);
    });

    it('adds entries newest first', () => {
        const store = new HistoryStore(join(makeTempDir(), 'h.json'));
        store.add(entry('a'));
        store.add(entry('b'));
        expect(store.list()).toEqual([entry('b'), entry('a')]);
    });

    it('keeps at most HISTORY_LIMIT entries', () => {
        const path = join(makeTempDir(), 'h.json');
        const seeded = Array.from({ length: HISTORY_LIMIT }, (_unused, index) => {
            return entry(`old-${index}`);
        });
        new JsonStore<HistoryEntry[]>(path, []).write(seeded);
        const store = new HistoryStore(path);
        store.add(entry('new'));
        const list = store.list();
        expect(list).toHaveLength(HISTORY_LIMIT);
        expect(list[0]).toEqual(entry('new'));
        expect(list[HISTORY_LIMIT - 1]).toEqual(entry(`old-${HISTORY_LIMIT - 2}`));
    });

    it('writes the file without indentation', () => {
        const path = join(makeTempDir(), 'h.json');
        new HistoryStore(path).add(entry('a'));
        expect(readFileSync(path, 'utf-8')).toBe(JSON.stringify([entry('a')]));
    });

    it('clears all entries', () => {
        const store = new HistoryStore(join(makeTempDir(), 'h.json'));
        store.add(entry('a'));
        store.clear();
        expect(store.list()).toEqual([]);
    });

    it('returns an empty list when the stored value is not an array', () => {
        const path = join(makeTempDir(), 'h.json');
        new JsonStore<unknown>(path, null).write({ not: 'an array' });
        expect(new HistoryStore(path).list()).toEqual([]);
    });
});
