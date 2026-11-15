import type { Page } from '@playwright/test';

export async function leaveHome(page: Page): Promise<void> {
    await page.locator('section.home').waitFor({ state: 'visible', timeout: 60000 });
    await page.locator('#side-nav > button').nth(1).click();
    await page.locator('section.downloads').waitFor({ state: 'visible' });
}
