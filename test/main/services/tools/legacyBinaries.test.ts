import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LEGACY_FILES, removeLegacyBinaries } from '@main/services/tools/legacyBinaries';
import { cleanTempDirs, makeTempDir } from '../../../helpers/tempDir';

afterEach(() => {
    cleanTempDirs();
});

function withBin(files: string[]): { dataDir: string; bin: string } {
    const dataDir = makeTempDir();
    const bin = join(dataDir, 'bin');
    mkdirSync(bin, { recursive: true });
    files.forEach((name) => {
        writeFileSync(join(bin, name), 'x');
    });
    return { dataDir, bin };
}

describe('removeLegacyBinaries', () => {
    it('lists the files the old updates saved', () => {
        expect(LEGACY_FILES).toEqual(['yt-dlp', 'yt-dlp.exe', 'yt-dlp.tmp', 'yt-dlp.exe.tmp', 'ani-cli', 'ani-cli.tmp']);
    });

    it('deletes them and the folder, and tells which ones', () => {
        const { dataDir, bin } = withBin(['yt-dlp', 'ani-cli', 'ani-cli.tmp']);
        expect(removeLegacyBinaries(dataDir).sort()).toEqual(['ani-cli', 'ani-cli.tmp', 'yt-dlp']);
        expect(existsSync(bin)).toBe(false);
    });

    it('keeps the folder and anything else that is in it', () => {
        const { dataDir, bin } = withBin(['yt-dlp.exe', 'mine.txt']);
        expect(removeLegacyBinaries(dataDir)).toEqual(['yt-dlp.exe']);
        expect(existsSync(join(bin, 'mine.txt'))).toBe(true);
        expect(existsSync(join(bin, 'yt-dlp.exe'))).toBe(false);
    });

    it('does nothing when there is no such folder, or it is empty', () => {
        expect(removeLegacyBinaries(makeTempDir())).toEqual([]);
        const { dataDir, bin } = withBin([]);
        expect(removeLegacyBinaries(dataDir)).toEqual([]);
        expect(existsSync(bin)).toBe(false);
    });

    it('does not touch the programs the app downloaded', () => {
        const { dataDir } = withBin(['yt-dlp']);
        mkdirSync(join(dataDir, 'tools', 'ytdlp'), { recursive: true });
        removeLegacyBinaries(dataDir);
        expect(existsSync(join(dataDir, 'tools', 'ytdlp'))).toBe(true);
    });

    it('keeps a file the user points to in the settings', () => {
        const { dataDir, bin } = withBin(['yt-dlp', 'ani-cli']);
        expect(removeLegacyBinaries(dataDir, ['', join(bin, 'yt-dlp')])).toEqual(['ani-cli']);
        expect(existsSync(join(bin, 'yt-dlp'))).toBe(true);
        expect(existsSync(join(bin, 'ani-cli'))).toBe(false);
    });

    it('does not delete a folder that has one of the names, nor what a link points to', () => {
        const { dataDir, bin } = withBin([]);
        mkdirSync(join(bin, 'yt-dlp'));
        writeFileSync(join(bin, 'yt-dlp', 'inside.txt'), 'x');
        const target = join(makeTempDir(), 'real-ani-cli');
        writeFileSync(target, 'x');
        symlinkSync(target, join(bin, 'ani-cli'));
        expect(removeLegacyBinaries(dataDir)).toEqual([]);
        expect(existsSync(join(bin, 'yt-dlp', 'inside.txt'))).toBe(true);
        expect(existsSync(target)).toBe(true);
        expect(existsSync(bin)).toBe(true);
    });

    it('only counts a name once it confirms the file is there', () => {
        const { dataDir, bin } = withBin(['yt-dlp']);
        symlinkSync(join(bin, 'nowhere'), join(bin, 'ani-cli'));
        expect(removeLegacyBinaries(dataDir)).toEqual(['yt-dlp']);
    });
});
