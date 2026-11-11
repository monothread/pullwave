import { existsSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { runFfmpegQuietly } from './ffmpegExec';

export type RunFfmpeg = (binary: string, args: string[]) => Promise<boolean>;

export interface MergePartsOptions {
    ffmpegBinary: string;
    // The parts of one recording, in the order they were recorded.
    paths: string[];
    runFfmpeg?: RunFfmpeg;
    fileExists?: (path: string) => boolean;
    removeFile?: (path: string) => void;
    writeTextFile?: (path: string, content: string) => void;
    renameFile?: (from: string, to: string) => void;
}

// The concat demuxer reads one `file '<path>'` line per part; a quote inside a path is written as `'\''`.
export function buildConcatList(paths: string[]): string {
    return paths
        .map((path) => {
            return `file '${path.replaceAll("'", "'\\''")}'`;
        })
        .join('\n');
}

// A live stream that dropped and came back is recorded in several files. Copying them (no re-encoding) one after the
// other into the first file leaves a single recording. Returns the path of that file; null when it could not be merged,
// in which case every part is left untouched.
export async function mergeParts(options: MergePartsOptions): Promise<string | null> {
    const runFfmpeg = options.runFfmpeg ?? runFfmpegQuietly;
    const fileExists = options.fileExists ?? existsSync;
    const removeFile = options.removeFile ?? unlinkSync;
    const writeTextFile = options.writeTextFile ?? writeFileSync;
    const renameFile = options.renameFile ?? renameSync;
    const parts = options.paths.filter((path) => {
        return fileExists(path);
    });
    const [target, ...others] = parts;
    if (target === undefined || others.length === 0) {
        return target ?? null;
    }
    const extension = extname(target);
    const listPath = `${target}.concat.txt`;
    const mergedPath = join(dirname(target), `${basename(target, extension)}.merging${extension}`);
    writeTextFile(listPath, buildConcatList(parts));
    const merged = await runFfmpeg(options.ffmpegBinary, ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', mergedPath]);
    removeFile(listPath);
    if (!merged || !fileExists(mergedPath)) {
        if (fileExists(mergedPath)) {
            removeFile(mergedPath);
        }
        return null;
    }
    renameFile(mergedPath, target);
    others.forEach((path) => {
        removeFile(path);
    });
    return target;
}
