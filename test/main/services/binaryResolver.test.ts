import { delimiter, join } from 'node:path';
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { ProgramId } from '@shared/tools';
import { BinaryResolver, executableName, type InstalledPrograms } from '@main/services/binaryResolver';

const TOOLS = '/data/tools';

// The programs that are installed, by the file of each; the others are "not installed", with the place they will have once they are.
function makePrograms(installed: Partial<Record<ProgramId, string>>, expected: Partial<Record<ProgramId, string>> = {}): InstalledPrograms {
    return {
        pathOf: (id) => {
            return installed[id] ?? null;
        },
        expectedPathOf: (id) => {
            return expected[id] ?? installed[id] ?? null;
        }
    };
}

const YTDLP = join(TOOLS, 'ytdlp', '2026.08.19', 'yt-dlp');
const DENO = join(TOOLS, 'deno', '2.4.0', 'deno');
const FFMPEG = join(TOOLS, 'ffmpeg', 'latest-abc', 'bin', 'ffmpeg');

describe('BinaryResolver.ytdlp', () => {
    it('prefers the custom path from the settings', () => {
        const resolver = new BinaryResolver(makePrograms({ ytdlp: YTDLP }));
        expect(resolver.ytdlp({ ...DEFAULT_SETTINGS, ytdlpPath: '/opt/yt-dlp' })).toEqual({ path: '/opt/yt-dlp', source: 'custom' });
    });

    it('uses the program the app installed', () => {
        const resolver = new BinaryResolver(makePrograms({ ytdlp: YTDLP }));
        expect(resolver.ytdlp(DEFAULT_SETTINGS)).toEqual({ path: YTDLP, source: 'installed' });
    });

    it('gives the place the program will have while it is not installed, so that running it fails as "not found"', () => {
        const resolver = new BinaryResolver(makePrograms({}, { ytdlp: YTDLP }));
        expect(resolver.ytdlp(DEFAULT_SETTINGS)).toEqual({ path: YTDLP, source: 'installed' });
    });

    it('never falls back to a yt-dlp of the system', () => {
        const resolver = new BinaryResolver(makePrograms({}));
        expect(resolver.ytdlp(DEFAULT_SETTINGS)).toEqual({ path: '', source: 'installed' });
    });
});

describe('BinaryResolver.ffmpeg / ffmpegLocation', () => {
    it('prefers the custom ffmpeg path and passes it as the location', () => {
        const resolver = new BinaryResolver(makePrograms({ ffmpeg: FFMPEG }));
        const settings = { ...DEFAULT_SETTINGS, ffmpegPath: '/opt/ffmpeg' };
        expect(resolver.ffmpeg(settings)).toEqual({ path: '/opt/ffmpeg', source: 'custom' });
        expect(resolver.ffmpegLocation(settings)).toBe('/opt/ffmpeg');
    });

    it('uses the installed ffmpeg and passes its folder as the location', () => {
        const resolver = new BinaryResolver(makePrograms({ ffmpeg: FFMPEG }));
        expect(resolver.ffmpeg(DEFAULT_SETTINGS)).toEqual({ path: FFMPEG, source: 'installed' });
        expect(resolver.ffmpegLocation(DEFAULT_SETTINGS)).toBe(join(TOOLS, 'ffmpeg', 'latest-abc', 'bin'));
    });

    it('gives no location while ffmpeg is not installed', () => {
        const resolver = new BinaryResolver(makePrograms({}));
        expect(resolver.ffmpeg(DEFAULT_SETTINGS)).toEqual({ path: '', source: 'installed' });
        expect(resolver.ffmpegLocation(DEFAULT_SETTINGS)).toBeNull();
    });
});

describe('BinaryResolver.spawnEnv', () => {
    it('puts the folders of deno and ffmpeg in front of PATH', () => {
        const resolver = new BinaryResolver(makePrograms({ deno: DENO, ffmpeg: FFMPEG }));
        expect(resolver.spawnEnv({ PATH: '/usr/bin', HOME: '/home/u' })).toEqual({
            PATH: `${join(TOOLS, 'deno', '2.4.0')}${delimiter}${join(TOOLS, 'ffmpeg', 'latest-abc', 'bin')}${delimiter}/usr/bin`,
            HOME: '/home/u'
        });
    });

    it('adds only the programs that are installed', () => {
        const resolver = new BinaryResolver(makePrograms({ deno: DENO }));
        expect(resolver.spawnEnv({ PATH: '/usr/bin' })).toEqual({ PATH: `${join(TOOLS, 'deno', '2.4.0')}${delimiter}/usr/bin` });
    });

    it('uses only the folders when PATH is unset', () => {
        const resolver = new BinaryResolver(makePrograms({ deno: DENO }));
        expect(resolver.spawnEnv({})).toEqual({ PATH: join(TOOLS, 'deno', '2.4.0') });
    });

    it('extends the existing "Path" variable instead of adding a second PATH key', () => {
        const resolver = new BinaryResolver(makePrograms({ deno: DENO }));
        const env = resolver.spawnEnv({ Path: 'C:\\Windows', SystemRoot: 'C:\\Windows' });
        expect(env).toEqual({ Path: `${join(TOOLS, 'deno', '2.4.0')}${delimiter}C:\\Windows`, SystemRoot: 'C:\\Windows' });
        expect(Object.keys(env)).not.toContain('PATH');
    });

    it('returns the base environment untouched when none of them is installed', () => {
        const base = { PATH: '/usr/bin' };
        expect(new BinaryResolver(makePrograms({})).spawnEnv(base)).toBe(base);
    });

    it('defaults to process.env', () => {
        expect(new BinaryResolver(makePrograms({})).spawnEnv()).toBe(process.env);
    });
});

describe('executableName', () => {
    it('adds the .exe extension on Windows only', () => {
        expect(executableName('yt-dlp', 'win32')).toBe('yt-dlp.exe');
        expect(executableName('ffmpeg', 'win32')).toBe('ffmpeg.exe');
        expect(executableName('yt-dlp', 'linux')).toBe('yt-dlp');
        expect(executableName('yt-dlp', 'darwin')).toBe('yt-dlp');
    });

    it('defaults to the current platform', () => {
        expect(executableName('yt-dlp')).toBe(process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
    });
});
