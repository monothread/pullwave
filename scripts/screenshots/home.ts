import { expect } from '@playwright/test';
import { resize, snap, WINDOW, type Shot } from './session';

export async function shootHome(shot: Shot): Promise<void> {
    await shot.page.locator('#side-nav > button').nth(0).click();
    await expect(shot.page.locator('section.home')).toBeVisible();
    await shot.page.waitForTimeout(3500);
    await snap(shot.page, 'home');
}

export async function shootHomeUltrawide(shot: Shot): Promise<void> {
    await resize(shot.app, shot.page, 3440, 1400);
    await shot.page.waitForTimeout(3500);
    await snap(shot.page, 'home-ultrawide');
    await resize(shot.app, shot.page, WINDOW.width, WINDOW.height);
}
