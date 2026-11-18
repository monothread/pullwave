import { THEME_BACKGROUNDS } from '@shared/constants';
import { resolveThemeChoice } from '@shared/themeChoice';
import type { ThemeChoice } from '@shared/types';

export interface BackgroundWindow {
    isDestroyed(): boolean;
    setBackgroundColor(color: string): void;
}

export function windowBackground(choice: ThemeChoice, systemPrefersDark: boolean): string {
    return THEME_BACKGROUNDS[resolveThemeChoice(choice, systemPrefersDark)];
}

export function paintWindowBackground(window: BackgroundWindow | null, choice: ThemeChoice, systemPrefersDark: boolean): void {
    if (window === null || window.isDestroyed()) {
        return;
    }
    window.setBackgroundColor(windowBackground(choice, systemPrefersDark));
}
