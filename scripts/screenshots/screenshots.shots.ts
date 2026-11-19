import { test } from '@playwright/test';
import { rmSync } from 'node:fs';
import { fillLibrary, shootEpisodes, shootLibrary, shootPlayer, shootSchedule, shootSearch, shootSeries } from './anime';
import { shootHome, shootHomeUltrawide } from './home';
import { fillMangaLibrary, shootMangaLibrary, shootMangaPage, shootMangaReader, shootMangaSearch, shootMangaSettings, shootMangaTwoPages } from './manga';
import { launch, prepareAssets, releaseAssets, type Assets } from './session';
import { historyOf, shootCut, shootError, shootHistory, shootQueue, shootVideoSettings } from './video';

const FAKE_FOLDERS = { downloadDir: '/home/user/Videos', animeDownloadDir: '/home/user/Anime', mangaDirectory: '/home/user/Manga' };

const DEMO_MANGA_FOLDER = '/tmp/pullwave-demo/Manga';

let assets: Assets;

test.beforeAll(async () => {
    assets = await prepareAssets();
});

test.afterAll(async () => {
    await releaseAssets(assets);
    rmSync('/tmp/pullwave-demo', { recursive: true, force: true });
});

test('the video downloader, the anime and the manga, and the home screen, in the Neon Tokyo Light theme', async () => {
    const shot = await launch(assets, { history: historyOf, settings: { mangaDirectory: DEMO_MANGA_FOLDER } });
    await shootError(shot);
    await shootQueue(shot, 'neon-tokyo-downloads');
    await shootHistory(shot);
    await fillLibrary(shot.page);
    await shootSchedule(shot);
    await shootSearch(shot);
    await shootLibrary(shot);
    await shootSeries(shot);
    await shootPlayer(shot);
    await shootEpisodes(shot);
    await fillMangaLibrary(shot.page);
    await shootMangaSearch(shot);
    await shootMangaLibrary(shot);
    await shootMangaPage(shot);
    await shootMangaReader(shot);
    await shootMangaTwoPages(shot);
    await shootMangaSettings(shot);
    await shootHome(shot);
    await shootHomeUltrawide(shot);
    await shot.app.close();
});

test('the cutter and the settings, with the folders of an imaginary home', async () => {
    const shot = await launch(assets, { env: { PULLWAVE_CUT_FILE: assets.longVideo }, settings: FAKE_FOLDERS });
    await shootCut(shot);
    await shootVideoSettings(shot);
    await shot.app.close();
});

for (const entry of [
    { theme: 'neon-tokyo' as const, file: 'neon-tokyo-dark-downloads' },
    { theme: 'dark' as const, file: 'dark-downloads' },
    { theme: 'light' as const, file: 'light-downloads' }
]) {
    test(`the queue in the ${entry.theme} theme`, async () => {
        const shot = await launch(assets, { theme: entry.theme });
        await shootQueue(shot, entry.file);
        await shot.app.close();
    });
}
