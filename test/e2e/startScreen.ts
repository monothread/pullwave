import type { Page } from '@playwright/test';

// The app opens on the home screen (D-127). The specs that start on the video downloader go to it first, by the place of its section in
// the menu (the second one), whatever the language of the interface.
export async function leaveHome(page: Page): Promise<void> {
    await page.locator('section.home').waitFor({ state: 'visible', timeout: 60000 });
    await page.locator('#side-nav > button').nth(1).click();
    await page.locator('section.downloads').waitFor({ state: 'visible' });
}
