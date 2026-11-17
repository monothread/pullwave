import type { Page } from '@playwright/test';
import { THEME_STYLES } from '../../src/shared/constants';
import { themeScheme } from '../../src/shared/themeChoice';
import type { ThemeName } from '../../src/shared/types';

export async function showTheme(page: Page, theme: ThemeName): Promise<void> {
    await page.evaluate(
        ([name, style, scheme]) => {
            document.documentElement.dataset.theme = name;
            document.documentElement.dataset.themeStyle = style;
            document.documentElement.dataset.themeScheme = scheme;
        },
        [theme, THEME_STYLES[theme], themeScheme(theme)] as const
    );
}
