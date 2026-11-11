import { exitEventText, isLogSource, LOG_LINE_LIMIT, LOG_SOURCES, SIGNAL_EVENT_PREFIX, STOPPED_BY_APP_EVENT } from '@shared/logs';

describe('LOG_SOURCES', () => {
    it('lists the five programs whose output is kept', () => {
        expect(LOG_SOURCES).toEqual(['yt-dlp', 'ani-cli', 'ffmpeg', 'suwayomi', 'flaresolverr']);
    });
});

describe('LOG_LINE_LIMIT', () => {
    it('is 2000 lines', () => {
        expect(LOG_LINE_LIMIT).toBe(2000);
    });
});

describe('isLogSource', () => {
    it('accepts every program', () => {
        LOG_SOURCES.forEach((source) => {
            expect(isLogSource(source)).toBe(true);
        });
    });

    it('refuses anything else', () => {
        expect(isLogSource('docker')).toBe(false);
        expect(isLogSource('YT-DLP')).toBe(false);
        expect(isLogSource('')).toBe(false);
        expect(isLogSource(null)).toBe(false);
        expect(isLogSource(undefined)).toBe(false);
        expect(isLogSource(1)).toBe(false);
        expect(isLogSource({ source: 'yt-dlp' })).toBe(false);
    });
});

describe('STOPPED_BY_APP_EVENT', () => {
    it('says the app stopped the program, in words no exit line uses', () => {
        expect(STOPPED_BY_APP_EVENT).toBe('stopped by the app');
        expect(STOPPED_BY_APP_EVENT.startsWith(SIGNAL_EVENT_PREFIX)).toBe(false);
    });
});

describe('exitEventText', () => {
    it('tells the exit code', () => {
        expect(exitEventText(0, null)).toBe('exited with code 0');
        expect(exitEventText(2, null)).toBe('exited with code 2');
    });

    it('tells the signal, which wins over a code', () => {
        expect(SIGNAL_EVENT_PREFIX).toBe('ended by signal');
        expect(exitEventText(null, 'SIGTERM')).toBe('ended by signal SIGTERM');
        expect(exitEventText(143, 'SIGKILL')).toBe('ended by signal SIGKILL');
    });

    it('tells that there was no code', () => {
        expect(exitEventText(null, null)).toBe('ended without an exit code');
    });
});
