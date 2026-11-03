import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import './display';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installedProgramsEnv } from './programs';

const ROOT = resolve(__dirname, '../..');
const ELECTRON_PATH = createRequire(__filename)('electron') as unknown as string;
const FAKE_ANI_CLI = resolve(__dirname, 'fixtures/fake-ani-cli.sh');
const FAKE_YTDLP = resolve(__dirname, 'fixtures/fake-yt-dlp.js');

// How long the change from one slide to the next lasts (SPOTLIGHT_SLIDE_MS) and how far the slides travel (--slide-from in bp-home.css).
const SLIDE_MS = 700;
const MIDDLE_OF_THE_CHANGE_MS = 350;
const SLIDE_TRAVEL_PX = 48;

type SlideDirection = 'forward' | 'back';

interface OverflowingBox {
    box: string;
    hidden: number;
}

interface BoxSnapshot {
    left: number;
    width: number;
    opacity: number;
    transform: string;
}

interface ChangeSnapshot {
    stageLeft: number;
    stageWidth: number;
    stageOverflowX: string;
    stageOverflowY: string;
    entering: BoxSnapshot;
    leaving: BoxSnapshot;
    enteringBoxShadow: string;
    animations: string[];
    overflowing: OverflowingBox[];
}

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
    const work = mkdtempSync(join(tmpdir(), 'pullwave-spotlight-'));
    const userData = join(work, 'user-data');
    mkdirSync(userData, { recursive: true });
    writeFileSync(
        join(userData, 'settings.json'),
        JSON.stringify({ language: 'en', checkUpdatesOnStart: false, verifyLiveEnd: false, ytdlpPath: FAKE_YTDLP, downloadDir: join(work, 'd'), animeDownloadDir: join(work, 'anime'), animeQuality: '720p' })
    );
    app = await electron.launch({
        executablePath: ELECTRON_PATH,
        args: [ROOT, '--no-sandbox', `--user-data-dir=${userData}`],
        env: { ...process.env, ...installedProgramsEnv(work), PULLWAVE_ANI_CLI: FAKE_ANI_CLI, PULLWAVE_ANILIST_URL: 'http://127.0.0.1:9/graphql', PULLWAVE_COVER_FALLBACK_URL: 'http://127.0.0.1:9', FAKE_YTDLP_LOG: join(work, 'y.log') }
    });
    page = await app.firstWindow();
    await page.locator('section.home').waitFor({ state: 'visible', timeout: 60000 });
});

test.afterAll(async () => {
    await app.close();
});

// The home of a fresh library has no highlights to rotate, so the carousel is drawn the way Spotlight.tsx draws it while it changes (the
// same classes, the same stylesheet): the slide that leaves under the one that comes, in the cell they share.
async function drawChange(direction: SlideDirection): Promise<void> {
    await page.evaluate((way) => {
        document.querySelector('[data-e2e="spotlight"]')?.remove();
        const slide = (motion: string, title: string): string => {
            return `<div class="spotlight__slide hero spotlight__slide--${motion} spotlight__slide--${way}">
                <div class="hero__art"></div>
                <div class="hero__body"><span class="hero__eyebrow">News</span><h2 class="hero__title">${title}</h2><p class="hero__meta">1 new episode</p></div>
            </div>`;
        };
        const section = document.createElement('section');
        section.className = 'spotlight';
        section.dataset.e2e = 'spotlight';
        section.innerHTML = `<div class="spotlight__stage">${slide('leaving', 'Leaving')}${slide('entering', 'Entering')}</div>`;
        document.querySelector('section.home')?.prepend(section);
    }, direction);
}

// Stops every animation of the carousel at this moment of the change, so what is measured does not depend on the speed of the machine.
async function freezeChangeAt(milliseconds: number): Promise<ChangeSnapshot> {
    return page.evaluate((at) => {
        const stage = document.querySelector<HTMLElement>('[data-e2e="spotlight"] .spotlight__stage');
        const entering = stage?.querySelector<HTMLElement>('.spotlight__slide--entering');
        const leaving = stage?.querySelector<HTMLElement>('.spotlight__slide--leaving');
        if (!stage || !entering || !leaving) {
            throw new Error('the carousel was not drawn');
        }
        const animations = stage.getAnimations({ subtree: true });
        animations.forEach((animation) => {
            animation.pause();
            animation.currentTime = at;
        });
        const snapshotOf = (box: HTMLElement): BoxSnapshot => {
            const rect = box.getBoundingClientRect();
            const style = getComputedStyle(box);
            return { left: rect.left, width: rect.width, opacity: Number(style.opacity), transform: style.transform };
        };
        const overflowing: OverflowingBox[] = [];
        // The stage itself still reports what it cuts (a clip keeps the size of its content); what matters is that nothing around it grows.
        for (let box: HTMLElement | null = stage.parentElement; box !== null; box = box.parentElement) {
            const hidden = box.scrollWidth - box.clientWidth;
            if (hidden > 0) {
                overflowing.push({ box: `${box.tagName.toLowerCase()}.${box.className}`, hidden });
            }
        }
        const stageRect = stage.getBoundingClientRect();
        const stageStyle = getComputedStyle(stage);
        return {
            stageLeft: stageRect.left,
            stageWidth: stageRect.width,
            stageOverflowX: stageStyle.overflowX,
            stageOverflowY: stageStyle.overflowY,
            entering: snapshotOf(entering),
            leaving: snapshotOf(leaving),
            enteringBoxShadow: getComputedStyle(entering).boxShadow,
            // The hero also has an animation of its own, the slow drift of the blurred cover: only the ones of the change count.
            animations: animations
                .map((animation) => {
                    return (animation as CSSAnimation).animationName;
                })
                .filter((name) => {
                    return name.startsWith('bp-slide-');
                }),
            overflowing
        };
    }, milliseconds);
}

(['forward', 'back'] as const).forEach((direction) => {
    const sign = direction === 'forward' ? 1 : -1;

    test.describe(`when the carousel changes slide ${direction}`, () => {
        test('shows no horizontal scroll in the middle of the change, nor in any box around the carousel', async () => {
            await drawChange(direction);
            const change = await freezeChangeAt(MIDDLE_OF_THE_CHANGE_MS);
            expect(change.animations.sort()).toEqual(['bp-slide-in', 'bp-slide-out']);
            expect(change.overflowing).toEqual([]);
        });

        test('keeps the slides moving: the new one comes from its side and the old one goes to the other, both fading', async () => {
            await drawChange(direction);
            const start = await freezeChangeAt(0);
            expect(start.entering.opacity).toBe(0);
            expect(start.entering.left - start.stageLeft).toBeCloseTo(sign * SLIDE_TRAVEL_PX, 0);
            expect(start.leaving.opacity).toBe(1);
            expect(start.leaving.left).toBeCloseTo(start.stageLeft, 0);

            const middle = await freezeChangeAt(MIDDLE_OF_THE_CHANGE_MS);
            const enteringOffset = (middle.entering.left - middle.stageLeft) * sign;
            const leavingOffset = (middle.leaving.left - middle.stageLeft) * sign;
            expect(enteringOffset).toBeGreaterThan(0);
            expect(enteringOffset).toBeLessThan(SLIDE_TRAVEL_PX);
            expect(leavingOffset).toBeLessThan(0);
            expect(leavingOffset).toBeGreaterThan(-SLIDE_TRAVEL_PX);
            expect(middle.entering.opacity).toBeGreaterThan(0);
            expect(middle.entering.opacity).toBeLessThan(1);
            expect(middle.leaving.opacity).toBeGreaterThan(0);
            expect(middle.leaving.opacity).toBeLessThan(1);
            expect(middle.entering.width).toBeCloseTo(middle.stageWidth, 0);
            expect(middle.leaving.width).toBeCloseTo(middle.stageWidth, 0);
        });

        test('ends with the new slide in place with no transform, the old one gone from sight, and still no horizontal scroll', async () => {
            await drawChange(direction);
            const end = await freezeChangeAt(SLIDE_MS);
            expect(end.entering.left).toBeCloseTo(end.stageLeft, 0);
            expect(end.entering.width).toBeCloseTo(end.stageWidth, 0);
            expect(end.entering.opacity).toBe(1);
            expect(end.entering.transform).toBe('none');
            expect(end.leaving.opacity).toBe(0);
            expect(end.overflowing).toEqual([]);
        });
    });
});

test.describe('the stage of the carousel', () => {
    test('cuts only what goes out to the sides, so the glow and the shadow of the slide above and below it stay', async () => {
        // A neon theme: its slides have a glow around them.
        await page.evaluate(() => {
            document.documentElement.dataset.theme = 'cyberpunk';
        });
        await drawChange('forward');
        const change = await freezeChangeAt(0);
        expect(change.stageOverflowX).toBe('clip');
        expect(change.stageOverflowY).toBe('visible');
        expect(change.enteringBoxShadow).not.toBe('none');
    });

    test('is no box that scrolls: it does not become a scroll container', async () => {
        await drawChange('forward');
        const scrollable = await page.evaluate(() => {
            const stage = document.querySelector<HTMLElement>('[data-e2e="spotlight"] .spotlight__stage');
            if (!stage) {
                throw new Error('the carousel was not drawn');
            }
            stage.scrollLeft = 20;
            return stage.scrollLeft;
        });
        expect(scrollable).toBe(0);
    });
});
