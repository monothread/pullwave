import { applySgr, highlightLog, logLevelOf, splitAnsiRuns, stripAnsiCodes, tokenizePlain, type AnsiStyle } from '@renderer/components/logHighlight';

const ESC = String.fromCharCode(27);
const PLAIN: AnsiStyle = { color: null, bold: false };

describe('stripAnsiCodes', () => {
    it('takes out the colors and the other codes of the terminal', () => {
        expect(stripAnsiCodes(`${ESC}[1;31mError${ESC}[0m done${ESC}[2K${ESC}[?25l`)).toBe('Error done');
    });

    it('leaves a text without codes as it is', () => {
        expect(stripAnsiCodes('plain [x] text')).toBe('plain [x] text');
    });
});

describe('applySgr', () => {
    it('resets with 0 or with no parameter', () => {
        expect(applySgr({ color: 'red', bold: true }, '0')).toEqual(PLAIN);
        expect(applySgr({ color: 'red', bold: true }, '')).toEqual(PLAIN);
    });

    it('turns bold on with 1 and off with 22', () => {
        expect(applySgr(PLAIN, '1')).toEqual({ color: null, bold: true });
        expect(applySgr({ color: 'cyan', bold: true }, '22')).toEqual({ color: 'cyan', bold: false });
    });

    it('takes every color from 30 to 37 and every bright one from 90 to 97', () => {
        const colors = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
        colors.forEach((color, index) => {
            expect(applySgr(PLAIN, String(30 + index))).toEqual({ color, bold: false });
            expect(applySgr(PLAIN, String(90 + index))).toEqual({ color: `bright-${color}`, bold: false });
        });
    });

    it('goes back to the default color with 39', () => {
        expect(applySgr({ color: 'green', bold: true }, '39')).toEqual({ color: null, bold: true });
    });

    it('applies several codes in order and ignores the ones it does not know (backgrounds, underline)', () => {
        expect(applySgr(PLAIN, '1;33')).toEqual({ color: 'yellow', bold: true });
        expect(applySgr(PLAIN, '31;0;32')).toEqual({ color: 'green', bold: false });
        expect(applySgr({ color: 'red', bold: false }, '4;41;38')).toEqual({ color: 'red', bold: false });
    });
});

describe('splitAnsiRuns', () => {
    it('gives one plain run for a text without codes', () => {
        expect(splitAnsiRuns('hello')).toEqual([{ text: 'hello', style: PLAIN }]);
    });

    it('gives no run for an empty text or a text of codes only', () => {
        expect(splitAnsiRuns('')).toEqual([]);
        expect(splitAnsiRuns(`${ESC}[31m${ESC}[0m`)).toEqual([]);
    });

    it('cuts the text where its style changes and drops the codes that are not colors', () => {
        expect(splitAnsiRuns(`a${ESC}[1;31mb${ESC}[2Kc${ESC}[0md`)).toEqual([
            { text: 'a', style: PLAIN },
            { text: 'b', style: { color: 'red', bold: true } },
            { text: 'c', style: { color: 'red', bold: true } },
            { text: 'd', style: PLAIN }
        ]);
    });
});

describe('tokenizePlain', () => {
    it('gives the whole text as one piece when nothing in it has a kind', () => {
        expect(tokenizePlain('nothing special here')).toEqual([{ text: 'nothing special here', kind: 'text', ansi: null }]);
    });

    it('gives nothing for an empty text', () => {
        expect(tokenizePlain('')).toEqual([]);
    });

    it('recognizes each kind of piece in a line of yt-dlp', () => {
        expect(tokenizePlain('[download] Destination: /home/me/Videos/a.mp4 from https://x.test/v?id=1 at 12.5MiB 45.2%')).toEqual([
            { text: '[download]', kind: 'tag', ansi: null },
            { text: ' Destination: ', kind: 'text', ansi: null },
            { text: '/home/me/Videos/a.mp4', kind: 'path', ansi: null },
            { text: ' from ', kind: 'text', ansi: null },
            { text: 'https://x.test/v?id=1', kind: 'url', ansi: null },
            { text: ' at ', kind: 'text', ansi: null },
            { text: '12.5MiB', kind: 'size', ansi: null },
            { text: ' ', kind: 'text', ansi: null },
            { text: '45.2%', kind: 'size', ansi: null }
        ]);
    });

    it('recognizes the levels, the times, the quoted texts and the hidden secrets', () => {
        expect(tokenizePlain('2026-11-11 10:00:00 INFO     "quoted" token=*** at 10:00:01.250')).toEqual([
            { text: '2026-11-11 10:00:00', kind: 'time', ansi: null },
            { text: ' ', kind: 'text', ansi: null },
            { text: 'INFO', kind: 'level', ansi: null },
            { text: '     ', kind: 'text', ansi: null },
            { text: '"quoted"', kind: 'string', ansi: null },
            { text: ' token=', kind: 'text', ansi: null },
            { text: '***', kind: 'redacted', ansi: null },
            { text: ' at ', kind: 'text', ansi: null },
            { text: '10:00:01.250', kind: 'time', ansi: null }
        ]);
    });

    it('stops an address at a hidden secret, which is marked as one', () => {
        expect(tokenizePlain('https://x.test/v?token=***&q=1')).toEqual([
            { text: 'https://x.test/v?token=', kind: 'url', ansi: null },
            { text: '***', kind: 'redacted', ansi: null },
            { text: '&q=1', kind: 'text', ansi: null }
        ]);
    });

    it('takes a level with its colon, and the options of a command', () => {
        expect(tokenizePlain('ERROR: bad -f best --no-part')).toEqual([
            { text: 'ERROR:', kind: 'level', ansi: null },
            { text: ' bad ', kind: 'text', ansi: null },
            { text: '-f', kind: 'flag', ansi: null },
            { text: ' best ', kind: 'text', ansi: null },
            { text: '--no-part', kind: 'flag', ansi: null }
        ]);
    });

    it('recognizes a path of Windows and one in the home folder, but not a word with a slash in it', () => {
        expect(tokenizePlain('C:\\Users\\me\\a.mp4 ~/Videos/b.mp4 and/or')).toEqual([
            { text: 'C:\\Users\\me\\a.mp4', kind: 'path', ansi: null },
            { text: ' ', kind: 'text', ansi: null },
            { text: '~/Videos/b.mp4', kind: 'path', ansi: null },
            { text: ' and/or', kind: 'text', ansi: null }
        ]);
    });

    it('does not take a lowercase level word or a dash inside a word for a kind', () => {
        expect(tokenizePlain('an error in e-mail')).toEqual([{ text: 'an error in e-mail', kind: 'text', ansi: null }]);
    });
});

describe('highlightLog', () => {
    it('keeps the colors the program gave and colors the rest by kind', () => {
        expect(highlightLog(`${ESC}[0;31mERROR:${ESC}[0m [youtube] gone`)).toEqual([
            { text: 'ERROR:', kind: 'text', ansi: { color: 'red', bold: false } },
            { text: ' ', kind: 'text', ansi: null },
            { text: '[youtube]', kind: 'tag', ansi: null },
            { text: ' gone', kind: 'text', ansi: null }
        ]);
    });

    it('keeps a bold piece without a color as the program wrote it', () => {
        expect(highlightLog(`${ESC}[1m[bold]${ESC}[22m`)).toEqual([{ text: '[bold]', kind: 'text', ansi: { color: null, bold: true } }]);
    });

    it('gives nothing for an empty line', () => {
        expect(highlightLog('')).toEqual([]);
    });
});

describe('logLevelOf', () => {
    it('tells the command by its stream', () => {
        expect(logLevelOf({ stream: 'command', text: 'yt-dlp ERROR' })).toBe('command');
    });

    it('tells how the program ended: well, by a signal, or badly', () => {
        expect(logLevelOf({ stream: 'event', text: 'exited with code 0' })).toBe('success');
        expect(logLevelOf({ stream: 'event', text: 'ended by signal SIGTERM' })).toBe('warning');
        expect(logLevelOf({ stream: 'event', text: 'exited with code 1' })).toBe('error');
        expect(logLevelOf({ stream: 'event', text: 'ended without an exit code' })).toBe('error');
        expect(logLevelOf({ stream: 'event', text: 'could not start: spawn x ENOENT' })).toBe('error');
    });

    it('tells a program the app stopped on purpose as info, not as a failure', () => {
        expect(logLevelOf({ stream: 'event', text: 'stopped by the app' })).toBe('info');
        expect(logLevelOf({ stream: 'stdout', text: 'stopped by the app' })).toBe('plain');
    });

    it('tells an error by its words, in the forms the programs write them', () => {
        [
            'ERROR: [youtube] abc: Video unavailable',
            '10:00:00.000 [main] ERROR s.t.Server - boom',
            '2026-11-11 10:00:00 CRITICAL Chrome crashed',
            'SEVERE: something',
            'FATAL out of memory',
            'Caused by: java.net.ConnectException',
            '\tat suwayomi.Main.run(Main.kt:12)',
            'java.lang.IllegalStateException: bad',
            'Traceback (most recent call last):',
            '[mp4 @ 0x55] moov atom not found: Invalid data found when processing input, failed',
            'Conversion failed!',
            'Permission denied',
            'Connection refused',
            'unable to open file',
            'cannot find the file',
            'Could not write header'
        ].forEach((text) => {
            expect(logLevelOf({ stream: 'stderr', text })).toBe('error');
        });
    });

    it('tells an error colored by the program', () => {
        expect(logLevelOf({ stream: 'stderr', text: `${ESC}[0;31mERROR:${ESC}[0m nope` })).toBe('error');
    });

    it('tells a warning', () => {
        expect(logLevelOf({ stream: 'stderr', text: 'WARNING: [youtube] Falling back' })).toBe('warning');
        expect(logLevelOf({ stream: 'stdout', text: '10:00:00 [main] WARN  x - slow' })).toBe('warning');
        expect(logLevelOf({ stream: 'stdout', text: 'this option is deprecated' })).toBe('warning');
    });

    it('tells a line of debugging', () => {
        expect(logLevelOf({ stream: 'stderr', text: '[debug] Command-line config' })).toBe('debug');
        expect(logLevelOf({ stream: 'stdout', text: '10:00:00 [main] DEBUG x - y' })).toBe('debug');
        expect(logLevelOf({ stream: 'stdout', text: '10:00:00 [main] TRACE x - y' })).toBe('debug');
    });

    it('tells a line of information', () => {
        expect(logLevelOf({ stream: 'stdout', text: '2026-11-11 10:00:00 INFO     Serving on http://0.0.0.0:8191' })).toBe('info');
    });

    it('tells any other line as plain', () => {
        expect(logLevelOf({ stream: 'stdout', text: '[download] Destination: a.mp4' })).toBe('plain');
        expect(logLevelOf({ stream: 'stdout', text: 'debug info' })).toBe('plain');
    });
});
