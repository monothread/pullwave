import { expect, type Page } from '@playwright/test';
import { snap, type Shot } from './session';

// The screens of the manga section.

const STORE_ADDRESS = 'https://store.example/index.min.json';
const SOURCE = 'Lantern Scans';

export interface MangaToAdd {
    title: string;
    // The source the manga is browsed in (the second one has its own mangas).
    source: 'Lantern Scans' | 'Paperwind';
    // Whether its chapters are downloaded.
    downloaded: boolean;
}

export const MANGA_LIBRARY: readonly MangaToAdd[] = [
    { title: 'Tidebound Chronicles', source: 'Lantern Scans', downloaded: true },
    { title: 'Paper Lantern Detective', source: 'Lantern Scans', downloaded: true },
    { title: 'Orbit Cafe', source: 'Lantern Scans', downloaded: false },
    { title: 'Hollow Crown Knights', source: 'Lantern Scans', downloaded: true },
    { title: 'Salt and Ember', source: 'Paperwind', downloaded: false },
    { title: 'The Last Lantern Keeper', source: 'Paperwind', downloaded: true }
];

function mangaNav(page: Page) {
    return page.getByRole('navigation', { name: 'Manga' });
}

export async function openManga(page: Page): Promise<void> {
    await page.locator('#side-nav > button').nth(3).click();
    await expect(page.getByRole('region', { name: 'Manga' })).toBeVisible();
}

export async function goToMangaTab(page: Page, tab: 'BROWSE' | 'SEARCH' | 'UPDATES' | 'LIBRARY' | 'HISTORY' | 'EXTENSIONS' | 'SETTINGS'): Promise<void> {
    await mangaNav(page).getByRole('button', { name: tab, exact: true }).click();
}

// Adds the store of extensions and installs the one of the sources, which is what makes the sources appear.
export async function installExtension(page: Page): Promise<void> {
    await goToMangaTab(page, 'SETTINGS');
    await page.getByLabel('Address of a store (index.min.json)').fill(STORE_ADDRESS);
    await page.getByRole('button', { name: 'ADD', exact: true }).click();
    await expect(page.getByText('Lantern Store')).toBeVisible();
    await goToMangaTab(page, 'EXTENSIONS');
    await page.getByRole('switch', { name: 'Installed only' }).uncheck();
    await page.getByRole('button', { name: `INSTALL: Tachiyomi: ${SOURCE}` }).click();
    await expect(page.getByText('INSTALLED', { exact: true })).toBeVisible();
}

// The browse opens where it was left (the page of a manga, a source): it goes back until the list of sources shows.
async function openSourceOf(page: Page, source: string): Promise<void> {
    await goToMangaTab(page, 'BROWSE');
    const popular = page.getByRole('button', { name: `POPULAR: ${source}`, exact: true });
    for (const label of ['← BACK', '← SOURCES', '← BACK', '← SOURCES']) {
        await page.waitForTimeout(400);
        if (await popular.isVisible()) {
            break;
        }
        const back = page.getByRole('button', { name: label, exact: true });
        if (await back.isVisible()) {
            await back.click();
        }
    }
    await popular.click();
}

export async function addManga(page: Page, manga: MangaToAdd): Promise<void> {
    await openSourceOf(page, manga.source);
    await page.getByRole('button', { name: `Open: ${manga.title}` }).click();
    await expect(page.getByRole('button', { name: 'READ: Chapter 1', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'ADD TO LIBRARY' }).click();
    if (manga.downloaded) {
        await goToMangaTab(page, 'LIBRARY');
        await page.getByTestId('manga-entry').getByRole('button', { name: `Open: ${manga.title}` }).click();
        await expect(page.getByRole('button', { name: 'READ: Chapter 1', exact: true })).toBeVisible();
        await page.getByRole('button', { name: `DOWNLOAD SEASON: ${manga.title}` }).click();
        await expect(page.getByRole('button', { name: 'DOWNLOADS (0)' })).toBeVisible({ timeout: 60000 });
    }
}

export async function fillMangaLibrary(page: Page): Promise<void> {
    await openManga(page);
    await installExtension(page);
    for (const manga of MANGA_LIBRARY) {
        await addManga(page, manga);
    }
}

// A tab opens where it was left (the page of a manga): the list is reached by going back.
async function backToList(page: Page): Promise<void> {
    const back = page.getByRole('button', { name: '← BACK', exact: true });
    for (let attempt = 0; attempt < 3; attempt += 1) {
        await page.waitForTimeout(400);
        if (await back.isVisible()) {
            await back.click();
        }
    }
}

export async function shootMangaSearch(shot: Shot): Promise<void> {
    const { page } = shot;
    await openManga(page);
    await goToMangaTab(page, 'SEARCH');
    await page.getByLabel('Manga name').fill('lantern');
    await page.getByRole('button', { name: 'SEARCH', exact: true }).last().click();
    await expect(page.getByText('"lantern": found in 2 of 2 sources')).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);
    await snap(page, 'manga-search');
}

export async function shootMangaLibrary(shot: Shot): Promise<void> {
    await openManga(shot.page);
    await goToMangaTab(shot.page, 'LIBRARY');
    await backToList(shot.page);
    await shot.page.waitForTimeout(2000);
    await snap(shot.page, 'manga-library');
}

export async function shootMangaPage(shot: Shot): Promise<void> {
    const { page } = shot;
    await openManga(page);
    await goToMangaTab(page, 'LIBRARY');
    await backToList(page);
    await page.getByTestId('manga-entry').getByRole('button', { name: 'Open: Paper Lantern Detective' }).click();
    await expect(page.getByRole('button', { name: 'READ: Chapter 1', exact: true })).toBeVisible();
    await page.waitForTimeout(1500);
    await snap(page, 'manga-page');
}

export async function shootMangaReader(shot: Shot): Promise<void> {
    const { page } = shot;
    await page.getByRole('button', { name: 'READ: Chapter 1', exact: true }).click();
    await page.waitForTimeout(2500);
    await snap(page, 'manga-reader');
}

export async function shootMangaSettings(shot: Shot): Promise<void> {
    // The reader covers the section while it is open.
    const close = shot.page.getByRole('button', { name: '← CLOSE', exact: true });
    if (await close.isVisible()) {
        await close.click();
    }
    await openManga(shot.page);
    await goToMangaTab(shot.page, 'SETTINGS');
    await shot.page.waitForTimeout(1000);
    await snap(shot.page, 'manga-settings');
}
