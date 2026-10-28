import { DEFAULT_SETTINGS, THEMES } from '@shared/constants';
import { sanitizeDownloadOptions, sanitizeSettings } from '@main/services/settingsSanitizer';

describe('sanitizeSettings', () => {
    it('returns the defaults for non-object input', () => {
        expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
        expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
        expect(sanitizeSettings('text')).toEqual(DEFAULT_SETTINGS);
    });

    it('returns the defaults for an empty object', () => {
        expect(sanitizeSettings({})).toEqual(DEFAULT_SETTINGS);
    });

    it('keeps valid values', () => {
        const valid = {
            downloadDir: '/data/videos',
            useBrowserCookies: true,
            cookiesBrowser: 'chrome',
            cookiesBrowserDir: '/home/a/.config/google-chrome',
            cookiesProfile: 'Default',
            maxResolution: '1080',
            videoContainer: 'mkv',
            audioOnly: true,
            audioFormat: 'opus',
            maxTitleLength: 120,
            restrictFilenames: true,
            deletePartialsOnFailure: false,
            downloadPlaylist: true,
            writeSubtitles: true,
            subtitleLangs: 'en',
            autoSubtitles: true,
            embedSubtitles: true,
            rateLimit: '2M',
            maxConcurrent: 3,
            ytdlpPath: '/opt/yt-dlp',
            ffmpegPath: '/opt/ffmpeg',
            jsRuntime: 'node:/usr/bin/node',
            checkUpdatesOnStart: false,
            closeToTray: true,
            launchAtLogin: true,
            startMinimized: true,
            liveFromStart: true,
            waitForLive: true,
            theme: 'light',
            language: 'ja',
            startTab: 'anime',
            verifyLiveEnd: false,
            verifyLiveEndSeconds: 45,
            extraArgs: '--no-mtime',
            animeDownloadDir: '/media/anime',
            animeQuality: '720p',
            animeAudio: 'dub',
            animeSubtitles: 'Portuguese',
            animeCheckNewEpisodes: false,
            animeAutoDownloadNew: true,
            mangaDirectory: '/media/manga',
            mangaFormat: 'folder',
            mangaFlaresolverrUrl: 'http://192.168.0.5:8191',
            mangaFlaresolverrEnabled: true,
            mangaShowAdult: true,
            mangaCheckNewChapters: false,
            mangaAutoDownloadNew: true,
            mangaSiteBrowser: 'firefox',
            translateProvider: 'anthropic',
            translateModel: 'my-model',
            translateBaseUrl: 'https://llm.example/v1',
            translateLanguage: 'Spanish',
            transcribeProvider: 'custom',
            transcribeModel: 'whisper-large',
            transcribeBaseUrl: 'https://stt.example/v1'
        };
        expect(sanitizeSettings(valid)).toEqual(valid);
    });

    it('keeps the manga folder empty and the format a CBZ by default', () => {
        expect(DEFAULT_SETTINGS).toMatchObject({ mangaDirectory: '', mangaFormat: 'cbz' });
        expect(sanitizeSettings({})).toMatchObject({ mangaDirectory: '', mangaFormat: 'cbz' });
    });

    it('does not install the helper for Cloudflare by itself', () => {
        expect(DEFAULT_SETTINGS.mangaFlaresolverrEnabled).toBe(false);
        expect(sanitizeSettings({}).mangaFlaresolverrEnabled).toBe(false);
    });

    it.each([true, false])('keeps the choice of having the helper for Cloudflare (%j)', (mangaFlaresolverrEnabled) => {
        expect(sanitizeSettings({ mangaFlaresolverrEnabled }).mangaFlaresolverrEnabled).toBe(mangaFlaresolverrEnabled);
    });

    it.each(['yes', 1, null, []])('falls back to no helper for the invalid value %j', (mangaFlaresolverrEnabled) => {
        expect(sanitizeSettings({ mangaFlaresolverrEnabled }).mangaFlaresolverrEnabled).toBe(false);
    });

    it('looks for new chapters every hour by default', () => {
        expect(DEFAULT_SETTINGS.mangaCheckNewChapters).toBe(true);
        expect(sanitizeSettings({}).mangaCheckNewChapters).toBe(true);
    });

    it.each([true, false])('keeps the choice of looking for new chapters (%j)', (mangaCheckNewChapters) => {
        expect(sanitizeSettings({ mangaCheckNewChapters }).mangaCheckNewChapters).toBe(mangaCheckNewChapters);
    });

    it.each(['yes', 0, null, []])('falls back to looking for new chapters for the invalid value %j', (mangaCheckNewChapters) => {
        expect(sanitizeSettings({ mangaCheckNewChapters }).mangaCheckNewChapters).toBe(true);
    });

    it('looks for new episodes once a day by default', () => {
        expect(DEFAULT_SETTINGS.animeCheckNewEpisodes).toBe(true);
        expect(sanitizeSettings({}).animeCheckNewEpisodes).toBe(true);
    });

    it.each([true, false])('keeps the choice of looking for new episodes (%j)', (animeCheckNewEpisodes) => {
        expect(sanitizeSettings({ animeCheckNewEpisodes }).animeCheckNewEpisodes).toBe(animeCheckNewEpisodes);
    });

    it.each(['yes', 0, null, []])('falls back to looking for new episodes for the invalid value %j', (animeCheckNewEpisodes) => {
        expect(sanitizeSettings({ animeCheckNewEpisodes }).animeCheckNewEpisodes).toBe(true);
    });

    it('does not download the new episodes by default', () => {
        expect(DEFAULT_SETTINGS.animeAutoDownloadNew).toBe(false);
        expect(sanitizeSettings({}).animeAutoDownloadNew).toBe(false);
    });

    it.each([true, false])('keeps the choice of downloading the new episodes (%j)', (animeAutoDownloadNew) => {
        expect(sanitizeSettings({ animeAutoDownloadNew }).animeAutoDownloadNew).toBe(animeAutoDownloadNew);
    });

    it.each(['yes', 1, null, []])('falls back to not downloading the new episodes for the invalid value %j', (animeAutoDownloadNew) => {
        expect(sanitizeSettings({ animeAutoDownloadNew }).animeAutoDownloadNew).toBe(false);
    });

    it('drops the limit of manga downloads saved by an older version (it is fixed now), touching nothing else', () => {
        const sanitized = sanitizeSettings({ mangaMaxConcurrent: 5 });
        expect(sanitized).toEqual(DEFAULT_SETTINGS);
        expect(Object.keys(sanitized)).not.toContain('mangaMaxConcurrent');
        expect(Object.keys(DEFAULT_SETTINGS)).not.toContain('mangaMaxConcurrent');
    });

    it('does not download the new chapters by default', () => {
        expect(DEFAULT_SETTINGS.mangaAutoDownloadNew).toBe(false);
        expect(sanitizeSettings({}).mangaAutoDownloadNew).toBe(false);
    });

    it.each([true, false])('keeps the choice of downloading the new chapters (%j)', (mangaAutoDownloadNew) => {
        expect(sanitizeSettings({ mangaAutoDownloadNew }).mangaAutoDownloadNew).toBe(mangaAutoDownloadNew);
    });

    it.each(['yes', 1, null, []])('falls back to not downloading the new chapters for the invalid value %j', (mangaAutoDownloadNew) => {
        expect(sanitizeSettings({ mangaAutoDownloadNew }).mangaAutoDownloadNew).toBe(false);
    });

    it('opens the sites of the mangas in the browser of the system by default', () => {
        expect(DEFAULT_SETTINGS.mangaSiteBrowser).toBe('default');
        expect(sanitizeSettings({}).mangaSiteBrowser).toBe('default');
    });

    it.each(['default', 'chrome', 'firefox', 'brave', 'chromium', 'edge', 'opera', 'vivaldi'])('keeps the browser for the sites of the mangas (%s)', (mangaSiteBrowser) => {
        expect(sanitizeSettings({ mangaSiteBrowser }).mangaSiteBrowser).toBe(mangaSiteBrowser);
    });

    it.each(['safari', '', 5, null, [], 'firefox --new-window'])('falls back to the browser of the system for the invalid value %j', (mangaSiteBrowser) => {
        expect(sanitizeSettings({ mangaSiteBrowser }).mangaSiteBrowser).toBe('default');
    });

    it('hides the sources for adults by default', () => {
        expect(DEFAULT_SETTINGS.mangaShowAdult).toBe(false);
        expect(sanitizeSettings({}).mangaShowAdult).toBe(false);
    });

    it.each([true, false])('keeps the choice to show the sources for adults (%j)', (mangaShowAdult) => {
        expect(sanitizeSettings({ mangaShowAdult }).mangaShowAdult).toBe(mangaShowAdult);
    });

    it.each(['yes', 1, null, []])('falls back to hiding the sources for adults for the invalid value %j', (mangaShowAdult) => {
        expect(sanitizeSettings({ mangaShowAdult }).mangaShowAdult).toBe(false);
    });

    it.each(['cbz', 'folder'])('keeps the manga format "%s"', (mangaFormat) => {
        expect(sanitizeSettings({ mangaFormat }).mangaFormat).toBe(mangaFormat);
    });

    it.each(['zip', 'CBZ', '', 5, null])('falls back to a CBZ for the invalid manga format %j', (mangaFormat) => {
        expect(sanitizeSettings({ mangaFormat }).mangaFormat).toBe('cbz');
    });

    it('has no FlareSolverr of the user by default', () => {
        expect(DEFAULT_SETTINGS.mangaFlaresolverrUrl).toBe('');
        expect(sanitizeSettings({}).mangaFlaresolverrUrl).toBe('');
    });

    it.each([
        ['http://192.168.0.5:8191', 'http://192.168.0.5:8191'],
        ['  https://flare.example/  ', 'https://flare.example'],
        ['http://localhost:8191///', 'http://localhost:8191']
    ])('keeps the address of the FlareSolverr %j as %j', (value, expected) => {
        expect(sanitizeSettings({ mangaFlaresolverrUrl: value }).mangaFlaresolverrUrl).toBe(expected);
    });

    it.each(['flare', 'ftp://host:8191', 'javascript:alert(1)', '', '   ', 5, null])('drops the invalid address of a FlareSolverr %j', (value) => {
        expect(sanitizeSettings({ mangaFlaresolverrUrl: value }).mangaFlaresolverrUrl).toBe('');
    });

    it('keeps the manga folder as text and falls back to an empty one for anything else', () => {
        expect(sanitizeSettings({ mangaDirectory: '/media/manga' }).mangaDirectory).toBe('/media/manga');
        expect(sanitizeSettings({ mangaDirectory: 5 }).mangaDirectory).toBe('');
        expect(sanitizeSettings({ mangaDirectory: null }).mangaDirectory).toBe('');
    });

    it('opens on the video downloader by default, and keeps the anime tab when it is the one saved', () => {
        expect(DEFAULT_SETTINGS.startTab).toBe('downloads');
        expect(sanitizeSettings({})).toMatchObject({ startTab: 'downloads' });
        expect(sanitizeSettings({ startTab: 'anime' })).toMatchObject({ startTab: 'anime' });
        expect(sanitizeSettings({ startTab: 'downloads' })).toMatchObject({ startTab: 'downloads' });
        expect(sanitizeSettings({ startTab: 'manga' })).toMatchObject({ startTab: 'manga' });
        expect(sanitizeSettings({ startTab: 'books' })).toMatchObject({ startTab: 'downloads' });
    });

    it.each(['settings', 'ANIME', 7, null, true])('falls back to the video downloader when the start tab is %s', (startTab) => {
        expect(sanitizeSettings({ startTab })).toMatchObject({ startTab: 'downloads' });
    });

    it('has the anime settings default to the best quality, subtitled, in the default folder', () => {
        expect(DEFAULT_SETTINGS).toMatchObject({ animeDownloadDir: '', animeQuality: 'best', animeAudio: 'sub' });
        expect(sanitizeSettings({})).toMatchObject({ animeDownloadDir: '', animeQuality: 'best', animeAudio: 'sub' });
    });

    it.each(['best', '1080p', '720p', '480p', '360p', 'worst'])('keeps the anime quality "%s"', (animeQuality) => {
        expect(sanitizeSettings({ animeQuality }).animeQuality).toBe(animeQuality);
    });

    it.each(['4k', '720', 'BEST', '', 720, null])('falls back to "best" for the invalid anime quality %j', (animeQuality) => {
        expect(sanitizeSettings({ animeQuality }).animeQuality).toBe('best');
    });

    it.each(['sub', 'dub'])('keeps the anime audio "%s"', (animeAudio) => {
        expect(sanitizeSettings({ animeAudio }).animeAudio).toBe(animeAudio);
    });

    it.each(['both', 'SUB', '', 1, null])('falls back to "sub" for the invalid anime audio %j', (animeAudio) => {
        expect(sanitizeSettings({ animeAudio }).animeAudio).toBe('sub');
    });

    it('follows the language of the app for the anime subtitles by default', () => {
        expect(DEFAULT_SETTINGS.animeSubtitles).toBe('auto');
        expect(sanitizeSettings({}).animeSubtitles).toBe('auto');
    });

    it.each(['auto', 'default', 'English', 'Portuguese', 'Spanish', 'French', 'German', 'Italian', 'Russian'])('keeps the anime subtitles "%s"', (animeSubtitles) => {
        expect(sanitizeSettings({ animeSubtitles }).animeSubtitles).toBe(animeSubtitles);
    });

    it.each(['english', 'Klingon', '', 3, null])('falls back to "auto" for the invalid anime subtitles %j', (animeSubtitles) => {
        expect(sanitizeSettings({ animeSubtitles }).animeSubtitles).toBe('auto');
    });

    it('has the translation of subtitles default to ChatGPT, with no model or address, into Brazilian Portuguese', () => {
        const defaults = { translateProvider: 'openai', translateModel: '', translateBaseUrl: '', translateLanguage: 'Portuguese (Brazil)' };
        expect(DEFAULT_SETTINGS).toMatchObject(defaults);
        expect(sanitizeSettings({})).toMatchObject(defaults);
    });

    it.each(['openai', 'anthropic', 'gemini', 'deepseek', 'glm', 'kimi', 'custom'])('keeps the translation provider "%s"', (translateProvider) => {
        expect(sanitizeSettings({ translateProvider }).translateProvider).toBe(translateProvider);
    });

    it.each(['OpenAI', 'mistral', '', 4, null])('falls back to "openai" for the invalid translation provider %j', (translateProvider) => {
        expect(sanitizeSettings({ translateProvider }).translateProvider).toBe('openai');
    });

    it.each(['Portuguese (Brazil)', 'Portuguese', 'Spanish', 'English', 'French', 'German', 'Italian', 'Russian', 'Japanese', 'Chinese', 'Korean', 'Arabic', 'Turkish', 'Indonesian'])('keeps the translation language "%s"', (translateLanguage) => {
        expect(sanitizeSettings({ translateLanguage }).translateLanguage).toBe(translateLanguage);
    });

    it.each(['spanish', 'Klingon', '', 2, null])('falls back to Brazilian Portuguese for the invalid translation language %j', (translateLanguage) => {
        expect(sanitizeSettings({ translateLanguage }).translateLanguage).toBe('Portuguese (Brazil)');
    });

    it('trims the translation model and address and ignores ones that are not text', () => {
        expect(sanitizeSettings({ translateModel: '  my-model ', translateBaseUrl: ' http://localhost:1234/v1 ' })).toMatchObject({
            translateModel: 'my-model',
            translateBaseUrl: 'http://localhost:1234/v1'
        });
        expect(sanitizeSettings({ translateModel: 5, translateBaseUrl: {} })).toMatchObject({ translateModel: '', translateBaseUrl: '' });
    });

    it('has the speech to text default to OpenAI and whisper-1, with no address', () => {
        const defaults = { transcribeProvider: 'openai', transcribeModel: 'whisper-1', transcribeBaseUrl: '' };
        expect(DEFAULT_SETTINGS).toMatchObject(defaults);
        expect(sanitizeSettings({})).toMatchObject(defaults);
    });

    it('does not keep the language spoken in the audio: it is asked for each time, in the window that makes the subtitle', () => {
        expect(DEFAULT_SETTINGS).not.toHaveProperty('transcribeLanguage');
        expect(sanitizeSettings({ transcribeLanguage: 'English' })).not.toHaveProperty('transcribeLanguage');
    });

    it.each(['openai', 'gemini', 'custom'])('keeps the speech to text provider "%s"', (transcribeProvider) => {
        expect(sanitizeSettings({ transcribeProvider }).transcribeProvider).toBe(transcribeProvider);
    });

    it.each(['anthropic', 'deepseek', 'OpenAI', 'Gemini', '', 4, null])('falls back to "openai" for the speech to text provider %j (only the protocols of OpenAI and Gemini are spoken)', (transcribeProvider) => {
        expect(sanitizeSettings({ transcribeProvider }).transcribeProvider).toBe('openai');
    });

    it('trims the speech to text model and address and ignores ones that are not text', () => {
        expect(sanitizeSettings({ transcribeModel: ' whisper-1 ', transcribeBaseUrl: ' http://localhost:9000/v1 ' })).toMatchObject({
            transcribeModel: 'whisper-1',
            transcribeBaseUrl: 'http://localhost:9000/v1'
        });
        expect(sanitizeSettings({ transcribeModel: 5, transcribeBaseUrl: {} })).toMatchObject({ transcribeModel: 'whisper-1', transcribeBaseUrl: '' });
    });

    it('trims the anime folder and ignores one that is not text', () => {
        expect(sanitizeSettings({ animeDownloadDir: '  /media/anime  ' }).animeDownloadDir).toBe('/media/anime');
        expect(sanitizeSettings({ animeDownloadDir: 5 }).animeDownloadDir).toBe('');
    });

    it.each(['device', 'en', 'pt', 'es', 'zh', 'ja'])('keeps the language "%s"', (language) => {
        expect(sanitizeSettings({ language }).language).toBe(language);
    });

    it.each(['fr', 'PT', '', 42, null])('falls back to "device" for the invalid language %j', (language) => {
        expect(sanitizeSettings({ language }).language).toBe('device');
    });

    it('falls back to defaults for invalid enum values', () => {
        const result = sanitizeSettings({
            cookiesBrowser: 'netscape',
            maxResolution: '99',
            videoContainer: 'avi',
            audioFormat: 'wav'
        });
        expect(result.cookiesBrowser).toBe(DEFAULT_SETTINGS.cookiesBrowser);
        expect(result.maxResolution).toBe(DEFAULT_SETTINGS.maxResolution);
        expect(result.videoContainer).toBe(DEFAULT_SETTINGS.videoContainer);
        expect(result.audioFormat).toBe(DEFAULT_SETTINGS.audioFormat);
    });

    it('falls back to defaults for wrongly typed values', () => {
        const result = sanitizeSettings({
            useBrowserCookies: 'yes',
            checkUpdatesOnStart: 'no',
            closeToTray: 'yes',
            launchAtLogin: 'yes',
            startMinimized: 1,
            liveFromStart: 1,
            waitForLive: 'true',
            cookiesBrowserDir: 7,
            autoSubtitles: 'yes',
            deletePartialsOnFailure: 'no',
            downloadDir: 5,
            maxTitleLength: '80',
            maxConcurrent: NaN
        });
        expect(result.useBrowserCookies).toBe(false);
        expect(result.checkUpdatesOnStart).toBe(true);
        expect(result.closeToTray).toBe(false);
        expect(result.launchAtLogin).toBe(false);
        expect(result.startMinimized).toBe(false);
        expect(result.liveFromStart).toBe(false);
        expect(result.waitForLive).toBe(false);
        expect(result.autoSubtitles).toBe(false);
        expect(result.deletePartialsOnFailure).toBe(true);
        expect(result.cookiesBrowserDir).toBe('');
        expect(result.downloadDir).toBe('');
        expect(result.maxTitleLength).toBe(80);
        expect(result.maxConcurrent).toBe(3);
    });

    it('checks the end of live streams for 10 seconds by default', () => {
        expect(DEFAULT_SETTINGS.verifyLiveEnd).toBe(true);
        expect(DEFAULT_SETTINGS.verifyLiveEndSeconds).toBe(10);
        expect(sanitizeSettings({})).toMatchObject({ verifyLiveEnd: true, verifyLiveEndSeconds: 10 });
    });

    it.each([false, true])('keeps verifyLiveEnd %j', (value) => {
        expect(sanitizeSettings({ verifyLiveEnd: value }).verifyLiveEnd).toBe(value);
    });

    it.each(['no', 0, null])('falls back to the default for the invalid verifyLiveEnd %j', (value) => {
        expect(sanitizeSettings({ verifyLiveEnd: value }).verifyLiveEnd).toBe(true);
    });

    it.each([
        [1, 1],
        [30, 30],
        [120, 120],
        [0, 1],
        [-5, 1],
        [500, 120],
        [7.6, 8]
    ])('clamps and rounds verifyLiveEndSeconds %j to %j', (value, expected) => {
        expect(sanitizeSettings({ verifyLiveEndSeconds: value }).verifyLiveEndSeconds).toBe(expected);
    });

    it.each(['20', NaN, Infinity, null, undefined])('falls back to 10 seconds for the invalid verifyLiveEndSeconds %j', (value) => {
        expect(sanitizeSettings({ verifyLiveEndSeconds: value }).verifyLiveEndSeconds).toBe(10);
    });

    it('clamps and rounds numeric values', () => {
        expect(sanitizeSettings({ maxTitleLength: 5 }).maxTitleLength).toBe(20);
        expect(sanitizeSettings({ maxTitleLength: 9999 }).maxTitleLength).toBe(200);
        expect(sanitizeSettings({ maxTitleLength: 80.6 }).maxTitleLength).toBe(81);
    });

    it('always runs three downloads at a time, whatever the saved value is', () => {
        expect(DEFAULT_SETTINGS.maxConcurrent).toBe(3);
        [0, 1, 2, 3, 5, 50, -4, 2.5, NaN, '3', null, undefined].forEach((value) => {
            expect(sanitizeSettings({ maxConcurrent: value }).maxConcurrent).toBe(3);
        });
        expect(sanitizeSettings({}).maxConcurrent).toBe(3);
        expect(sanitizeSettings(null).maxConcurrent).toBe(3);
    });

    it('trims string values', () => {
        expect(sanitizeSettings({ downloadDir: '  /tmp/x  ' }).downloadDir).toBe('/tmp/x');
    });

    it('accepts valid rate limits and rejects invalid ones', () => {
        expect(sanitizeSettings({ rateLimit: '500K' }).rateLimit).toBe('500K');
        expect(sanitizeSettings({ rateLimit: '1.5m' }).rateLimit).toBe('1.5m');
        expect(sanitizeSettings({ rateLimit: '100' }).rateLimit).toBe('100');
        expect(sanitizeSettings({ rateLimit: 'fast' }).rateLimit).toBe('');
        expect(sanitizeSettings({ rateLimit: '1M; rm -rf' }).rateLimit).toBe('');
        expect(sanitizeSettings({ rateLimit: 10 }).rateLimit).toBe('');
    });
});

describe('sanitizeSettings theme', () => {
    it.each(['device', 'cyberpunk', 'synthwave', 'terminal', 'dark', 'tokyo-night', 'nord', 'dracula', 'gruvbox', 'amoled', 'high-contrast', 'light', 'sakura'])('keeps the %s theme', (theme) => {
        expect(sanitizeSettings({ theme }).theme).toBe(theme);
    });

    it('defaults to device when it is missing, unknown or not a string', () => {
        expect(DEFAULT_SETTINGS.theme).toBe('device');
        expect(sanitizeSettings({}).theme).toBe('device');
        expect(sanitizeSettings({ theme: 'solarized' }).theme).toBe('device');
        expect(sanitizeSettings({ theme: 3 }).theme).toBe('device');
        expect(sanitizeSettings({ theme: 'Tokyo Night' }).theme).toBe('device');
        expect(sanitizeSettings({ theme: 'tokyo_night' }).theme).toBe('device');
    });

    it('offers the thirteen themes, in the order of the list', () => {
        expect(THEMES).toEqual(['device', 'cyberpunk', 'synthwave', 'terminal', 'dark', 'tokyo-night', 'nord', 'dracula', 'gruvbox', 'amoled', 'high-contrast', 'light', 'sakura']);
    });
});


describe('sanitizeDownloadOptions', () => {
    it.each([null, undefined, 'text', 42, true, []])('returns no options for the non-object input %j', (input) => {
        expect(sanitizeDownloadOptions(input)).toEqual({});
    });

    it('returns no options for an empty object', () => {
        expect(sanitizeDownloadOptions({})).toEqual({});
    });

    it('keeps every valid option', () => {
        const valid = {
            maxResolution: '720',
            videoContainer: 'mkv',
            audioOnly: true,
            audioFormat: 'opus',
            liveFromStart: true,
            waitForLive: false,
            verifyLiveEnd: false,
            verifyLiveEndSeconds: 30
        };
        expect(sanitizeDownloadOptions(valid)).toEqual(valid);
    });

    it('keeps only the options that were given, so the others follow the settings', () => {
        expect(sanitizeDownloadOptions({ maxResolution: 'best' })).toEqual({ maxResolution: 'best' });
        expect(sanitizeDownloadOptions({ audioOnly: false })).toEqual({ audioOnly: false });
    });

    it('drops invalid values', () => {
        expect(
            sanitizeDownloadOptions({
                maxResolution: '99',
                videoContainer: 'avi',
                audioOnly: 'yes',
                audioFormat: 'wav',
                liveFromStart: 1,
                waitForLive: null,
                verifyLiveEnd: 'true',
                verifyLiveEndSeconds: '20'
            })
        ).toEqual({});
        expect(sanitizeDownloadOptions({ verifyLiveEndSeconds: NaN })).toEqual({});
        expect(sanitizeDownloadOptions({ verifyLiveEndSeconds: Infinity })).toEqual({});
        expect(sanitizeDownloadOptions({ maxResolution: 720 })).toEqual({});
    });

    it('drops anything that is not a per-download option, including other settings', () => {
        expect(sanitizeDownloadOptions({ downloadDir: '/etc', extraArgs: '--exec rm', ytdlpPath: '/bin/sh', theme: 'dark', maxResolution: '480' })).toEqual({ maxResolution: '480' });
    });

    it.each([
        [0, 1],
        [-3, 1],
        [500, 120],
        [7.6, 8],
        [10, 10]
    ])('clamps and rounds the seconds %j to %j', (value, expected) => {
        expect(sanitizeDownloadOptions({ verifyLiveEndSeconds: value })).toEqual({ verifyLiveEndSeconds: expected });
    });
});
