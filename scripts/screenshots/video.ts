import { expect, type Page } from '@playwright/test';
import { join } from 'node:path';
import { VIDEO_TITLES } from './catalog';
import { resize, snap, WINDOW, type Assets, type Shot } from './session';

// The screens of the video downloader.

export function videoLink(title: string, query: Record<string, string> = {}): string {
    const parameters = new URLSearchParams({ title, ...query });
    return `https://videos.example/watch?${parameters.toString()}`;
}

export async function openVideoDownloader(page: Page): Promise<void> {
    await page.locator('#side-nav > button').nth(1).click();
    await page.locator('section.downloads').waitFor({ state: 'visible' });
}

export async function submitLink(page: Page, link: string): Promise<void> {
    await page.getByLabel('Link 1', { exact: true }).fill(link);
    await page.getByRole('button', { name: 'DOWNLOAD', exact: true }).click();
}

// Two downloads that go on, at the percentages the links say.
export async function startTwoDownloads(page: Page): Promise<void> {
    await submitLink(page, videoLink(VIDEO_TITLES[0] ?? '', { percent: '73', speed: '8.41MiB/s', eta: '00:36' }));
    await expect(page.getByTestId('job-card').first()).toBeVisible();
    await page.waitForTimeout(1000);
    await submitLink(page, videoLink(VIDEO_TITLES[1] ?? '', { percent: '38', speed: '12.60MiB/s', eta: '01:12' }));
    await expect(page.getByTestId('job-card')).toHaveCount(2);
    await page.waitForTimeout(1500);
}

export function historyOf(shot: Pick<Shot, 'downloads'>): unknown[] {
    const day = 86400000;
    const now = Date.now();
    return [
        { id: 'h1', url: videoLink(VIDEO_TITLES[2] ?? ''), title: VIDEO_TITLES[2], filePath: join(shot.downloads, `${VIDEO_TITLES[2] ?? ''} [abc].mp4`), status: 'done', errorTitle: null, finishedAt: now - 3600000 },
        { id: 'h2', url: videoLink(VIDEO_TITLES[3] ?? ''), title: VIDEO_TITLES[3], filePath: join(shot.downloads, `${VIDEO_TITLES[3] ?? ''} [abc].mp4`), status: 'done', errorTitle: null, finishedAt: now - 5 * 3600000 },
        { id: 'h3', url: videoLink('A private video', { fail: 'unavailable' }), title: 'A private video', filePath: null, status: 'error', errorTitle: 'Video unavailable', finishedAt: now - day },
        { id: 'h4', url: videoLink(VIDEO_TITLES[0] ?? ''), title: VIDEO_TITLES[0], filePath: join(shot.downloads, `${VIDEO_TITLES[0] ?? ''} [abc].mp4`), status: 'done', errorTitle: null, finishedAt: now - 2 * day }
    ];
}

export async function shootQueue(shot: Shot, name: string): Promise<void> {
    await openVideoDownloader(shot.page);
    await startTwoDownloads(shot.page);
    await snap(shot.page, name);
}

export async function shootError(shot: Shot): Promise<void> {
    const { page } = shot;
    await openVideoDownloader(page);
    await submitLink(page, 'https://videos.example/watch?v=Kx9s2LqPz&fail=forbidden');
    const banner = page.getByRole('alert').filter({ hasText: 'Forbidden' });
    await expect(banner).toBeVisible();
    await snap(page, 'cyberpunk-error');
    await banner.getByRole('button', { name: 'SHOW DETAILS' }).click();
    await expect(page.getByRole('dialog', { name: 'ERROR DETAILS' })).toBeVisible();
    await snap(page, 'cyberpunk-error-details');
    await page.getByRole('dialog', { name: 'ERROR DETAILS' }).getByRole('button', { name: 'CLOSE' }).click();
    await page.getByTestId('job-card').getByRole('button', { name: 'REMOVE' }).click();
    await page.getByRole('dialog', { name: 'Remove this download from the list?' }).getByRole('button', { name: 'REMOVE', exact: true }).click();
    await expect(page.getByTestId('job-card')).toHaveCount(0);
}

export async function shootHistory(shot: Shot): Promise<void> {
    await shot.page.getByRole('navigation', { name: 'Video downloader' }).getByRole('button', { name: 'HISTORY', exact: true }).click();
    await expect(shot.page.locator('.history__item--done').first()).toBeVisible();
    await snap(shot.page, 'cyberpunk-history');
}

export async function shootCut(shot: Shot): Promise<void> {
    const { page } = shot;
    await openVideoDownloader(page);
    await page.getByRole('navigation', { name: 'Video downloader' }).getByRole('button', { name: 'CUT' }).click();
    await resize(shot.app, page, WINDOW.width, WINDOW.height + 100);
    await page.getByRole('button', { name: 'CHOOSE FILE' }).click();
    await expect(page.getByTestId('cut-segment')).toHaveCount(1, { timeout: 20000 });
    await page.getByLabel('Start of part 1').fill('0:30');
    await page.getByLabel('End of part 1').fill('1:15');
    await page.getByRole('button', { name: '+ ADD PART' }).click();
    await page.getByLabel('Start of part 2').fill('2:10');
    await page.getByLabel('End of part 2').fill('2:40');
    await page.waitForTimeout(1000);
    await snap(page, 'cyberpunk-cut');
    await resize(shot.app, page, WINDOW.width, WINDOW.height);
}

export async function shootVideoSettings(shot: Shot): Promise<void> {
    await openVideoDownloader(shot.page);
    await shot.page.getByRole('navigation', { name: 'Video downloader' }).getByRole('button', { name: /SETTINGS/ }).click();
    await shot.page.waitForTimeout(800);
    await snap(shot.page, 'cyberpunk-settings');
}

export type { Assets };
