import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import './display';
import { leaveHome } from './startScreen';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const ELECTRON_PATH = createRequire(__filename)('electron') as unknown as string;
const TOOLS = process.env.PULLWAVE_MANGA_TOOLS ?? '';
const STORE_URL = 'https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json';

const HAS_PROGRAMS = TOOLS !== '' && existsSync(join(TOOLS, 'suwayomi'));
test.skip(process.env.PULLWAVE_LIVE_CLOUDFLARE !== '1' || !HAS_PROGRAMS, 'set PULLWAVE_LIVE_CLOUDFLARE=1 and PULLWAVE_MANGA_TOOLS (with suwayomi in it) to run this');
test.setTimeout(120000);

let workDir: string;
let app: ElectronApplication;
let page: Page;

test.beforeEach(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'pullwave-manga-cf-'));
    const userData = join(workDir, 'userData');
    mkdirSync(join(userData, 'manga'), { recursive: true });
    symlinkSync(TOOLS, join(userData, 'manga', 'tools'));
    writeFileSync(join(userData, 'settings.json'), JSON.stringify({ language: 'en', checkUpdatesOnStart: false, downloadDir: join(workDir, 'downloads'), mangaDirectory: join(workDir, 'manga'), mangaFlaresolverrEnabled: true }));
    app = await electron.launch({ executablePath: ELECTRON_PATH, args: [ROOT, '--no-sandbox', `--user-data-dir=${userData}`], env: { ...process.env, PULLWAVE_NO_TOOLS: '1', PULLWAVE_E2E_LIVE: '1' } });
    page = await app.firstWindow();
    await page.waitForSelector('.logo');
    await expect(page.getByText('// BOOTING SYSTEMS…')).toBeHidden({ timeout: 60000 });
    await leaveHome(page);
});

test.afterEach(async () => {
    const testInfo = test.info();
    if (testInfo.status !== testInfo.expectedStatus) {
        const manga = join(workDir, 'userData', 'manga');
        const read = (path: string): string => {return (existsSync(path) ? readFileSync(path, 'utf-8') : '(none)')};
        const conf = read(join(manga, 'server', 'server.conf')).split('\n').filter((line) => {return line.includes('flareSolverr') || line.includes('server.port')});
        const log = read(join(manga, 'server', 'logs', 'application.log')).split('\n').filter((line) => {return /ERROR|Cloudflare|FlareSolverr|flaresolverr/i.test(line)});
        const screen = await page.locator('.manga').innerText().catch(() => {return '(no screen)'});
        console.log(`DIAGNOSIS\nscreen: ${screen.replace(/\s+/g, ' ').slice(0, 600)}\nconf: ${conf.join(' | ')}\nlog: ${log.slice(-6).join(' | ').slice(0, 1200)}`);
    }
    await app.close();
    rmSync(workDir, { recursive: true, force: true });
});

test('reads a site that is behind Cloudflare through the helper, and says that a check is going on', async () => {
    await page.getByRole('button', { name: 'MANGA', exact: true }).click();
    const nav = page.getByRole('navigation', { name: 'Manga' });
    await expect(nav).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('region', { name: 'Helper for sites protected by Cloudflare' })).toHaveCount(0, { timeout: 20000 });

    await nav.getByRole('button', { name: 'SETTINGS', exact: true }).click();
    await page.getByLabel('Address of a store (index.min.json)').fill(STORE_URL);
    await page.getByRole('button', { name: 'ADD', exact: true }).click();
    await expect(page.getByTestId('manga-store')).toBeVisible({ timeout: 40000 });
    await nav.getByRole('button', { name: 'EXTENSIONS', exact: true }).click();
    await page.getByRole('switch', { name: 'Installed only' }).uncheck();
    await expect(page.getByLabel('Filter extensions')).toBeVisible({ timeout: 40000 });
    await page.getByLabel('Filter extensions').fill('Manganato');
    await page.getByRole('button', { name: 'INSTALL: Manganato', exact: true }).click();
    await expect(page.getByText('INSTALLED', { exact: true })).toBeVisible({ timeout: 40000 });

    await nav.getByRole('button', { name: 'BROWSE', exact: true }).click();
    await page.getByRole('button', { name: /^POPULAR: Manganato/ }).click();
    await expect(page.getByTestId('manga-cloudflare')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('manga-cloudflare')).toContainText('Passing the Cloudflare check of');
    await expect(page.getByText(/^Results: \d+$/)).toBeVisible({ timeout: 45000 });
    await expect(page.getByTestId('manga-cloudflare')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await page.locator('.cover-card').count()).toBeGreaterThan(0);
});

test('offers to look for an update of the helper the app runs, and never an update of the server', async () => {
    await page.getByRole('button', { name: 'MANGA', exact: true }).click();
    const nav = page.getByRole('navigation', { name: 'Manga' });
    await expect(nav).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('region', { name: 'Helper for sites protected by Cloudflare' })).toHaveCount(0, { timeout: 20000 });

    await nav.getByRole('button', { name: 'SETTINGS', exact: true }).click();
    const status = page.getByRole('group', { name: 'Status of the programs' });
    const server = status.getByTestId('manga-health-server');
    const helper = status.getByTestId('manga-health-helper');
    await expect(status.getByRole('button', { name: 'CHECK FOR UPDATES' })).toBeEnabled({ timeout: 30000 });
    await expect(status).toContainText('Updating takes the latest release of FlareSolverr (from GitHub) and switches to it at once.');
    await expect(status).toContainText('The manga server stays at the version the app ships with: it moves with the updates of the app.');

    await status.getByRole('button', { name: 'CHECK FOR UPDATES' }).click();
    await expect(helper).toContainText(/Latest: v\d+\.\d+\.\d+|Could not look for the latest version/, { timeout: 30000 });
    await expect(status.getByRole('button', { name: 'CHECK FOR UPDATES' })).toBeEnabled();
    await expect(server.getByRole('button')).toHaveCount(0);
    await expect(server).not.toContainText('Latest:');
    await expect(status.getByRole('button', { name: /RESTART NOW|USE THE ONE OF THE APP/ })).toHaveCount(0);
    const latest = /Latest: (v\d+\.\d+\.\d+)/.exec(await helper.innerText())?.[1] ?? null;
    if (latest !== null && latest !== 'v3.5.2') {
        await expect(helper.getByRole('button', { name: `UPDATE TO ${latest}` })).toBeEnabled();
    } else {
        await expect(helper.getByRole('button', { name: /^UPDATE TO/ })).toHaveCount(0);
    }
});
