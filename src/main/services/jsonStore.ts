import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface JsonStoreOptions {
    // Writes the file without indentation: smaller and faster to write, for files nobody reads by hand.
    compact?: boolean;
}

// A value kept in a JSON file. The file is read once: after that the value is kept in memory and only writes touch the disk,
// so this store must be the only one that writes its file while the app runs.
export class JsonStore<T> {
    private cache: { value: T } | null = null;

    constructor(
        private readonly filePath: string,
        private readonly fallback: T,
        private readonly options: JsonStoreOptions = {}
    ) {}

    read(): T {
        if (this.cache === null) {
            this.cache = { value: this.readFile() };
        }
        return this.cache.value;
    }

    write(value: T): void {
        mkdirSync(dirname(this.filePath), { recursive: true });
        const temporaryPath = `${this.filePath}.tmp`;
        writeFileSync(temporaryPath, this.serialize(value), 'utf-8');
        renameSync(temporaryPath, this.filePath);
        this.cache = { value };
    }

    private readFile(): T {
        try {
            return JSON.parse(readFileSync(this.filePath, 'utf-8')) as T;
        } catch {
            return this.fallback;
        }
    }

    private serialize(value: T): string {
        if (this.options.compact === true) {
            return JSON.stringify(value);
        }
        return JSON.stringify(value, null, 2);
    }
}
