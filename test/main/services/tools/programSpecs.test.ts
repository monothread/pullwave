import { PROGRAM_IDS, type ProgramId, type ToolSpec } from '@shared/tools';
import {
    aniCliSpec,
    denoSpec,
    executableName,
    FFMPEG_ASSETS,
    ffmpegSpec,
    ffmpegVersionOf,
    isProgramVersion,
    pinnedSpec,
    programPlatform,
    ytdlpSpec
} from '@main/services/tools/programSpecs';

const SHA = 'ab'.repeat(32);

describe('programPlatform', () => {
    it('is the system when the programs are made for it: linux or windows, 64 bits', () => {
        expect(programPlatform('linux', 'x64')).toBe('linux');
        expect(programPlatform('win32', 'x64')).toBe('win32');
    });

    it.each([
        ['linux', 'arm64'],
        ['win32', 'arm64'],
        ['win32', 'ia32'],
        ['darwin', 'x64'],
        ['darwin', 'arm64'],
        ['freebsd', 'x64']
    ] as const)('is null for %s %s', (platform, arch) => {
        expect(programPlatform(platform, arch)).toBeNull();
    });
});

describe('executableName', () => {
    it('has .exe on windows only', () => {
        expect(executableName('deno', 'win32')).toBe('deno.exe');
        expect(executableName('deno', 'linux')).toBe('deno');
    });
});

describe('the versions the app is made with', () => {
    it('are yt-dlp 2026.08.19 as one file, from its release, with the checksum of that release', () => {
        expect(pinnedSpec('ytdlp', 'linux', 'x64')).toEqual({
            id: 'ytdlp',
            version: '2026.08.19',
            url: 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp_linux',
            sha256: '58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a',
            sizeBytes: 40_446_224,
            format: 'raw',
            stripComponents: 0,
            exclude: [],
            executables: ['yt-dlp'],
            entry: 'yt-dlp'
        });
        expect(pinnedSpec('ytdlp', 'win32', 'x64')).toEqual({
            id: 'ytdlp',
            version: '2026.08.19',
            url: 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp.exe',
            sha256: '66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a',
            sizeBytes: 17_840_399,
            format: 'raw',
            stripComponents: 0,
            exclude: [],
            executables: ['yt-dlp.exe'],
            entry: 'yt-dlp.exe'
        });
    });

    it('are deno 2.9.7, in the zip of its release', () => {
        expect(pinnedSpec('deno', 'linux', 'x64')).toEqual({
            id: 'deno',
            version: 'v2.9.7',
            url: 'https://github.com/denoland/deno/releases/download/v2.9.7/deno-x86_64-unknown-linux-gnu.zip',
            sha256: 'c6527f24f4b16031d3ae4fa9f658d5f11534c8d84ce7dc8502420280919c3490',
            sizeBytes: 41_596_794,
            format: 'zip',
            stripComponents: 0,
            exclude: [],
            executables: ['deno'],
            entry: 'deno'
        });
        expect(pinnedSpec('deno', 'win32', 'x64')).toMatchObject({
            version: 'v2.9.7',
            url: 'https://github.com/denoland/deno/releases/download/v2.9.7/deno-x86_64-pc-windows-msvc.zip',
            sha256: 'a0c3101b4158d1dfb7d6a78a7bf0f3de80c96bb423c152beec8beb22786f2238',
            sizeBytes: 42_630_221,
            executables: ['deno.exe'],
            entry: 'deno.exe'
        });
    });

    it('are ani-cli 5.1.4 at one commit, the same script on both systems', () => {
        const expected = {
            id: 'anicli',
            version: '3ad53631ef2433b0c26e25ab011a5b149706c120',
            url: 'https://raw.githubusercontent.com/pystardust/ani-cli/3ad53631ef2433b0c26e25ab011a5b149706c120/ani-cli',
            sha256: '32ae0965b7abb102ab85f381411b980d1a9196f06bf2756d48fef16695b41d47',
            sizeBytes: 29_772,
            format: 'raw',
            stripComponents: 0,
            exclude: [],
            executables: ['ani-cli'],
            entry: 'ani-cli'
        };
        expect(pinnedSpec('anicli', 'linux', 'x64')).toEqual(expected);
        expect(pinnedSpec('anicli', 'win32', 'x64')).toEqual(expected);
    });

    it('are busybox 1.35.0 on Linux and busybox-w32 on Windows, one file each', () => {
        expect(pinnedSpec('busybox', 'linux', 'x64')).toEqual({
            id: 'busybox',
            version: '1.35.0',
            url: 'https://busybox.net/downloads/binaries/1.35.0-x86_64-linux-musl/busybox',
            sha256: '6e123e7f3202a8c1e9b1f94d8941580a25135382b99e8d3e34fb858bba311348',
            sizeBytes: 1_131_168,
            format: 'raw',
            stripComponents: 0,
            exclude: [],
            executables: ['busybox'],
            entry: 'busybox'
        });
        expect(pinnedSpec('busybox', 'win32', 'x64')).toEqual({
            id: 'busybox',
            version: 'FRP-6075-g169694ebd',
            url: 'https://frippery.org/files/busybox/busybox-w64u-FRP-6075-g169694ebd.exe',
            sha256: '6e263d154d8548d1eb936f65d1d8312c80df31c45974e48d6335e4dcc0f4f34c',
            sizeBytes: 675_840,
            format: 'raw',
            stripComponents: 0,
            exclude: [],
            executables: ['busybox.exe'],
            entry: 'busybox.exe'
        });
    });

    it('are curl 8.22.0, in the .tar.xz of its release, with the file at the top', () => {
        expect(pinnedSpec('curl', 'linux', 'x64')).toEqual({
            id: 'curl',
            version: '8.22.0',
            url: 'https://github.com/stunnel/static-curl/releases/download/8.22.0/curl-linux-x86_64-musl-8.22.0.tar.xz',
            sha256: 'dfb02460ba2abe513087538f12a3cf79b74b64a5ea3787ce8ac0cdb11251f884',
            sizeBytes: 4_142_376,
            format: 'tar.xz',
            stripComponents: 0,
            exclude: [],
            executables: ['curl'],
            entry: 'curl'
        });
        expect(pinnedSpec('curl', 'win32', 'x64')).toMatchObject({
            url: 'https://github.com/stunnel/static-curl/releases/download/8.22.0/curl-windows-x86_64-8.22.0.tar.xz',
            sha256: '8a57d1a52ea246f50be9e3f24a1d539d4fd23884405efbe18c6eb44eaf8ca524',
            sizeBytes: 3_516_016,
            format: 'tar.xz',
            executables: ['curl.exe'],
            entry: 'curl.exe'
        });
    });

    it('have none for ffmpeg: the build it was made with is not kept anywhere', () => {
        expect(pinnedSpec('ffmpeg', 'linux', 'x64')).toBeNull();
        expect(pinnedSpec('ffmpeg', 'win32', 'x64')).toBeNull();
    });

    it('have none for a system the programs are not made for', () => {
        PROGRAM_IDS.forEach((id) => {
            expect(pinnedSpec(id, 'darwin', 'arm64')).toBeNull();
            expect(pinnedSpec(id, 'linux', 'arm64')).toBeNull();
        });
    });

    it.each(PROGRAM_IDS.filter((id) => {
        return id !== 'ffmpeg';
    }).flatMap((id) => {
        return (['linux', 'win32'] as const).map((platform) => {
            return [id, platform] as const;
        });
    }))('is complete for %s on %s: https, a checksum, a size, and the files it must have', (id: ProgramId, platform) => {
        const spec = pinnedSpec(id, platform, 'x64') as ToolSpec;
        expect(spec.id).toBe(id);
        expect(spec.url.startsWith('https://')).toBe(true);
        expect(spec.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(spec.sizeBytes).toBeGreaterThan(0);
        expect(isProgramVersion(id, spec.version)).toBe(true);
        expect(spec.executables).toContain(spec.entry);
        // A script has no .exe even on Windows (it runs on the busybox).
        expect(spec.entry.endsWith('.exe')).toBe(platform === 'win32' && id !== 'anicli');
    });
});

describe('the specs of the latest versions', () => {
    it('are made from the version, the checksum and the size, with the address built here', () => {
        expect(ytdlpSpec('2026.09.01', SHA, 123, 'linux')).toEqual({
            id: 'ytdlp',
            version: '2026.09.01',
            url: 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.09.01/yt-dlp_linux',
            sha256: SHA,
            sizeBytes: 123,
            format: 'raw',
            stripComponents: 0,
            exclude: [],
            executables: ['yt-dlp'],
            entry: 'yt-dlp'
        });
        expect(denoSpec('v2.10.0', SHA, 456, 'win32')).toMatchObject({ id: 'deno', url: 'https://github.com/denoland/deno/releases/download/v2.10.0/deno-x86_64-pc-windows-msvc.zip', format: 'zip', entry: 'deno.exe' });
        expect(aniCliSpec('b'.repeat(40), SHA, 30_000)).toMatchObject({ id: 'anicli', url: `https://raw.githubusercontent.com/pystardust/ani-cli/${'b'.repeat(40)}/ani-cli`, format: 'raw', entry: 'ani-cli' });
    });

    it('are made for ffmpeg on Linux from the file of the release of BtbN, keeping the libraries and leaving the headers', () => {
        const spec = ffmpegSpec('linux', 'ffmpeg-n9.0-latest-linux64-gpl-shared-9.0.tar.xz', SHA, 70_000_000);
        expect(spec).toEqual({
            id: 'ffmpeg',
            version: ffmpegVersionOf(SHA),
            url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n9.0-latest-linux64-gpl-shared-9.0.tar.xz',
            sha256: SHA,
            sizeBytes: 70_000_000,
            format: 'tar.xz',
            stripComponents: 1,
            exclude: ['include'],
            executables: ['bin/ffmpeg', 'bin/ffprobe'],
            entry: 'bin/ffmpeg'
        });
        expect(spec?.version).toBe('latest-abababababab');
    });

    it('are made for ffmpeg on Windows from the same release of BtbN, as a zip', () => {
        const asset = 'ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip';
        expect(ffmpegSpec('win32', asset, SHA, 86_000_000)).toEqual({
            id: 'ffmpeg',
            version: 'latest-abababababab',
            url: `https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/${asset}`,
            sha256: SHA,
            sizeBytes: 86_000_000,
            format: 'zip',
            stripComponents: 1,
            exclude: [],
            executables: ['bin/ffmpeg.exe', 'bin/ffprobe.exe'],
            entry: 'bin/ffmpeg.exe'
        });
    });

    it('are not made for ffmpeg on Windows from a file that is not a win64 GPL shared build', () => {
        ['whatever', '../evil.zip', 'ffmpeg-n9.0-latest-win64-gpl-9.0.zip', 'ffmpeg-n9.0-latest-win64-lgpl-shared-9.0.zip', 'ffmpeg-n9.0-latest-linux64-gpl-shared-9.0.tar.xz', ''].forEach((asset) => {
            expect(ffmpegSpec('win32', asset, SHA, 1)).toBeNull();
        });
    });

    it('are not made for ffmpeg on Linux from a file that is not a build of BtbN of the kind the app uses', () => {
        ['../evil.tar.xz', 'ffmpeg-master-latest-linux64-gpl-shared.tar.xz', 'ffmpeg-n9.0-latest-linux64-gpl-9.0.tar.xz', 'ffmpeg-n9.0-latest-linuxarm64-gpl-shared-9.0.tar.xz', 'x/ffmpeg-n9.0-latest-linux64-gpl-shared-9.0.tar.xz', ''].forEach((asset) => {
            expect(ffmpegSpec('linux', asset, SHA, 1)).toBeNull();
        });
    });
});

describe('FFMPEG_ASSETS', () => {
    it('takes the numbered branches of the GPL shared build of Linux and nothing else', () => {
        expect(FFMPEG_ASSETS.linux.test('ffmpeg-n8.1-latest-linux64-gpl-shared-8.1.tar.xz')).toBe(true);
        expect(FFMPEG_ASSETS.linux.test('ffmpeg-n10.2-latest-linux64-gpl-shared-10.2.tar.xz')).toBe(true);
        expect(FFMPEG_ASSETS.linux.test('ffmpeg-n9.0-latest-linux64-lgpl-shared-9.0.tar.xz')).toBe(false);
        expect(FFMPEG_ASSETS.linux.test('ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip')).toBe(false);
    });

    it('takes the numbered branches of the GPL shared build of Windows and nothing else', () => {
        expect(FFMPEG_ASSETS.win32.test('ffmpeg-n8.1-latest-win64-gpl-shared-8.1.zip')).toBe(true);
        expect(FFMPEG_ASSETS.win32.test('ffmpeg-n10.2-latest-win64-gpl-shared-10.2.zip')).toBe(true);
        expect(FFMPEG_ASSETS.win32.test('ffmpeg-master-latest-win64-gpl-shared.zip')).toBe(false);
        expect(FFMPEG_ASSETS.win32.test('ffmpeg-n9.0-latest-linux64-gpl-shared-9.0.tar.xz')).toBe(false);
    });
});

describe('isProgramVersion', () => {
    it.each([
        ['ytdlp', '2026.08.19', true],
        ['ytdlp', '2026.08.19.1', true],
        ['ytdlp', '2026.8.19', false],
        ['ytdlp', 'latest', false],
        ['ytdlp', '../2026.08.19', false],
        ['deno', 'v2.9.7', true],
        ['deno', '2.9.7', false],
        ['deno', 'v2.9', false],
        ['deno', 'v2.9.7/../x', false],
        ['ffmpeg', 'latest-0123456789ab', true],
        ['ffmpeg', 'latest-0123456789a', false],
        ['ffmpeg', 'latest-0123456789AB', false],
        ['ffmpeg', 'n9.0', false],
        ['anicli', '3ad53631ef2433b0c26e25ab011a5b149706c120', true],
        ['anicli', '3ad5363', false],
        ['anicli', 'master', false],
        ['busybox', '1.35.0', true],
        ['busybox', 'FRP-6075-g169694ebd', true],
        ['busybox', '../x', false],
        ['busybox', '', false],
        ['curl', '8.22.0', true],
        ['curl', 'a/b', false],
        ['curl', 'x'.repeat(60), false]
    ] as const)('for %s, %j is %s', (id, version, expected) => {
        expect(isProgramVersion(id, version)).toBe(expected);
    });
});
