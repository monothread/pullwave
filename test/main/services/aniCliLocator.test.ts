import {
    AniCliLocator,
    ANI_CLI_COMMAND,
    ANI_MENU_COMMAND,
    ANI_PLAYER_COMMAND,
    ANI_RUNNER_SCRIPT,
    WINDOWS_SYSTEM_VARIABLES,
    BUSYBOX_APPLETS,
    type AniLocations,
    type AniPrograms,
    type AniTools,
    type AniToolsFs
} from '@main/services/aniCliLocator';
import { cleanTempDirs, makeTempDir } from '../../helpers/tempDir';
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SCRIPT = '/data/tools/anicli/abc/ani-cli';
const BUSYBOX = '/data/tools/busybox/1.35/busybox';
const CURL = '/data/tools/curl/8.0/curl';

const FULL: AniPrograms = {
    anicli: () => {
        return SCRIPT;
    },
    busybox: () => {
        return BUSYBOX;
    },
    curl: () => {
        return CURL;
    }
};

const NONE: AniPrograms = {
    anicli: () => {
        return null;
    },
    busybox: () => {
        return null;
    },
    curl: () => {
        return null;
    }
};

function newLinuxLocator(locations: AniLocations, fs?: AniToolsFs, programs: AniPrograms = FULL): AniCliLocator {
    return new AniCliLocator(locations, programs, fs, 'linux');
}

const LOCATIONS: AniLocations = {
    scriptsDir: '/app/resources/ani-scripts',
    dataDir: '/data/anime'
};

const TOOLS: AniTools = {
    ytdlp: { path: '/data/tools/ytdlp/1/yt-dlp', source: 'installed' },
    ffmpeg: { path: '/data/tools/ffmpeg/b/bin/ffmpeg', source: 'installed' },
    deno: '/data/tools/deno/2/deno',
    ffprobe: '/data/tools/ffmpeg/b/bin/ffprobe'
};

interface FakeFs {
    fs: AniToolsFs;
    links: Map<string, string>;
    directories: string[];
    removed: string[];
    texts: Map<string, string>;
    writes: Array<[string, string]>;
}

function makeFs(existing: string[] = [], links: Record<string, string> = {}, texts: Record<string, string> = {}): FakeFs {
    const textMap = new Map<string, string>(Object.entries(texts));
    const writes: Array<[string, string]> = [];
    const linkMap = new Map<string, string>(Object.entries(links));
    const directories: string[] = [];
    const removed: string[] = [];
    const fs: AniToolsFs = {
        exists: (path) => {
            return existing.includes(path);
        },
        mkdir: (path) => {
            directories.push(path);
        },
        symlink: (target, path) => {
            linkMap.set(path, target);
        },
        readlink: (path) => {
            return linkMap.get(path) ?? null;
        },
        remove: (path) => {
            removed.push(path);
            linkMap.delete(path);
        },
        readText: (path) => {
            return textMap.get(path) ?? null;
        },
        writeText: (path, content) => {
            writes.push([path, content]);
            textMap.set(path, content);
        }
    };
    return { fs, links: linkMap, directories, removed, texts: textMap, writes };
}

afterEach(() => {
    cleanTempDirs();
});

describe('AniCliLocator paths', () => {
    const locator = newLinuxLocator(LOCATIONS, makeFs().fs);

    it('derives every path from the locations and the installed programs', () => {
        expect(locator.toolsDir).toBe('/data/anime/tools');
        expect(locator.historyDir).toBe('/data/anime/history');
        expect(locator.runnerPath).toBe('/app/resources/ani-scripts/pullwave-run.sh');
        expect(locator.busyboxPath).toBe(BUSYBOX);
        expect(locator.curlPath).toBe(CURL);
    });

    it('gives empty paths for the programs that are not installed', () => {
        const empty = newLinuxLocator(LOCATIONS, makeFs().fs, NONE);
        expect(empty.busyboxPath).toBe('');
        expect(empty.curlPath).toBe('');
    });
});

describe('AniCliLocator.script', () => {
    it('prefers the custom path from the settings', () => {
        expect(newLinuxLocator(LOCATIONS, makeFs().fs).script('/opt/ani-cli')).toEqual({ path: '/opt/ani-cli', source: 'custom' });
    });

    it('uses the script the app installed', () => {
        expect(newLinuxLocator(LOCATIONS, makeFs().fs).script('')).toEqual({ path: SCRIPT, source: 'installed' });
    });

    it('never falls back to a copy installed on the system', () => {
        expect(newLinuxLocator(LOCATIONS, makeFs().fs, NONE).script('')).toBeNull();
    });
});

describe('AniCliLocator.isReady', () => {
    it('is ready when the script, the shell and curl are there', () => {
        expect(newLinuxLocator(LOCATIONS, makeFs().fs).isReady('')).toBe(true);
    });

    it('is ready with a script the user chose once the shell and curl are there', () => {
        const withoutScript: AniPrograms = { ...FULL, anicli: NONE.anicli };
        expect(newLinuxLocator(LOCATIONS, makeFs().fs, withoutScript).isReady('')).toBe(false);
        expect(newLinuxLocator(LOCATIONS, makeFs().fs, withoutScript).isReady('/opt/ani-cli')).toBe(true);
    });

    it('is not ready while the shell or curl is missing', () => {
        expect(newLinuxLocator(LOCATIONS, makeFs().fs, { ...FULL, busybox: NONE.busybox }).isReady('')).toBe(false);
        expect(newLinuxLocator(LOCATIONS, makeFs().fs, { ...FULL, curl: NONE.curl }).isReady('')).toBe(false);
        expect(newLinuxLocator(LOCATIONS, makeFs().fs, NONE).isReady('')).toBe(false);
    });
});

describe('AniCliLocator.info', () => {
    it('tells which copy is used and its version', () => {
        const locator = newLinuxLocator(LOCATIONS, makeFs([SCRIPT], {}, { [SCRIPT]: '#!/bin/sh\nversion_number="5.1.4"\n' }).fs);
        expect(locator.info('')).toEqual({ found: true, path: SCRIPT, version: '5.1.4', source: 'installed' });
    });

    it('has no version when the script says none or cannot be read', () => {
        expect(newLinuxLocator(LOCATIONS, makeFs([SCRIPT], {}, { [SCRIPT]: 'no version here' }).fs).info('').version).toBeNull();
        expect(newLinuxLocator(LOCATIONS, makeFs([SCRIPT]).fs).info('')).toMatchObject({ found: true, version: null });
    });

    it('describes the script the user chose', () => {
        const locator = newLinuxLocator(LOCATIONS, makeFs(['/opt/ani-cli'], {}, { '/opt/ani-cli': 'version_number="1.2.3"' }).fs);
        expect(locator.info('/opt/ani-cli')).toEqual({ found: true, path: '/opt/ani-cli', version: '1.2.3', source: 'custom' });
        expect(locator.info('/opt/missing')).toEqual({ found: false, path: '/opt/missing', version: null, source: 'custom' });
    });

    it('says it was not found while the script is not installed', () => {
        expect(newLinuxLocator(LOCATIONS, makeFs().fs, NONE).info('')).toEqual({ found: false, path: '', version: null, source: 'installed' });
    });
});

describe('AniCliLocator.prepareTools', () => {
    it('creates the folders and one link per tool', () => {
        const { fs, links, directories } = makeFs();
        newLinuxLocator(LOCATIONS, fs).prepareTools(TOOLS);

        expect(directories).toEqual(['/data/anime/tools', '/data/anime/history']);
        const expected: Record<string, string> = {};
        BUSYBOX_APPLETS.forEach((name) => {
            expected[`/data/anime/tools/${name}`] = BUSYBOX;
        });
        expected['/data/anime/tools/curl'] = CURL;
        expected['/data/anime/tools/yt-dlp'] = '/data/tools/ytdlp/1/yt-dlp';
        expected['/data/anime/tools/ffmpeg'] = '/data/tools/ffmpeg/b/bin/ffmpeg';
        expected['/data/anime/tools/ffprobe'] = '/data/tools/ffmpeg/b/bin/ffprobe';
        expected['/data/anime/tools/deno'] = '/data/tools/deno/2/deno';
        expect(Object.fromEntries(links)).toEqual(expected);
    });

    it('links the yt-dlp and ffmpeg that were chosen, whatever their source', () => {
        const { fs, links } = makeFs();
        newLinuxLocator(LOCATIONS, fs).prepareTools({
            ytdlp: { path: '/opt/yt-dlp', source: 'custom' },
            ffmpeg: { path: '/opt/ffmpeg', source: 'custom' },
            deno: null,
            ffprobe: null
        });
        expect(links.get('/data/anime/tools/yt-dlp')).toBe('/opt/yt-dlp');
        expect(links.get('/data/anime/tools/ffmpeg')).toBe('/opt/ffmpeg');
    });

    it('does not link a tool that is not installed yet', () => {
        const { fs, links } = makeFs();
        newLinuxLocator(LOCATIONS, fs).prepareTools({
            ytdlp: { path: '', source: 'installed' },
            ffmpeg: { path: '', source: 'installed' },
            deno: null,
            ffprobe: null
        });
        ['yt-dlp', 'ffmpeg', 'ffprobe', 'deno'].forEach((name) => {
            expect(links.has(`/data/anime/tools/${name}`)).toBe(false);
        });
        expect(links.has('/data/anime/tools/curl')).toBe(true);
    });

    it('keeps links that already point at the right place', () => {
        const { fs, removed } = makeFs([], { '/data/anime/tools/curl': CURL });
        newLinuxLocator(LOCATIONS, fs).prepareTools(TOOLS);
        expect(removed).not.toContain('/data/anime/tools/curl');
    });

    it('replaces links that point somewhere else', () => {
        const { fs, links, removed } = makeFs([], { '/data/anime/tools/yt-dlp': '/old/yt-dlp' });
        newLinuxLocator(LOCATIONS, fs).prepareTools(TOOLS);
        expect(removed).toContain('/data/anime/tools/yt-dlp');
        expect(links.get('/data/anime/tools/yt-dlp')).toBe('/data/tools/ytdlp/1/yt-dlp');
    });

    it.skipIf(process.platform === 'win32')('creates real links on the file system and is safe to repeat', () => {
        const root = makeTempDir();
        mkdirSync(join(root, 'bin'), { recursive: true });
        writeFileSync(join(root, 'bin', 'yt-dlp'), '');
        const busybox = join(root, 'bin', 'busybox');
        const locator = new AniCliLocator({ scriptsDir: join(root, 'scripts'), dataDir: join(root, 'data') }, { ...FULL, busybox: () => {
            return busybox;
        } });
        const tools: AniTools = { ytdlp: { path: join(root, 'bin', 'yt-dlp'), source: 'installed' }, ffmpeg: { path: '', source: 'installed' }, deno: null, ffprobe: null };

        locator.prepareTools(tools);
        locator.prepareTools(tools);

        expect(lstatSync(join(root, 'data', 'tools', 'sed')).isSymbolicLink()).toBe(true);
        expect(readlinkSync(join(root, 'data', 'tools', 'sed'))).toBe(busybox);
        expect(readlinkSync(join(root, 'data', 'tools', 'yt-dlp'))).toBe(join(root, 'bin', 'yt-dlp'));
        expect(existsSync(join(root, 'data', 'history'))).toBe(true);
    });
});

describe('AniCliLocator.env player', () => {
    const locator = newLinuxLocator(LOCATIONS, makeFs().fs);

    it('plays nothing by default', () => {
        expect(locator.env({ audio: 'sub', downloadDir: '.', subtitleLabels: [] }, {}).ANI_CLI_PLAYER).toBe('pullwave_noplayer');
    });

    it('can ask ani-cli to print the address instead', () => {
        expect(locator.env({ audio: 'sub', downloadDir: '.', subtitleLabels: [], player: 'debug' }, {}).ANI_CLI_PLAYER).toBe('debug');
    });
});

describe('AniCliLocator.env subtitles', () => {
    const locator = newLinuxLocator(LOCATIONS, makeFs().fs);

    it('joins the languages with a bar, in order', () => {
        expect(locator.env({ audio: 'sub', downloadDir: '.', subtitleLabels: ['Spanish'] }, {}).PULLWAVE_SUB_LABELS).toBe('Spanish');
        expect(locator.env({ audio: 'sub', downloadDir: '.', subtitleLabels: ['Spanish', 'English'] }, {}).PULLWAVE_SUB_LABELS).toBe('Spanish|English');
    });

    it('leaves the variable empty when ani-cli should choose', () => {
        expect(locator.env({ audio: 'sub', downloadDir: '.', subtitleLabels: [] }, {}).PULLWAVE_SUB_LABELS).toBe('');
    });
});

describe('AniCliLocator.withPatches', () => {
    const ORIGINAL = [
        '# header',
        'hianime_m3u8() {',
        `    sub_link="$(printf "%s" "$_json" | sed 's|.*"subtitles":\\[||; s|}\\].*||; s|},{|}\\n{|g' | grep -m 1 '"default":true' | sed -nE 's|.*"src":"([^"]*)".*|\\1|p')"`,
        '}'
    ].join('\n');
    const installed = { path: SCRIPT, source: 'installed' as const };

    it('saves a patched copy next to the tools and uses it', () => {
        const { fs, writes, directories } = makeFs([], {}, { [installed.path]: ORIGINAL });
        const result = newLinuxLocator(LOCATIONS, fs).withPatches(installed);

        expect(result).toEqual({ path: '/data/anime/ani-cli.patched', source: 'installed' });
        expect(writes).toHaveLength(1);
        expect(writes[0]?.[0]).toBe('/data/anime/ani-cli.patched');
        expect(writes[0]?.[1]).toContain('sub_link="$(pullwave_pick_subtitle "$_json")"');
        expect(directories).toEqual(['/data/anime']);
    });

    it('also patches the debug output of the script', () => {
        const debug = 'x\n        debug) printf "All links:\\n%s\\nSelected link:\\n%s\\nSubtitles:\\n%s\\n" "$links" "$video_link" "$sub_link" ;;';
        const { fs, writes } = makeFs([], {}, { [installed.path]: debug });
        newLinuxLocator(LOCATIONS, fs).withPatches(installed);
        expect(writes[0]?.[1]).toContain('Referer:');
    });

    it('does not write the copy again when it is already up to date', () => {
        const first = makeFs([], {}, { [installed.path]: ORIGINAL });
        const locator = newLinuxLocator(LOCATIONS, first.fs);
        locator.withPatches(installed);
        locator.withPatches(installed);
        expect(first.writes).toHaveLength(1);
    });

    it('writes the copy again when it is out of date', () => {
        const { fs, writes } = makeFs([], {}, { [installed.path]: ORIGINAL, '/data/anime/ani-cli.patched': 'old copy' });
        newLinuxLocator(LOCATIONS, fs).withPatches(installed);
        expect(writes).toHaveLength(1);
    });

    it('never changes a script the user chose', () => {
        const custom = { path: '/opt/ani-cli', source: 'custom' as const };
        const { fs, writes } = makeFs([], {}, { [custom.path]: ORIGINAL });
        expect(newLinuxLocator(LOCATIONS, fs).withPatches(custom)).toBe(custom);
        expect(writes).toEqual([]);
    });

    it('uses the script as it is when it cannot be read', () => {
        const { fs, writes } = makeFs();
        expect(newLinuxLocator(LOCATIONS, fs).withPatches(installed)).toBe(installed);
        expect(writes).toEqual([]);
    });

    it('uses the script as it is when it is a version it cannot patch', () => {
        const { fs, writes } = makeFs([], {}, { [installed.path]: 'a different script' });
        expect(newLinuxLocator(LOCATIONS, fs).withPatches(installed)).toBe(installed);
        expect(writes).toEqual([]);
    });

    it('reads and writes real files', () => {
        const root = makeTempDir();
        const script = join(root, 'ani-cli');
        writeFileSync(script, ORIGINAL);
        const locator = new AniCliLocator({ scriptsDir: join(root, 's'), dataDir: join(root, 'data') }, FULL);

        const result = locator.withPatches({ path: script, source: 'installed' });

        expect(result.path).toBe(join(root, 'data', 'ani-cli.patched'));
        expect(readFileSync(result.path, 'utf-8')).toContain('pullwave_pick_subtitle() {');
        expect(locator.withPatches({ path: join(root, 'missing'), source: 'installed' }).path).toBe(join(root, 'missing'));
    });
});

describe('AniCliLocator.prepareTools on the real file system of Windows', () => {
    it.skipIf(process.platform !== 'win32')('makes no links, only the folder of the history, and can be repeated', () => {
        const root = makeTempDir();
        const locator = new AniCliLocator({ scriptsDir: join(root, 's'), dataDir: join(root, 'data') }, FULL);
        const tools: AniTools = { ytdlp: { path: join(root, 'bin', 'yt-dlp.exe'), source: 'installed' }, ffmpeg: { path: '', source: 'installed' }, deno: null, ffprobe: null };

        locator.prepareTools(tools);
        locator.prepareTools(tools);

        expect(existsSync(join(root, 'data', 'history'))).toBe(true);
        expect(existsSync(join(root, 'data', 'tools'))).toBe(false);
    });
});

describe('AniCliLocator.command', () => {
    it('runs the script with the busybox the app installed', () => {
        const locator = newLinuxLocator(LOCATIONS, makeFs().fs);
        expect(locator.command({ path: SCRIPT, source: 'installed' })).toEqual({
            binary: BUSYBOX,
            args: ['sh', '/app/resources/ani-scripts/pullwave-run.sh', SCRIPT]
        });
    });

    it('uses forward slashes for the script on Windows', () => {
        const programs: AniPrograms = { ...FULL, busybox: () => {
            return 'C:\\data\\tools\\busybox\\busybox.exe';
        } };
        const locator = new AniCliLocator({ scriptsDir: 'C:\\app\\ani-scripts', dataDir: 'C:\\data\\anime' }, programs, makeFs().fs, 'win32');
        expect(locator.command({ path: 'C:\\data\\tools\\anicli\\ani-cli', source: 'installed' })).toEqual({
            binary: 'C:\\data\\tools\\busybox\\busybox.exe',
            args: ['sh', 'C:/app/ani-scripts/pullwave-run.sh', 'C:/data/tools/anicli/ani-cli']
        });
    });
});

describe('AniCliLocator.env', () => {
    const locator = newLinuxLocator(LOCATIONS, makeFs().fs);

    it('builds an isolated environment', () => {
        expect(locator.env({ audio: 'dub', downloadDir: '/home/me/Anime', subtitleLabels: ['Portuguese', 'English'] }, { PATH: '/usr/bin', HOME: '/home/me', LANG: 'pt_BR.UTF-8', SECRET: 'x' })).toEqual({
            PATH: '/data/anime/tools',
            ANI_CLI_MENU: ANI_MENU_COMMAND,
            ANI_CLI_PLAYER: ANI_PLAYER_COMMAND,
            ANI_CLI_LOG: '0',
            ANI_CLI_MODE: 'dub',
            ANI_CLI_HIST_DIR: '/data/anime/history',
            ANI_CLI_DOWNLOAD_DIR: '/home/me/Anime',
            PULLWAVE_SUB_LABELS: 'Portuguese|English',
            HOME: '/home/me',
            LANG: 'pt_BR.UTF-8'
        });
    });

    it('passes on only the variables ani-cli and yt-dlp need', () => {
        const env = locator.env({ audio: 'sub', downloadDir: '.', subtitleLabels: [] }, { HOME: '/h', LC_ALL: 'C', TMPDIR: '/t', PATH: '/usr/bin', DISPLAY: ':0' });
        expect(env.HOME).toBe('/h');
        expect(env.LC_ALL).toBe('C');
        expect(env.TMPDIR).toBe('/t');
        expect(env.LANG).toBeUndefined();
        expect(env.DISPLAY).toBeUndefined();
        expect(env.PATH).toBe('/data/anime/tools');
    });

    it('sets the audio mode', () => {
        expect(locator.env({ audio: 'sub', downloadDir: '.', subtitleLabels: [] }, {}).ANI_CLI_MODE).toBe('sub');
    });

    it('puts the folders of the tools on Path on Windows, once each, and passes the variables Windows programs need', () => {
        const programs: AniPrograms = {
            anicli: FULL.anicli,
            busybox: () => {
                return 'C:\\t\\busybox\\busybox.exe';
            },
            curl: () => {
                return 'C:\\t\\curl\\bin\\curl.exe';
            }
        };
        const windows = new AniCliLocator({ scriptsDir: 'C:\\app\\s', dataDir: 'C:\\data\\anime' }, programs, makeFs().fs, 'win32');
        const tools: AniTools = {
            ytdlp: { path: 'C:\\t\\ytdlp\\yt-dlp.exe', source: 'installed' },
            ffmpeg: { path: 'C:\\t\\ffmpeg\\bin\\ffmpeg.exe', source: 'installed' },
            deno: 'C:\\t\\ytdlp\\deno.exe',
            ffprobe: null
        };
        const env = windows.env({ audio: 'sub', downloadDir: 'C:\\Anime', subtitleLabels: [], tools }, { SystemRoot: 'C:\\Windows', Path: 'C:\\leak', SECRET: 'x' });
        expect(env.Path).toBe('C:\\t\\ytdlp;C:\\t\\ffmpeg\\bin;C:\\t\\busybox;C:\\t\\curl\\bin');
        expect(env.PATH).toBeUndefined();
        expect(env.SystemRoot).toBe('C:\\Windows');
        expect(env.SECRET).toBeUndefined();
        expect(env.ANI_CLI_DOWNLOAD_DIR).toBe('C:/Anime');
    });
});

describe('constants', () => {
    it('names the tools ani-cli looks for', () => {
        expect(ANI_CLI_COMMAND).toBe('ani-cli');
        expect(ANI_MENU_COMMAND).toBe('pullwave_menu');
        expect(ANI_PLAYER_COMMAND).toBe('pullwave_noplayer');
        expect(ANI_RUNNER_SCRIPT).toBe('pullwave-run.sh');
    });

    it('lists what a Windows program needs from the system', () => {
        expect(WINDOWS_SYSTEM_VARIABLES).toEqual(['SystemRoot', 'windir', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'PATHEXT', 'COMSPEC', 'HOMEDRIVE', 'HOMEPATH']);
    });
});
