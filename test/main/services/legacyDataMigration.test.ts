import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LEGACY_DATA_DIR_NAME, migrateLegacyUserData, type MigrationFiles } from '@main/services/legacyDataMigration';
import { cleanTempDirs, makeTempDir } from '../../helpers/tempDir';

const APP_DATA = '/config';
const LEGACY_DIR = join(APP_DATA, 'cyber-downloader');
const USER_DATA = join(APP_DATA, 'pullwave');

afterEach(() => {
    cleanTempDirs();
});

function setup(existing: string[], copyError?: Error, removeError?: Error) {
    const files: MigrationFiles = {
        exists: vi.fn((path: string) => {
            return existing.includes(path);
        }),
        copyDirectory: vi.fn(() => {
            if (copyError) {
                throw copyError;
            }
        }),
        removeDirectory: vi.fn(() => {
            if (removeError) {
                throw removeError;
            }
        })
    };
    return files;
}

describe('LEGACY_DATA_DIR_NAME', () => {
    it('is the data folder name used before the rename to Pullwave', () => {
        expect(LEGACY_DATA_DIR_NAME).toBe('cyber-downloader');
    });
});

describe('migrateLegacyUserData', () => {
    it('copies the old folder into the new one and reports it', () => {
        const files = setup([LEGACY_DIR]);

        expect(migrateLegacyUserData(APP_DATA, USER_DATA, files)).toBe(true);

        expect(files.exists).toHaveBeenCalledWith(USER_DATA);
        expect(files.exists).toHaveBeenCalledWith(LEGACY_DIR);
        expect(files.copyDirectory).toHaveBeenCalledTimes(1);
        expect(files.copyDirectory).toHaveBeenCalledWith(LEGACY_DIR, USER_DATA, expect.any(Function));
        expect(files.removeDirectory).not.toHaveBeenCalled();
    });

    it('does nothing when there is no old folder', () => {
        const files = setup([]);

        expect(migrateLegacyUserData(APP_DATA, USER_DATA, files)).toBe(false);

        expect(files.copyDirectory).not.toHaveBeenCalled();
    });

    it('does nothing when the new folder already exists', () => {
        const files = setup([LEGACY_DIR, USER_DATA]);

        expect(migrateLegacyUserData(APP_DATA, USER_DATA, files)).toBe(false);

        expect(files.copyDirectory).not.toHaveBeenCalled();
    });

    it('does nothing when the data folder is the old folder itself', () => {
        const files = setup([LEGACY_DIR]);

        expect(migrateLegacyUserData(APP_DATA, LEGACY_DIR, files)).toBe(false);

        expect(files.copyDirectory).not.toHaveBeenCalled();
    });

    it('removes the partial copy and reports failure when copying throws', () => {
        const files = setup([LEGACY_DIR], new Error('EACCES'));

        expect(migrateLegacyUserData(APP_DATA, USER_DATA, files)).toBe(false);

        expect(files.removeDirectory).toHaveBeenCalledTimes(1);
        expect(files.removeDirectory).toHaveBeenCalledWith(USER_DATA);
    });

    it('still reports failure without throwing when removing the partial copy also fails', () => {
        const files = setup([LEGACY_DIR], new Error('EACCES'), new Error('EBUSY'));

        expect(migrateLegacyUserData(APP_DATA, USER_DATA, files)).toBe(false);

        expect(files.removeDirectory).toHaveBeenCalledWith(USER_DATA);
    });

    it('skips only the Chromium lock files when deciding what to copy', () => {
        const files = setup([LEGACY_DIR]);
        migrateLegacyUserData(APP_DATA, USER_DATA, files);
        const [, , shouldCopy] = vi.mocked(files.copyDirectory).mock.calls[0] ?? [];
        if (!shouldCopy) {
            throw new Error('copyDirectory was not called');
        }

        expect(shouldCopy(LEGACY_DIR)).toBe(true);
        expect(shouldCopy(`${LEGACY_DIR}/settings.json`)).toBe(true);
        expect(shouldCopy(`${LEGACY_DIR}/history.json`)).toBe(true);
        expect(shouldCopy(`${LEGACY_DIR}/SingletonLock`)).toBe(false);
        expect(shouldCopy(`${LEGACY_DIR}/SingletonSocket`)).toBe(false);
        expect(shouldCopy(`${LEGACY_DIR}/SingletonCookie`)).toBe(false);
    });

    describe('with the real file system', () => {
        it('copies the data, keeps the old folder and leaves the stale lock behind', () => {
            const appData = makeTempDir();
            const legacyDir = join(appData, LEGACY_DATA_DIR_NAME);
            const userData = join(appData, 'pullwave');
            mkdirSync(join(legacyDir, 'Local Storage'), { recursive: true });
            writeFileSync(join(legacyDir, 'settings.json'), '{"language":"pt"}');
            writeFileSync(join(legacyDir, 'history.json'), '[]');
            writeFileSync(join(legacyDir, 'Local Storage', 'leveldb'), 'theme');
            symlinkSync('/nonexistent-host-1234', join(legacyDir, 'SingletonLock'));

            expect(migrateLegacyUserData(appData, userData)).toBe(true);

            expect(readFileSync(join(userData, 'settings.json'), 'utf-8')).toBe('{"language":"pt"}');
            expect(readFileSync(join(userData, 'history.json'), 'utf-8')).toBe('[]');
            expect(readFileSync(join(userData, 'Local Storage', 'leveldb'), 'utf-8')).toBe('theme');
            expect(existsSync(join(userData, 'SingletonLock'))).toBe(false);
            expect(readFileSync(join(legacyDir, 'settings.json'), 'utf-8')).toBe('{"language":"pt"}');
        });

        it('does not touch an existing new folder', () => {
            const appData = makeTempDir();
            const userData = join(appData, 'pullwave');
            mkdirSync(join(appData, LEGACY_DATA_DIR_NAME), { recursive: true });
            writeFileSync(join(appData, LEGACY_DATA_DIR_NAME, 'settings.json'), '{"language":"pt"}');
            mkdirSync(userData, { recursive: true });
            writeFileSync(join(userData, 'settings.json'), '{"language":"en"}');

            expect(migrateLegacyUserData(appData, userData)).toBe(false);

            expect(readFileSync(join(userData, 'settings.json'), 'utf-8')).toBe('{"language":"en"}');
        });

        it('does nothing when neither folder exists', () => {
            const appData = makeTempDir();
            const userData = join(appData, 'pullwave');

            expect(migrateLegacyUserData(appData, userData)).toBe(false);

            expect(existsSync(userData)).toBe(false);
        });
    });
});
