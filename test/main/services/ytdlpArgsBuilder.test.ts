import { DEFAULT_SETTINGS } from '@shared/constants';
import type { Settings } from '@shared/types';
import { FILE_PRINT_TEMPLATE, INFO_PRINT_TEMPLATE, POSTPROCESS_TEMPLATE, PROGRESS_TEMPLATE, STREAM_PRINT_TEMPLATE, THUMBNAIL_PRINT_TEMPLATE } from '@main/services/progressParser';
import { buildYtdlpArgs, splitArguments } from '@main/services/ytdlpArgsBuilder';

const URL = 'https://example.com/watch?v=abc';
const DEFAULT_DIR = '/home/u/Downloads';

function build(overrides: Partial<Settings> = {}, ffmpegLocation: string | null = null): string[] {
    return buildYtdlpArgs(URL, { ...DEFAULT_SETTINGS, ...overrides }, DEFAULT_DIR, ffmpegLocation);
}

describe('splitArguments', () => {
    it('splits on whitespace', () => {
        expect(splitArguments('--no-mtime --retries 5')).toEqual(['--no-mtime', '--retries', '5']);
    });

    it('keeps quoted segments together and strips the quotes', () => {
        expect(splitArguments(`--user-agent "My Agent 1.0" --referer 'https://a b'`)).toEqual([
            '--user-agent',
            'My Agent 1.0',
            '--referer',
            'https://a b'
        ]);
    });

    it('returns an empty array for blank input', () => {
        expect(splitArguments('   ')).toEqual([]);
        expect(splitArguments('')).toEqual([]);
    });
});

describe('buildYtdlpArgs', () => {
    it('builds the exact default argument list', () => {
        expect(build()).toEqual([
            '--newline',
            '--no-colors',
            '--progress',
            '--no-simulate',
            '--progress-template',
            PROGRESS_TEMPLATE,
            '--progress-template',
            POSTPROCESS_TEMPLATE,
            '--print',
            FILE_PRINT_TEMPLATE,
            '--print',
            INFO_PRINT_TEMPLATE,
            '--print',
            STREAM_PRINT_TEMPLATE,
            '--print',
            THUMBNAIL_PRINT_TEMPLATE,
            '-P',
            DEFAULT_DIR,
            '-o',
            '%(title).80s [%(id)s].%(ext)s',
            '--trim-filenames',
            '240',
            '--no-playlist',
            '-f',
            'bv*+ba/b',
            '--merge-output-format',
            'mp4',
            '--',
            URL
        ]);
    });

    it('asks yt-dlp to report each post-processor without turning on the verbose output', () => {
        const args = build({ audioOnly: true });
        expect(
            args.filter((arg) => {
                return arg === POSTPROCESS_TEMPLATE;
            })
        ).toHaveLength(1);
        expect(args[args.indexOf(POSTPROCESS_TEMPLATE) - 1]).toBe('--progress-template');
        expect(args).not.toContain('--no-quiet');
    });

    it('always places the URL last after the separator', () => {
        const args = build({ extraArgs: '--no-mtime' });
        expect(args.slice(-2)).toEqual(['--', URL]);
    });

    it('uses the configured download directory over the default', () => {
        const args = build({ downloadDir: '/media/videos' });
        expect(args[args.indexOf('-P') + 1]).toBe('/media/videos');
    });

    it('uses the max title length in the output template', () => {
        const args = build({ maxTitleLength: 120 });
        expect(args[args.indexOf('-o') + 1]).toBe('%(title).120s [%(id)s].%(ext)s');
    });

    it('limits the height when a max resolution is set', () => {
        const args = build({ maxResolution: '720' });
        expect(args[args.indexOf('-f') + 1]).toBe('bv*[height<=720]+ba/b[height<=720]');
    });

    it('uses the selected video container', () => {
        const args = build({ videoContainer: 'mkv' });
        expect(args[args.indexOf('--merge-output-format') + 1]).toBe('mkv');
    });

    it('extracts audio in audio-only mode without merging video', () => {
        const args = build({ audioOnly: true, audioFormat: 'opus', maxResolution: '720' });
        expect(args).toEqual(expect.arrayContaining(['-f', 'ba/b', '-x', '--audio-format', 'opus']));
        expect(args).not.toContain('--merge-output-format');
        expect(args).not.toContain('bv*[height<=720]+ba/b[height<=720]');
    });

    it('adds no cookie arguments when cookies are disabled', () => {
        expect(build({ cookiesBrowser: 'chrome' })).not.toContain('--cookies-from-browser');
    });

    it('adds the browser cookies argument', () => {
        const args = build({ useBrowserCookies: true, cookiesBrowser: 'brave' });
        expect(args[args.indexOf('--cookies-from-browser') + 1]).toBe('brave');
    });

    it('points the cookies argument at the folder of a detected browser', () => {
        const args = build({ useBrowserCookies: true, cookiesBrowser: 'brave', cookiesBrowserDir: '/home/a/.config/BraveSoftware/Brave-Origin' });
        expect(args[args.indexOf('--cookies-from-browser') + 1]).toBe('brave:/home/a/.config/BraveSoftware/Brave-Origin');
    });

    it('looks for the profile inside the folder of a detected browser', () => {
        const args = build({
            useBrowserCookies: true,
            cookiesBrowser: 'brave',
            cookiesBrowserDir: '/home/a/.config/BraveSoftware/Brave-Origin',
            cookiesProfile: 'Profile 1'
        });
        expect(args[args.indexOf('--cookies-from-browser') + 1]).toBe('brave:/home/a/.config/BraveSoftware/Brave-Origin/Profile 1');
    });

    it('adds the browser profile to the cookies argument', () => {
        const args = build({ useBrowserCookies: true, cookiesBrowser: 'firefox', cookiesProfile: 'work' });
        expect(args[args.indexOf('--cookies-from-browser') + 1]).toBe('firefox:work');
    });

    it('enables playlists', () => {
        const args = build({ downloadPlaylist: true });
        expect(args).toContain('--yes-playlist');
        expect(args).not.toContain('--no-playlist');
    });

    it('adds subtitle arguments', () => {
        const args = build({ writeSubtitles: true, subtitleLangs: 'en,pt' });
        expect(args).toEqual(expect.arrayContaining(['--write-subs', '--sub-langs', 'en,pt']));
        expect(args).not.toContain('--embed-subs');
        expect(args).not.toContain('--write-auto-subs');
    });

    it('does not request auto-generated subtitles by default', () => {
        expect(build({ writeSubtitles: true })).not.toContain('--write-auto-subs');
    });

    it('requests auto-generated subtitles when enabled', () => {
        const args = build({ writeSubtitles: true, autoSubtitles: true, subtitleLangs: 'ja' });
        expect(args).toEqual(expect.arrayContaining(['--write-subs', '--write-auto-subs', '--sub-langs', 'ja']));
    });

    it('embeds subtitles without --write-subs, so yt-dlp deletes the separate subtitle files afterwards', () => {
        const args = build({ writeSubtitles: true, embedSubtitles: true, subtitleLangs: 'ja' });
        expect(args).toEqual(expect.arrayContaining(['--embed-subs', '--sub-langs', 'ja']));
        expect(args[args.indexOf('--sub-langs') + 1]).toBe('ja');
        expect(args).not.toContain('--write-subs');
        expect(args).not.toContain('--write-auto-subs');
    });

    it('embeds auto-generated subtitles without --write-subs', () => {
        const args = build({ writeSubtitles: true, embedSubtitles: true, autoSubtitles: true, subtitleLangs: 'ja' });
        expect(args).toEqual(expect.arrayContaining(['--embed-subs', '--write-auto-subs', '--sub-langs', 'ja']));
        expect(args).not.toContain('--write-subs');
    });

    it('keeps the subtitle file next to the video when they are not embedded', () => {
        const args = build({ writeSubtitles: true, embedSubtitles: false });
        expect(args).toContain('--write-subs');
        expect(args).not.toContain('--embed-subs');
    });

    it('requests all subtitle languages when none is configured', () => {
        const args = build({ writeSubtitles: true, subtitleLangs: '' });
        expect(args[args.indexOf('--sub-langs') + 1]).toBe('all');
    });

    it('ignores subtitle options when subtitles are disabled', () => {
        const args = build({ writeSubtitles: false, embedSubtitles: true, autoSubtitles: true });
        expect(args).not.toContain('--write-subs');
        expect(args).not.toContain('--write-auto-subs');
        expect(args).not.toContain('--embed-subs');
    });

    it('adds restrict-filenames, rate limit and the resolved ffmpeg location', () => {
        const args = build({ restrictFilenames: true, rateLimit: '2M' }, '/opt/ffmpeg');
        expect(args).toContain('--restrict-filenames');
        expect(args[args.indexOf('-r') + 1]).toBe('2M');
        expect(args[args.indexOf('--ffmpeg-location') + 1]).toBe('/opt/ffmpeg');
    });

    it('does not add the ffmpeg location when none was resolved', () => {
        expect(build({ ffmpegPath: '/ignored/here' }, null)).not.toContain('--ffmpeg-location');
    });

    it('defaults the ffmpeg location to none', () => {
        expect(buildYtdlpArgs(URL, DEFAULT_SETTINGS, DEFAULT_DIR)).not.toContain('--ffmpeg-location');
    });

    it('adds the JavaScript runtime argument', () => {
        const args = build({ jsRuntime: 'node:/usr/bin/node' });
        expect(args[args.indexOf('--js-runtimes') + 1]).toBe('node:/usr/bin/node');
    });

    it('omits optional flags by default', () => {
        const args = build();
        expect(args).not.toContain('--restrict-filenames');
        expect(args).not.toContain('-r');
        expect(args).not.toContain('--ffmpeg-location');
        expect(args).not.toContain('--js-runtimes');
    });

    it('appends parsed extra arguments before the URL separator', () => {
        const args = build({ extraArgs: '--retries 5 --user-agent "My Agent"' });
        expect(args.slice(-6)).toEqual(['--retries', '5', '--user-agent', 'My Agent', '--', URL]);
    });
});

describe('buildYtdlpArgs for live streams', () => {
    const build = (overrides: Partial<Settings>) => {
        return buildYtdlpArgs(URL, { ...DEFAULT_SETTINGS, ...overrides }, DEFAULT_DIR);
    };

    it('adds no live options by default', () => {
        const args = build({});
        expect(args).not.toContain('--wait-for-video');
        expect(args).not.toContain('--live-from-start');
        expect(args).not.toContain('--downloader-args');
    });

    it('waits for a scheduled stream, checking every 30 seconds', () => {
        const args = build({ waitForLive: true });
        expect(args[args.indexOf('--wait-for-video') + 1]).toBe('30');
        expect(args).not.toContain('--live-from-start');
    });

    it('is not quiet while it waits, so yt-dlp prints its "[wait]" lines, and stays as it was otherwise', () => {
        expect(build({ waitForLive: true })).toContain('--no-quiet');
        expect(build({ waitForLive: false })).not.toContain('--no-quiet');
        expect(build({ liveFromStart: true })).not.toContain('--no-quiet');
    });

    it('records from the start through yt-dlp (YouTube, Twitch) and through ffmpeg (HLS)', () => {
        const args = build({ liveFromStart: true });
        expect(args).toContain('--live-from-start');
        expect(args[args.indexOf('--downloader-args') + 1]).toBe('ffmpeg_i:-live_start_index 0');
        expect(args).not.toContain('--wait-for-video');
    });

    it('combines both options and keeps them before the URL separator', () => {
        const args = build({ waitForLive: true, liveFromStart: true });
        expect(args).toEqual(expect.arrayContaining(['--wait-for-video', '30', '--live-from-start', '--downloader-args', 'ffmpeg_i:-live_start_index 0']));
        expect(args.slice(-2)).toEqual(['--', URL]);
    });

    describe('attempts to record a stream that came back', () => {
        const resume = (overrides: Partial<Settings>, resumedPart = 2, extras = {}) => {
            return buildYtdlpArgs(URL, { ...DEFAULT_SETTINGS, ...overrides }, DEFAULT_DIR, null, { ...extras, resumedPart });
        };

        it('only record when the video is live', () => {
            const args = resume({});
            expect(args[args.indexOf('--match-filter') + 1]).toBe('is_live');
            expect(args.slice(-2)).toEqual(['--', URL]);
        });

        it('write to a file with the part number', () => {
            expect(resume({}, 2)[resume({}, 2).indexOf('-o') + 1]).toBe('%(title).80s [%(id)s] (part 2).%(ext)s');
            expect(resume({}, 5)[resume({}, 5).indexOf('-o') + 1]).toBe('%(title).80s [%(id)s] (part 5).%(ext)s');
        });

        it('neither wait for a scheduled stream nor start from the beginning again', () => {
            const args = resume({ waitForLive: true, liveFromStart: true });
            expect(args).not.toContain('--wait-for-video');
            expect(args).not.toContain('--no-quiet');
            expect(args).not.toContain('--live-from-start');
            expect(args).not.toContain('--downloader-args');
        });

        it('keep everything else of the request', () => {
            const args = resume({ useBrowserCookies: true, cookiesBrowser: 'chrome' }, 2, { downloadDir: '/custom/dir' });
            expect(args).toEqual(expect.arrayContaining(['-P', '/custom/dir', '--cookies-from-browser', 'chrome']));
        });

        it('do not add a part number to the first recording or a filter', () => {
            const args = build({});
            expect(args).not.toContain('--match-filter');
            expect(args[args.indexOf('-o') + 1]).toBe('%(title).80s [%(id)s].%(ext)s');
        });
    });

    it('always asks yt-dlp to announce each download so live streams can be recognised', () => {
        const args = build({});
        const infoIndex = args.indexOf(INFO_PRINT_TEMPLATE);
        expect(args[infoIndex - 1]).toBe('--print');
    });

    it('asks yt-dlp to print, right after that, where the stream can be fetched from', () => {
        const args = build({});
        const streamIndex = args.indexOf(STREAM_PRINT_TEMPLATE);
        expect(args[streamIndex - 1]).toBe('--print');
        expect(args[streamIndex - 2]).toBe(INFO_PRINT_TEMPLATE);
    });
});

describe('buildYtdlpArgs with a folder chosen for one download', () => {
    it('uses that folder instead of the one in the settings', () => {
        const args = buildYtdlpArgs(URL, { ...DEFAULT_SETTINGS, downloadDir: '/from/settings' }, DEFAULT_DIR, null, { downloadDir: '/only/this' });
        expect(args[args.indexOf('-P') + 1]).toBe('/only/this');
    });

    it('uses that folder instead of the default one when the settings have none', () => {
        const args = buildYtdlpArgs(URL, { ...DEFAULT_SETTINGS, downloadDir: '' }, DEFAULT_DIR, null, { downloadDir: '/only/this' });
        expect(args[args.indexOf('-P') + 1]).toBe('/only/this');
    });

    it('keeps the folder from the settings when no folder is chosen', () => {
        const args = buildYtdlpArgs(URL, { ...DEFAULT_SETTINGS, downloadDir: '/from/settings' }, DEFAULT_DIR, null, {});
        expect(args[args.indexOf('-P') + 1]).toBe('/from/settings');
    });

    it('falls back to the default folder when neither is set', () => {
        const args = buildYtdlpArgs(URL, { ...DEFAULT_SETTINGS, downloadDir: '' }, DEFAULT_DIR, null);
        expect(args[args.indexOf('-P') + 1]).toBe(DEFAULT_DIR);
    });
});

