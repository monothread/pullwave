import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import './display';
import { leaveHome } from './startScreen';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MARKER_FILE } from '../../src/main/services/tools/toolInstaller';
import { installPrograms, programsEnv } from './programs';

// The update of ani-cli from the settings of the anime, for real: the app runs an ani-cli it takes for an older one (the pinned script under a
// commit that is not its own), looks up the latest commit on GitHub, and the update goes through every step on its card: the look at the
// script, its download, the shell, and the tries for real against the source (a search for KAIJU GIRL CARAMELISE, its episodes, episode 1).
// It needs the network and the source, so it only runs when asked (PULLWAVE_LIVE=1), like anime-live.
const ROOT = resolve(__dirname, '../..');
const ELECTRON_PATH = createRequire(__filename)('electron') as unknown as string;
const ANI_DIR = join(ROOT, 'resources', 'bin', 'ani');
const HAS_ANI_TOOLS = process.platform !== 'win32' && ['busybox', 'curl', 'ani-cli'].every((name) => {
    return existsSync(join(ANI_DIR, name));
});
test.skip(process.env.PULLWAVE_LIVE !== '1' || !HAS_ANI_TOOLS, 'set PULLWAVE_LIVE=1 (needs the network and `npm run fetch-binaries`)');
test.setTimeout(300000);

// A commit the app takes for the one it runs: not one of ani-cli, so the latest of GitHub is always another one.
const OLDER = '0'.repeat(40);
const STEPS = ['Checking that the app can use it', 'Downloading', 'Checking the script', 'Trying a search', 'Trying the list of episodes', 'Trying an episode'];

let workDir: string;
let tools: string;
let app: ElectronApplication;
let page: Page;

// The pinned script installed as if it were the commit OLDER, chosen by an update made before.
function installOlderAniCli(directory: string): void {
    const script = readFileSync(join(ANI_DIR, 'ani-cli'));
    const sha256 = createHash('sha256').update(script).digest('hex');
    const folder = join(directory, 'anicli', OLDER);
    mkdirSync(folder, { recursive: true });
    copyFileSync(join(ANI_DIR, 'ani-cli'), join(folder, 'ani-cli'));
    writeFileSync(join(folder, MARKER_FILE), JSON.stringify({ id: 'anicli', version: OLDER, sha256 }));
    writeFileSync(join(directory, 'anicli-selected.json'), JSON.stringify({ version: OLDER, sha256, sizeBytes: script.length }));
}

test.beforeEach(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'pullwave-update-live-'));
    const userData = join(workDir, 'user-data');
    mkdirSync(userData, { recursive: true });
    writeFileSync(join(userData, 'settings.json'), JSON.stringify({ language: 'en', checkUpdatesOnStart: false, animeDownloadDir: join(workDir, 'anime'), downloadDir: join(workDir, 'downloads') }));
    tools = installPrograms(join(workDir, 'tools')).directory;
    // Only the older one is there: the latest is downloaded and checked by the update (one that is installed already is used as it is).
    rmSync(join(tools, 'anicli'), { recursive: true, force: true });
    installOlderAniCli(tools);
    app = await electron.launch({ executablePath: ELECTRON_PATH, args: [ROOT, '--no-sandbox', `--user-data-dir=${userData}`], env: { ...process.env, ...programsEnv(tools) } as Record<string, string> });
    page = await app.firstWindow();
    await page.waitForSelector('.logo');
    await expect(page.getByText('// BOOTING SYSTEMS…')).toBeHidden({ timeout: 60000 });
    await leaveHome(page);
});

test.afterEach(async () => {
    await app.close();
    rmSync(workDir, { recursive: true, force: true });
});

test('updates ani-cli from the settings, showing each step on its card, and uses the new script once every step passed', async () => {
    await page.getByRole('button', { name: 'ANIME', exact: true }).click();
    await page.getByRole('navigation', { name: 'Anime' }).getByRole('button', { name: 'SETTINGS', exact: true }).click();
    const block = page.getByTestId('programs-block-anime');
    const row = block.getByTestId('program-anicli');
    await expect(row).toContainText('version 5.1.8');

    await block.getByRole('button', { name: 'CHECK FOR NEW VERSIONS' }).click();
    const update = row.getByRole('button', { name: /^ani-cli: UPDATE TO [0-9a-f]{7}$/ });
    await expect(update).toBeEnabled({ timeout: 30000 });
    const latest = /UPDATE TO ([0-9a-f]{7})/.exec((await update.textContent()) ?? '')?.[1] as string;
    // Every state the card goes through is kept, to see the steps were gone through in order.
    await row.evaluate((element) => {
        const seen: string[] = [];
        (window as unknown as { updateStates: string[] }).updateStates = seen;
        new MutationObserver(() => {
            const state = Array.from(element.querySelectorAll('[data-step]'))
                .map((item) => {
                    return `${item.getAttribute('data-step') ?? ''}:${item.getAttribute('data-state') ?? ''}`;
                })
                .join(' ');
            if (state.length > 0 && seen.at(-1) !== state) {
                seen.push(state);
            }
        }).observe(element, { subtree: true, childList: true, attributes: true });
    });
    await update.click();

    // The card shows every step, in order, while the update goes on.
    const steps = row.getByRole('list', { name: 'Steps of the update' });
    await expect(steps.getByRole('listitem')).toHaveCount(STEPS.length, { timeout: 15000 });
    await expect(steps.getByRole('listitem')).toHaveText(
        STEPS.map((step) => {
            return new RegExp(`^. ${step}$`);
        })
    );
    // Every step passed: the card says so, the steps go, and the new script is the one in use.
    await expect(row).toContainText(`Updated to ${latest}.`, { timeout: 180000 });
    await expect(steps).toHaveCount(0);
    // The card went through every step, each one going on after the ones before it were done.
    const states = await page.evaluate(() => {
        return (window as unknown as { updateStates: string[] }).updateStates;
    });
    const running = states.flatMap((state) => {
        const current = /(\w+):(running|failed)/.exec(state);
        return current === null ? [] : [current[1] as string];
    });
    expect([...new Set(running)]).toEqual(['compatibility', 'download', 'syntax', 'search', 'episodes', 'episode']);
    await expect(row.getByRole('alert')).toHaveCount(0);
    const selected = JSON.parse(readFileSync(join(tools, 'anicli-selected.json'), 'utf-8')) as { version: string };
    expect(selected.version.startsWith(latest)).toBe(true);
    expect(readdirSync(join(tools, 'anicli'))).toEqual([selected.version]);
    expect(readFileSync(join(tools, 'anicli', selected.version, 'ani-cli'), 'utf-8')).toMatch(/^#!\/bin\/sh\n/);
    // What the tries for real used is kept apart from the anime in use.
    expect(existsSync(join(workDir, 'user-data', 'anime', 'update-check'))).toBe(true);
});
