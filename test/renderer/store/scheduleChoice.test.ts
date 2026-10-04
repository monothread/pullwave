// @vitest-environment jsdom
import { readScheduleChoice, saveScheduleTimeZone } from '@renderer/store/scheduleChoice';

beforeEach(() => {
    window.localStorage.clear();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('readScheduleChoice', () => {
    it('has no choice when nothing was saved', () => {
        expect(readScheduleChoice()).toEqual({ timeZone: null });
    });

    it('reads the time zone that was saved', () => {
        saveScheduleTimeZone('Asia/Tokyo');
        expect(readScheduleChoice()).toEqual({ timeZone: 'Asia/Tokyo' });
    });

    it.each(['day', 'week', 'month'])('does not read a view (%s) that an older version saved', (view) => {
        window.localStorage.setItem('pullwave-schedule-view', view);
        expect(readScheduleChoice()).toEqual({ timeZone: null });
    });

    it('ignores a time zone that does not exist', () => {
        window.localStorage.setItem('pullwave-schedule-time-zone', 'Mars/Olympus');
        expect(readScheduleChoice().timeZone).toBeNull();
    });

    it('has no choice when the storage cannot be read', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        expect(readScheduleChoice()).toEqual({ timeZone: null });
    });
});

describe('saveScheduleTimeZone', () => {
    it('writes the time zone under its own key', () => {
        saveScheduleTimeZone('America/Sao_Paulo');
        expect(window.localStorage.getItem('pullwave-schedule-time-zone')).toBe('America/Sao_Paulo');
    });

    it('does not fail when the storage cannot be written', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('full');
        });
        expect(() => {
            saveScheduleTimeZone('UTC');
        }).not.toThrow();
    });
});
