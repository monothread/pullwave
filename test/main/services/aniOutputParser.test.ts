import {
    ANIME_PROMPT,
    DOWNLOAD_FAILED_MARKER,
    EPISODE_PROMPT,
    isDownloadFailedLine,
    isSearchMoreLine,
    MENU_PREFIX,
    mapAniError,
    mapAniSpawnError,
    parseAnimeChoice,
    parseDestinationLine,
    parseMenuLine,
    parsePartLine,
    parseProgressLine,
    PART_MARKER,
    stripAnsi
} from '@main/services/aniOutputParser';

const NOW = 1_700_000_000_000;

beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
    vi.restoreAllMocks();
});

const ESC = String.fromCharCode(27);

describe('constants', () => {
    it('exposes the prefix and the prompts ani-cli uses', () => {
        expect(MENU_PREFIX).toBe('PULLWAVE_MENU');
        expect(ANIME_PROMPT).toBe('Select anime:');
        expect(EPISODE_PROMPT).toBe('Select episode:');
    });
});

describe('stripAnsi', () => {
    it('removes color and erase codes and carriage returns', () => {
        expect(stripAnsi(`${ESC}[2K\r${ESC}[1;31mNo results found!${ESC}[0m`)).toBe('No results found!');
    });

    it('leaves plain text untouched', () => {
        expect(stripAnsi('plain text')).toBe('plain text');
    });
});

describe('mapAniError', () => {
    const cases: Array<[string, string, ReturnType<typeof mapAniError>['code']]> = [
        ['no results', `${ESC}[2K\r${ESC}[1;31mNo results found!${ESC}[0m`, 'NO_RESULTS'],
        ['cloudflare block', 'Blocked by cloudflare. Try installing curl-impersonate', 'BLOCKED'],
        ['episode not released', 'Episode not released!', 'EPISODE_NOT_RELEASED'],
        ['no sources', 'No sources found for sub!', 'NO_SOURCES'],
        ['released but no valid sources', 'Episode is released, but no valid sources!', 'NO_SOURCES'],
        ['invalid anime selection', 'Invalid anime selection', 'INVALID_SELECTION'],
        ['invalid episode selection', 'Invalid episode selection', 'INVALID_SELECTION'],
        ['invalid episode', 'Invalid episode!', 'INVALID_SELECTION'],
        ['invalid range', 'Invalid range!', 'INVALID_SELECTION'],
        ['out of range', 'Out of range', 'INVALID_SELECTION'],
        ['missing program', 'Program curl not found. Please install it.', 'BINARY_MISSING'],
        ['missing downloaders', 'Neither yt-dlp nor ffmpeg found', 'BINARY_MISSING'],
        ['missing player', 'No player found. Looked for mpv and vlc', 'BINARY_MISSING'],
        ['connection error', 'Connection error: could not fetch https://x (timeout; curl exit 28)', 'NETWORK'],
        ['http failure', 'Request failed: HTTP 503 from https://x', 'NETWORK'],
        ['dns failure', 'curl: (6) Could not resolve host: hianime.at', 'NETWORK'],
        ['yt-dlp http 5xx', 'ERROR: HTTP Error 502: Bad Gateway', 'NETWORK']
    ];

    it.each(cases)('maps %s', (_name, output, code) => {
        expect(mapAniError(output, 1)).toEqual({ code, raw: stripAnsi(output).trim(), details: { occurredAt: NOW, exitCode: 1 } });
    });

    it('prefers the first matching rule', () => {
        expect(mapAniError('No results found!\nConnection error: x', 1).code).toBe('NO_RESULTS');
    });

    it('falls back to UNKNOWN keeping the output', () => {
        expect(mapAniError('something odd happened', 3)).toEqual({ code: 'UNKNOWN', raw: 'something odd happened', details: { occurredAt: NOW, exitCode: 3 } });
    });

    it('describes the exit code when there is no output', () => {
        expect(mapAniError('  \n', 3)).toEqual({ code: 'UNKNOWN', raw: 'ani-cli exited with code 3', details: { occurredAt: NOW, exitCode: 3 } });
        expect(mapAniError('', null)).toEqual({ code: 'UNKNOWN', raw: 'ani-cli exited with code unknown', details: { occurredAt: NOW } });
    });

    it('adds what the caller knows about the failure to the details', () => {
        expect(mapAniError('No results found!', 1, { operation: 'Searching for the anime with ani-cli' })).toEqual({
            code: 'NO_RESULTS',
            raw: 'No results found!',
            details: { occurredAt: NOW, exitCode: 1, operation: 'Searching for the anime with ani-cli' }
        });
    });

    it('keeps only the end of a very long output', () => {
        const output = `${'a'.repeat(5000)}END`;
        const mapped = mapAniError(output, 1);
        expect(mapped.raw).toHaveLength(4000);
        expect(mapped.raw.endsWith('END')).toBe(true);
    });
});

describe('mapAniSpawnError', () => {
    it('maps a missing executable to BINARY_MISSING', () => {
        const error: NodeJS.ErrnoException = Object.assign(new Error('spawn busybox ENOENT'), { code: 'ENOENT', errno: -2, syscall: 'spawn busybox' });
        expect(mapAniSpawnError(error, { operation: 'Running ani-cli', command: 'busybox sh ani-cli' })).toEqual({
            code: 'BINARY_MISSING',
            raw: 'spawn busybox ENOENT',
            details: { occurredAt: NOW, errorName: 'Error', stack: error.stack, systemCode: 'ENOENT', operation: 'Running ani-cli', command: 'busybox sh ani-cli' }
        });
    });

    it('maps any other failure to UNKNOWN', () => {
        const error: NodeJS.ErrnoException = Object.assign(new Error('spawn busybox EACCES'), { code: 'EACCES', errno: -13, syscall: 'spawn busybox' });
        expect(mapAniSpawnError(error)).toEqual({
            code: 'UNKNOWN',
            raw: 'spawn busybox EACCES',
            details: { occurredAt: NOW, errorName: 'Error', stack: error.stack, systemCode: 'EACCES' }
        });
    });
});

describe('isSearchMoreLine', () => {
    it('is true for the line the search prints when the source has more results, with or without codes and spaces around it', () => {
        expect(isSearchMoreLine('PULLWAVE_SEARCH_MORE')).toBe(true);
        expect(isSearchMoreLine('  PULLWAVE_SEARCH_MORE \r')).toBe(true);
        expect(isSearchMoreLine(`${String.fromCharCode(27)}[2K\r${String.fromCharCode(27)}[1;34mPULLWAVE_SEARCH_MORE${String.fromCharCode(27)}[0m`)).toBe(true);
    });

    it('is false for any other line, even one that mentions it', () => {
        expect(isSearchMoreLine('')).toBe(false);
        expect(isSearchMoreLine('PULLWAVE_SEARCH_MORE now')).toBe(false);
        expect(isSearchMoreLine('the PULLWAVE_SEARCH_MORE line')).toBe(false);
        expect(isSearchMoreLine('pullwave_search_more')).toBe(false);
        expect(isSearchMoreLine('PULLWAVE_MENU\tSelect anime: \t1 Naruto')).toBe(false);
    });
});

describe('parseMenuLine', () => {
    it('reads the prompt and the choice', () => {
        expect(parseMenuLine('PULLWAVE_MENU\tSelect anime: \t1 Cyberpunk: Edgerunners')).toEqual({
            prompt: 'Select anime:',
            choice: '1 Cyberpunk: Edgerunners'
        });
    });

    it('keeps tabs that are part of the choice', () => {
        expect(parseMenuLine('PULLWAVE_MENU\tSelect episode: \ta\tb')).toEqual({ prompt: 'Select episode:', choice: 'a\tb' });
    });

    it('accepts an empty choice', () => {
        expect(parseMenuLine('PULLWAVE_MENU\tSelect episode: \t')).toEqual({ prompt: 'Select episode:', choice: '' });
    });

    it('ignores lines that are not from the menu', () => {
        expect(parseMenuLine('Checking dependencies...')).toBeNull();
        expect(parseMenuLine('OTHER\tSelect anime: \t1 x')).toBeNull();
    });

    it('ignores a menu line without a choice column', () => {
        expect(parseMenuLine('PULLWAVE_MENU\tSelect anime: ')).toBeNull();
        expect(parseMenuLine('PULLWAVE_MENU')).toBeNull();
    });
});

describe('parseAnimeChoice', () => {
    it('splits the position from the title', () => {
        expect(parseAnimeChoice('2 Cyberpunk: Edgerunners 2')).toEqual({ index: 2, title: 'Cyberpunk: Edgerunners 2' });
    });

    it('trims the line', () => {
        expect(parseAnimeChoice('  10 One Piece  ')).toEqual({ index: 10, title: 'One Piece' });
    });

    it('reads the id of the source when the script lets it through, marked, between the position and the title', () => {
        expect(parseAnimeChoice('2 pwid:nisekoi-false-love-season-2-605 Nisekoi: False Love')).toEqual({
            index: 2,
            title: 'Nisekoi: False Love',
            sourceId: 'nisekoi-false-love-season-2-605'
        });
        expect(parseAnimeChoice('1 pwid:naruto-12 Naruto')).toEqual({ index: 1, title: 'Naruto', sourceId: 'naruto-12' });
    });

    it('reads an id of any look, since it is the marker that tells it: another source can write its ids another way', () => {
        expect(parseAnimeChoice('3 pwid:ReooPAxPMsHM4KPMY One Piece')).toEqual({ index: 3, title: 'One Piece', sourceId: 'ReooPAxPMsHM4KPMY' });
        expect(parseAnimeChoice('4 pwid:603 Nisekoi')).toEqual({ index: 4, title: 'Nisekoi', sourceId: '603' });
    });

    it('does not take the first word of a title for an id, whatever it looks like: only the marker makes an id', () => {
        expect(parseAnimeChoice('3 Black Clover Season 2')).toEqual({ index: 3, title: 'Black Clover Season 2' });
        expect(parseAnimeChoice('4 86-1 Eighty-Six')).toEqual({ index: 4, title: '86-1 Eighty-Six' });
        expect(parseAnimeChoice('5 naruto-12 Shippuden')).toEqual({ index: 5, title: 'naruto-12 Shippuden' });
        expect(parseAnimeChoice('6 one-piece Film')).toEqual({ index: 6, title: 'one-piece Film' });
    });

    it('does not take a marker for an id when nothing follows it', () => {
        expect(parseAnimeChoice('7 pwid:naruto-12')).toEqual({ index: 7, title: 'pwid:naruto-12' });
    });

    it('rejects lines that are not a numbered title', () => {
        expect(parseAnimeChoice('Cyberpunk')).toBeNull();
        expect(parseAnimeChoice('3')).toBeNull();
        expect(parseAnimeChoice('')).toBeNull();
    });
});

describe('parseProgressLine', () => {
    it('reads an in-progress line of a fragmented download', () => {
        expect(parseProgressLine('[download]  97.3% of ~ 109.82MiB at  662.96KiB/s ETA 00:05 (frag 141/145)')).toEqual({
            percent: 97.3,
            totalBytes: Math.round(109.82 * 1024 ** 2),
            speed: '662.96KiB/s',
            eta: '00:05'
        });
    });

    it('reads the final line, which has no ETA', () => {
        expect(parseProgressLine('[download] 100% of  107.36MiB in 00:00:44 at 2.41MiB/s')).toEqual({
            percent: 100,
            totalBytes: Math.round(107.36 * 1024 ** 2),
            speed: '2.41MiB/s',
            eta: null
        });
    });

    it('reads a line without speed information', () => {
        expect(parseProgressLine('[download]   0.0% of ~ 2.00GiB')).toEqual({ percent: 0, totalBytes: 2 * 1024 ** 3, speed: null, eta: null });
    });

    it('reads an unknown speed', () => {
        expect(parseProgressLine('[download]  10.0% of 500.00KiB at Unknown B/s ETA Unknown')).toEqual({
            percent: 10,
            totalBytes: 500 * 1024,
            speed: 'Unknown B/s',
            eta: 'Unknown'
        });
    });

    it('reads sizes in bytes', () => {
        expect(parseProgressLine('[download]  50.0% of 200B at 10B/s ETA 00:10')?.totalBytes).toBe(200);
    });

    it('strips terminal codes before reading', () => {
        expect(parseProgressLine(`${ESC}[2K[download]  42.0% of 10.00MiB at 1.00MiB/s ETA 00:06`)?.percent).toBe(42);
    });

    it('ignores other lines', () => {
        expect(parseProgressLine('[download] Destination: /tmp/a.mp4')).toBeNull();
        expect(parseProgressLine('[hlsnative] Total fragments: 145')).toBeNull();
        expect(parseProgressLine('')).toBeNull();
    });
});

describe('parseDestinationLine', () => {
    it('reads the file yt-dlp writes to', () => {
        expect(parseDestinationLine('[download] Destination: /home/me/Anime/Cyberpunk_ Edgerunners Episode 1.mp4')).toBe(
            '/home/me/Anime/Cyberpunk_ Edgerunners Episode 1.mp4'
        );
    });

    it('ignores other lines', () => {
        expect(parseDestinationLine('[download] 100% of 107.36MiB in 00:00:44')).toBeNull();
        expect(parseDestinationLine('')).toBeNull();
    });
});

describe('parsePartLine', () => {
    it('names the marker the stand-in of ffmpeg prints', () => {
        expect(PART_MARKER).toBe('PULLWAVE_PART');
    });

    it('reads the part that starts and the parts of the episode, in their order', () => {
        expect(parsePartLine('PULLWAVE_PART\t0\tvideo,audio')).toEqual({ kinds: ['video', 'audio'], index: 0 });
        expect(parsePartLine('PULLWAVE_PART\t1\tvideo,audio')).toEqual({ kinds: ['video', 'audio'], index: 1 });
        expect(parsePartLine('PULLWAVE_PART\t2\tvideo,audio,other')).toEqual({ kinds: ['video', 'audio', 'other'], index: 2 });
    });

    it('reads the line with colors and spaces around it', () => {
        expect(parsePartLine(`${ESC}[0m  PULLWAVE_PART\t1\tvideo,audio  `)).toEqual({ kinds: ['video', 'audio'], index: 1 });
    });

    it.each([
        ['a part past the last one', 'PULLWAVE_PART\t2\tvideo,audio'],
        ['a part that is not a number', 'PULLWAVE_PART\tone\tvideo,audio'],
        ['a negative part', 'PULLWAVE_PART\t-1\tvideo,audio'],
        ['a part with a decimal point', 'PULLWAVE_PART\t0.5\tvideo,audio'],
        ['no part', 'PULLWAVE_PART\t\tvideo,audio'],
        ['a single part', 'PULLWAVE_PART\t0\tvideo'],
        ['a kind the app does not know', 'PULLWAVE_PART\t0\tvideo,subtitle'],
        ['an empty kind', 'PULLWAVE_PART\t0\tvideo,'],
        ['no kinds', 'PULLWAVE_PART\t0'],
        ['a field more', 'PULLWAVE_PART\t0\tvideo,audio\textra'],
        ['another marker', 'PULLWAVE_MENU\t0\tvideo,audio'],
        ['the marker inside another line', 'the PULLWAVE_PART\t0\tvideo,audio line'],
        ['a progress line', '[download]  10.0% of ~ 1.00MiB at 1.00MiB/s ETA 00:01'],
        ['an empty line', '']
    ])('gives null for %s', (_name, line) => {
        expect(parsePartLine(line)).toBeNull();
    });
});

describe('isDownloadFailedLine', () => {
    it('names the line the stand-in of ffmpeg prints when a download failed', () => {
        expect(DOWNLOAD_FAILED_MARKER).toBe('PULLWAVE_DOWNLOAD_FAILED');
    });

    it('takes the line, also with terminal codes and spaces around it', () => {
        expect(isDownloadFailedLine('PULLWAVE_DOWNLOAD_FAILED')).toBe(true);
        expect(isDownloadFailedLine(`${ESC}[0m  PULLWAVE_DOWNLOAD_FAILED  `)).toBe(true);
    });

    it('does not take a line that only mentions it, or any other line', () => {
        expect(isDownloadFailedLine('the PULLWAVE_DOWNLOAD_FAILED line')).toBe(false);
        expect(isDownloadFailedLine('PULLWAVE_DOWNLOAD_FAILED\textra')).toBe(false);
        expect(isDownloadFailedLine('')).toBe(false);
        expect(isDownloadFailedLine('[download] Destination: /x.mp4')).toBe(false);
    });
});
