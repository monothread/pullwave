import { appendFileSync, statSync, writeFileSync } from 'node:fs';

export const MAX_LOG_BYTES = 256 * 1024;

export interface DiagnosticFiles {
    append: (path: string, text: string) => void;
    size: (path: string) => number;
    reset: (path: string) => void;
}

const DEFAULT_FILES: DiagnosticFiles = {
    append: (path, text) => {
        appendFileSync(path, text, 'utf-8');
    },
    size: (path) => {
        return statSync(path).size;
    },
    reset: (path) => {
        writeFileSync(path, '', 'utf-8');
    }
};

export interface DiagnosticLog {
    readonly path: string;
    write: (message: string) => void;
}

export function createDiagnosticLog(path: string, now: () => Date = () => {return new Date()}, files: DiagnosticFiles = DEFAULT_FILES): DiagnosticLog {
    return {
        path,
        write: (message: string): void => {
            try {
                try {
                    if (files.size(path) > MAX_LOG_BYTES) {
                        files.reset(path);
                    }
                } catch {
                    // The file does not exist yet.
                }
                files.append(path, `[${now().toISOString()}] ${message}\n`);
            } catch {
                // Logging is never critical.
            }
        }
    };
}
