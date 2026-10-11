import { createWriteStream, renameSync, rmSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { ZipFile } from 'yazl';

export interface CbzEntry {
    // The name inside the archive.
    name: string;
    // The file it is read from.
    path: string;
}

// ZIP cannot hold a date before 1980; a fixed one makes the same pages give the same archive.
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

// Writes the pages (already in reading order) and, when given, the ComicInfo text into a CBZ (a ZIP). The archive is written
// beside its final place and only renamed into it when complete, so a chapter is never half there. Images are stored as they are
// (they are compressed already); the XML is deflated.
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
    // A page that cannot be read is reported by the archive, not by the stream the bytes go through.
    const unreadable = new Promise<never>((_resolve, reject) => {
        zip.once('error', reject);
    });
    zip.end();
    const file = createWriteStream(temporaryPath);
    try {
        await Promise.race([pipeline(zip.outputStream, file), unreadable]);
        dependencies.rename(temporaryPath, outputPath);
    } catch (error) {
        file.destroy();
        dependencies.remove(temporaryPath);
        throw error;
    }
}
