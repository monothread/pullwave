import { expect } from '@playwright/test';
import { resize, snap, WINDOW, type Shot } from './session';

// The home screen, with the library filled in: the carousel and the blocks of each section.
export async function shootHome(shot: Shot): Promise<void> {
    await shot.page.locator('#side-nav > button').nth(0).click();
    await expect(shot.page.locator('section.home')).toBeVisible();
    await shot.page.waitForTimeout(3500);
    await snap(shot.page, 'home');
}

// The same screen on an ultrawide 3440x1440 screen, where the interface is magnified a fifth and the page is wider.
export async function shootHomeUltrawide(shot: Shot): Promise<void> {
    await resize(shot.app, shot.page, 3440, 1400);
    await shot.page.waitForTimeout(3500);
    await snap(shot.page, 'home-ultrawide');
    await resize(shot.app, shot.page, WINDOW.width, WINDOW.height);
}
