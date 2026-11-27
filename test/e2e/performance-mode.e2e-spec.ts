import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import './display';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installedProgramsEnv } from './programs';

const ROOT = resolve(__dirname, '../..');
const ELECTRON_PATH = createRequire(__filename)('electron') as unknown as string;
const FAKE_ANI_CLI = resolve(__dirname, 'fixtures/fake-ani-cli.sh');
const FAKE_YTDLP = resolve(__dirname, 'fixtures/fake-yt-dlp.js');

test.setTimeout(120000);

interface Session {
    app: ElectronApplication;
    page: Page;
}

async function openApp(work: string, userData: string): Promise<Session> {
    const app = await electron.launch({
        executablePath: ELECTRON_PATH,
        args: [ROOT, '--no-sandbox', `--user-data-dir=${userData}`],
        env: {
            ...process.env,
            ...installedProgramsEnv(work),
            PULLWAVE_ANI_CLI: FAKE_ANI_CLI,
            PULLWAVE_ANILIST_URL: 'http://127.0.0.1:9/graphql',
            PULLWAVE_COVER_FALLBACK_URL: 'http://127.0.0.1:9',
            FAKE_YTDLP_LOG: join(work, 'y.log')
        }
    });
    const page = await app.firstWindow();
    await page.waitForSelector('.logo');
    await expect(page.getByText('// BOOTING SYSTEMS…')).toBeHidden({ timeout: 60000 });
    return { app, page };
}

test('performance mode is off by default, disables heavy visual effects when turned on, persists across restarts and restores them when turned off', async () => {
    const work = mkdtempSync(join(tmpdir(), 'pullwave-perf-mode-'));
    const userData = join(work, 'user-data');
    mkdirSync(userData, { recursive: true });
    writeFileSync(
        join(userData, 'settings.json'),
        JSON.stringify({
            language: 'en',
            themeMode: 'dark',
            themeFamily: 'cyberpunk',
            checkUpdatesOnStart: false,
            verifyLiveEnd: false,
            ytdlpPath: FAKE_YTDLP,
            downloadDir: join(work, 'd'),
            animeDownloadDir: join(work, 'anime')
        })
    );

    let session = await openApp(work, userData);
    try {
        const { page } = session;
        await page.locator('section.home').waitFor({ state: 'visible', timeout: 60000 });

        const before = await page.evaluate(() => {
            const topbar = document.querySelector('.topbar') as HTMLElement;
            const sidenav = document.querySelector('.sidenav') as HTMLElement;
            return {
                attribute: document.documentElement.hasAttribute('data-performance-mode'),
                topbarBlur: getComputedStyle(topbar).backdropFilter,
                sidenavBlur: getComputedStyle(sidenav).backdropFilter,
                auroraAnim: getComputedStyle(document.body, '::before').animationName,
                runningLoops: document.getAnimations().filter((animation) => {
                    return animation.playState === 'running' && animation.effect?.getTiming().iterations === Infinity;
                }).length
            };
        });
        expect(before.attribute).toBe(false);
        expect(before.topbarBlur).toContain('blur(');
        expect(before.sidenavBlur).toContain('blur(');
        expect(before.auroraAnim).toBe('bp-aurora-drift');
        expect(before.runningLoops).toBeGreaterThan(0);

        await page.getByRole('button', { name: 'SETTINGS (GLOBAL)' }).click();
        const toggle = page.getByLabel('Performance mode');
        await expect(toggle).not.toBeChecked();
        await toggle.click();
        await expect(toggle).toBeChecked();

        await expect
            .poll(async () => {
                const saved = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf-8')) as { performanceMode?: boolean };
                return saved.performanceMode;
            })
            .toBe(true);

        await page.getByRole('button', { name: 'HOME' }).click();
        await page.locator('section.home').waitFor({ state: 'visible' });

        const active = await page.evaluate(() => {
            const topbar = document.querySelector('.topbar') as HTMLElement;
            const sidenav = document.querySelector('.sidenav') as HTMLElement;
            const aurora = getComputedStyle(document.body, '::before');
            return {
                attribute: document.documentElement.hasAttribute('data-performance-mode'),
                topbarBlur: getComputedStyle(topbar).backdropFilter,
                sidenavBlur: getComputedStyle(sidenav).backdropFilter,
                auroraAnim: aurora.animationName,
                auroraBg: aurora.backgroundImage,
                hasFocusHalo: document.querySelector('.focus-halo') !== null,
                hasBackdrop: document.querySelector('.backdrop') !== null,
                runningLoops: document.getAnimations().filter((animation) => {
                    return animation.playState === 'running' && animation.effect?.getTiming().iterations === Infinity;
                }).length
            };
        });
        expect(active.attribute).toBe(true);
        expect(active.topbarBlur).toBe('none');
        expect(active.sidenavBlur).toBe('none');
        expect(active.auroraAnim).toBe('none');
        expect(active.auroraBg).toContain('radial-gradient');
        expect(active.hasFocusHalo).toBe(false);
        expect(active.hasBackdrop).toBe(false);
        expect(active.runningLoops).toBe(0);

        await session.app.close();
        session = await openApp(work, userData);
        const reopened = session.page;
        await reopened.locator('section.home').waitFor({ state: 'visible', timeout: 60000 });
        expect(await reopened.evaluate(() => {
            return document.documentElement.hasAttribute('data-performance-mode');
        })).toBe(true);

        await reopened.getByRole('button', { name: 'SETTINGS (GLOBAL)' }).click();
        const reopenedToggle = reopened.getByLabel('Performance mode');
        await expect(reopenedToggle).toBeChecked();
        await reopenedToggle.click();
        await expect(reopenedToggle).not.toBeChecked();

        await expect
            .poll(async () => {
                return reopened.evaluate(() => {
                    return document.documentElement.hasAttribute('data-performance-mode');
                });
            })
            .toBe(false);

        await expect
            .poll(async () => {
                const saved = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf-8')) as { performanceMode?: boolean };
                return saved.performanceMode;
            })
            .toBe(false);

        await reopened.getByRole('button', { name: 'HOME' }).click();
        await reopened.locator('section.home').waitFor({ state: 'visible' });

        const restored = await reopened.evaluate(() => {
            const topbar = document.querySelector('.topbar') as HTMLElement;
            const sidenav = document.querySelector('.sidenav') as HTMLElement;
            return {
                topbarBlur: getComputedStyle(topbar).backdropFilter,
                sidenavBlur: getComputedStyle(sidenav).backdropFilter,
                auroraAnim: getComputedStyle(document.body, '::before').animationName,
                hasFocusHalo: document.querySelector('.focus-halo') !== null,
                hasBackdrop: document.querySelector('.backdrop') !== null,
                runningLoops: document.getAnimations().filter((animation) => {
                    return animation.playState === 'running' && animation.effect?.getTiming().iterations === Infinity;
                }).length
            };
        });
        expect(restored.topbarBlur).toContain('blur(');
        expect(restored.sidenavBlur).toContain('blur(');
        expect(restored.auroraAnim).toBe('bp-aurora-drift');
        expect(restored.hasFocusHalo).toBe(true);
        expect(restored.hasBackdrop).toBe(true);
        expect(restored.runningLoops).toBeGreaterThan(0);
    } finally {
        await session.app.close();
        rmSync(work, { recursive: true, force: true });
    }
});
