import { createWriteStream, renameSync, rmSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { ZipFile } from 'yazl';

export interface CbzEntry {
    name: string;
    path: string;
}

const ENTRY_DATE = new Date(Date.UTC(1980, 0, 1));
const TEXT_ENTRY = /\.xml$/i;

export interface CbzDependencies {
    rename: (from: string, to: string) => void;
    remove: (path: string) => void;
}

const DEFAULT_DEPENDENCIES: CbzDependencies = {
    rename: renameSync,
    remove: (path) => {
        rmSync(path, { force: true });
    }
};

export async function writeCbz(
    outputPath: string,
    entries: readonly CbzEntry[],
    extraFiles: ReadonlyArray<{ name: string; content: string }> = [],
    dependencies: CbzDependencies = DEFAULT_DEPENDENCIES
): Promise<void> {
    const temporaryPath = `${outputPath}.tmp`;
    const zip = new ZipFile();
    entries.forEach((entry) => {
        zip.addFile(entry.path, entry.name, { mtime: ENTRY_DATE, compress: TEXT_ENTRY.test(entry.name) });
    });
    extraFiles.forEach((file) => {
        zip.addBuffer(Buffer.from(file.content, 'utf-8'), file.name, { mtime: ENTRY_DATE, compress: true });
    });
    const unreadable = new Promise<never>((_resolve, reject) => {
        zip.once('error', reject);
    });
    zip.end();
    const file = createWriteStream(temporaryPath);
    try {
        await Promise.race([pipeline(zip.outputStream, file), unreadable]);
        dependencies.rename(temporaryPath, outputPath);
    } catch (error) {
        if (!file.closed) {
            await new Promise<void>((resolve) => {
                file.once('close', () => {
                    resolve();
                });
                file.destroy();
            });
        }
        dependencies.remove(temporaryPath);
        throw error;
    }
}
