import { expect } from '@playwright/test';
import { snap, type Shot } from './session';

// The home screen, with the library filled in: the carousel and the blocks of each section.
export async function shootHome(shot: Shot): Promise<void> {
    await shot.page.locator('#side-nav > button').nth(0).click();
    await expect(shot.page.locator('section.home')).toBeVisible();
    await shot.page.waitForTimeout(3500);
    await snap(shot.page, 'home');
}
