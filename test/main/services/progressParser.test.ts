import {
    FILE_PREFIX,
    FILE_PRINT_TEMPLATE,
    WAIT_PREFIX,
    isWaitLine,
    INFO_PREFIX,
    INFO_PRINT_TEMPLATE,
    PROGRESS_PREFIX,
    POSTPROCESS_PREFIX,
    POSTPROCESS_TEMPLATE,
    PROGRESS_TEMPLATE,
    parseFileLine,
    parseInfoLine,
    parsePostProcessLine,
    parseProgressLine,
    parseStreamLine,
    STREAM_PREFIX,
    STREAM_PRINT_TEMPLATE
} from '@main/services/progressParser';

describe('progress templates', () => {
    it('exposes the yt-dlp progress template', () => {
        expect(PROGRESS_TEMPLATE).toBe(
            'download:CYBERPROG|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress.downloaded_bytes)s|%(progress.elapsed)s|%(info.is_live)s|%(info.title)s'
        );
    });

    it('exposes the yt-dlp file print template', () => {
        expect(FILE_PRINT_TEMPLATE).toBe('after_move:CYBERFILE|%(filepath)s');
    });

    it('exposes the template that announces when each post-processor starts and finishes', () => {
        expect(POSTPROCESS_PREFIX).toBe('CYBERPP|');
        expect(POSTPROCESS_TEMPLATE).toBe('postprocess:CYBERPP|%(progress.status)s|%(progress.postprocessor)s');
    });

    it('exposes the template that announces each download and whether it is live', () => {
        expect(INFO_PRINT_TEMPLATE).toBe('before_dl:CYBERINFO|%(is_live)s|%(filename)s');
    });

    it('exposes the template that tells where the stream can be fetched from', () => {
        expect(STREAM_PREFIX).toBe('CYBERSTREAM|');
        expect(STREAM_PRINT_TEMPLATE).toBe('before_dl:CYBERSTREAM|%(.{is_live,protocol,url,http_headers,requested_formats})j');
    });
});

describe('parseStreamLine', () => {
    const HEADERS = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://site.test/' };

    function line(data: unknown): string {
        return `${STREAM_PREFIX}${JSON.stringify(data)}`;
    }

    it('reads the video and the audio that are apart, each with the headers it needs', () => {
        const audioHeaders = { 'User-Agent': 'Audio' };
        expect(
            parseStreamLine(
                line({
                    is_live: true,
                    protocol: 'm3u8_native+m3u8_native',
                    requested_formats: [
                        { url: 'https://cdn.test/video.m3u8', protocol: 'm3u8_native', http_headers: HEADERS, format_id: '7' },
                        { url: 'https://cdn.test/audio.m3u8', protocol: 'm3u8_native', http_headers: audioHeaders }
                    ]
                })
            )
        ).toEqual({
            live: true,
            sources: [
                { url: 'https://cdn.test/video.m3u8', protocol: 'm3u8_native', headers: HEADERS },
                { url: 'https://cdn.test/audio.m3u8', protocol: 'm3u8_native', headers: audioHeaders }
            ]
        });
    });

    it('reads a stream that has the video and the audio together from the line itself', () => {
        expect(parseStreamLine(line({ is_live: true, protocol: 'm3u8', url: 'https://cdn.test/all.m3u8', http_headers: HEADERS, requested_formats: null }))).toEqual({
            live: true,
            sources: [{ url: 'https://cdn.test/all.m3u8', protocol: 'm3u8', headers: HEADERS }]
        });
    });

    it('gives a rendition without headers the ones of the whole video', () => {
        expect(parseStreamLine(line({ is_live: true, http_headers: HEADERS, requested_formats: [{ url: 'https://cdn.test/v.m3u8', protocol: 'm3u8_native' }] }))?.sources).toEqual([
            { url: 'https://cdn.test/v.m3u8', protocol: 'm3u8_native', headers: HEADERS }
        ]);
    });

    it('keeps only the headers that are text', () => {
        expect(parseStreamLine(line({ is_live: true, url: 'https://a.test/x.m3u8', protocol: 'm3u8', http_headers: { A: 'b', C: 1, D: null } }))?.sources[0]?.headers).toEqual({ A: 'b' });
    });

    it.each([[false], [null], ['True']])('reads is_live=%j as not live', (value) => {
        expect(parseStreamLine(line({ is_live: value, url: 'https://a.test/x.m3u8', protocol: 'm3u8' }))?.live).toBe(false);
    });

    it.each([
        ['text that is not JSON', `${STREAM_PREFIX}{not json`],
        ['JSON that is not an object', `${STREAM_PREFIX}[1,2]`],
        ['JSON that is a number', `${STREAM_PREFIX}7`],
        ['a rendition without an address', line({ is_live: true, requested_formats: [{ protocol: 'm3u8_native' }] })],
        ['a rendition without a protocol', line({ is_live: true, requested_formats: [{ url: 'https://a.test/x.m3u8' }] })],
        ['a rendition that is not an object', line({ is_live: true, requested_formats: ['x'] })],
        ['an empty list of renditions', line({ is_live: true, requested_formats: [] })],
        ['no address at all', line({ is_live: true })],
        ['another line', 'CYBERINFO|True|/d/v.mp4'],
        ['an empty line', '']
    ])('gives nothing for %s', (_label, text) => {
        expect(parseStreamLine(text)).toBeNull();
    });
});

describe('parseProgressLine', () => {
    it('parses a complete progress line', () => {
        expect(parseProgressLine(`${PROGRESS_PREFIX}  14.2%|   4.84MiB/s|00:12|1048576|3.5|False|Me at the zoo`)).toEqual({
            percent: 14.2,
            speed: '4.84MiB/s',
            eta: '00:12',
            title: 'Me at the zoo',
            downloadedBytes: 1048576,
            elapsedSeconds: 3.5,
            live: false
        });
    });

    it('recognises a live stream', () => {
        expect(parseProgressLine(`${PROGRESS_PREFIX}100.0%|39.46KiB/s|NA|648600|16.05|True|index 2026`)).toEqual({
            percent: 100,
            speed: '39.46KiB/s',
            eta: '',
            title: 'index 2026',
            downloadedBytes: 648600,
            elapsedSeconds: 16.05,
            live: true
        });
    });

    it.each(['False', 'None', 'NA', ''])('does not treat is_live=%s as live', (value) => {
        expect(parseProgressLine(`${PROGRESS_PREFIX}1.0%|1MiB/s|00:01|10|1|${value}|T`)?.live).toBe(false);
    });

    it('keeps pipes inside the title', () => {
        expect(parseProgressLine(`${PROGRESS_PREFIX}50.0%|1MiB/s|00:01|10|1|False|A | B | C`)?.title).toBe('A | B | C');
    });

    it('turns NA and Unknown values into empty strings or null numbers', () => {
        expect(parseProgressLine(`${PROGRESS_PREFIX}100.0%|Unknown B/s|NA|NA|NA|None|Title`)).toEqual({
            percent: 100,
            speed: '',
            eta: '',
            title: 'Title',
            downloadedBytes: null,
            elapsedSeconds: null,
            live: false
        });
    });

    it('uses zero when the percentage is not numeric (live streams have none)', () => {
        expect(parseProgressLine(`${PROGRESS_PREFIX}NA|1MiB/s|00:01|10|1|True|Title`)?.percent).toBe(0);
    });

    it('returns null for lines without the progress prefix', () => {
        expect(parseProgressLine('[download] Destination: file.mp4')).toBeNull();
        expect(parseProgressLine('')).toBeNull();
    });
});

describe('parseInfoLine', () => {
    it('reads that a download is live and where its file is written', () => {
        expect(parseInfoLine(`${INFO_PREFIX}True|/home/u/Downloads/index 2026 [index].mp4`)).toEqual({
            live: true,
            filePath: '/home/u/Downloads/index 2026 [index].mp4'
        });
    });

    it.each(['False', 'None', 'NA'])('reads is_live=%s as not live', (value) => {
        expect(parseInfoLine(`${INFO_PREFIX}${value}|/d/v.mp4`)).toEqual({ live: false, filePath: '/d/v.mp4' });
    });

    it('keeps pipes inside the path', () => {
        expect(parseInfoLine(`${INFO_PREFIX}True|/d/a | b.mp4`)?.filePath).toBe('/d/a | b.mp4');
    });

    it('returns null without a path or for other lines', () => {
        expect(parseInfoLine(`${INFO_PREFIX}True|`)).toBeNull();
        expect(parseInfoLine(`${INFO_PREFIX}True`)).toBeNull();
        expect(parseInfoLine('CYBERFILE|/d/v.mp4')).toBeNull();
        expect(parseInfoLine('')).toBeNull();
    });
});

describe('parsePostProcessLine', () => {
    it('parses the start of a post-processor', () => {
        expect(parsePostProcessLine('CYBERPP|started|ExtractAudio')).toEqual({ status: 'started', processor: 'ExtractAudio' });
    });

    it('parses the end of a post-processor', () => {
        expect(parsePostProcessLine('CYBERPP|finished|Merger')).toEqual({ status: 'finished', processor: 'Merger' });
    });

    it('keeps the name of post-processors that have digits or are not known to the app', () => {
        expect(parsePostProcessLine('CYBERPP|started|FixupM3u8')).toEqual({ status: 'started', processor: 'FixupM3u8' });
        expect(parsePostProcessLine('CYBERPP|started|SomethingNew')).toEqual({ status: 'started', processor: 'SomethingNew' });
    });

    it('trims the status and ignores extra fields after the processor name', () => {
        expect(parsePostProcessLine('CYBERPP| started |MoveFiles')).toEqual({ status: 'started', processor: 'MoveFiles' });
    });

    it('ignores an unknown status', () => {
        expect(parsePostProcessLine('CYBERPP|processing|Merger')).toBeNull();
        expect(parsePostProcessLine('CYBERPP||Merger')).toBeNull();
    });

    it('ignores a missing or not available processor name', () => {
        expect(parsePostProcessLine('CYBERPP|started|')).toBeNull();
        expect(parsePostProcessLine('CYBERPP|started|NA')).toBeNull();
        expect(parsePostProcessLine('CYBERPP|started')).toBeNull();
    });

    it('ignores every other line', () => {
        expect(parsePostProcessLine('CYBERPROG|100.0%|1MiB/s|00:00|1|1|NA|t')).toBeNull();
        expect(parsePostProcessLine('[Merger] Merging formats into "a.mp4"')).toBeNull();
        expect(parsePostProcessLine(' CYBERPP|started|Merger')).toBeNull();
        expect(parsePostProcessLine('')).toBeNull();
    });
});

describe('isWaitLine', () => {
    it('recognises the lines yt-dlp prints while it waits for a scheduled live stream', () => {
        expect(WAIT_PREFIX).toBe('[wait]');
        expect(isWaitLine('[wait] Waiting for 00:59:59 - Press Ctrl+C to try now')).toBe(true);
        expect(isWaitLine('[wait] Remaining time until next attempt: 00:59:59')).toBe(true);
        expect(isWaitLine('[wait]')).toBe(true);
    });

    it('ignores every other line', () => {
        expect(isWaitLine('[FakeLive] Extracting URL: https://x.test/a')).toBe(false);
        expect(isWaitLine('WARNING: [FakeLive] abc: This live event will begin in 1 hour')).toBe(false);
        expect(isWaitLine('CYBERPROG|1%|1|1|t')).toBe(false);
        expect(isWaitLine(' [wait] indented')).toBe(false);
        expect(isWaitLine('')).toBe(false);
    });
});

describe('parseFileLine', () => {
    it('extracts the file path', () => {
        expect(parseFileLine(`${FILE_PREFIX}/home/u/Downloads/My Video [abc].mp4`)).toBe('/home/u/Downloads/My Video [abc].mp4');
    });

    it('returns null for an empty path', () => {
        expect(parseFileLine(FILE_PREFIX)).toBeNull();
    });

    it('returns null for other lines', () => {
        expect(parseFileLine('CYBERPROG|1%|1|1|t')).toBeNull();
    });
});
