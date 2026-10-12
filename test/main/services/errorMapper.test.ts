import type { ErrorCode } from '@shared/types';
import { mapDownloadError, mapSpawnError } from '@main/services/errorMapper';
import { applyLanguage } from '@main/services/language';

describe('mapDownloadError', () => {
    const cases: Array<[ErrorCode, string, string]> = [
        ['FILENAME_TOO_LONG', 'OSError: [Errno 36] File name too long', 'Title too long'],
        ['FFMPEG_MISSING', 'ERROR: Postprocessing: ffprobe and ffmpeg not found', 'ffmpeg not found'],
        ['LOGIN_REQUIRED', "ERROR: Sign in to confirm you’re not a bot", 'Login required'],
        ['LOGIN_REQUIRED', 'ERROR: This video is age-restricted', 'Login required'],
        ['UNAVAILABLE', 'ERROR: Video unavailable', 'Video unavailable'],
        ['LOGIN_REQUIRED', "ERROR: Private video. Sign in if you've been granted access", 'Login required'],
        ['UNAVAILABLE', 'ERROR: Private video', 'Video unavailable'],
        ['UNAVAILABLE', 'ERROR: This video has been removed by the uploader', 'Video unavailable'],
        ['OUTDATED', 'ERROR: Unable to extract initial data; please report this issue', 'yt-dlp may be outdated'],
        ['OUTDATED', 'ERROR: Unsupported URL: https://x.com', 'yt-dlp may be outdated'],
        ['NETWORK', 'ERROR: Unable to download webpage: <urlopen error timed out>', 'Network failure'],
        ['FORBIDDEN', 'ERROR: [generic] https://cdn.example.test/videoplayback?sig=abc&expire=1: Unable to download webpage: HTTP Error 403: Forbidden (caused by <HTTPError 403: Forbidden>)', 'Access refused by the server'],
        ['FORBIDDEN', 'ERROR: unable to download video data: HTTP Error 403: Forbidden', 'Access refused by the server'],
        ['FORBIDDEN', 'ERROR: HTTP Error 401: Unauthorized', 'Access refused by the server'],
        ['FORBIDDEN', 'ERROR: HTTP Error 410: Gone', 'Access refused by the server'],
        ['FORBIDDEN', 'ERROR: Forbidden', 'Access refused by the server'],
        ['NETWORK', 'ERROR: getaddrinfo failed', 'Network failure'],
        ['NETWORK', 'ERROR: HTTP Error 503: Service Unavailable', 'Network failure']
    ];

    it.each(cases)('maps %s for "%s"', (code, stderr, title) => {
        const error = mapDownloadError(stderr, 1);
        expect(error.title).toBe(title);
        expect(error.raw).toBe(stderr);
        expect(error.code).toBe(code);
    });

    it('returns the full mapped error shape', () => {
        expect(mapDownloadError('ERROR: Video unavailable', 1)).toEqual({
            code: 'UNAVAILABLE',
            title: 'Video unavailable',
            hint: 'The video may be private, removed or blocked in your region.',
            raw: 'ERROR: Video unavailable'
        });
    });

    it('falls back to UNKNOWN with the raw stderr', () => {
        expect(mapDownloadError('  something odd happened \n', 2)).toEqual({
            code: 'UNKNOWN',
            title: 'Download failed',
            hint: 'See the details below.',
            raw: 'something odd happened'
        });
    });

    it('describes the exit code when stderr is empty', () => {
        expect(mapDownloadError('', 3).raw).toBe('yt-dlp exited with code 3');
        expect(mapDownloadError('', null).raw).toBe('yt-dlp exited with code unknown');
    });

    it('keeps only the last 4000 characters of very long stderr', () => {
        const stderr = `${'a'.repeat(5000)}END`;
        const error = mapDownloadError(stderr, 1);
        expect(error.raw).toHaveLength(4000);
        expect(error.raw.endsWith('END')).toBe(true);
    });
});

describe('mapSpawnError', () => {
    it('maps ENOENT to BINARY_MISSING', () => {
        const error = Object.assign(new Error('spawn yt-dlp ENOENT'), { code: 'ENOENT' });
        expect(mapSpawnError(error)).toEqual({
            code: 'BINARY_MISSING',
            title: 'yt-dlp not found',
            hint: 'Install yt-dlp or set its path in the settings.',
            raw: 'spawn yt-dlp ENOENT'
        });
    });

    it('maps other errors to UNKNOWN', () => {
        const error = Object.assign(new Error('spawn EACCES'), { code: 'EACCES' });
        expect(mapSpawnError(error)).toEqual({
            code: 'UNKNOWN',
            title: 'Could not start yt-dlp',
            hint: 'See the details below.',
            raw: 'spawn EACCES'
        });
    });
});

describe('mapDownloadError for refused requests', () => {
    const FORBIDDEN_STDERR =
        'ERROR: [generic] https://cdn.example.test/videoplayback?sig=abc&expire=1: Unable to download webpage: HTTP Error 403: Forbidden (caused by <HTTPError 403: Forbidden>)';

    it('maps an HTTP 403 to a friendly message instead of a network failure and keeps the raw text', () => {
        expect(mapDownloadError(FORBIDDEN_STDERR, 1)).toEqual({
            code: 'FORBIDDEN',
            title: 'Access refused by the server',
            hint: 'The server refused the request (HTTP 401/403/410). The link may have expired or may only work for the original session, network or browser, which is common for temporary addresses. Try again from the page, or enable browser cookies in the settings.',
            raw: FORBIDDEN_STDERR
        });
    });

    it('still reports real network failures as NETWORK', () => {
        expect(mapDownloadError('ERROR: Unable to download webpage: <urlopen error [Errno -2] Name or service not known>', 1).code).toBe('NETWORK');
        expect(mapDownloadError('ERROR: HTTP Error 503: Service Unavailable', 1).code).toBe('NETWORK');
    });

    it('prefers a more specific cause over the refusal when both appear', () => {
        expect(mapDownloadError('ERROR: Sign in to confirm your age\nHTTP Error 403: Forbidden', 1).code).toBe('LOGIN_REQUIRED');
    });
});


describe('error messages in other languages', () => {
    afterEach(() => {
        applyLanguage('en', 'en-US');
    });

    it('translates the title and the hint of a matched rule but keeps the raw output', () => {
        applyLanguage('pt', 'en-US');
        expect(mapDownloadError('ERROR: Video unavailable', 1)).toEqual({
            code: 'UNAVAILABLE',
            title: 'Vídeo indisponível',
            hint: 'O vídeo pode ser privado, ter sido removido ou estar bloqueado na sua região.',
            raw: 'ERROR: Video unavailable'
        });
    });

    it('translates the unknown failure and the exit code text', () => {
        applyLanguage('es', 'en-US');
        expect(mapDownloadError('', 7)).toEqual({
            code: 'UNKNOWN',
            title: 'La descarga falló',
            hint: 'Consulta los detalles a continuación.',
            raw: 'yt-dlp terminó con el código 7'
        });
        expect(mapDownloadError('', null).raw).toBe('yt-dlp terminó con el código desconocido');
    });

    it('translates the spawn errors', () => {
        applyLanguage('ja', 'en-US');
        const missing = Object.assign(new Error('spawn yt-dlp ENOENT'), { code: 'ENOENT' });
        expect(mapSpawnError(missing)).toEqual({
            code: 'BINARY_MISSING',
            title: 'yt-dlp が見つかりません',
            hint: 'yt-dlp をインストールするか、設定でパスを指定してください。',
            raw: 'spawn yt-dlp ENOENT'
        });
        const denied = Object.assign(new Error('spawn EACCES'), { code: 'EACCES' });
        expect(mapSpawnError(denied)).toEqual({
            code: 'UNKNOWN',
            title: 'yt-dlp を起動できませんでした',
            hint: '詳細は以下をご覧ください。',
            raw: 'spawn EACCES'
        });
    });
});
