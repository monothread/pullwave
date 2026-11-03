import { test } from '@playwright/test';
import { rmSync } from 'node:fs';
import { fillLibrary, shootLibrary, shootPlayer, shootSchedule, shootSearch, shootSeries } from './anime';
import { shootHome } from './home';
import { fillMangaLibrary, shootMangaLibrary, shootMangaPage, shootMangaReader, shootMangaSearch, shootMangaSettings } from './manga';
import { launch, prepareAssets, releaseAssets, type Assets } from './session';
import { historyOf, shootCut, shootError, shootHistory, shootQueue, shootVideoSettings } from './video';

// Takes every screenshot of the README and of docs/screenshots on the real application, with invented titles, fake programs and fake
// servers, in a new temporary folder: nothing of an installed Pullwave is read or changed. Run it with `npm run screenshots`.

const FAKE_FOLDERS = { downloadDir: '/home/user/Videos', animeDownloadDir: '/home/user/Anime', mangaDirectory: '/home/user/Manga' };

// The folder of the manga is fixed once the library has a manga, so the screen of its settings is taken in the first run, with a folder that
// says nothing about this machine.
const DEMO_MANGA_FOLDER = '/tmp/pullwave-demo/Manga';

let assets: Assets;

test.beforeAll(async () => {
    assets = await prepareAssets();
});

test.afterAll(async () => {
    await releaseAssets(assets);
    rmSync('/tmp/pullwave-demo', { recursive: true, force: true });
});

test('the video downloader, the anime and the manga, and the home screen, in the cyberpunk theme', async () => {
    const shot = await launch(assets, { history: historyOf, settings: { mangaDirectory: DEMO_MANGA_FOLDER } });
    await shootError(shot);
    await shootQueue(shot, 'cyberpunk-downloads');
    await shootHistory(shot);
    await fillLibrary(shot.page);
    await shootSchedule(shot);
    await shootSearch(shot);
    await shootLibrary(shot);
    await shootSeries(shot);
    await shootPlayer(shot);
    await fillMangaLibrary(shot.page);
    await shootMangaSearch(shot);
    await shootMangaLibrary(shot);
    await shootMangaPage(shot);
    await shootMangaReader(shot);
    await shootMangaSettings(shot);
    await shootHome(shot);
    await shot.app.close();
});

test('the cutter and the settings, with the folders of an imaginary home', async () => {
    const shot = await launch(assets, { env: { PULLWAVE_CUT_FILE: assets.longVideo }, settings: FAKE_FOLDERS });
    await shootCut(shot);
    await shootVideoSettings(shot);
    await shot.app.close();
});

for (const theme of ['dark', 'light']) {
    test(`the queue in the ${theme} theme`, async () => {
        const shot = await launch(assets, { theme });
        await shootQueue(shot, `${theme}-downloads`);
        await shot.app.close();
    });
}
