import { expect, type Page } from '@playwright/test';

export interface NoticesPlace {
    right: number;
    bottom: number;
    display: string;
}

export const NOTICES_CORNER = { right: 20, bottom: 20 };

const HOLDER_ID = 'test-notices';
const HOLDER_SELECTOR = `#${HOLDER_ID}`;

export async function showNotice(page: Page): Promise<void> {
    await page.evaluate((id) => {
        const holder = document.createElement('div');
        holder.id = id;
        holder.className = 'toasts';
        holder.innerHTML = '<div class="toast toast--info" role="status"><span class="toast__message">A notice</span></div>';
        (document.querySelector('.app') ?? document.body).appendChild(holder);
    }, HOLDER_ID);
}

export function noticesPlace(page: Page): Promise<NoticesPlace> {
    return page.evaluate((selector) => {
        const holder = document.querySelector(selector) as HTMLElement;
        const box = holder.getBoundingClientRect();
        return {
            right: Math.round(document.documentElement.clientWidth - box.right),
            bottom: Math.round(document.documentElement.clientHeight - box.bottom),
            display: getComputedStyle(holder).display
        };
    }, HOLDER_SELECTOR);
}

export async function expectNoticesAtBottomRight(page: Page): Promise<void> {
    await expect(page.locator(`${HOLDER_SELECTOR} .toast`)).toBeVisible();
    expect(await noticesPlace(page)).toEqual({ ...NOTICES_CORNER, display: 'flex' });
}

export async function expectNoticesHidden(page: Page): Promise<void> {
    await expect(page.locator(HOLDER_SELECTOR)).toBeHidden();
    await expect(page.locator(`${HOLDER_SELECTOR} .toast`)).toBeHidden();
    expect((await noticesPlace(page)).display).toBe('none');
}
