import { existsSync, unlinkSync } from 'node:fs';
import { runFfmpegQuietly } from './ffmpegExec';

export type RunFfmpeg = (binary: string, args: string[]) => Promise<boolean>;

export interface SalvageOptions {
    ffmpegBinary: string;
    filePath: string;
    runFfmpeg?: RunFfmpeg;
    fileExists?: (path: string) => boolean;
    removeFile?: (path: string) => void;
}

// A live recording ended by killing yt-dlp (what "stop" does on Windows) is left as `<file>.part`, a stream that
// plays fine even though it was cut short. Copying it (no re-encoding) into the final file keeps what was recorded.
// Returns the final file path, or null when there was nothing to save or it could not be saved.
export async function salvageRecording(options: SalvageOptions): Promise<string | null> {
    const runFfmpeg = options.runFfmpeg ?? runFfmpegQuietly;
    const fileExists = options.fileExists ?? existsSync;
    const removeFile = options.removeFile ?? unlinkSync;
    const partial = `${options.filePath}.part`;
    if (!fileExists(partial)) {
        return fileExists(options.filePath) ? options.filePath : null;
    }
    const saved = await runFfmpeg(options.ffmpegBinary, ['-y', '-v', 'error', '-i', partial, '-c', 'copy', options.filePath]);
    if (!saved || !fileExists(options.filePath)) {
        return null;
    }
    removeFile(partial);
    return options.filePath;
}
