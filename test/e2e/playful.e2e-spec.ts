import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import './display';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installedProgramsEnv } from './programs';

// The playful layer on the real app (D-147): the week in numbers on the home screen, the wave of the name, the colour of the aurora, the
// ripple of a press, the pill and the halo that follow the focus, the pictures of the empty screens, the clock that flips, the confetti and
// the notice with its timer, the circle that opens when the theme changes and the volume of the sounds.

const ROOT = resolve(__dirname, '../..');
const ELECTRON_PATH = createRequire(__filename)('electron') as unknown as string;
const FAKE_ANI_CLI = resolve(__dirname, 'fixtures/fake-ani-cli.sh');
const FAKE_YTDLP = resolve(__dirname, 'fixtures/fake-yt-dlp.js');
const DAY_MS = 24 * 60 * 60 * 1000;
const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

test.setTimeout(120000);

interface Session {
    app: ElectronApplication;
    page: Page;
    work: string;
}

let session: Session;

async function launch(): Promise<Session> {
    const work = mkdtempSync(join(tmpdir(), 'pullwave-playful-'));
    const userData = join(work, 'user-data');
    mkdirSync(userData, { recursive: true });
    writeFileSync(
        join(userData, 'settings.json'),
        JSON.stringify({ language: 'en', checkUpdatesOnStart: false, verifyLiveEnd: false, ytdlpPath: FAKE_YTDLP, downloadDir: join(work, 'd'), animeDownloadDir: join(work, 'anime') })
    );
    const now = Date.now();
    // Three downloads on three days in a row, and one that failed: the week has three downloads and a streak of three days.
    writeFileSync(
        join(userData, 'history.json'),
        JSON.stringify([
            { id: 'a', url: 'https://x/1', title: 'Today', filePath: join(work, 'a.mp4'), status: 'done', errorTitle: null, finishedAt: now },
            { id: 'b', url: 'https://x/2', title: 'Yesterday', filePath: join(work, 'b.mp4'), status: 'done', errorTitle: null, finishedAt: now - DAY_MS },
            { id: 'c', url: 'https://x/3', title: 'Before', filePath: join(work, 'c.mp4'), status: 'done', errorTitle: null, finishedAt: now - 2 * DAY_MS },
            { id: 'd', url: 'https://x/4', title: 'Failed', filePath: null, status: 'error', errorTitle: 'Video unavailable', finishedAt: now }
        ])
    );
    const app = await electron.launch({
        executablePath: ELECTRON_PATH,
        args: [ROOT, '--no-sandbox', `--user-data-dir=${userData}`],
        env: { ...process.env, ...installedProgramsEnv(work), PULLWAVE_ANI_CLI: FAKE_ANI_CLI, PULLWAVE_ANILIST_URL: 'http://127.0.0.1:9/graphql', PULLWAVE_COVER_FALLBACK_URL: 'http://127.0.0.1:9', FAKE_YTDLP_LOG: join(work, 'y.log') }
    });
    const page = await app.firstWindow();
    await page.waitForSelector('.logo');
    await expect(page.getByText('// BOOTING SYSTEMS…')).toBeHidden({ timeout: 60000 });
    return { app, page, work };
}

test.beforeAll(async () => {
    session = await launch();
});

test.afterAll(async () => {
    await session.app.close();
    rmSync(session.work, { recursive: true, force: true });
});

async function typeKonami(page: Page): Promise<void> {
    for (const key of KONAMI) {
        await page.keyboard.press(key);
    }
}

async function goHome(page: Page): Promise<void> {
    await page.locator('#side-nav > button').first().click();
    await page.locator('section.home').waitFor({ state: 'visible' });
    // The change of page is a view transition: until it ends, a press falls on the transition and not on the page.
    await page.waitForFunction(() => {
        return !document.documentElement.classList.contains('vt-active');
    });
}

test('the home screen shows the week in numbers, with a greeting', async () => {
    const { page } = session;
    await page.locator('section.home').waitFor({ state: 'visible', timeout: 60000 });
    const stats = page.getByRole('region', { name: 'Your week in numbers' });
    await expect(stats).toBeVisible();
    await expect(stats.locator('.stats__greeting')).toHaveText(/^(Good morning|Good afternoon|Good evening|Still up\? The wave never sleeps)$/);
    await expect(stats.locator('.stats__title')).toHaveText('LAST 7 DAYS');
    await expect(stats.locator('dt')).toHaveText(['Downloads', 'Episodes watched', 'Chapters read', 'Days in a row']);
    // The numbers count up from zero, so they are read once the count is over.
    await expect(stats.locator('[data-stat="downloads"] .count-up')).toHaveText('3', { timeout: 10000 });
    await expect(stats.locator('[data-stat="watched"] .count-up')).toHaveText('0');
    await expect(stats.locator('[data-stat="read"] .count-up')).toHaveText('0');
    await expect(stats.locator('[data-stat="streak"] .count-up')).toHaveText('3');
    // There are no achievements: only the greeting and the four numbers.
    await expect(stats.locator('ul')).toHaveCount(0);
});

test('the wave of the name lies flat when nothing goes on, dances after five clicks on the name and runs through every colour with the Konami code', async () => {
    const { page } = session;
    await goHome(page);
    const wave = page.locator('.brand__wave');
    await expect(wave).toHaveClass('brand__wave brand__wave--idle');
    expect(await wave.locator('.brand__bar').first().evaluate((bar) => { return getComputedStyle(bar).animationName; })).toBe('bp-wave-idle');
    await page.locator('.brand').click({ clickCount: 5, delay: 40 });
    await expect(wave).toHaveClass(/brand__wave--dance/);
    expect(await wave.locator('.brand__bar').first().evaluate((bar) => { return getComputedStyle(bar).animationName; })).toBe('bp-wave-dance');
    await expect(wave).not.toHaveClass(/brand__wave--dance/, { timeout: 5000 });
    await typeKonami(page);
    await expect(wave).toHaveClass(/brand__wave--rainbow/);
    expect(await wave.locator('.brand__bar').first().evaluate((bar) => { return getComputedStyle(bar).animationName; })).toBe('bp-wave-bar, bp-hue');
    // The code again puts it back.
    await typeKonami(page);
    await expect(wave).not.toHaveClass(/brand__wave--rainbow/);
});

test('the code shows a notice with a timer that drains, and throws confetti over the window', async () => {
    const { page } = session;
    await goHome(page);
    // The notice of the code of the test before this one has to be gone, or there are two.
    await expect(page.locator('.toast--info')).toHaveCount(0, { timeout: 10000 });
    await typeKonami(page);
    const toast = page.locator('.toast--info', { hasText: 'Rainbow wave unlocked!' });
    await expect(toast).toBeVisible();
    const timer = await toast.evaluate((element) => {
        const style = getComputedStyle(element, '::before');
        return { name: style.animationName, duration: style.animationDuration, fill: style.animationFillMode };
    });
    expect(timer).toEqual({ name: 'bp-toast-drain', duration: '5s', fill: 'forwards' });
    await page.waitForFunction(() => {
        return document.querySelector('body > canvas') !== null;
    });
    // Turn the mode off again for the next tests.
    await typeKonami(page);
    await expect(page.locator('.brand__wave')).not.toHaveClass(/brand__wave--rainbow/);
});

test('the aurora takes the colour of the section the user is in, and a pill slides to the active section', async () => {
    const { page } = session;
    await goHome(page);
    expect(await page.evaluate(() => { return document.documentElement.dataset.section; })).toBe('home');
    const nav = page.locator('#side-nav');
    await expect(nav.locator('.tab__pill')).toHaveCount(1);
    await expect(nav.locator('[data-section-id="home"] .tab__pill')).toHaveCount(1);
    await nav.locator('[data-section-id="downloads"]').click();
    await page.locator('section.downloads').waitFor({ state: 'visible' });
    expect(await page.evaluate(() => { return document.documentElement.dataset.section; })).toBe('downloads');
    await expect(nav.locator('.tab__pill')).toHaveCount(1);
    await expect(nav.locator('[data-section-id="downloads"] .tab__pill')).toHaveCount(1);
    await expect(nav.locator('[data-section-id="home"] .tab__pill')).toHaveCount(0);
    await expect(page.locator('section.downloads .tabs .tab--active .tab__pill')).toHaveCount(1);
    await nav.locator('[data-section-id="anime"]').click();
    await page.locator('section.anime').waitFor({ state: 'visible' });
    expect(await page.evaluate(() => { return document.documentElement.dataset.section; })).toBe('anime');
    // The light of the aurora is the one of the section (it is blended slowly, so wait for it to arrive). Both colours are worked out by the
    // browser the same way: a box painted with the light, and a box painted with what the section asks for.
    await expect
        .poll(async () => {
            return page.evaluate(() => {
                const paint = (background: string): string => {
                    const probe = document.createElement('span');
                    probe.style.background = background;
                    document.body.appendChild(probe);
                    const painted = getComputedStyle(probe).backgroundColor;
                    probe.remove();
                    return painted;
                };
                return paint('var(--bp-aurora-a)') === paint('color-mix(in srgb, var(--magenta) 28%, transparent)');
            });
        })
        .toBe(true);
});

test('a press sends a ripple from the point where the button was pressed, which ends by itself', async () => {
    const { page } = session;
    await goHome(page);
    const button = page.locator('.downloads-indicator__button');
    const box = (await button.boundingBox()) as { x: number; y: number; width: number; height: number };
    // A press during the change of page falls on the transition, not on the button: wait for it to end.
    await page.waitForFunction(() => {
        return !document.documentElement.classList.contains('vt-active');
    });
    await page.mouse.move(box.x + 10, box.y + 8);
    await page.mouse.down();
    await expect(button).toHaveClass(/is-rippling/);
    const point = await button.evaluate((element) => {
        return { x: (element as HTMLElement).style.getPropertyValue('--rx'), y: (element as HTMLElement).style.getPropertyValue('--ry') };
    });
    expect(point).toEqual({ x: '10px', y: '8px' });
    expect(await button.evaluate((element) => { return getComputedStyle(element).animationName; })).toBe('bp-ripple');
    // Let go away from the button, so it is not clicked.
    await page.mouse.move(box.x + 400, box.y + 400);
    await page.mouse.up();
    await expect(button).not.toHaveClass(/is-rippling/, { timeout: 3000 });
});

test('a halo slides to the control that has the focus when it is moved with the keys', async () => {
    const { page } = session;
    await goHome(page);
    const nav = page.locator('#side-nav');
    await nav.locator('[data-section-id="downloads"]').focus();
    await page.keyboard.press('ArrowDown');
    const anime = nav.locator('[data-section-id="anime"]');
    await expect(anime).toBeFocused();
    const halo = page.locator('.focus-halo');
    await expect(halo).toHaveAttribute('data-visible', 'true');
    await expect
        .poll(
            async () => {
                const target = (await anime.boundingBox()) as { x: number; y: number; width: number; height: number };
                const around = (await halo.boundingBox()) as { x: number; y: number; width: number; height: number };
                return [Math.round(target.x - around.x), Math.round(target.y - around.y), Math.round(around.width - target.width), Math.round(around.height - target.height)];
            },
            { timeout: 5000 }
        )
        .toEqual([6, 6, 12, 12]);
    expect(await halo.evaluate((element) => { return getComputedStyle(element).pointerEvents; })).toBe('none');
    // Blur it: the halo goes out of sight.
    await anime.evaluate((element) => { (element as HTMLElement).blur(); });
    await expect(halo).toHaveAttribute('data-visible', 'false');
});

test('the clock flips: every character of the time is its own element and they read as the time', async () => {
    const { page } = session;
    await goHome(page);
    const clock = page.locator('.topbar__clock');
    const characters = await clock.locator('.flip__char').evaluateAll((items) => {
        return items.map((item) => {
            return item.textContent;
        });
    });
    expect(characters.length).toBeGreaterThanOrEqual(5);
    await expect(clock).toHaveText(characters.join(''));
    await expect(clock).toHaveText(/^\d{2}:\d{2}\s?(AM|PM)?$/);
    expect(await clock.locator('.flip__char').first().evaluate((item) => { return getComputedStyle(item).animationName; })).toBe('bp-flip');
});

test('an empty screen of the anime section keeps the ring that breathes above its message, with no picture in its place', async () => {
    const { page } = session;
    await page.locator('#side-nav [data-section-id="anime"]').click();
    await page.locator('section.anime').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'LIBRARY', exact: true }).click();
    const empty = page.locator('.anime .empty').first();
    await expect(empty).toBeVisible();
    const ring = await empty.evaluate((element) => {
        const style = getComputedStyle(element, '::before');
        return { image: style.backgroundImage, width: style.width, height: style.height, border: style.borderTopWidth, radius: style.borderTopLeftRadius, animation: style.animationName };
    });
    expect(ring).toEqual({ image: 'none', width: '44px', height: '44px', border: '2px', radius: '50%', animation: 'bp-ping' });
});

test('the home screen has the greeting of the hour with no picture beside it, and the wave of the name is forty pixels tall', async () => {
    const { page } = session;
    await goHome(page);
    await expect(page.locator('.stats__greeting')).toBeVisible();
    await expect(page.locator('.stats__who img')).toHaveCount(0);
    const wave = await page.locator('.brand__wave').evaluate((element) => {
        const bar = element.querySelector('.brand__bar') as HTMLElement;
        return { height: element.getBoundingClientRect().height, bar: bar.getBoundingClientRect().width };
    });
    expect(wave).toEqual({ height: 40, bar: 6 });
});

test('the pointer: the arrow everywhere, the hand on what can be pressed, the forbidden sign on what cannot, and the text shape only in fields', async () => {
    const { page } = session;
    const cursors = async (selector: string): Promise<string> => {
        return page.locator(selector).first().evaluate((element) => { return getComputedStyle(element).cursor; });
    };
    expect(await page.evaluate(() => { return getComputedStyle(document.body).cursor; })).toBe('default');
    await goHome(page);
    expect(await cursors('.section-card')).toBe('default');
    expect(await cursors('.section-card .section-card__title span')).toBe('default');
    expect(await cursors('.stats__greeting')).toBe('default');
    expect(await cursors('#side-nav [data-section-id="downloads"]')).toBe('pointer');
    await page.locator('#side-nav [data-section-id="downloads"]').click();
    await page.locator('section.downloads').waitFor({ state: 'visible' });
    await page.getByLabel('Link 1', { exact: true }).fill('');
    expect(await cursors('input[aria-label="Link 1"]')).toBe('text');
    await page.locator('section.downloads .tab--icon').click();
    const toggle = page.locator('label.field--toggle').first();
    await expect(toggle).toBeVisible();
    expect(await toggle.evaluate((element) => { return getComputedStyle(element).cursor; })).toBe('pointer');
    expect(await toggle.locator('.field__hint, .field__label, span').first().evaluate((element) => { return getComputedStyle(element).cursor; })).toBe('pointer');
    // Nothing typed to search for: the button cannot be pressed, and says so with the forbidden sign (not the busy one).
    await page.locator('#side-nav [data-section-id="anime"]').click();
    await page.getByRole('navigation', { name: 'Anime' }).getByRole('button', { name: 'SEARCH', exact: true }).click();
    const search = page.locator('section.anime').getByRole('button', { name: 'SEARCH', exact: true }).last();
    await expect(search).toBeDisabled();
    expect(await search.evaluate((element) => { return getComputedStyle(element).cursor; })).toBe('not-allowed');
    await page.locator('#side-nav [data-section-id="settings"]').click();
    expect(await cursors('.settings__volume')).toBe('pointer');
});

test('the settings of the whole app have the volume of the sounds, kept in the window', async () => {
    const { page } = session;
    await page.locator('#side-nav [data-section-id="settings"]').click();
    const slider = page.getByLabel('Sound volume');
    await expect(slider).toBeVisible();
    await expect(slider).toHaveAttribute('min', '0');
    await expect(slider).toHaveAttribute('max', '1');
    await expect(slider).toHaveValue('1');
    await slider.evaluate((element) => {
        const input = element as HTMLInputElement;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, '0.5');
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(slider).toHaveValue('0.5');
    expect(await page.evaluate(() => { return window.localStorage.getItem('pullwave-ui-volume'); })).toBe('0.5');
    await expect(page.getByText('How loud the short sounds of the navigation and of the events are. The button of the top bar turns them on and off.')).toBeVisible();
});

test('a change of theme opens as a circle from where it was chosen, and ends with the new theme', async () => {
    const { page } = session;
    await page.locator('#side-nav [data-section-id="settings"]').click();
    const select = page.getByLabel('Theme');
    await expect(select).toBeVisible();
    await select.selectOption('dark');
    await page.waitForFunction(() => {
        return document.documentElement.classList.contains('vt-theme');
    });
    expect(await page.evaluate(() => { return document.documentElement.style.getPropertyValue('--reveal-x').endsWith('%'); })).toBe(true);
    await page.waitForFunction(() => {
        return !document.documentElement.classList.contains('vt-theme');
    });
    expect(await page.evaluate(() => { return document.documentElement.dataset.theme; })).toBe('dark');
    expect(await page.evaluate(() => { return document.documentElement.dataset.themeStyle; })).toBe('flat');
});
