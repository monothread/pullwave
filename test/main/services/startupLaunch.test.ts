import { AUTOSTART_FLAG, isAutostartLaunch, shouldStartHidden, withoutAutostartFlag } from '@main/services/startupLaunch';

describe('AUTOSTART_FLAG', () => {
    it('is the flag the login entry starts the app with', () => {
        expect(AUTOSTART_FLAG).toBe('--autostart');
    });
});

describe('isAutostartLaunch', () => {
    it('is true when the flag is among the arguments', () => {
        expect(isAutostartLaunch(['/usr/bin/pullwave', '--no-sandbox', '--autostart'])).toBe(true);
    });

    it('is false when the app was started without the flag', () => {
        expect(isAutostartLaunch(['/usr/bin/pullwave', '--no-sandbox'])).toBe(false);
    });

    it('is false for no arguments', () => {
        expect(isAutostartLaunch([])).toBe(false);
    });

    it('does not take a similar argument for the flag', () => {
        expect(isAutostartLaunch(['/usr/bin/pullwave', '--autostart-later', 'autostart'])).toBe(false);
    });
});

describe('withoutAutostartFlag', () => {
    it('removes the flag and keeps the other arguments in order', () => {
        expect(withoutAutostartFlag(['--no-sandbox', '--autostart', '--user-data-dir=/tmp/x'])).toEqual(['--no-sandbox', '--user-data-dir=/tmp/x']);
    });

    it('removes every copy of the flag', () => {
        expect(withoutAutostartFlag(['--autostart', '--autostart'])).toEqual([]);
    });

    it('returns the arguments as they are when the flag is absent', () => {
        expect(withoutAutostartFlag(['--no-sandbox'])).toEqual(['--no-sandbox']);
    });
});

describe('shouldStartHidden', () => {
    it.each([
        [true, true, true],
        [true, false, false],
        [false, true, false],
        [false, false, false]
    ])('with autostart %s and start minimized %s it is %s', (autostart, startMinimized, expected) => {
        expect(shouldStartHidden({ autostart, startMinimized })).toBe(expected);
    });
});
