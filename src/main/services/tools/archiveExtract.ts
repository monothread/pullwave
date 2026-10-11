import { chmodSync, createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import * as tar from 'tar';
import yauzl from 'yauzl';
import type { ArchiveFormat } from '@shared/tools';

export class ArchiveError extends Error {}

export interface ExtractOptions {
    destination: string;
    stripComponents: number;
    exclude: readonly string[];
}

// The path inside the archive without its leading folders (null when it is nothing but them).
export function stripPath(path: string, components: number): string | null {
    const parts = path.replace(/\\/g, '/').split('/').filter((part) => {
        return part.length > 0 && part !== '.';
    });
    const rest = parts.slice(components);
    return rest.length > 0 ? rest.join('/') : null;
}

export function isExcluded(strippedPath: string, exclude: readonly string[]): boolean {
    return exclude.some((folder) => {
        return strippedPath === folder || strippedPath.startsWith(`${folder}/`);
    });
}

// Where a path inside the archive lands, or an error when it would land outside the destination.
export function safeTarget(destination: string, strippedPath: string): string {
    const root = resolve(destination);
    const target = resolve(root, strippedPath);
    if (target !== root && !target.startsWith(root + sep)) {
        throw new ArchiveError(`The archive has a path outside its folder: ${strippedPath}`);
    }
    return target;
}

async function extractTarGz(file: string, options: ExtractOptions): Promise<void> {
    await mkdir(options.destination, { recursive: true });
    await tar.x({
        file,
        cwd: options.destination,
        strip: options.stripComponents,
        filter: (path) => {
            const stripped = stripPath(path, options.stripComponents);
            return stripped !== null && !isExcluded(stripped, options.exclude);
        }
    });
}

const MODE_TYPE_MASK = 0o170000;
const MODE_SYMLINK = 0o120000;
const MODE_DIRECTORY = 0o040000;

function openZip(file: string): Promise<yauzl.ZipFile> {
    return new Promise((resolveOpen, reject) => {
        yauzl.open(file, { lazyEntries: true, autoClose: true }, (error, zip) => {
            if (error !== null || zip === undefined) {
                reject(error ?? new ArchiveError('The archive could not be opened'));
                return;
            }
            resolveOpen(zip);
        });
    });
}

function openEntry(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<NodeJS.ReadableStream> {
    return new Promise((resolveOpen, reject) => {
        zip.openReadStream(entry, (error, stream) => {
            if (error !== null || stream === undefined) {
                reject(error ?? new ArchiveError('An entry of the archive could not be read'));
                return;
            }
            resolveOpen(stream);
        });
    });
}

async function writeZipEntry(zip: yauzl.ZipFile, entry: yauzl.Entry, target: string): Promise<void> {
    const mode = entry.externalFileAttributes >>> 16;
    const kind = mode & MODE_TYPE_MASK;
    if (kind === MODE_SYMLINK) {
        // A link could point anywhere: it is not unpacked.
        return;
    }
    if (entry.fileName.endsWith('/') || kind === MODE_DIRECTORY) {
        await mkdir(target, { recursive: true });
        return;
    }
    await mkdir(dirname(target), { recursive: true });
    await pipeline(await openEntry(zip, entry), createWriteStream(target));
    if ((mode & 0o111) !== 0) {
        chmodSync(target, 0o755);
    }
}

async function extractZip(file: string, options: ExtractOptions): Promise<void> {
    await mkdir(options.destination, { recursive: true });
    const zip = await openZip(file);
    await new Promise<void>((resolveAll, reject) => {
        let failed = false;
        const fail = (error: unknown): void => {
            failed = true;
            zip.close();
            reject(error);
        };
        zip.on('error', fail);
        zip.on('end', () => {
            if (!failed) {
                resolveAll();
            }
        });
        zip.on('entry', (entry: yauzl.Entry) => {
            const stripped = stripPath(entry.fileName, options.stripComponents);
            if (stripped === null || isExcluded(stripped, options.exclude)) {
                zip.readEntry();
                return;
            }
            let target: string;
            try {
                target = safeTarget(options.destination, stripped);
            } catch (error) {
                fail(error);
                return;
            }
            writeZipEntry(zip, entry, target).then(
                () => {
                    zip.readEntry();
                },
                (error: unknown) => {
                    fail(error);
                }
            );
        });
        zip.readEntry();
    });
}

// Unpacks an archive into a folder without the leading folders and without the excluded ones. A path that would land outside the
// folder, and a link, are never unpacked.
export async function extractArchive(format: ArchiveFormat, file: string, options: ExtractOptions): Promise<void> {
    if (format === 'tar.gz') {
        await extractTarGz(file, options);
        return;
    }
    await extractZip(file, options);
}
