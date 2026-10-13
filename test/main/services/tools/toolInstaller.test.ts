import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ToolSpec, ToolState } from '@shared/tools';
import { extractArchive } from '@main/services/tools/archiveExtract';
import { DOWNLOAD_SHARE, MARKER_FILE, ToolInstaller } from '@main/services/tools/toolInstaller';
import { ToolDownloadError, type DownloadOptions, type DownloadResult } from '@main/services/tools/toolDownload';
import { cleanTempDirs, makeTempDir } from '../../../helpers/tempDir';

const SPEC: ToolSpec = {
    id: 'suwayomi',
    version: 'v1',
    url: 'https://example.com/suwayomi-v1.tar.gz',
    sha256: 'a'.repeat(64),
    sizeBytes: 1000,
    format: 'tar.gz',
    stripComponents: 1,
    exclude: ['electron'],
    executables: ['jre/bin/java'],
    entry: 'bin/server.jar'
};

type Download = (options: DownloadOptions) => Promise<DownloadResult>;
type Extract = typeof extractArchive;

function goodDownload(overrides: Partial<DownloadResult> = {}): { download: Download; calls: DownloadOptions[] } {
    const calls: DownloadOptions[] = [];
    const download: Download = (options) => {
        calls.push(options);
        mkdirSync(dirname(options.destination), { recursive: true });
        writeFileSync(options.destination, 'archive');
        options.onProgress?.({ bytesDone: 250, bytesTotal: 1000 });
        options.onProgress?.({ bytesDone: 1000, bytesTotal: 1000 });
        return Promise.resolve({ sha256: SPEC.sha256, bytes: 1000, ...overrides });
    };
    return { download, calls };
}

// An unpacking that makes the files the install expects.
function goodExtract(files: string[] = ['jre/bin/java', 'bin/server.jar']): { extract: Extract; calls: unknown[] } {
    const calls: unknown[] = [];
    const extract: Extract = (format, file, options) => {
        calls.push({ format, file, options });
        files.forEach((path) => {
            const full = join(options.destination, path);
            mkdirSync(join(full, '..'), { recursive: true });
            writeFileSync(full, path);
        });
        return Promise.resolve();
    };
    return { extract, calls };
}

function setup(parts: { download?: Download; extract?: Extract } = {}) {
    const root = makeTempDir();
    const states: ToolState[] = [];
    const installer = new ToolInstaller({
        rootDirectory: root,
        download: parts.download ?? goodDownload().download,
        extract: parts.extract ?? goodExtract().extract,
        onState: (state) => {
            states.push(state);
        }
    });
    return { installer, root, states, folder: join(root, 'suwayomi') };
}

afterEach(() => {
    cleanTempDirs();
});

describe('ToolInstaller', () => {
    it('is missing before the first install', () => {
        const { installer } = setup();
        expect(installer.isReady(SPEC)).toBe(false);
        expect(installer.stateOf(SPEC)).toEqual({ id: 'suwayomi', status: 'missing', version: 'v1', bytesDone: 0, bytesTotal: 0, percent: 0, error: null });
    });

    it('downloads, checks, unpacks and moves the program in, reporting every step', async () => {
        const { download, calls: downloads } = goodDownload();
        const { extract, calls: extractions } = goodExtract();
        const { installer, root, states, folder } = setup({ download, extract });
        const result = await installer.install(SPEC);
        expect(result).toEqual({ id: 'suwayomi', status: 'ready', version: 'v1', bytesDone: 0, bytesTotal: 0, percent: 100, error: null });
        expect(downloads).toHaveLength(1);
        expect(downloads[0]).toMatchObject({ url: SPEC.url, destination: join(folder, 'download-v1.part'), expectedBytes: 1000 });
        expect(extractions).toEqual([
            { format: 'tar.gz', file: join(folder, 'download-v1.part'), options: { destination: join(folder, 'staging-v1'), stripComponents: 1, exclude: ['electron'] } }
        ]);
        expect(states.map((state) => {
            return [state.status, state.percent];
        })).toEqual([
            ['downloading', 0],
            ['downloading', Math.floor(0.25 * DOWNLOAD_SHARE)],
            ['downloading', DOWNLOAD_SHARE],
            ['verifying', DOWNLOAD_SHARE],
            ['extracting', 90],
            ['ready', 100]
        ]);
        expect(states[1]).toMatchObject({ bytesDone: 250, bytesTotal: 1000 });
        expect(installer.directoryOf(SPEC)).toBe(join(root, 'suwayomi', 'v1'));
        expect(installer.pathOf(SPEC, 'bin/server.jar')).toBe(join(root, 'suwayomi', 'v1', 'bin', 'server.jar'));
        expect(readFileSync(installer.pathOf(SPEC, 'bin/server.jar'), 'utf-8')).toBe('bin/server.jar');
        expect(JSON.parse(readFileSync(installer.pathOf(SPEC, MARKER_FILE), 'utf-8'))).toEqual({ id: 'suwayomi', version: 'v1', sha256: SPEC.sha256 });
        expect(readdirSync(folder)).toEqual(['v1']);
        expect(installer.isReady(SPEC)).toBe(true);
        expect(installer.stateOf(SPEC)).toMatchObject({ status: 'ready', percent: 100 });
    });

    it('makes the executables runnable', async () => {
        const { installer } = setup();
        await installer.install(SPEC);
        if (process.platform !== 'win32') {
            expect(statSync(installer.pathOf(SPEC, 'jre/bin/java')).mode & 0o111).not.toBe(0);
        }
    });

    it('does nothing when the program is already there', async () => {
        const { download, calls } = goodDownload();
        const { installer } = setup({ download });
        await installer.install(SPEC);
        const again = await installer.install(SPEC);
        expect(again.status).toBe('ready');
        expect(calls).toHaveLength(1);
    });

    it('installs again when the entry file is gone', async () => {
        const { download, calls } = goodDownload();
        const { installer } = setup({ download });
        await installer.install(SPEC);
        const { rmSync } = await import('node:fs');
        rmSync(installer.pathOf(SPEC, 'bin/server.jar'));
        expect(installer.isReady(SPEC)).toBe(false);
        await installer.install(SPEC);
        expect(calls).toHaveLength(2);
        expect(installer.isReady(SPEC)).toBe(true);
    });

    it('is not ready when the marker belongs to another checksum or is unreadable', async () => {
        const { installer } = setup();
        await installer.install(SPEC);
        writeFileSync(installer.pathOf(SPEC, MARKER_FILE), JSON.stringify({ id: 'suwayomi', version: 'v1', sha256: 'b'.repeat(64) }));
        expect(installer.isReady(SPEC)).toBe(false);
        writeFileSync(installer.pathOf(SPEC, MARKER_FILE), 'not json');
        expect(installer.isReady(SPEC)).toBe(false);
    });

    it('shares one install between callers that ask together', async () => {
        const { download, calls } = goodDownload();
        const { installer } = setup({ download });
        const [first, second] = await Promise.all([installer.install(SPEC), installer.install(SPEC)]);
        expect(first).toBe(second);
        expect(calls).toHaveLength(1);
    });

    it('refuses a download that does not match the checksum and keeps nothing', async () => {
        const { download } = goodDownload({ sha256: 'c'.repeat(64) });
        const { extract, calls: extractions } = goodExtract();
        const { installer, folder } = setup({ download, extract });
        const result = await installer.install(SPEC);
        expect(result).toMatchObject({
            status: 'error',
            percent: 0,
            error: { code: 'HASH_MISMATCH', message: 'The downloaded file does not match the checksum the app expects' }
        });
        expect(extractions).toHaveLength(0);
        expect(readdirSync(folder)).toEqual([]);
        expect(installer.isReady(SPEC)).toBe(false);
        expect(installer.stateOf(SPEC)).toMatchObject({ status: 'error' });
    });

    it('reports a download that failed', async () => {
        const download: Download = () => {
            return Promise.reject(new ToolDownloadError('The server answered 404'));
        };
        const { installer } = setup({ download });
        await expect(installer.install(SPEC)).resolves.toMatchObject({ status: 'error', error: { code: 'DOWNLOAD_FAILED', message: 'The server answered 404' } });
    });

    it('reports an archive that cannot be unpacked and cleans up', async () => {
        const extract: Extract = (_format, _file, options) => {
            mkdirSync(options.destination, { recursive: true });
            writeFileSync(join(options.destination, 'half'), 'x');
            return Promise.reject(new Error('unexpected end of archive'));
        };
        const { installer, folder } = setup({ extract });
        await expect(installer.install(SPEC)).resolves.toMatchObject({ status: 'error', error: { code: 'EXTRACT_FAILED', message: 'unexpected end of archive' } });
        expect(readdirSync(folder)).toEqual([]);
    });

    it('reports an archive without a program that must be runnable', async () => {
        const { extract } = goodExtract(['bin/server.jar']);
        const { installer } = setup({ extract });
        await expect(installer.install(SPEC)).resolves.toMatchObject({ status: 'error', error: { code: 'INCOMPLETE', message: 'The archive does not have jre/bin/java' } });
    });

    it('reports an archive without the entry file', async () => {
        const { extract } = goodExtract(['jre/bin/java']);
        const { installer, folder } = setup({ extract });
        await expect(installer.install(SPEC)).resolves.toMatchObject({ status: 'error', error: { code: 'INCOMPLETE', message: 'The archive does not have bin/server.jar' } });
        expect(readdirSync(folder)).toEqual([]);
    });

    it.each([['ENOSPC'], ['EACCES'], ['EPERM'], ['EROFS'], ['EDQUOT']])('reports %s as a disk problem', async (code) => {
        const download: Download = () => {
            return Promise.reject(Object.assign(new Error('no space left on device'), { code }));
        };
        const { installer } = setup({ download });
        await expect(installer.install(SPEC)).resolves.toMatchObject({ status: 'error', error: { code: 'DISK', message: 'no space left on device' } });
    });

    it('goes back to missing, without an error, when the install is cancelled', async () => {
        const controller = new AbortController();
        const download: Download = (options) => {
            mkdirSync(dirname(options.destination), { recursive: true });
            writeFileSync(options.destination, 'partial');
            controller.abort();
            return Promise.reject(new DOMException('aborted', 'AbortError'));
        };
        const { installer, folder } = setup({ download });
        const result = await installer.install(SPEC, controller.signal);
        expect(result).toMatchObject({ status: 'missing', percent: 0, error: null });
        expect(readdirSync(folder)).toEqual([]);
    });

    it('can try again after a failure', async () => {
        let attempts = 0;
        const { download } = goodDownload();
        const flaky: Download = (options) => {
            attempts += 1;
            return attempts === 1 ? Promise.reject(new ToolDownloadError('offline')) : download(options);
        };
        const { installer } = setup({ download: flaky });
        await expect(installer.install(SPEC)).resolves.toMatchObject({ status: 'error' });
        await expect(installer.install(SPEC)).resolves.toMatchObject({ status: 'ready' });
        expect(installer.isReady(SPEC)).toBe(true);
    });

    it('removes the folders of other versions once the new one is in', async () => {
        const { installer, folder } = setup();
        mkdirSync(join(folder, 'v0'), { recursive: true });
        writeFileSync(join(folder, 'v0', 'old'), 'old');
        await installer.install(SPEC);
        expect(readdirSync(folder)).toEqual(['v1']);
    });

    it('keeps the version that works when the new one fails', async () => {
        const { installer, folder } = setup();
        await installer.install(SPEC);
        const failing = new ToolInstaller({
            rootDirectory: join(folder, '..'),
            download: () => {
                return Promise.reject(new ToolDownloadError('offline'));
            },
            extract: goodExtract().extract
        });
        const next: ToolSpec = { ...SPEC, version: 'v2', sha256: 'd'.repeat(64) };
        await expect(failing.install(next)).resolves.toMatchObject({ status: 'error' });
        expect(existsSync(installer.pathOf(SPEC, 'bin/server.jar'))).toBe(true);
        expect(installer.isReady(SPEC)).toBe(true);
    });

    it('does not report a stale install state once the program is there', async () => {
        const { installer } = setup();
        await installer.install(SPEC);
        expect(installer.stateOf(SPEC).status).toBe('ready');
    });
});

describe('ToolInstaller keeping the other versions', () => {
    const NEXT: ToolSpec = { ...SPEC, version: 'v2' };

    function installed(root: string): ToolInstaller {
        return new ToolInstaller({ rootDirectory: root, download: goodDownload().download, extract: goodExtract().extract });
    }

    it('takes the other versions away after an install, unless it is told to keep them', async () => {
        const root = makeTempDir();
        const installer = installed(root);
        await installer.install(SPEC);
        await installer.install(NEXT);
        expect(readdirSync(join(root, 'suwayomi'))).toEqual(['v2']);
    });

    it('keeps the version that runs when it is told to, so a newer one can be put beside it', async () => {
        const root = makeTempDir();
        const installer = installed(root);
        await installer.install(SPEC);
        const state = await installer.install(NEXT, undefined, true);
        expect(state.status).toBe('ready');
        expect(readdirSync(join(root, 'suwayomi')).sort()).toEqual(['v1', 'v2']);
        expect(installer.isReady(SPEC)).toBe(true);
        expect(installer.isReady(NEXT)).toBe(true);
    });

    it('takes the other versions away later, leaving the folders of an install that is going on', async () => {
        const root = makeTempDir();
        const installer = installed(root);
        await installer.install(SPEC);
        await installer.install(NEXT, undefined, true);
        mkdirSync(join(root, 'suwayomi', 'staging-v3'), { recursive: true });
        writeFileSync(join(root, 'suwayomi', 'download-v3.part'), 'x');
        installer.removeOthers(NEXT);
        expect(readdirSync(join(root, 'suwayomi')).sort()).toEqual(['download-v3.part', 'staging-v3', 'v2']);
    });

    it('does nothing when the program has no folder yet', () => {
        const installer = installed(makeTempDir());
        expect(() => {
            installer.removeOthers(SPEC);
        }).not.toThrow();
    });
});

describe('ToolInstaller a program that is one file (raw)', () => {
    const RAW: ToolSpec = {
        id: 'ytdlp',
        version: '2026.08.19',
        url: 'https://example.com/yt-dlp_linux',
        sha256: 'b'.repeat(64),
        sizeBytes: 500,
        format: 'raw',
        stripComponents: 0,
        exclude: [],
        executables: ['yt-dlp'],
        entry: 'yt-dlp'
    };

    function rawDownload(content = 'the program'): { download: Download; calls: DownloadOptions[] } {
        const calls: DownloadOptions[] = [];
        const download: Download = (options) => {
            calls.push(options);
            mkdirSync(dirname(options.destination), { recursive: true });
            writeFileSync(options.destination, content);
            return Promise.resolve({ sha256: RAW.sha256, bytes: content.length });
        };
        return { download, calls };
    }

    function rawSetup(download: Download, extract?: Extract) {
        const root = makeTempDir();
        const states: ToolState[] = [];
        const extractions: unknown[] = [];
        const installer = new ToolInstaller({
            rootDirectory: root,
            download,
            extract:
                extract ??
                ((...args) => {
                    extractions.push(args);
                    return Promise.resolve();
                }),
            onState: (state) => {
                states.push(state);
            }
        });
        return { installer, root, states, extractions };
    }

    it('puts the downloaded file where the spec says, unpacking nothing, and makes it runnable', async () => {
        const { download, calls } = rawDownload();
        const { installer, root, extractions } = rawSetup(download);
        const result = await installer.install(RAW);
        expect(result).toMatchObject({ id: 'ytdlp', status: 'ready', version: '2026.08.19', percent: 100 });
        expect(extractions).toEqual([]);
        expect(calls[0]).toMatchObject({ url: RAW.url, destination: join(root, 'ytdlp', 'download-2026.08.19.part'), expectedBytes: 500 });
        expect(readFileSync(installer.pathOf(RAW, 'yt-dlp'), 'utf-8')).toBe('the program');
        if (process.platform !== 'win32') {
            expect(statSync(installer.pathOf(RAW, 'yt-dlp')).mode & 0o111).not.toBe(0);
        }
        expect(JSON.parse(readFileSync(installer.pathOf(RAW, MARKER_FILE), 'utf-8'))).toEqual({ id: 'ytdlp', version: '2026.08.19', sha256: RAW.sha256 });
        expect(readdirSync(join(root, 'ytdlp'))).toEqual(['2026.08.19']);
        expect(installer.isReady(RAW)).toBe(true);
    });

    it('puts a file in a folder of its own, like the program that goes in bin/', async () => {
        const nested: ToolSpec = { ...RAW, id: 'anicli', version: 'abc1234', executables: ['bin/ani-cli'], entry: 'bin/ani-cli' };
        const { installer } = rawSetup(rawDownload('#!/bin/sh').download);
        await installer.install(nested);
        expect(readFileSync(installer.pathOf(nested, 'bin/ani-cli'), 'utf-8')).toBe('#!/bin/sh');
    });

    it('does not take a file that is not the one the app expects', async () => {
        const { installer, root, states } = rawSetup((options) => {
            mkdirSync(dirname(options.destination), { recursive: true });
            writeFileSync(options.destination, 'other');
            return Promise.resolve({ sha256: 'c'.repeat(64), bytes: 5 });
        });
        const result = await installer.install(RAW);
        expect(result).toMatchObject({ status: 'error', error: { code: 'HASH_MISMATCH' } });
        expect(states.at(-1)).toMatchObject({ status: 'error' });
        expect(existsSync(join(root, 'ytdlp', '2026.08.19'))).toBe(false);
        expect(readdirSync(join(root, 'ytdlp'))).toEqual([]);
    });
});

describe('ToolInstaller the check of what was unpacked', () => {
    it('puts the program in its place when the check lets it through, and gives the check the folder it unpacked', async () => {
        const { installer, root } = setup();
        const seen: string[] = [];
        const result = await installer.install(SPEC, undefined, false, (directory) => {
            seen.push(directory);
            expect(existsSync(join(directory, 'bin/server.jar'))).toBe(true);
            return Promise.resolve();
        });
        expect(result.status).toBe('ready');
        expect(seen).toEqual([join(root, 'suwayomi', 'staging-v1')]);
        expect(installer.isReady(SPEC)).toBe(true);
    });

    it('installs nothing, and says why, when the check throws', async () => {
        const { installer, folder, states } = setup();
        const result = await installer.install(SPEC, undefined, false, () => {
            return Promise.reject(new Error('The new program does not run'));
        });
        expect(result).toEqual({ id: 'suwayomi', status: 'error', version: 'v1', bytesDone: 0, bytesTotal: 0, percent: 0, error: { code: 'INVALID', message: 'The new program does not run' } });
        expect(states.at(-1)).toMatchObject({ status: 'error', error: { code: 'INVALID' } });
        expect(installer.isReady(SPEC)).toBe(false);
        expect(readdirSync(folder)).toEqual([]);
    });

    it('keeps the version that works when the check of the new one fails', async () => {
        const { installer, folder } = setup();
        await installer.install(SPEC);
        const next: ToolSpec = { ...SPEC, version: 'v2' };
        const result = await installer.install(next, undefined, true, () => {
            return Promise.reject(new Error('does not run'));
        });
        expect(result.status).toBe('error');
        expect(installer.isReady(SPEC)).toBe(true);
        expect(readdirSync(folder)).toEqual(['v1']);
    });

    it('does not run the check when the program is already there', async () => {
        const { installer } = setup();
        await installer.install(SPEC);
        const verify = vi.fn(() => {
            return Promise.resolve();
        });
        await installer.install(SPEC, undefined, false, verify);
        expect(verify).not.toHaveBeenCalled();
    });

    it('does not run the check for a download that failed, nor for a checksum that does not match', async () => {
        const verify = vi.fn(() => {
            return Promise.resolve();
        });
        const failing = setup({ download: () => {return Promise.reject(new ToolDownloadError('offline'))} });
        expect((await failing.installer.install(SPEC, undefined, false, verify)).error?.code).toBe('DOWNLOAD_FAILED');
        const wrong = setup({ download: goodDownload({ sha256: 'f'.repeat(64) }).download });
        expect((await wrong.installer.install(SPEC, undefined, false, verify)).error?.code).toBe('HASH_MISMATCH');
        expect(verify).not.toHaveBeenCalled();
    });
});
