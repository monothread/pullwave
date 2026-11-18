import type { Mock } from 'vitest';
import { THEME_BACKGROUNDS, THEME_FAMILIES } from '@shared/constants';
import { paintWindowBackground, windowBackground, type BackgroundWindow } from '@main/services/windowBackground';

interface SpyWindow extends BackgroundWindow {
    setBackgroundColor: Mock<(color: string) => void>;
}

function makeWindow(destroyed: boolean): SpyWindow {
    return {
        isDestroyed: () => {
            return destroyed;
        },
        setBackgroundColor: vi.fn<(color: string) => void>()
    };
}

describe('windowBackground', () => {
    it.each(THEME_FAMILIES)('gives the background of $dark in the dark mode of the $id family, whatever the system says', ({ id, dark }) => {
        expect(windowBackground({ themeMode: 'dark', themeFamily: id }, false)).toBe(THEME_BACKGROUNDS[dark]);
        expect(windowBackground({ themeMode: 'dark', themeFamily: id }, true)).toBe(THEME_BACKGROUNDS[dark]);
    });

    it.each(THEME_FAMILIES)('gives the background of $light in the light mode of the $id family, whatever the system says', ({ id, light }) => {
        expect(windowBackground({ themeMode: 'light', themeFamily: id }, true)).toBe(THEME_BACKGROUNDS[light]);
        expect(windowBackground({ themeMode: 'light', themeFamily: id }, false)).toBe(THEME_BACKGROUNDS[light]);
    });

    it('follows the system in the system mode', () => {
        expect(windowBackground({ themeMode: 'device', themeFamily: 'default' }, true)).toBe('#16181d');
        expect(windowBackground({ themeMode: 'device', themeFamily: 'default' }, false)).toBe('#f3f4f7');
        expect(windowBackground({ themeMode: 'device', themeFamily: 'nord' }, true)).toBe('#2e3440');
        expect(windowBackground({ themeMode: 'device', themeFamily: 'nord' }, false)).toBe('#eceff4');
    });
});

describe('paintWindowBackground', () => {
    it('paints the window with the background of the theme shown', () => {
        const window = makeWindow(false);
        paintWindowBackground(window, { themeMode: 'light', themeFamily: 'gruvbox' }, true);
        expect(window.setBackgroundColor).toHaveBeenCalledTimes(1);
        expect(window.setBackgroundColor).toHaveBeenCalledWith('#fbf1c7');
    });

    it('paints the version of the system in the system mode', () => {
        const window = makeWindow(false);
        paintWindowBackground(window, { themeMode: 'device', themeFamily: 'cyberpunk' }, true);
        paintWindowBackground(window, { themeMode: 'device', themeFamily: 'cyberpunk' }, false);
        expect(window.setBackgroundColor.mock.calls).toEqual([['#07060f'], ['#eef8fb']]);
    });

    it('does nothing without a window', () => {
        expect(() => {
            paintWindowBackground(null, { themeMode: 'dark', themeFamily: 'nord' }, true);
        }).not.toThrow();
    });

    it('does not touch a window that was destroyed', () => {
        const window = makeWindow(true);
        paintWindowBackground(window, { themeMode: 'dark', themeFamily: 'nord' }, true);
        expect(window.setBackgroundColor).not.toHaveBeenCalled();
    });
});
