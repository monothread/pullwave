import { DEFAULT_SETTINGS } from '@shared/constants';
import { checkBinaries, defaultExecFile, parseFfmpegVersion } from '@main/services/binaryLocator';
import { BinaryResolver } from '@main/services/binaryResolver';

function makeResolver(installed: { ytdlp?: string; ffmpeg?: string } = {}): BinaryResolver {
    return new BinaryResolver({
        pathOf: (id) => {
            return id === 'ytdlp' || id === 'ffmpeg' ? (installed[id] ?? null) : null;
        },
        expectedPathOf: (id) => {
            return id === 'ytdlp' || id === 'ffmpeg' ? (installed[id] ?? null) : null;
        }
    });
}

describe('parseFfmpegVersion', () => {
    it('reads the version from the first line', () => {
        expect(parseFfmpegVersion('ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023\nbuilt with gcc')).toBe('6.1.1-3ubuntu5');
    });

    it('returns null when no version is present', () => {
        expect(parseFfmpegVersion('garbage')).toBeNull();
        expect(parseFfmpegVersion('')).toBeNull();
    });
});

describe('checkBinaries', () => {
    it('reports both installed programs as found with their versions', async () => {
        const exec = vi.fn(async (file: string) => {
            return file === '/t/yt-dlp' ? '2026.08.19\n' : 'ffmpeg version 7.0 Copyright';
        });
        await expect(checkBinaries(DEFAULT_SETTINGS, makeResolver({ ytdlp: '/t/yt-dlp', ffmpeg: '/t/ffmpeg' }), exec)).resolves.toEqual({
            ytdlp: { found: true, path: '/t/yt-dlp', version: '2026.08.19', source: 'installed' },
            ffmpeg: { found: true, path: '/t/ffmpeg', version: '7.0', source: 'installed' }
        });
        expect(exec).toHaveBeenCalledWith('/t/yt-dlp', ['--version']);
        expect(exec).toHaveBeenCalledWith('/t/ffmpeg', ['-version']);
    });

    it('reports a program that does not run as missing', async () => {
        const exec = vi.fn(async () => {
            throw new Error('ENOENT');
        });
        await expect(checkBinaries(DEFAULT_SETTINGS, makeResolver({ ytdlp: '/t/yt-dlp' }), exec)).resolves.toEqual({
            ytdlp: { found: false, path: '/t/yt-dlp', version: null, source: 'installed' },
            ffmpeg: { found: false, path: '', version: null, source: 'installed' }
        });
    });

    it('probes the custom paths', async () => {
        const exec = vi.fn(async () => {
            return '1.0';
        });
        const settings = { ...DEFAULT_SETTINGS, ytdlpPath: '/x/yt', ffmpegPath: '/x/ff' };
        const status = await checkBinaries(settings, makeResolver(), exec);
        expect(exec).toHaveBeenCalledWith('/x/yt', ['--version']);
        expect(exec).toHaveBeenCalledWith('/x/ff', ['-version']);
        expect(status.ytdlp).toMatchObject({ path: '/x/yt', source: 'custom' });
        expect(status.ffmpeg).toMatchObject({ path: '/x/ff', source: 'custom' });
    });

    it('reports a null version for empty yt-dlp output', async () => {
        const exec = vi.fn(async () => {
            return '  \n';
        });
        expect((await checkBinaries(DEFAULT_SETTINGS, makeResolver({ ytdlp: '/t/yt-dlp' }), exec)).ytdlp).toEqual({
            found: true,
            path: '/t/yt-dlp',
            version: null,
            source: 'installed'
        });
    });
});

describe('defaultExecFile', () => {
    it('resolves with stdout', async () => {
        await expect(defaultExecFile(process.execPath, ['-e', 'process.stdout.write("hi")'])).resolves.toBe('hi');
    });

    it('rejects when the command fails', async () => {
        await expect(defaultExecFile(process.execPath, ['-e', 'process.exit(2)'])).rejects.toBeInstanceOf(Error);
    });

    it('rejects when the binary does not exist', async () => {
        await expect(defaultExecFile('/nonexistent/binary', [])).rejects.toBeInstanceOf(Error);
    });
});
