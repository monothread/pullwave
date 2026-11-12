import { expect, type Locator, type Page } from '@playwright/test';

// The area of the app that scrolls.
function scrollArea(page: Page): Locator {
    return page.locator('.app__main');
}

// Scrolls the page to its top.
export async function scrollToTop(page: Page): Promise<void> {
    await scrollArea(page).evaluate((area) => {
        area.scrollTop = 0;
    });
}

// Scrolls the page to its bottom.
export async function scrollToBottom(page: Page): Promise<void> {
    await scrollArea(page).evaluate((area) => {
        area.scrollTop = area.scrollHeight;
    });
}

// A long list is drawn by blocks: an item far from the screen is not on the page. Scrolls from the top, half a screen at a time, until the
// item is drawn.
export async function scrollUntilDrawn(page: Page, item: Locator): Promise<void> {
    await scrollToTop(page);
    await expect
        .poll(
            async () => {
                if ((await item.count()) === 0) {
                    await scrollArea(page).evaluate((area) => {
                        area.scrollBy(0, area.clientHeight / 2);
                    });
                }
                return item.count();
            },
            { timeout: 10_000 }
        )
        .toBeGreaterThan(0);
}
