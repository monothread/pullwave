import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JsonStore } from '@main/services/jsonStore';
import { cleanTempDirs, makeTempDir } from '../../helpers/tempDir';

afterEach(() => {
    cleanTempDirs();
});

describe('JsonStore', () => {
    it('returns the fallback when the file does not exist', () => {
        const store = new JsonStore<{ a: number }>(join(makeTempDir(), 'x.json'), { a: 1 });
        expect(store.read()).toEqual({ a: 1 });
    });

    it('returns the fallback when the file has invalid JSON', () => {
        const path = join(makeTempDir(), 'x.json');
        writeFileSync(path, '{ broken');
        expect(new JsonStore<{ a: number }>(path, { a: 7 }).read()).toEqual({ a: 7 });
    });

    it('writes and reads back a value, creating missing directories', () => {
        const path = join(makeTempDir(), 'nested', 'deep', 'x.json');
        const store = new JsonStore<{ a: number }>(path, { a: 0 });
        store.write({ a: 42 });
        expect(store.read()).toEqual({ a: 42 });
        expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({ a: 42 });
    });

    it('does not leave the temporary file behind', () => {
        const path = join(makeTempDir(), 'x.json');
        new JsonStore<number[]>(path, []).write([1, 2]);
        expect(existsSync(`${path}.tmp`)).toBe(false);
    });

    it('writes the file indented by default, so it can be read by hand', () => {
        const path = join(makeTempDir(), 'x.json');
        new JsonStore<{ a: number }>(path, { a: 0 }).write({ a: 1 });
        expect(readFileSync(path, 'utf-8')).toBe('{\n  "a": 1\n}');
    });

    it('writes the file without indentation when it is compact', () => {
        const path = join(makeTempDir(), 'x.json');
        new JsonStore<{ a: number[] }>(path, { a: [] }, { compact: true }).write({ a: [1, 2] });
        expect(readFileSync(path, 'utf-8')).toBe('{"a":[1,2]}');
    });

    it('reads the file only once and gives the kept value after that', () => {
        const path = join(makeTempDir(), 'x.json');
        writeFileSync(path, JSON.stringify({ a: 1 }));
        const store = new JsonStore<{ a: number }>(path, { a: 0 });
        const first = store.read();
        writeFileSync(path, JSON.stringify({ a: 2 }));
        expect(store.read()).toBe(first);
        expect(store.read()).toEqual({ a: 1 });
    });

    it('keeps the fallback after a file that could not be read', () => {
        const path = join(makeTempDir(), 'x.json');
        const store = new JsonStore<{ a: number }>(path, { a: 5 });
        expect(store.read()).toEqual({ a: 5 });
        writeFileSync(path, JSON.stringify({ a: 6 }));
        expect(store.read()).toEqual({ a: 5 });
    });

    it('gives the written value without reading the file again', () => {
        const path = join(makeTempDir(), 'x.json');
        const store = new JsonStore<{ a: number }>(path, { a: 0 });
        const value = { a: 9 };
        store.write(value);
        writeFileSync(path, '{ broken');
        expect(store.read()).toBe(value);
    });

    it('keeps the value it had when a write fails', () => {
        const path = join(makeTempDir(), 'x.json');
        // A folder with something inside where the file should be: the file cannot take its place.
        mkdirSync(path);
        writeFileSync(join(path, 'inside'), '');
        const store = new JsonStore<{ a: number }>(path, { a: 0 });
        expect(store.read()).toEqual({ a: 0 });
        expect(() => {
            store.write({ a: 2 });
        }).toThrow();
        expect(store.read()).toEqual({ a: 0 });
    });
});
