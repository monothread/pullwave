import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PROGRAM_IDS, type ProgramId, type ToolSpec, type ToolState } from '@shared/tools';
import type { extractArchive } from '@main/services/tools/archiveExtract';
import { LookupError, type LatestDependencies } from '@main/services/tools/programLatest';
import { ffmpegSpec, pinnedSpec, ytdlpSpec, denoSpec, aniCliSpec } from '@main/services/tools/programSpecs';
import { PREPARE_CONCURRENCY, ProgramTools, SELECTED_SUFFIX, type RunProgram } from '@main/services/tools/programTools';
import { ToolDownloadError, type DownloadOptions, type DownloadResult } from '@main/services/tools/toolDownload';
import { ALL_SUBTITLES_PART, aniCliScript, DEBUG_PART, SELECTION_PART } from '../../../helpers/aniCliScripts';
import { cleanTempDirs, makeTempDir } from '../../../helpers/tempDir';

const LINUX_FFMPEG_ASSET = 'ffmpeg-n9.0-latest-linux64-gpl-shared-9.0.tar.xz';
const SHA_A = 'aa'.repeat(32);
const SHA_B = 'bb'.repeat(32);
const COMMIT = 'c'.repeat(40);

type Download = (options: DownloadOptions) => Promise<DownloadResult>;

interface Setup {
    tools: ProgramTools;
    root: string;
    states: ToolState[];
    updates: ToolState[];
    downloads: DownloadOptions[];
    run: ReturnType<typeof vi.fn<RunProgram>>;
    // The specs the fake network knows (the pinned ones and the ones a test adds).
    register: (spec: ToolSpec) => void;
    failing: Set<string>;
    // Addresses whose file comes with another checksum than the publisher listed.
    corrupt: Set<string>;
    custom: Record<string, string>;
    latest: { value: Partial<Record<ProgramId, ToolSpec | Error>> };
    gate: { value: Promise<void> | null };
}

function setup(options: { platform?: NodeJS.Platform; arch?: string; downloadLatency?: boolean } = {}): Setup {
    const platform = options.platform ?? 'linux';
    const arch = options.arch ?? 'x64';
    const root = makeTempDir();
    const states: ToolState[] = [];
    const updates: ToolState[] = [];
    const downloads: DownloadOptions[] = [];
    const failing = new Set<string>();
    const corrupt = new Set<string>();
    const custom: Record<string, string> = {};
    const latest: { value: Partial<Record<ProgramId, ToolSpec | Error>> } = { value: {} };
    const gate: { value: Promise<void> | null } = { value: null };
    const specs = new Map<string, ToolSpec>();
    PROGRAM_IDS.forEach((id) => {
        (['linux', 'win32'] as const).forEach((system) => {
            const spec = pinnedSpec(id, system, 'x64');
            if (spec !== null) {
                specs.set(spec.url, spec);
            }
        });
    });
    const download: Download = async (downloadOptions) => {
        downloads.push(downloadOptions);
        if (gate.value !== null) {
            await gate.value;
        }
        if (failing.has(downloadOptions.url)) {
            throw new ToolDownloadError('The connection was lost');
        }
        mkdirSync(dirname(downloadOptions.destination), { recursive: true });
        writeFileSync(downloadOptions.destination, `file of ${downloadOptions.url}`);
        downloadOptions.onProgress?.({ bytesDone: 50, bytesTotal: 100 });
        return { sha256: corrupt.has(downloadOptions.url) ? 'e'.repeat(64) : (specs.get(downloadOptions.url)?.sha256 ?? 'f'.repeat(64)), bytes: 100 };
    };
    // Unpacking: the files the spec of the address says it has.
    const extract: typeof extractArchive = (_format, file, extractOptions) => {
        const url = readFileSync(file, 'utf-8').replace('file of ', '');
        const spec = specs.get(url);
        [...(spec?.executables ?? []), spec?.entry ?? 'x'].forEach((path) => {
            const full = join(extractOptions.destination, path);
            mkdirSync(dirname(full), { recursive: true });
            writeFileSync(full, `program ${path}`);
        });
        return Promise.resolve();
    };
    const run = vi.fn<RunProgram>(async () => {
        return { ok: true, output: 'ok' };
    });
    const lookups: LatestDependencies = {
        fetchText: () => {return Promise.reject(new Error('not used'))},
        fetchBuffer: () => {return Promise.reject(new Error('not used'))},
        fetchSize: () => {return Promise.reject(new Error('not used'))},
        verifySums: () => {return Promise.resolve(true)}
    };
    const tools = new ProgramTools({
        rootDirectory: root,
        platform,
        arch,
        customPath: (id) => {
            return custom[id] ?? '';
        },
        onState: (state) => {
            states.push(state);
        },
        onUpdateState: (state) => {
            updates.push(state);
        },
        download,
        extract,
        latest: lookups,
        run
    });
    // The lookups of the latest version are replaced by what the test says.
    const instance = tools as unknown as { lookup: (id: ProgramId) => Promise<{ spec: ToolSpec; unfit: never[] }>; firstSpec?: unknown };
    instance.lookup = (id) => {
        const found = latest.value[id];
        if (found === undefined) {
            return Promise.reject(new LookupError('no-release', 'There is no release'));
        }
        if (found instanceof Error) {
            return Promise.reject(found);
        }
        // What the publisher lists, the network can give.
        specs.set(found.url, found);
        return Promise.resolve({ spec: found, unfit: [] });
    };
    return {
        tools,
        root,
        states,
        updates,
        downloads,
        run,
        failing,
        corrupt,
        custom,
        latest,
        gate,
        register: (spec) => {
            specs.set(spec.url, spec);
        }
    };
}

function ffmpegLatest(sha = SHA_A): ToolSpec {
    return ffmpegSpec('linux', LINUX_FFMPEG_ASSET, sha, 70_000_000) as ToolSpec;
}

function writeSelected(context: Setup, id: ProgramId, content: unknown): void {
    mkdirSync(context.root, { recursive: true });
    writeFileSync(join(context.root, `${id}${SELECTED_SUFFIX}`), typeof content === 'string' ? content : JSON.stringify(content));
}

afterEach(() => {
    cleanTempDirs();
});

describe('ProgramTools before anything is installed', () => {
    it('knows the system it is for', () => {
        expect(setup().tools.system).toBe('linux');
        expect(setup({ platform: 'win32' }).tools.system).toBe('win32');
        expect(setup({ platform: 'darwin', arch: 'arm64' }).tools.system).toBeNull();
        expect(setup({ platform: 'linux', arch: 'arm64' }).tools.system).toBeNull();
    });

    it('has every program missing, with the version the app was made with, but ffmpeg, which has none', () => {
        const { tools } = setup();
        PROGRAM_IDS.forEach((id) => {
            const state = tools.stateOf(id);
            expect(state.status).toBe('missing');
            expect(state.id).toBe(id);
            expect(state.error).toBeNull();
            expect(tools.pathOf(id)).toBeNull();
            expect(tools.directoryOf(id)).toBeNull();
            expect(tools.isReady(id)).toBe(false);
        });
        expect(tools.stateOf('ytdlp').version).toBe('2026.08.19');
        expect(tools.stateOf('deno').version).toBe('v2.9.7');
        expect(tools.stateOf('busybox').version).toBe('1.35.0');
        expect(tools.stateOf('curl').version).toBe('8.22.0');
        expect(tools.stateOf('ffmpeg').version).toBeNull();
    });

    it('says the programs are not made for a system they are not made for', () => {
        const { tools } = setup({ platform: 'darwin', arch: 'arm64' });
        expect(tools.stateOf('ytdlp')).toMatchObject({ status: 'error', error: { code: 'UNSUPPORTED_PLATFORM' } });
        expect(tools.status().supported).toBe(false);
    });

    it('gives the shape of the status for the screen: every program, with its state, whether a path of the user replaces it, and its folder', () => {
        const { tools, custom } = setup();
        custom['ytdlp'] = '/usr/bin/yt-dlp';
        const status = tools.status();
        expect(status.supported).toBe(true);
        expect(
            status.programs.map((program) => {
                return [program.id, program.state.status, program.custom, program.directory];
            })
        ).toEqual([
            ['ytdlp', 'missing', true, null],
            ['deno', 'missing', false, null],
            ['ffmpeg', 'missing', false, null],
            ['anicli', 'missing', false, null],
            ['busybox', 'missing', false, null],
            ['curl', 'missing', false, null]
        ]);
    });
});

describe('ProgramTools installing', () => {
    it('installs the version the app was made with, from its address, and gives the path of the file', async () => {
        const { tools, root, downloads, states } = setup();
        const state = await tools.install('ytdlp');
        expect(state).toMatchObject({ id: 'ytdlp', status: 'ready', version: '2026.08.19', percent: 100 });
        expect(downloads).toHaveLength(1);
        expect(downloads[0]).toMatchObject({ url: 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp_linux', expectedBytes: 40_446_224 });
        expect(tools.pathOf('ytdlp')).toBe(join(root, 'ytdlp', '2026.08.19', 'yt-dlp'));
        expect(tools.directoryOf('ytdlp')).toBe(join(root, 'ytdlp', '2026.08.19'));
        expect(tools.isReady('ytdlp')).toBe(true);
        expect(tools.stateOf('ytdlp')).toMatchObject({ status: 'ready' });
        expect(states.map((entry) => {
            return entry.status;
        })).toEqual(['downloading', 'downloading', 'verifying', 'extracting', 'ready']);
    });

    it('runs the program once, before it takes its place, to see that it works', async () => {
        const { tools, root, run } = setup();
        await tools.install('ytdlp');
        expect(run).toHaveBeenCalledTimes(1);
        expect(run).toHaveBeenCalledWith(join(root, 'ytdlp', 'staging-2026.08.19', 'yt-dlp'), ['--version']);
    });

    it.each([
        ['deno', ['--version'], 'deno'],
        ['curl', ['--version'], 'curl'],
        ['busybox', ['true'], 'busybox']
    ] as const)('checks %s by running it with %j', async (id, args, file) => {
        const { tools, root, run } = setup();
        await tools.install(id);
        const version = pinnedSpec(id, 'linux', 'x64')?.version as string;
        expect(run).toHaveBeenCalledWith(join(root, id, `staging-${version}`, file), [...args]);
    });

    it('does not run again, nor download again, when the program is there', async () => {
        const { tools, downloads, run } = setup();
        await tools.install('deno');
        await tools.install('deno');
        expect(downloads).toHaveLength(1);
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('does not install a program that does not run, and says so', async () => {
        const { tools, root, run } = setup();
        run.mockResolvedValue({ ok: false, output: 'cannot execute binary file' });
        const state = await tools.install('ytdlp');
        expect(state).toMatchObject({ status: 'error', error: { code: 'INVALID', message: 'The program does not run: cannot execute binary file' } });
        expect(tools.isReady('ytdlp')).toBe(false);
        expect(readdirSync(join(root, 'ytdlp'))).toEqual([]);
        expect(tools.stateOf('ytdlp')).toMatchObject({ status: 'error', error: { code: 'INVALID' } });
    });

    it('says the download failed, keeps saying it, and installs on the next try', async () => {
        const { tools, failing, states } = setup();
        failing.add('https://github.com/denoland/deno/releases/download/v2.9.7/deno-x86_64-unknown-linux-gnu.zip');
        const failed = await tools.install('deno');
        expect(failed).toMatchObject({ status: 'error', error: { code: 'DOWNLOAD_FAILED', message: 'The connection was lost' } });
        expect(tools.stateOf('deno')).toMatchObject({ status: 'error', error: { code: 'DOWNLOAD_FAILED' } });
        expect(states.at(-1)).toMatchObject({ id: 'deno', status: 'error' });
        failing.clear();
        const again = await tools.install('deno');
        expect(again.status).toBe('ready');
        expect(tools.stateOf('deno').status).toBe('ready');
        expect(tools.pathOf('deno')).not.toBeNull();
    });

    it('does not take a file that is not the one the app expects', async () => {
        const { tools, register } = setup();
        const spec = pinnedSpec('busybox', 'linux', 'x64') as ToolSpec;
        register({ ...spec, sha256: '0'.repeat(64) });
        const state = await tools.install('busybox');
        expect(state).toMatchObject({ status: 'error', error: { code: 'HASH_MISMATCH' } });
        expect(tools.isReady('busybox')).toBe(false);
    });

    it('installs nothing on a system the programs are not made for', async () => {
        const { tools, downloads } = setup({ platform: 'darwin', arch: 'arm64' });
        expect(await tools.install('ytdlp')).toMatchObject({ status: 'error', error: { code: 'UNSUPPORTED_PLATFORM' } });
        expect(downloads).toEqual([]);
    });

    it('installs the program of Windows with the names of Windows', async () => {
        const { tools, root } = setup({ platform: 'win32' });
        await tools.install('ytdlp');
        await tools.install('busybox');
        expect(tools.pathOf('ytdlp')).toBe(join(root, 'ytdlp', '2026.08.19', 'yt-dlp.exe'));
        expect(tools.pathOf('busybox')).toBe(join(root, 'busybox', 'FRP-6075-g169694ebd', 'busybox.exe'));
    });

    it('gives the path of another file of the same install, like ffprobe beside ffmpeg', async () => {
        const { tools, root, latest } = setup();
        latest.value.ffmpeg = ffmpegLatest();
        await tools.install('ffmpeg');
        expect(tools.pathOf('ffmpeg')).toBe(join(root, 'ffmpeg', ffmpegLatest().version, 'bin', 'ffmpeg'));
        expect(tools.pathOf('ffmpeg', 'bin/ffprobe')).toBe(join(root, 'ffmpeg', ffmpegLatest().version, 'bin', 'ffprobe'));
    });
});

describe('ProgramTools the check of ani-cli', () => {
    it('looks at the script with the shell that is installed', async () => {
        const { tools, root, run } = setup();
        await tools.install('busybox');
        run.mockClear();
        await tools.install('anicli');
        expect(run).toHaveBeenCalledTimes(1);
        expect(run).toHaveBeenCalledWith(tools.pathOf('busybox'), ['sh', '-n', join(root, 'anicli', 'staging-3ad53631ef2433b0c26e25ab011a5b149706c120', 'ani-cli')]);
    });

    it('does not install a script the shell does not accept', async () => {
        const { tools, run } = setup();
        await tools.install('busybox');
        run.mockResolvedValue({ ok: false, output: 'syntax error' });
        const state = await tools.install('anicli');
        expect(state).toMatchObject({ status: 'error', error: { code: 'INVALID', message: 'The shell does not accept the script of ani-cli' } });
    });

    it('installs the script without that check when the shell is not installed yet', async () => {
        const { tools, run } = setup();
        const state = await tools.install('anicli');
        expect(state.status).toBe('ready');
        expect(run).not.toHaveBeenCalled();
    });
});

describe('ProgramTools ffmpeg, which has no version of the app', () => {
    it('looks up the latest on the first install, remembers it, and installs it', async () => {
        const { tools, root, latest, downloads } = setup();
        latest.value.ffmpeg = ffmpegLatest();
        const state = await tools.install('ffmpeg');
        expect(state).toMatchObject({ status: 'ready', version: `latest-${SHA_A.slice(0, 12)}` });
        expect(downloads[0]).toMatchObject({ url: `https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/${LINUX_FFMPEG_ASSET}`, expectedBytes: 70_000_000 });
        expect(JSON.parse(readFileSync(join(root, `ffmpeg${SELECTED_SUFFIX}`), 'utf-8'))).toEqual({ version: `latest-${SHA_A.slice(0, 12)}`, sha256: SHA_A, sizeBytes: 70_000_000, asset: LINUX_FFMPEG_ASSET });
        expect(tools.isReady('ffmpeg')).toBe(true);
    });

    it('does not look it up again once it is installed', async () => {
        const { tools, latest, downloads } = setup();
        latest.value.ffmpeg = ffmpegLatest();
        await tools.install('ffmpeg');
        latest.value.ffmpeg = new Error('offline');
        const state = await tools.install('ffmpeg');
        expect(state.status).toBe('ready');
        expect(downloads).toHaveLength(1);
    });

    it('says why it could not be looked up, with the reason of the failure, and tries again on the next call', async () => {
        const { tools, latest, states } = setup();
        latest.value.ffmpeg = new Error('Request failed (503)');
        const first = await tools.install('ffmpeg');
        expect(first).toMatchObject({ id: 'ffmpeg', status: 'error', error: { code: 'DOWNLOAD_FAILED', message: 'Request failed (503)' } });
        expect(tools.stateOf('ffmpeg')).toMatchObject({ status: 'error', error: { code: 'DOWNLOAD_FAILED' } });
        expect(states.at(-1)).toMatchObject({ id: 'ffmpeg', status: 'error' });
        latest.value.ffmpeg = new LookupError('checksum', 'The list of checksums does not have the build');
        await tools.install('ffmpeg');
        expect(tools.stateOf('ffmpeg')).toMatchObject({ status: 'error', error: { code: 'INVALID', message: 'The list of checksums does not have the build' } });
        latest.value.ffmpeg = ffmpegLatest();
        expect((await tools.install('ffmpeg')).status).toBe('ready');
        expect(tools.stateOf('ffmpeg').status).toBe('ready');
    });

    it('looks the build up again when the download of the one it remembered fails, since the builds are rolling', async () => {
        const { tools, latest, failing, register } = setup();
        latest.value.ffmpeg = ffmpegLatest(SHA_A);
        register(ffmpegLatest(SHA_A));
        failing.add(ffmpegLatest(SHA_A).url);
        expect((await tools.install('ffmpeg')).status).toBe('error');
        // The publisher put another build in its place meanwhile.
        const newer = ffmpegSpec('linux', 'ffmpeg-n9.1-latest-linux64-gpl-shared-9.1.tar.xz', SHA_B, 71_000_000) as ToolSpec;
        register(newer);
        latest.value.ffmpeg = newer;
        const state = await tools.install('ffmpeg');
        expect(state).toMatchObject({ status: 'ready', version: `latest-${SHA_B.slice(0, 12)}` });
        expect(tools.readSelected('ffmpeg')?.sha256).toBe(SHA_B);
    });

    it('goes on with the one it remembered when the lookup fails but that one can be downloaded', async () => {
        const { tools, latest, register, root } = setup();
        latest.value.ffmpeg = ffmpegLatest();
        register(ffmpegLatest());
        const spec = ffmpegLatest();
        writeSelected({ root } as Setup, 'ffmpeg', { version: spec.version, sha256: spec.sha256, sizeBytes: spec.sizeBytes, asset: LINUX_FFMPEG_ASSET });
        latest.value.ffmpeg = new Error('offline');
        const state = await tools.install('ffmpeg');
        expect(state).toMatchObject({ status: 'ready', version: spec.version });
    });
});

describe('ProgramTools the version that was chosen', () => {
    it('is the one the app was made with when nothing was chosen', () => {
        expect(setup().tools.chosenSpec('ytdlp')).toEqual(pinnedSpec('ytdlp', 'linux', 'x64'));
    });

    it.each([
        ['ytdlp', ytdlpSpec('2026.09.01', SHA_A, 41_000_000, 'linux'), { version: '2026.09.01', sha256: SHA_A, sizeBytes: 41_000_000 }],
        ['deno', denoSpec('v2.10.0', SHA_A, 42_000_000, 'linux'), { version: 'v2.10.0', sha256: SHA_A, sizeBytes: 42_000_000 }],
        ['anicli', aniCliSpec(COMMIT, SHA_A, 30_000), { version: COMMIT, sha256: SHA_A, sizeBytes: 30_000 }],
        ['ffmpeg', ffmpegLatest(), { version: `latest-${SHA_A.slice(0, 12)}`, sha256: SHA_A, sizeBytes: 70_000_000, asset: LINUX_FFMPEG_ASSET }]
    ] as const)('is the one the file says for %s, with the address built here', (id, expected, selected) => {
        const context = setup();
        writeSelected(context, id, selected);
        expect(context.tools.chosenSpec(id)).toEqual(expected);
        expect(context.tools.readSelected(id)).toEqual(selected);
    });

    it.each([
        ['text that is not JSON', 'not json'],
        ['a list', '[1]'],
        ['null', 'null'],
        ['a version that is a path', { version: '../../x', sha256: SHA_A, sizeBytes: 100 }],
        ['a version that is not one', { version: 'latest', sha256: SHA_A, sizeBytes: 100 }],
        ['a number for the version', { version: 2026, sha256: SHA_A, sizeBytes: 100 }],
        ['a checksum that is not 64 digits', { version: '2026.09.01', sha256: 'abc', sizeBytes: 100 }],
        ['a checksum in capitals', { version: '2026.09.01', sha256: SHA_A.toUpperCase(), sizeBytes: 100 }],
        ['no checksum', { version: '2026.09.01', sizeBytes: 100 }],
        ['a size of zero', { version: '2026.09.01', sha256: SHA_A, sizeBytes: 0 }],
        ['a negative size', { version: '2026.09.01', sha256: SHA_A, sizeBytes: -1 }],
        ['a size that is not a number', { version: '2026.09.01', sha256: SHA_A, sizeBytes: '100' }],
        ['a size that is too big', { version: '2026.09.01', sha256: SHA_A, sizeBytes: 100_000_001 }],
        ['a size that is not finite', '{"version":"2026.09.01","sha256":"' + SHA_A + '","sizeBytes":1e999}']
    ])('is not taken from a file that has %s: the version of the app is used', (_name, content) => {
        const context = setup();
        writeSelected(context, 'ytdlp', content);
        expect(context.tools.readSelected('ytdlp')).toBeNull();
        expect(context.tools.chosenSpec('ytdlp')).toEqual(pinnedSpec('ytdlp', 'linux', 'x64'));
    });

    it.each([['../evil.tar.xz'], ['ffmpeg-master-latest-linux64-gpl-shared.tar.xz'], [5]])('is not taken for ffmpeg with the file name %j', (asset) => {
        const context = setup();
        writeSelected(context, 'ffmpeg', { version: `latest-${SHA_A.slice(0, 12)}`, sha256: SHA_A, sizeBytes: 70_000_000, asset });
        expect(context.tools.readSelected('ffmpeg')).toBeNull();
        expect(context.tools.chosenSpec('ffmpeg')).toBeNull();
    });

    it('is never read for busybox or curl, which stay at their version', () => {
        const context = setup();
        writeSelected(context, 'busybox', { version: '1.36.0', sha256: SHA_A, sizeBytes: 100 });
        expect(context.tools.readSelected('busybox')).toBeNull();
        expect(context.tools.chosenSpec('busybox')).toEqual(pinnedSpec('busybox', 'linux', 'x64'));
    });

    it('is installed from its own folder, so the one of the app is not touched', async () => {
        const context = setup();
        const spec = ytdlpSpec('2026.09.01', SHA_A, 41_000_000, 'linux');
        context.register(spec);
        writeSelected(context, 'ytdlp', { version: spec.version, sha256: spec.sha256, sizeBytes: spec.sizeBytes });
        await context.tools.install('ytdlp');
        expect(context.tools.pathOf('ytdlp')).toBe(join(context.root, 'ytdlp', '2026.09.01', 'yt-dlp'));
        expect(context.downloads[0]?.url).toBe('https://github.com/yt-dlp/yt-dlp/releases/download/2026.09.01/yt-dlp_linux');
    });
});

describe('ProgramTools getting everything ready when the app opens', () => {
    it('installs every program, never more than two at a time', async () => {
        const context = setup();
        let going = 0;
        let most = 0;
        let release: () => void = () => {return undefined};
        context.gate.value = new Promise<void>((resolve) => {
            release = resolve;
        });
        const original = context.run.getMockImplementation();
        context.run.mockImplementation(async (file, args) => {
            return original ? original(file, args) : { ok: true, output: '' };
        });
        const wrapped = context.tools as unknown as { installer: { install: (...args: unknown[]) => Promise<ToolState> } };
        const install = wrapped.installer.install.bind(wrapped.installer);
        wrapped.installer.install = async (...args) => {
            going += 1;
            most = Math.max(most, going);
            try {
                return await install(...args);
            } finally {
                going -= 1;
            }
        };
        context.latest.value.ffmpeg = ffmpegLatest();
        context.register(ffmpegLatest());
        const preparing = context.tools.prepare();
        await Promise.resolve();
        await new Promise((resolve) => {
            setTimeout(resolve, 10);
        });
        release();
        await preparing;
        expect(most).toBe(PREPARE_CONCURRENCY);
        PROGRAM_IDS.forEach((id) => {
            expect(context.tools.isReady(id)).toBe(true);
        });
    });

    it('leaves out the programs the user gave a path for', async () => {
        const context = setup();
        context.custom['ytdlp'] = '/usr/bin/yt-dlp';
        context.custom['ffmpeg'] = '/usr/bin/ffmpeg';
        await context.tools.prepare();
        expect(context.tools.isReady('ytdlp')).toBe(false);
        expect(context.tools.isReady('ffmpeg')).toBe(false);
        expect(context.tools.isReady('deno')).toBe(true);
        expect(context.tools.isReady('busybox')).toBe(true);
    });

    it('installs only the programs it is asked for', async () => {
        const context = setup();
        await context.tools.prepare(['busybox', 'curl']);
        expect(context.downloads.map((entry) => {
            return entry.url;
        }).sort()).toEqual([
            'https://busybox.net/downloads/binaries/1.35.0-x86_64-linux-musl/busybox',
            'https://github.com/stunnel/static-curl/releases/download/8.22.0/curl-linux-x86_64-musl-8.22.0.tar.xz'
        ]);
    });

    it('goes on with the others when one fails, and says which one failed', async () => {
        const context = setup();
        context.failing.add('https://github.com/denoland/deno/releases/download/v2.9.7/deno-x86_64-unknown-linux-gnu.zip');
        context.latest.value.ffmpeg = ffmpegLatest();
        context.register(ffmpegLatest());
        await context.tools.prepare();
        expect(context.tools.stateOf('deno')).toMatchObject({ status: 'error', error: { code: 'DOWNLOAD_FAILED' } });
        ['ytdlp', 'ffmpeg', 'anicli', 'busybox', 'curl'].forEach((id) => {
            expect(context.tools.isReady(id as ProgramId)).toBe(true);
        });
    });

    it('does nothing on a system the programs are not made for', async () => {
        const context = setup({ platform: 'darwin', arch: 'arm64' });
        await context.tools.prepare();
        expect(context.downloads).toEqual([]);
    });

    it('takes away the versions that are not the chosen one', async () => {
        const context = setup();
        mkdirSync(join(context.root, 'ytdlp', '2025.01.01'), { recursive: true });
        writeFileSync(join(context.root, 'ytdlp', '2025.01.01', 'yt-dlp'), 'old');
        await context.tools.prepare(['ytdlp']);
        expect(readdirSync(join(context.root, 'ytdlp'))).toEqual(['2026.08.19']);
    });

    it('does not fail when a version that is not wanted cannot be deleted', async () => {
        const context = setup();
        await context.tools.install('ytdlp');
        const wrapped = context.tools as unknown as { installer: { removeOthers: () => void } };
        wrapped.installer.removeOthers = () => {
            throw Object.assign(new Error('busy'), { code: 'EBUSY' });
        };
        await expect(context.tools.prepare(['ytdlp'])).resolves.toBeUndefined();
        expect(context.tools.isReady('ytdlp')).toBe(true);
    });
});

describe('ProgramTools reinstalling', () => {
    it('takes away what is installed and installs it again', async () => {
        const context = setup();
        await context.tools.install('curl');
        const file = context.tools.pathOf('curl') as string;
        writeFileSync(file, 'damaged');
        const state = await context.tools.reinstall('curl');
        expect(state.status).toBe('ready');
        expect(context.downloads).toHaveLength(2);
        expect(readFileSync(file, 'utf-8')).toBe('program curl');
    });

    it('installs it when nothing is installed', async () => {
        const context = setup();
        expect((await context.tools.reinstall('deno')).status).toBe('ready');
    });

    it('says why when it cannot be installed again, and the damaged one is gone', async () => {
        const context = setup();
        await context.tools.install('curl');
        context.failing.add('https://github.com/stunnel/static-curl/releases/download/8.22.0/curl-linux-x86_64-musl-8.22.0.tar.xz');
        const state = await context.tools.reinstall('curl');
        expect(state).toMatchObject({ status: 'error', error: { code: 'DOWNLOAD_FAILED' } });
        expect(context.tools.isReady('curl')).toBe(false);
    });
});

describe('ProgramTools the latest versions', () => {
    it('says, for each program, the version that is chosen, the latest one and whether it can be updated', async () => {
        const context = setup();
        context.latest.value.ytdlp = ytdlpSpec('2026.09.01', SHA_A, 41_000_000, 'linux');
        context.latest.value.deno = denoSpec('v2.9.7', SHA_A, 41_596_794, 'linux');
        context.latest.value.ffmpeg = ffmpegLatest();
        context.latest.value.anicli = aniCliSpec(COMMIT, SHA_A, 30_000);
        const versions = await context.tools.check();
        expect(versions['ytdlp']).toEqual({ id: 'ytdlp', current: '2026.08.19', latest: '2026.09.01', updatable: true, base: '2026.08.19', chosen: false, error: null, errorMessage: null, unfit: [] });
        expect(versions['deno']).toMatchObject({ current: 'v2.9.7', latest: 'v2.9.7', updatable: false });
        expect(versions['ffmpeg']).toEqual({ id: 'ffmpeg', current: null, latest: `latest-${SHA_A.slice(0, 12)}`, updatable: true, base: null, chosen: false, error: null, errorMessage: null, unfit: [] });
        expect(versions['anicli']).toMatchObject({ current: '3ad53631ef2433b0c26e25ab011a5b149706c120', latest: COMMIT, updatable: true });
    });

    it('does not look for a newer busybox or curl: they stay at their version', async () => {
        const versions = await setup().tools.check();
        expect(versions['busybox']).toEqual({ id: 'busybox', current: '1.35.0', latest: null, updatable: false, base: '1.35.0', chosen: false, error: null, errorMessage: null, unfit: [] });
        expect(versions['curl']).toMatchObject({ current: '8.22.0', latest: null, updatable: false, error: null });
    });

    it('says the chosen version is not the one of the app when an update was made', async () => {
        const context = setup();
        writeSelected(context, 'ytdlp', { version: '2026.09.01', sha256: SHA_A, sizeBytes: 41_000_000 });
        context.latest.value.ytdlp = ytdlpSpec('2026.09.01', SHA_A, 41_000_000, 'linux');
        const info = (await context.tools.check())['ytdlp'];
        expect(info).toMatchObject({ current: '2026.09.01', latest: '2026.09.01', updatable: false, base: '2026.08.19', chosen: true });
    });

    it('says why the latest is not known, for each program on its own, with the reason and the details', async () => {
        const context = setup();
        context.latest.value.ytdlp = new LookupError('signature', 'The checksums of the release are not signed by the yt-dlp project');
        context.latest.value.deno = new Error('Request failed (503)');
        const versions = await context.tools.check();
        expect(versions['ytdlp']).toMatchObject({ latest: null, updatable: false, error: 'signature', errorMessage: 'The checksums of the release are not signed by the yt-dlp project' });
        expect(versions['deno']).toMatchObject({ latest: null, updatable: false, error: 'failed', errorMessage: 'Request failed (503)' });
        expect(versions['ffmpeg']).toMatchObject({ error: 'no-release' });
    });

    it('does not look for a program the user gave a path for', async () => {
        const context = setup();
        context.custom['ytdlp'] = '/usr/bin/yt-dlp';
        context.latest.value.ytdlp = ytdlpSpec('2026.09.01', SHA_A, 41_000_000, 'linux');
        expect((await context.tools.check())['ytdlp']).toMatchObject({ latest: null, updatable: false, error: null });
    });

    it('knows nothing on a system the programs are not made for', async () => {
        const versions = await setup({ platform: 'darwin', arch: 'arm64' }).tools.check();
        PROGRAM_IDS.forEach((id) => {
            expect(versions[id]).toMatchObject({ current: null, latest: null, updatable: false, error: null });
        });
    });
});

describe('ProgramTools updating', () => {
    function updatable(context: Setup): ToolSpec {
        const spec = ytdlpSpec('2026.09.01', SHA_A, 41_000_000, 'linux');
        context.register(spec);
        context.latest.value.ytdlp = spec;
        return spec;
    }

    it('downloads the latest beside the one that is installed, checks it, and makes it the one that is used', async () => {
        const context = setup();
        await context.tools.install('ytdlp');
        const spec = updatable(context);
        const result = await context.tools.update('ytdlp');
        expect(result).toEqual({ ok: true, version: '2026.09.01' });
        expect(context.tools.pathOf('ytdlp')).toBe(join(context.root, 'ytdlp', '2026.09.01', 'yt-dlp'));
        expect(context.tools.readSelected('ytdlp')).toEqual({ version: spec.version, sha256: spec.sha256, sizeBytes: spec.sizeBytes });
        expect(context.tools.stateOf('ytdlp')).toMatchObject({ status: 'ready', version: '2026.09.01' });
        expect(context.run).toHaveBeenLastCalledWith(join(context.root, 'ytdlp', 'staging-2026.09.01', 'yt-dlp'), ['--version']);
    });

    it('takes the old version away once the new one is the chosen one', async () => {
        const context = setup();
        await context.tools.install('ytdlp');
        updatable(context);
        await context.tools.update('ytdlp');
        expect(readdirSync(join(context.root, 'ytdlp'))).toEqual(['2026.09.01']);
    });

    it('shows the download of the update apart: the program that is installed is not reported as missing meanwhile', async () => {
        const context = setup();
        await context.tools.install('ytdlp');
        context.states.length = 0;
        updatable(context);
        await context.tools.update('ytdlp');
        expect(context.updates.map((state) => {
            return state.status;
        })).toEqual(['downloading', 'downloading', 'verifying', 'extracting', 'ready']);
        expect(context.states.map((state) => {
            return state.status;
        })).toEqual(['ready']);
        expect(context.states[0]).toMatchObject({ id: 'ytdlp', version: '2026.09.01' });
    });

    it('keeps the version that works when the download fails', async () => {
        const context = setup();
        await context.tools.install('ytdlp');
        const spec = updatable(context);
        context.failing.add(spec.url);
        const result = await context.tools.update('ytdlp');
        expect(result).toEqual({ ok: false, reason: 'failed', message: 'The connection was lost' });
        expect(context.tools.pathOf('ytdlp')).toBe(join(context.root, 'ytdlp', '2026.08.19', 'yt-dlp'));
        expect(context.tools.readSelected('ytdlp')).toBeNull();
        expect(context.tools.stateOf('ytdlp').status).toBe('ready');
    });

    it('keeps the version that works when the new one does not run', async () => {
        const context = setup();
        await context.tools.install('ytdlp');
        updatable(context);
        context.run.mockResolvedValue({ ok: false, output: 'segmentation fault' });
        const result = await context.tools.update('ytdlp');
        expect(result).toMatchObject({ ok: false, reason: 'failed', message: 'The program does not run: segmentation fault' });
        expect(context.tools.readSelected('ytdlp')).toBeNull();
        expect(readdirSync(join(context.root, 'ytdlp'))).toEqual(['2026.08.19']);
        expect(context.tools.stateOf('ytdlp').status).toBe('ready');
    });

    it('keeps the version that works when the file is not the one the publisher listed', async () => {
        const context = setup();
        await context.tools.install('ytdlp');
        const spec = updatable(context);
        context.corrupt.add(spec.url);
        const result = await context.tools.update('ytdlp');
        expect(result).toMatchObject({ ok: false, reason: 'failed', message: 'The downloaded file does not match the checksum the app expects' });
        expect(context.tools.readSelected('ytdlp')).toBeNull();
    });

    it('says it is up to date when the latest is the one that is installed', async () => {
        const context = setup();
        await context.tools.install('ytdlp');
        context.latest.value.ytdlp = pinnedSpec('ytdlp', 'linux', 'x64') as ToolSpec;
        expect(await context.tools.update('ytdlp')).toEqual({ ok: false, reason: 'current', message: '2026.08.19' });
        expect(context.downloads).toHaveLength(1);
    });

    it('installs the latest even when it is the chosen one but it is not there (the files were deleted)', async () => {
        const context = setup();
        const spec = updatable(context);
        writeSelected(context, 'ytdlp', { version: spec.version, sha256: spec.sha256, sizeBytes: spec.sizeBytes });
        expect(await context.tools.update('ytdlp')).toEqual({ ok: true, version: '2026.09.01' });
        expect(context.tools.isReady('ytdlp')).toBe(true);
    });

    it('says why the latest is not known, with the reason', async () => {
        const context = setup();
        context.latest.value.ytdlp = new LookupError('signature', 'not signed');
        expect(await context.tools.update('ytdlp')).toEqual({ ok: false, reason: 'lookup', message: 'not signed', lookup: 'signature' });
        context.latest.value.ytdlp = new Error('offline');
        expect(await context.tools.update('ytdlp')).toEqual({ ok: false, reason: 'failed', message: 'offline' });
        expect(context.downloads).toEqual([]);
    });

    it('does not start a second update of the program while one goes on', async () => {
        const context = setup();
        await context.tools.install('ytdlp');
        updatable(context);
        context.gate.value = new Promise<void>((resolve) => {
            setTimeout(resolve, 20);
        });
        const first = context.tools.update('ytdlp');
        const second = await context.tools.update('ytdlp');
        expect(second).toMatchObject({ ok: false, reason: 'busy' });
        expect((await first).ok).toBe(true);
        expect(await context.tools.update('ytdlp')).toMatchObject({ ok: false, reason: 'current' });
    });

    it('does not update a program the user gave a path for, nor busybox and curl, nor on an unsupported system', async () => {
        const context = setup();
        context.custom['ytdlp'] = '/usr/bin/yt-dlp';
        expect(await context.tools.update('ytdlp')).toMatchObject({ ok: false, reason: 'custom' });
        expect(await context.tools.update('busybox')).toMatchObject({ ok: false, reason: 'unsupported' });
        expect(await context.tools.update('curl')).toMatchObject({ ok: false, reason: 'unsupported' });
        expect(await setup({ platform: 'darwin', arch: 'arm64' }).tools.update('ytdlp')).toMatchObject({ ok: false, reason: 'unsupported' });
    });

    it('updates ffmpeg, which has no version of the app, and remembers the file of its release', async () => {
        const context = setup();
        context.latest.value.ffmpeg = ffmpegLatest(SHA_A);
        context.register(ffmpegLatest(SHA_A));
        await context.tools.install('ffmpeg');
        const next = ffmpegSpec('linux', 'ffmpeg-n9.1-latest-linux64-gpl-shared-9.1.tar.xz', SHA_B, 71_000_000) as ToolSpec;
        context.register(next);
        context.latest.value.ffmpeg = next;
        expect(await context.tools.update('ffmpeg')).toEqual({ ok: true, version: `latest-${SHA_B.slice(0, 12)}` });
        expect(context.tools.readSelected('ffmpeg')).toEqual({ version: next.version, sha256: SHA_B, sizeBytes: 71_000_000, asset: 'ffmpeg-n9.1-latest-linux64-gpl-shared-9.1.tar.xz' });
        expect(readdirSync(join(context.root, 'ffmpeg'))).toEqual([next.version]);
    });

    it('does not fail the update when an old version cannot be deleted', async () => {
        const context = setup();
        await context.tools.install('ytdlp');
        updatable(context);
        const wrapped = context.tools as unknown as { installer: { removeOthers: () => void } };
        wrapped.installer.removeOthers = () => {
            throw Object.assign(new Error('busy'), { code: 'EBUSY' });
        };
        expect(await context.tools.update('ytdlp')).toEqual({ ok: true, version: '2026.09.01' });
        expect(context.tools.pathOf('ytdlp')).toBe(join(context.root, 'ytdlp', '2026.09.01', 'yt-dlp'));
    });
});

describe('ProgramTools going back to the version of the app', () => {
    it('forgets what the update chose, and the version of the app is the one used (installed again if it is not there)', async () => {
        const context = setup();
        await context.tools.install('ytdlp');
        const spec = ytdlpSpec('2026.09.01', SHA_A, 41_000_000, 'linux');
        context.register(spec);
        context.latest.value.ytdlp = spec;
        await context.tools.update('ytdlp');
        expect(await context.tools.reset('ytdlp')).toEqual({ ok: true });
        expect(context.tools.readSelected('ytdlp')).toBeNull();
        expect(context.tools.pathOf('ytdlp')).toBe(join(context.root, 'ytdlp', '2026.08.19', 'yt-dlp'));
        expect(readdirSync(join(context.root, 'ytdlp'))).toEqual(['2026.08.19']);
        expect(existsSync(join(context.root, `ytdlp${SELECTED_SUFFIX}`))).toBe(false);
    });

    it('says there is nothing to go back from when no other version was chosen', async () => {
        const context = setup();
        await context.tools.install('ytdlp');
        expect(await context.tools.reset('ytdlp')).toMatchObject({ ok: false, reason: 'none' });
    });

    it('has nothing to go back to for ffmpeg, which has no version of the app', async () => {
        const context = setup();
        context.latest.value.ffmpeg = ffmpegLatest();
        context.register(ffmpegLatest());
        await context.tools.install('ffmpeg');
        expect(await context.tools.reset('ffmpeg')).toMatchObject({ ok: false, reason: 'none' });
        expect(context.tools.isReady('ffmpeg')).toBe(true);
    });

    it('says why when the version of the app cannot be installed again, and keeps nothing chosen', async () => {
        const context = setup();
        const spec = ytdlpSpec('2026.09.01', SHA_A, 41_000_000, 'linux');
        context.register(spec);
        writeSelected(context, 'ytdlp', { version: spec.version, sha256: spec.sha256, sizeBytes: spec.sizeBytes });
        context.failing.add('https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp_linux');
        const result = await context.tools.reset('ytdlp');
        expect(result).toEqual({ ok: false, reason: 'failed', message: 'The connection was lost' });
        expect(context.tools.stateOf('ytdlp')).toMatchObject({ status: 'error' });
    });

    it('does nothing for a program the user gave a path for, nor on an unsupported system', async () => {
        const context = setup();
        context.custom['ytdlp'] = '/usr/bin/yt-dlp';
        expect(await context.tools.reset('ytdlp')).toMatchObject({ ok: false, reason: 'custom' });
        expect(await setup({ platform: 'darwin', arch: 'arm64' }).tools.reset('ytdlp')).toMatchObject({ ok: false, reason: 'unsupported' });
    });
});

describe('ProgramTools the root folder', () => {
    it('is the one it was given', () => {
        const context = setup();
        expect(context.tools.rootDirectory).toBe(context.root);
    });

    it('has the script of ani-cli that passes the syntax check with a real script text', () => {
        expect(aniCliScript('5.1.4')).toContain(SELECTION_PART);
        expect(aniCliScript('5.1.4')).toContain(ALL_SUBTITLES_PART);
        expect(aniCliScript('5.1.4')).toContain(DEBUG_PART);
    });
});
