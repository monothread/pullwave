import type { AniRunResult } from '@shared/anime';
import { AniCliLocator, type AniLocations, type AniPrograms, type AniTools, type AniToolsFs } from '@main/services/aniCliLocator';
import { AniCliService, type AniDownloadOptions } from '@main/services/aniCliService';
import type { AniRunHandle, AniRunOptions, AniRunOutcome, MenuChoice } from '@main/services/aniCliRunner';

const LOCATIONS: AniLocations = {
    scriptsDir: '/app/resources/ani-scripts',
    dataDir: '/data/anime'
};
const SCRIPT = '/data/tools/anicli/abc/ani-cli';
const BUSYBOX = '/data/tools/busybox/1.35/busybox';
const CURL = '/data/tools/curl/8.0/curl';
const RUNNER = '/app/resources/ani-scripts/pullwave-run.sh';
const TOOLS: AniTools = {
    ytdlp: { path: '/data/tools/ytdlp/1/yt-dlp', source: 'installed' },
    ffmpeg: { path: '/data/tools/ffmpeg/b/bin/ffmpeg', source: 'installed' },
    deno: null,
    ffprobe: null
};

function outcome(partial: Partial<AniRunOutcome> = {}): AniRunOutcome {
    return { exitCode: 1, output: '', menuChoices: [], destination: null, ...partial };
}

function animeChoices(...titles: string[]): MenuChoice[] {
    return titles.map((title, position) => {
        return { prompt: 'Select anime:', choice: `${position + 1} ${title}` };
    });
}

function episodeChoices(...numbers: string[]): MenuChoice[] {
    return numbers.map((number) => {
        return { prompt: 'Select episode:', choice: number };
    });
}

function done(value: AniRunOutcome): AniRunResult<AniRunOutcome> {
    return { status: 'done', value };
}

interface Setup {
    service: AniCliService;
    run: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    prepareTools: ReturnType<typeof vi.spyOn>;
    callsOf: () => AniRunOptions[];
}

// `results` are handed out one per run, in order.
interface SetupOptions {
    subtitleLabels?: () => string[];
    // What the script file says, when it can be read.
    scriptText?: string;
}

const ALL_INSTALLED: AniPrograms = {
    anicli: () => {
        return SCRIPT;
    },
    busybox: () => {
        return '/nonexistent/busybox';
    },
    curl: () => {
        return CURL;
    }
};

function setup(results: Array<AniRunResult<AniRunOutcome>>, scriptExists: Array<boolean> = [true, true, true], options: SetupOptions = {}): Setup {
    let existsCalls = 0;
    const fs: AniToolsFs = {
        exists: () => {
            return true;
        },
        mkdir: () => {
            return undefined;
        },
        symlink: () => {
            return undefined;
        },
        readlink: () => {
            return null;
        },
        remove: () => {
            return undefined;
        },
        readText: (path) => {
            return path === SCRIPT ? (options.scriptText ?? null) : null;
        },
        writeText: () => {
            return undefined;
        }
    };
    // The script is "installed" or not by the sequence given: one answer for each time it is asked for, the last one for the rest.
    const programs: AniPrograms = {
        anicli: () => {
            const answer = scriptExists[existsCalls] ?? scriptExists[scriptExists.length - 1] ?? false;
            existsCalls += 1;
            return answer ? SCRIPT : null;
        },
        busybox: () => {
            return BUSYBOX;
        },
        curl: () => {
            return CURL;
        }
    };
    const locator = new AniCliLocator(LOCATIONS, programs, fs, 'linux');
    const prepareTools = vi.spyOn(locator, 'prepareTools');
    const cancel = vi.fn();
    const queue = [...results];
    const run = vi.fn((): AniRunHandle => {
        const next = queue.shift() ?? done(outcome());
        return { result: Promise.resolve(next), cancel };
    });
    const service = new AniCliService({ locator, customScriptPath: () => { return ''; }, tools: () => { return TOOLS; }, subtitleLabels: options.subtitleLabels, run });
    return {
        service,
        run,
        cancel,
        prepareTools,
        callsOf: () => {
            return run.mock.calls.map((call) => {
                return (call as unknown as [AniRunOptions])[0];
            });
        }
    };
}

describe('AniCliService subtitles', () => {
    const PATCHABLE = [
        '# header',
        'hianime_m3u8() {',
        `    sub_link="$(printf "%s" "$_json" | sed 's|.*"subtitles":\\[||; s|}\\].*||; s|},{|}\\n{|g' | grep -m 1 '"default":true' | sed -nE 's|.*"src":"([^"]*)".*|\\1|p')"`,
        '}'
    ].join('\n');

    it('passes the languages to try to ani-cli', async () => {
        const { service, callsOf } = setup([done(outcome({ exitCode: 0 }))], [true], { subtitleLabels: () => { return ['Portuguese', 'English']; } });
        await service.download({ query: 'naruto', index: 1, episode: '1', quality: 'best', audio: 'sub', downloadDir: '/d' }).result;
        expect(callsOf()[0]?.env).toMatchObject({ PULLWAVE_SUB_LABELS: 'Portuguese|English' });
    });

    it('leaves the choice to ani-cli when no languages are given', async () => {
        const { service, callsOf } = setup([done(outcome({ menuChoices: animeChoices('Naruto') }))]);
        await service.search('naruto', 'sub');
        expect(callsOf()[0]?.env).toMatchObject({ PULLWAVE_SUB_LABELS: '' });
    });

    it('runs the patched copy of the script when it can be patched', async () => {
        const { service, callsOf } = setup([done(outcome({ exitCode: 0 }))], [true], { scriptText: PATCHABLE });
        await service.download({ query: 'naruto', index: 1, episode: '1', quality: 'best', audio: 'sub', downloadDir: '/d' }).result;
        expect(callsOf()[0]?.args.slice(0, 3)).toEqual(['sh', RUNNER, '/data/anime/ani-cli.patched']);
    });

    it('runs the script as it is when it cannot be patched', async () => {
        const { service, callsOf } = setup([done(outcome({ exitCode: 0 }))], [true], { scriptText: 'something else' });
        await service.download({ query: 'naruto', index: 1, episode: '1', quality: 'best', audio: 'sub', downloadDir: '/d' }).result;
        expect(callsOf()[0]?.args.slice(0, 3)).toEqual(['sh', RUNNER, SCRIPT]);
    });
});

describe('AniCliService.resolveSubtitles', () => {
    const LINK = 'https://hls.example.top/v/abc/1080/index.m3u8';
    const request = { query: 'naruto', index: 2, episode: '4', quality: '720p', audio: 'dub' as const };
    const ENGLISH = '{"label":"English","src":"https://s/en.vtt","default":true}';
    const PORTUGUESE = '{"label":"Portuguese","src":"https://s/pt.vtt"}';
    const printed = ['All links:', `1080 >${LINK}`, 'Selected link:', LINK, 'Subtitles:', 'https://s/en.vtt', 'Referer:', 'https://embed.example/', 'Subtitle list:', ENGLISH, PORTUGUESE].join('\n');

    it('asks ani-cli the way it does to watch, and reads the subtitles and the referer', async () => {
        const { service, callsOf } = setup([done(outcome({ exitCode: 0, output: printed }))]);
        expect(await service.resolveSubtitles(request)).toEqual({
            status: 'done',
            value: {
                referer: 'https://embed.example/',
                subtitles: [
                    { label: 'English', src: 'https://s/en.vtt' },
                    { label: 'Portuguese', src: 'https://s/pt.vtt' }
                ]
            }
        });
        const [call] = callsOf();
        expect(call?.args).toEqual(['sh', RUNNER, SCRIPT, '-S', '2', '-e', '4', '-q', '720p', 'naruto']);
        expect(call?.env).toMatchObject({ ANI_CLI_PLAYER: 'debug', ANI_CLI_MODE: 'dub', ANI_CLI_DOWNLOAD_DIR: '.' });
    });

    it('gives an empty list when the script reports no subtitles', async () => {
        const output = ['Selected link:', LINK, 'Subtitles:', 'Referer:', 'https://embed.example/'].join('\n');
        const { service } = setup([done(outcome({ exitCode: 0, output }))]);
        expect(await service.resolveSubtitles(request)).toEqual({ status: 'done', value: { referer: 'https://embed.example/', subtitles: [] } });
    });

    it('maps what ani-cli reports when the episode cannot be played', async () => {
        const { service } = setup([done(outcome({ exitCode: 1, output: 'No sources found for dub!\n' }))]);
        expect(await service.resolveSubtitles(request)).toEqual({ status: 'error', error: { code: 'NO_SOURCES', raw: 'No sources found for dub!' } });
    });

    it('does not trust a list when ani-cli failed, nor one that comes without a stream', async () => {
        expect((await setup([done(outcome({ exitCode: 1, output: printed }))]).service.resolveSubtitles(request)).status).toBe('error');
        const noStream = ['Subtitle list:', ENGLISH].join('\n');
        expect(await setup([done(outcome({ exitCode: 0, output: noStream }))]).service.resolveSubtitles(request)).toEqual({
            status: 'error',
            error: { code: 'UNKNOWN', raw: noStream }
        });
    });

    it('rejects an invalid request without running anything, and reports a missing ani-cli', async () => {
        const invalid = setup([]);
        expect(await invalid.service.resolveSubtitles({ ...request, episode: '1; rm -rf /' })).toEqual({ status: 'error', error: { code: 'UNKNOWN', raw: 'Invalid episode: 1; rm -rf /' } });
        expect(invalid.run).not.toHaveBeenCalled();
        const missing = setup([], [false]);
        expect(await missing.service.resolveSubtitles(request)).toEqual({
            status: 'error',
            error: { code: 'UNKNOWN', raw: 'ani-cli is not installed.' }
        });
        expect(missing.run).not.toHaveBeenCalled();
    });

    it('passes on a failure to start and on a cancellation', async () => {
        const failure: AniRunResult<AniRunOutcome> = { status: 'error', error: { code: 'BINARY_MISSING', raw: 'spawn ENOENT' } };
        expect(await setup([failure]).service.resolveSubtitles(request)).toEqual(failure);
        expect(await setup([{ status: 'cancelled' }]).service.resolveSubtitles(request)).toEqual({ status: 'cancelled' });
    });
});

describe('AniCliService.resolveStream', () => {
    const LINK = 'https://hls.example.top/v/abc/1080/index.m3u8';
    const request = { query: 'naruto', index: 2, episode: '4', quality: '720p', audio: 'dub' as const };
    const printed = ['All links:', `1080 >${LINK}`, 'Selected link:', LINK, 'Subtitles:', 'https://s/pt.vtt', 'Referer:', 'https://embed.example/'].join('\n');

    it('asks ani-cli to print the address, without downloading, and reads it', async () => {
        const { service, callsOf } = setup([done(outcome({ exitCode: 0, output: printed }))]);
        expect(await service.resolveStream(request)).toEqual({ status: 'done', value: { url: LINK, subtitleUrl: 'https://s/pt.vtt', referer: 'https://embed.example/', subtitles: [] } });

        const [call] = callsOf();
        expect(call?.args).toEqual(['sh', RUNNER, SCRIPT, '-S', '2', '-e', '4', '-q', '720p', 'naruto']);
        expect(call?.env).toMatchObject({ ANI_CLI_PLAYER: 'debug', ANI_CLI_MODE: 'dub', ANI_CLI_DOWNLOAD_DIR: '.' });
    });

    it('maps what ani-cli reports when there is no address', async () => {
        const { service } = setup([done(outcome({ exitCode: 1, output: 'No sources found for dub!\n' }))]);
        expect(await service.resolveStream(request)).toEqual({ status: 'error', error: { code: 'NO_SOURCES', raw: 'No sources found for dub!' } });
    });

    it('does not trust an address when ani-cli failed', async () => {
        const { service } = setup([done(outcome({ exitCode: 1, output: printed }))]);
        expect((await service.resolveStream(request)).status).toBe('error');
    });

    it('fails when ani-cli ends well but printed no address', async () => {
        const { service } = setup([done(outcome({ exitCode: 0, output: 'nothing useful' }))]);
        expect(await service.resolveStream(request)).toEqual({ status: 'error', error: { code: 'UNKNOWN', raw: 'nothing useful' } });
    });

    it('rejects an invalid request without running anything', async () => {
        const { service, run } = setup([]);
        expect(await service.resolveStream({ ...request, episode: '1; rm -rf /' })).toEqual({ status: 'error', error: { code: 'UNKNOWN', raw: 'Invalid episode: 1; rm -rf /' } });
        expect(run).not.toHaveBeenCalled();
    });

    it('reports a missing ani-cli', async () => {
        const { service, run } = setup([], [false]);
        expect(await service.resolveStream(request)).toEqual({
            status: 'error',
            error: { code: 'UNKNOWN', raw: 'ani-cli is not installed.' }
        });
        expect(run).not.toHaveBeenCalled();
    });

    it('passes on a failure to start and on a cancellation', async () => {
        const failure: AniRunResult<AniRunOutcome> = { status: 'error', error: { code: 'BINARY_MISSING', raw: 'spawn ENOENT' } };
        expect(await setup([failure]).service.resolveStream(request)).toEqual(failure);
        expect(await setup([{ status: 'cancelled' }]).service.resolveStream(request)).toEqual({ status: 'cancelled' });
    });
});

describe('AniCliService.isAvailable', () => {
    it('is true when a copy of ani-cli exists', () => {
        expect(setup([]).service.isAvailable()).toBe(true);
    });

    it('is false when there is none', () => {
        expect(setup([], [false]).service.isAvailable()).toBe(false);
    });
});

describe('AniCliService.search', () => {
    it('runs ani-cli with the cleaned query in an isolated environment', async () => {
        const { service, callsOf, prepareTools } = setup([done(outcome({ menuChoices: animeChoices('Naruto') }))]);
        await service.search('-d naruto &', 'dub');

        expect(prepareTools).toHaveBeenCalledWith(TOOLS);
        const [call] = callsOf();
        expect(call?.binary).toBe(BUSYBOX);
        expect(call?.args).toEqual(['sh', RUNNER, SCRIPT, 'd naruto']);
        expect(call?.env).toMatchObject({
            PATH: '/data/anime/tools',
            ANI_CLI_MODE: 'dub',
            ANI_CLI_DOWNLOAD_DIR: '.',
            ANI_CLI_MENU: 'pullwave_menu'
        });
    });

    it('returns the results in the order ani-cli listed them', async () => {
        const { service } = setup([done(outcome({ menuChoices: animeChoices('Cyberpunk: Edgerunners', 'Cyberpunk: Edgerunners 2') }))]);
        expect(await service.search('cyberpunk', 'sub')).toEqual({
            status: 'done',
            value: [
                { index: 1, title: 'Cyberpunk: Edgerunners' },
                { index: 2, title: 'Cyberpunk: Edgerunners 2' }
            ]
        });
    });

    it('skips menu lines that are not numbered titles', async () => {
        const { service } = setup([done(outcome({ menuChoices: [...animeChoices('Naruto'), { prompt: 'Select anime:', choice: 'garbage' }] }))]);
        expect(await service.search('naruto', 'sub')).toEqual({ status: 'done', value: [{ index: 1, title: 'Naruto' }] });
    });

    it('ignores choices made for other prompts', async () => {
        const { service } = setup([done(outcome({ menuChoices: [...episodeChoices('1', '2'), ...animeChoices('Naruto')] }))]);
        expect(await service.search('naruto', 'sub')).toEqual({ status: 'done', value: [{ index: 1, title: 'Naruto' }] });
    });

    it('treats a lone result, picked by ani-cli, as the first one', async () => {
        const { service } = setup([done(outcome({ menuChoices: episodeChoices('1', '2', '3') }))]);
        expect(await service.search('Kaguya-sama', 'sub')).toEqual({ status: 'done', value: [{ index: 1, title: 'Kaguya-sama' }] });
    });

    it('treats a clean exit without any menu as a lone result with a single episode', async () => {
        const { service } = setup([done(outcome({ exitCode: 0, output: 'hianime.at links fetched\n' }))]);
        expect(await service.search('kimi no na wa', 'sub')).toEqual({ status: 'done', value: [{ index: 1, title: 'kimi no na wa' }] });
    });

    it('maps what ani-cli reports when there is nothing to list', async () => {
        const { service } = setup([done(outcome({ output: 'No results found!\n' }))]);
        expect(await service.search('zzzz', 'sub')).toEqual({ status: 'error', error: { code: 'NO_RESULTS', raw: 'No results found!' } });
    });

    it('does not run anything for an empty search', async () => {
        const { service, run } = setup([]);
        expect(await service.search(' -- &&& ', 'sub')).toEqual({ status: 'error', error: { code: 'UNKNOWN', raw: 'The search is empty.' } });
        expect(run).not.toHaveBeenCalled();
    });

    it('reports a missing ani-cli', async () => {
        const { service, run } = setup([], [false]);
        expect(await service.search('naruto', 'sub')).toEqual({
            status: 'error',
            error: { code: 'UNKNOWN', raw: 'ani-cli is not installed.' }
        });
        expect(run).not.toHaveBeenCalled();
    });

    it('passes on a failure to start the program', async () => {
        const failure: AniRunResult<AniRunOutcome> = { status: 'error', error: { code: 'BINARY_MISSING', raw: 'spawn ENOENT' } };
        expect(await setup([failure]).service.search('naruto', 'sub')).toEqual(failure);
    });

    it('passes on a cancellation', async () => {
        expect(await setup([{ status: 'cancelled' }]).service.search('naruto', 'sub')).toEqual({ status: 'cancelled' });
    });
});

describe('AniCliService.episodes', () => {
    it('lists the episodes of the chosen result', async () => {
        const { service, callsOf } = setup([done(outcome({ menuChoices: episodeChoices('1', '2', '3') }))]);
        expect(await service.episodes('cyberpunk edgerunners', 2, 'sub')).toEqual({ status: 'done', value: ['1', '2', '3'] });
        expect(callsOf()[0]?.args).toEqual(['sh', RUNNER, SCRIPT, '-S', '2', 'cyberpunk edgerunners']);
        expect(callsOf()[0]?.env).toMatchObject({ ANI_CLI_MODE: 'sub' });
    });

    it('confirms episode 1 for an anime that ani-cli does not list (a film)', async () => {
        const { service, callsOf } = setup([done(outcome({ exitCode: 0, output: 'links fetched\n' })), done(outcome({ exitCode: 0 }))]);
        expect(await service.episodes('kimi no na wa', 1, 'sub')).toEqual({ status: 'done', value: ['1'] });
        expect(callsOf()[1]?.args).toEqual(['sh', RUNNER, SCRIPT, '-S', '1', '-e', '1', 'kimi no na wa']);
    });

    it('fails when ani-cli refuses episode 1 of an unlisted anime', async () => {
        const { service } = setup([done(outcome({ exitCode: 0 })), done(outcome({ exitCode: 1, output: 'Invalid episode!\n' }))]);
        expect(await service.episodes('x', 1, 'sub')).toEqual({ status: 'error', error: { code: 'INVALID_SELECTION', raw: 'Invalid episode!' } });
    });

    it('passes on a cancellation while confirming episode 1', async () => {
        const { service } = setup([done(outcome({ exitCode: 0 })), { status: 'cancelled' }]);
        expect(await service.episodes('x', 1, 'sub')).toEqual({ status: 'cancelled' });
    });

    it('reports a missing ani-cli while confirming episode 1', async () => {
        const { service } = setup([done(outcome({ exitCode: 0 }))], [true, false]);
        expect(await service.episodes('x', 1, 'sub')).toEqual({
            status: 'error',
            error: { code: 'UNKNOWN', raw: 'ani-cli is not installed.' }
        });
    });

    it('maps what ani-cli reports when the list cannot be read', async () => {
        const { service } = setup([done(outcome({ exitCode: 1, output: 'Connection error: could not fetch https://x (curl exit 6)\n' }))]);
        expect(await service.episodes('naruto', 1, 'sub')).toEqual({
            status: 'error',
            error: { code: 'NETWORK', raw: 'Connection error: could not fetch https://x (curl exit 6)' }
        });
    });

    it('reports a missing ani-cli', async () => {
        const { service, run } = setup([], [false]);
        expect((await service.episodes('naruto', 1, 'sub')).status).toBe('error');
        expect(run).not.toHaveBeenCalled();
    });

    it('passes on a failure to start and on a cancellation', async () => {
        const failure: AniRunResult<AniRunOutcome> = { status: 'error', error: { code: 'BINARY_MISSING', raw: 'spawn ENOENT' } };
        expect(await setup([failure]).service.episodes('naruto', 1, 'sub')).toEqual(failure);
        expect(await setup([{ status: 'cancelled' }]).service.episodes('naruto', 1, 'sub')).toEqual({ status: 'cancelled' });
    });
});

describe('AniCliService.download', () => {
    const request: AniDownloadOptions = {
        query: 'cyberpunk edgerunners',
        index: 1,
        episode: '3',
        quality: '720p',
        audio: 'dub',
        downloadDir: '/home/me/Anime'
    };

    it('runs the download with its own folder and audio mode', async () => {
        const { service, callsOf, prepareTools } = setup([done(outcome({ exitCode: 0, destination: '/home/me/Anime/Cyberpunk_ Edgerunners Episode 3.mp4' }))]);
        const handle = service.download(request);

        expect(await handle.result).toEqual({ status: 'done', value: { filePath: '/home/me/Anime/Cyberpunk_ Edgerunners Episode 3.mp4' } });
        expect(prepareTools).toHaveBeenCalledWith(TOOLS);
        expect(callsOf()[0]?.args).toEqual(['sh', RUNNER, SCRIPT, '-d', '-S', '1', '-e', '3', '-q', '720p', 'cyberpunk edgerunners']);
        expect(callsOf()[0]?.env).toMatchObject({ ANI_CLI_MODE: 'dub', ANI_CLI_DOWNLOAD_DIR: '/home/me/Anime' });
    });

    it('reports no file when yt-dlp never said where it wrote', async () => {
        const { service } = setup([done(outcome({ exitCode: 0 }))]);
        expect(await service.download(request).result).toEqual({ status: 'done', value: { filePath: null } });
    });

    it('forwards the progress and destination callbacks', async () => {
        const onProgress = vi.fn();
        const onDestination = vi.fn();
        const { service, callsOf } = setup([done(outcome({ exitCode: 0 }))]);
        await service.download({ ...request, onProgress, onDestination }).result;
        expect(callsOf()[0]?.onProgress).toBe(onProgress);
        expect(callsOf()[0]?.onDestination).toBe(onDestination);
    });

    it('maps a failed download', async () => {
        const { service } = setup([done(outcome({ exitCode: 1, output: 'No sources found for dub!\n' }))]);
        expect(await service.download(request).result).toEqual({ status: 'error', error: { code: 'NO_SOURCES', raw: 'No sources found for dub!' } });
    });

    it('passes on a failure to start and on a cancellation', async () => {
        const failure: AniRunResult<AniRunOutcome> = { status: 'error', error: { code: 'BINARY_MISSING', raw: 'spawn ENOENT' } };
        expect(await setup([failure]).service.download(request).result).toEqual(failure);
        expect(await setup([{ status: 'cancelled' }]).service.download(request).result).toEqual({ status: 'cancelled' });
    });

    it('cancels the run it started', () => {
        const { service, cancel } = setup([done(outcome({ exitCode: 0 }))]);
        service.download(request).cancel();
        expect(cancel).toHaveBeenCalledTimes(1);
    });

    it('rejects an invalid request without running anything', async () => {
        const { service, run } = setup([]);
        const handle = service.download({ ...request, episode: '1; rm -rf /' });
        expect(await handle.result).toEqual({ status: 'error', error: { code: 'UNKNOWN', raw: 'Invalid episode: 1; rm -rf /' } });
        expect(() => {
            handle.cancel();
        }).not.toThrow();
        expect(run).not.toHaveBeenCalled();
    });

    it('reports a missing ani-cli', async () => {
        const { service, run } = setup([], [false]);
        const handle = service.download(request);
        expect(await handle.result).toEqual({
            status: 'error',
            error: { code: 'UNKNOWN', raw: 'ani-cli is not installed.' }
        });
        expect(() => {
            handle.cancel();
        }).not.toThrow();
        expect(run).not.toHaveBeenCalled();
    });
});

describe('AniCliService default runner', () => {
    it('starts a real process when no runner is injected', async () => {
        const locator = new AniCliLocator(LOCATIONS, ALL_INSTALLED, {
            exists: () => {
                return true;
            },
            mkdir: () => {
                return undefined;
            },
            symlink: () => {
                return undefined;
            },
            readlink: () => {
                return null;
            },
            remove: () => {
                return undefined;
            },
            readText: () => {
                return null;
            },
            writeText: () => {
                return undefined;
            }
        });
        const service = new AniCliService({ locator, customScriptPath: () => { return ''; }, tools: () => { return TOOLS; } });
        const result = await service.search('naruto', 'sub');
        expect(result).toMatchObject({ status: 'error', error: { code: 'BINARY_MISSING' } });
    });
});
