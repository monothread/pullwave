import { cpSync, existsSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';

export const LEGACY_DATA_DIR_NAME = 'cyber-downloader';

const CHROMIUM_LOCK_PREFIX = 'Singleton';

export interface MigrationFiles {
    exists: (path: string) => boolean;
    copyDirectory: (from: string, to: string, shouldCopy: (source: string) => boolean) => void;
    removeDirectory: (path: string) => void;
}

const DEFAULT_FILES: MigrationFiles = {
    exists: (path) => {
        return existsSync(path);
    },
    copyDirectory: (from, to, shouldCopy) => {
        cpSync(from, to, { recursive: true, filter: shouldCopy });
    },
    removeDirectory: (path) => {
        rmSync(path, { recursive: true, force: true });
    }
};

function isNotChromiumLock(source: string): boolean {
    return !basename(source).startsWith(CHROMIUM_LOCK_PREFIX);
}

function discardPartialCopy(userDataDir: string, files: MigrationFiles): void {
    try {
        files.removeDirectory(userDataDir);
    } catch {
        // Nothing else can be done; the next start will find the folder and use what is in it.
    }
}

export function migrateLegacyUserData(appDataDir: string, userDataDir: string, files: MigrationFiles = DEFAULT_FILES): boolean {
    const legacyDir = join(appDataDir, LEGACY_DATA_DIR_NAME);
    if (legacyDir === userDataDir || files.exists(userDataDir) || !files.exists(legacyDir)) {
        return false;
    }
    try {
        files.copyDirectory(legacyDir, userDataDir, isNotChromiumLock);
        return true;
    } catch {
        discardPartialCopy(userDataDir, files);
        return false;
    }
}
