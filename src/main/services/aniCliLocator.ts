import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import type { AniCliInfo } from '@shared/anime';
import { patchAniCli } from './aniPatches';
import { providerOf } from './aniProvider';
import { parseAniCliVersion } from './aniVersion';
import { SEARCH_MIN_VARIABLE } from './aniSearchPages';
import { SUBTITLE_LABELS_VARIABLE } from './aniSubtitles';
import type { ResolvedBinary } from './binaryResolver';

export const ANI_CLI_COMMAND = 'ani-cli';
export const ANI_MENU_COMMAND = 'pullwave_menu';
export const ANI_PLAYER_COMMAND = 'pullwave_noplayer';
export const ANI_RUNNER_SCRIPT = 'pullwave-run.sh';
export const PATCHED_SCRIPT_PREFIX = 'ani-cli.';
export const PATCHED_SCRIPT_SUFFIX = '.patched';
export const LEGACY_PATCHED_SCRIPT = 'ani-cli.patched';
export const WINDOWS_SYSTEM_VARIABLES = [
    'SystemRoot',
    'windir',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'ProgramData',
    'PATHEXT',
    'COMSPEC',
    'HOMEDRIVE',
    'HOMEPATH'
];
export const BUSYBOX_APPLETS = [
    'sed',
    'grep',
    'cut',
    'head',
    'tail',
    'tr',
    'wc',
    'sort',
    'od',
    'base64',
    'printf',
    'mkdir',
    'rm',
    'cat',
    'date',
    'nl',
    'cp',
    'mv',
    'uname',
    'sleep'
];

export interface AniLocations {
    scriptsDir: string;
    dataDir: string;
}

export interface AniPrograms {
    anicli: () => string | null;
    busybox: () => string | null;
    curl: () => string | null;
}

export interface AniTools {
    ytdlp: ResolvedBinary;
    ffmpeg: ResolvedBinary;
    deno: string | null;
    ffprobe: string | null;
}

export interface AniToolsFs {
    exists: (path: string) => boolean;
    mkdir: (path: string) => void;
    symlink: (target: string, path: string) => void;
    readlink: (path: string) => string | null;
    remove: (path: string) => void;
    readText: (path: string) => string | null;
    writeText: (path: string, content: string) => void;
}

export const ANI_MODE = 'sub';

export interface AniEnvOptions {
    downloadDir: string;
    subtitleLabels: readonly string[];
    player?: string;
    tools?: AniTools;
    searchMin?: number;
}

export function readTextFile(path: string): string | null {
    try {
        return readFileSync(path, 'utf-8');
    } catch {
        return null;
    }
}

const defaultFs: AniToolsFs = {
    exists: existsSync,
    mkdir: (path) => {
        mkdirSync(path, { recursive: true });
    },
    symlink: (target, path) => {
        symlinkSync(target, path);
    },
    readlink: (path) => {
        try {
            return readlinkSync(path);
        } catch {
            return null;
        }
    },
    remove: (path) => {
        rmSync(path, { force: true });
    },
    readText: readTextFile,
    writeText: (path, content) => {
        writeFileSync(path, content);
    }
};

export class AniCliLocator {
    private readonly path: typeof posix;

    constructor(
        private readonly locations: AniLocations,
        private readonly programs: AniPrograms,
        private readonly fs: AniToolsFs = defaultFs,
        private readonly platform: NodeJS.Platform = process.platform
    ) {
        this.path = platform === 'win32' ? win32 : posix;
    }

    private forScript(path: string): string {
        return this.platform === 'win32' ? path.replace(/\\/g, '/') : path;
    }

    get toolsDir(): string {
        return this.path.join(this.locations.dataDir, 'tools');
    }

    get historyDir(): string {
        return this.path.join(this.locations.dataDir, 'history');
    }

    get runnerPath(): string {
        return this.path.join(this.locations.scriptsDir, ANI_RUNNER_SCRIPT);
    }

    get busyboxPath(): string {
        return this.programs.busybox() ?? '';
    }

    get curlPath(): string {
        return this.programs.curl() ?? '';
    }

    script(customPath: string): ResolvedBinary | null {
        if (customPath.length > 0) {
            return { path: customPath, source: 'custom' };
        }
        const installed = this.programs.anicli();
        return installed === null ? null : { path: installed, source: 'installed' };
    }

    isReady(customPath: string): boolean {
        return this.script(customPath) !== null && this.programs.busybox() !== null && this.programs.curl() !== null;
    }

    private versionOf(path: string): string | null {
        const source = this.fs.readText(path);
        return source === null ? null : parseAniCliVersion(source);
    }

    info(customPath: string): AniCliInfo {
        const script = this.script(customPath);
        if (script === null) {
            return { found: false, path: '', version: null, source: 'installed' };
        }
        const version = this.versionOf(script.path);
        return { found: this.fs.exists(script.path), path: script.path, version, source: script.source };
    }

    private toolLinks(tools: AniTools): Array<{ name: string; target: string }> {
        const links = [
            ...BUSYBOX_APPLETS.map((name) => {
                return { name, target: this.busyboxPath };
            }),
            { name: 'curl', target: this.curlPath }
        ];
        const optional: Array<{ name: string; target: string | null }> = [
            { name: 'yt-dlp', target: tools.ytdlp.path },
            { name: 'ffmpeg', target: tools.ffmpeg.path },
            { name: 'ffprobe', target: tools.ffprobe },
            { name: 'deno', target: tools.deno }
        ];
        optional.forEach(({ name, target }) => {
            if (target !== null && target !== '') {
                links.push({ name, target });
            }
        });
        return links;
    }

    prepareTools(tools: AniTools): void {
        if (this.platform === 'win32') {
            this.fs.mkdir(this.historyDir);
            return;
        }
        this.fs.mkdir(this.toolsDir);
        this.fs.mkdir(this.historyDir);
        this.toolLinks(tools).forEach(({ name, target }) => {
            const linkPath = this.path.join(this.toolsDir, name);
            if (this.fs.readlink(linkPath) === target) {
                return;
            }
            this.fs.remove(linkPath);
            this.fs.symlink(target, linkPath);
        });
    }

    private scriptProvider: string | null = null;

    get provider(): string | null {
        return this.scriptProvider;
    }

    patchedScriptPath(patched: string): string {
        return this.path.join(this.locations.dataDir, `${PATCHED_SCRIPT_PREFIX}${createHash('sha256').update(patched).digest('hex').slice(0, 16)}${PATCHED_SCRIPT_SUFFIX}`);
    }

    private previousPatched: string | null = null;

    withPatches(script: ResolvedBinary): ResolvedBinary {
        const source = this.fs.readText(script.path);
        this.scriptProvider = source === null ? this.scriptProvider : providerOf(source);
        if (script.source === 'custom') {
            return script;
        }
        const patched = source === null ? null : patchAniCli(source);
        if (patched === null) {
            return script;
        }
        const path = this.patchedScriptPath(patched);
        if (this.fs.readText(path) !== patched) {
            this.fs.mkdir(this.locations.dataDir);
            this.fs.writeText(path, patched);
        }
        this.forgetPrevious(path);
        return { path, source: script.source };
    }

    private forgetPrevious(current: string): void {
        const stale = [this.previousPatched, this.path.join(this.locations.dataDir, LEGACY_PATCHED_SCRIPT)].filter((candidate): candidate is string => {
            return candidate !== null && candidate !== current && this.fs.exists(candidate);
        });
        stale.forEach((candidate) => {
            try {
                this.fs.remove(candidate);
            } catch {
                // Still in use: it goes the next time.
            }
        });
        this.previousPatched = current;
    }

    command(script: ResolvedBinary): { binary: string; args: string[] } {
        return { binary: this.busyboxPath, args: ['sh', this.forScript(this.runnerPath), this.forScript(script.path)] };
    }

    private searchPath(options: AniEnvOptions): string {
        if (this.platform !== 'win32') {
            return this.toolsDir;
        }
        const files = [options.tools?.ytdlp.path, options.tools?.ffmpeg.path, options.tools?.deno, this.programs.busybox(), this.programs.curl()];
        const folders = files.flatMap((file) => {
            return file === undefined || file === null || file === '' ? [] : [this.path.dirname(file)];
        });
        return [...new Set(folders)].join(this.path.delimiter);
    }

    env(options: AniEnvOptions, baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
        const env: NodeJS.ProcessEnv = {
            [this.platform === 'win32' ? 'Path' : 'PATH']: this.searchPath(options),
            ANI_CLI_MENU: ANI_MENU_COMMAND,
            ANI_CLI_PLAYER: options.player ?? ANI_PLAYER_COMMAND,
            ANI_CLI_LOG: '0',
            ANI_CLI_MODE: ANI_MODE,
            ANI_CLI_HIST_DIR: this.forScript(this.historyDir),
            ANI_CLI_DOWNLOAD_DIR: this.forScript(options.downloadDir),
            ANI_CLI_TMP_DIR: this.forScript(options.downloadDir),
            [SUBTITLE_LABELS_VARIABLE]: options.subtitleLabels.join('|')
        };
        if (options.searchMin !== undefined) {
            env[SEARCH_MIN_VARIABLE] = String(options.searchMin);
        }
        const passed = this.platform === 'win32' ? [...WINDOWS_SYSTEM_VARIABLES, 'HOME', 'LANG', 'LC_ALL'] : ['HOME', 'LANG', 'LC_ALL', 'TMPDIR'];
        passed.forEach((key) => {
            const value = baseEnv[key];
            if (value !== undefined) {
                env[key] = value;
            }
        });
        return env;
    }
}
