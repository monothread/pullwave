import { expect, type Page } from '@playwright/test';
import { snap, snapElement, snapFullscreen, type Shot } from './session';

// The screens of the anime section.

export interface AnimeToAdd {
    title: string;
    series?: string;
    order?: number;
    // How many episodes are downloaded (the first ones): the whole season when it is 'season'.
    downloaded: number | 'season';
}

// The anime that fill the library, and what is downloaded of each.
export const LIBRARY: readonly AnimeToAdd[] = [
    { title: 'Neon Harbor Nights', series: 'Neon Harbor Nights', order: 1, downloaded: 'season' },
    { title: 'Neon Harbor Nights 2', series: 'Neon Harbor Nights', order: 2, downloaded: 5 },
    { title: 'Clockwork Sparrow', downloaded: 'season' },
    { title: 'Starlight Courier', downloaded: 7 },
    { title: 'The Lantern Cartographer', downloaded: 3 },
    { title: 'Moonlit Ramen Club', downloaded: 0 },
    { title: 'Ashfall Academy', downloaded: 4 }
];

function animeNav(page: Page) {
    return page.getByRole('navigation', { name: 'Anime' });
}

export async function openAnime(page: Page): Promise<void> {
    await page.locator('#side-nav > button').nth(2).click();
    await expect(animeNav(page)).toBeVisible();
}

export async function goToAnimeTab(page: Page, tab: 'SCHEDULE' | 'UPDATES' | 'SEARCH' | 'LIBRARY' | 'HISTORY'): Promise<void> {
    await animeNav(page).getByRole('button', { name: tab, exact: true }).click();
}

export async function searchAnime(page: Page, words: string): Promise<void> {
    await goToAnimeTab(page, 'SEARCH');
    await page.getByLabel('Anime name').fill(words);
    await page.getByLabel('Anime name').press('Enter');
    await expect(page.getByRole('button', { name: 'OPEN: Neon Harbor Nights', exact: true })).toBeVisible({ timeout: 30000 });
    // The covers come a moment after the names.
    await page.waitForTimeout(2500);
}

async function addDialogFill(page: Page, anime: AnimeToAdd): Promise<void> {
    const dialog = page.getByRole('dialog', { name: 'Add to the library' });
    await expect(dialog).toBeVisible();
    if (anime.series !== undefined) {
        await dialog.getByLabel('Series').fill(anime.series);
        await dialog.getByLabel('Order').fill(String(anime.order ?? 1));
    }
    await dialog.getByRole('button', { name: 'CONFIRM' }).click();
    await expect(dialog).toBeHidden();
}

async function waitForDownloads(page: Page): Promise<void> {
    await expect(page.getByRole('button', { name: 'DOWNLOADS (0)' })).toBeVisible({ timeout: 60000 });
}

async function downloadEpisodes(page: Page, anime: AnimeToAdd): Promise<void> {
    await page.getByRole('button', { name: 'VIEW IN LIBRARY', exact: true }).click();
    if (anime.downloaded === 0) {
        return;
    }
    await page.getByRole('button', { name: `SHOW EPISODES: ${anime.title}`, exact: true }).click();
    if (anime.downloaded === 'season') {
        await page.getByRole('button', { name: `DOWNLOAD SEASON: ${anime.title}`, exact: true }).click();
    } else {
        for (let episode = 1; episode <= anime.downloaded; episode += 1) {
            await page.getByRole('button', { name: `DOWNLOAD: ${anime.title} EP ${String(episode)}`, exact: true }).click();
        }
    }
    await waitForDownloads(page);
}

// Puts the anime in the library from the search and downloads the episodes it says.
export async function addAnime(page: Page, anime: AnimeToAdd): Promise<void> {
    await searchAnime(page, anime.title);
    await page.getByRole('button', { name: `OPEN: ${anime.title}`, exact: true }).click();
    await expect(page.getByRole('button', { name: 'EP 3', exact: true })).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'ADD TO LIBRARY', exact: true }).click();
    await addDialogFill(page, anime);
    await downloadEpisodes(page, anime);
}

export async function fillLibrary(page: Page): Promise<void> {
    await openAnime(page);
    for (const anime of LIBRARY) {
        await addAnime(page, anime);
    }
}

export async function shootSchedule(shot: Shot): Promise<void> {
    await openAnime(shot.page);
    await goToAnimeTab(shot.page, 'SCHEDULE');
    await expect(shot.page.locator('.cover-card').first()).toBeVisible({ timeout: 30000 });
    await shot.page.waitForTimeout(2500);
    await snap(shot.page, 'anime-schedule');
}

export async function shootSearch(shot: Shot): Promise<void> {
    await openAnime(shot.page);
    await searchAnime(shot.page, 'neon');
    await snap(shot.page, 'anime-search');
}

export async function shootLibrary(shot: Shot): Promise<void> {
    await openAnime(shot.page);
    await goToAnimeTab(shot.page, 'LIBRARY');
    await shot.page.waitForTimeout(2500);
    await snap(shot.page, 'anime-library');
}

export async function shootSeries(shot: Shot): Promise<void> {
    const { page } = shot;
    await openAnime(page);
    await goToAnimeTab(page, 'LIBRARY');
    await page.getByRole('button', { name: 'OPEN SERIES: Neon Harbor Nights', exact: true }).click();
    await page.waitForTimeout(1500);
    await snap(page, 'anime-series');
}

// The episodes of a season as cards: the first two watched, so the seal of what was watched is seen next to the ones still to watch.
export async function shootEpisodes(shot: Shot): Promise<void> {
    const { page } = shot;
    for (const episode of [1, 2]) {
        await page.getByRole('button', { name: `MARK AS WATCHED: Neon Harbor Nights EP ${String(episode)}`, exact: true }).click();
    }
    await expect(page.getByRole('img', { name: 'WATCHED' })).toHaveCount(2);
    await snapElement(page, '.episode-cards', 'anime-episodes');
}

export async function shootPlayer(shot: Shot): Promise<void> {
    const { page } = shot;
    await page.getByRole('button', { name: 'SHOW EPISODES: Neon Harbor Nights', exact: true }).click();
    await page.getByRole('button', { name: 'PLAY: Neon Harbor Nights EP 1', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Neon Harbor Nights · EP 1' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Fullscreen' }).click();
    await expect.poll(() => {
        return page.evaluate(() => {
            return document.fullscreenElement !== null;
        });
    }).toBe(true);
    await page.waitForTimeout(7000);
    await page.mouse.move(640, 500);
    await page.mouse.move(660, 520);
    await page.waitForTimeout(500);
    await snapFullscreen(page, 'anime-player');
    await page.keyboard.press('Escape');
}
