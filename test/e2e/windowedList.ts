import { expect, type Locator, type Page } from '@playwright/test';

function scrollArea(page: Page): Locator {
    return page.locator('.app__main');
}

export async function scrollToTop(page: Page): Promise<void> {
    await scrollArea(page).evaluate((area) => {
        area.scrollTop = 0;
    });
}

export async function scrollToBottom(page: Page): Promise<void> {
    await scrollArea(page).evaluate((area) => {
        area.scrollTop = area.scrollHeight;
    });
}

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
