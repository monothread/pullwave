import { expect, type Page } from '@playwright/test';
import { snap, type Shot } from './session';

const STORE_ADDRESS = 'https://store.example/index.min.json';
const SOURCE = 'MangaDex';

export interface MangaToAdd {
    title: string;
    source: 'MangaDex' | 'MangaPark';
    downloaded: boolean;
}

export const MANGA_LIBRARY: readonly MangaToAdd[] = [
    { title: 'One Piece', source: 'MangaDex', downloaded: true },
    { title: 'Chainsaw Man', source: 'MangaDex', downloaded: true },
    { title: 'Berserk', source: 'MangaDex', downloaded: true },
    { title: 'Vagabond', source: 'MangaDex', downloaded: false },
    { title: 'One-Punch Man', source: 'MangaPark', downloaded: true },
    { title: 'Solo Leveling', source: 'MangaPark', downloaded: false }
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

export async function installExtension(page: Page): Promise<void> {
    await goToMangaTab(page, 'SETTINGS');
    await page.getByLabel('Address of a store (index.min.json)').fill(STORE_ADDRESS);
    await page.getByRole('button', { name: 'ADD', exact: true }).click();
    await expect(page.getByText('Keiyoushi')).toBeVisible();
    await goToMangaTab(page, 'EXTENSIONS');
    await page.getByRole('switch', { name: 'Installed only' }).uncheck();
    await page.getByRole('button', { name: `INSTALL: Tachiyomi: ${SOURCE}` }).click();
    await expect(page.getByText('INSTALLED', { exact: true })).toBeVisible();
}

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
    await page.getByLabel('Manga name').fill('one');
    await page.getByRole('button', { name: 'SEARCH', exact: true }).last().click();
    await expect(page.getByText('"one": found in 2 of 2 sources')).toBeVisible({ timeout: 30000 });
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
    await page.getByTestId('manga-entry').getByRole('button', { name: 'Open: One Piece' }).click();
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
    const close = shot.page.getByRole('button', { name: '← CLOSE', exact: true });
    if (await close.isVisible()) {
        await close.click();
    }
    await openManga(shot.page);
    await goToMangaTab(shot.page, 'SETTINGS');
    await shot.page.waitForTimeout(1000);
    await snap(shot.page, 'manga-settings');
}

export async function shootMangaTwoPages(shot: Shot): Promise<void> {
    const { page } = shot;
    const reader = page.getByRole('region', { name: 'Reader' });
    await reader.getByRole('button', { name: 'READER SETTINGS' }).click();
    await reader.getByRole('switch', { name: 'Two pages side by side' }).check();
    await reader.getByRole('button', { name: 'READER SETTINGS' }).click();
    await page.waitForTimeout(2500);
    await snap(page, 'manga-two-pages');
    await reader.getByRole('button', { name: 'READER SETTINGS' }).click();
    await reader.getByRole('switch', { name: 'Two pages side by side' }).uncheck();
    await reader.getByRole('button', { name: 'READER SETTINGS' }).click();
    await page.keyboard.press('Escape');
}
