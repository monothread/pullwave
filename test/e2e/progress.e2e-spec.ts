import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import './display';
import { leaveHome } from './startScreen';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installedProgramsEnv } from './programs';

const ROOT = resolve(__dirname, '../..');
const ELECTRON_PATH = createRequire(__filename)('electron') as unknown as string;
const THEMES = ['cyberpunk', 'synthwave', 'terminal', 'neon-tokyo', 'acid-rain', 'amber-city', 'ultraviolet', 'pink-noir', 'cyber-gold', 'ice-neon', 'neon-tokyo-light', 'dark', 'tokyo-night', 'nord', 'dracula', 'gruvbox', 'amoled', 'high-contrast', 'light', 'sakura', 'sakura-dark'];

let workDir: string;
let app: ElectronApplication;
let page: Page;

async function launch(theme: string): Promise<void> {
    workDir = mkdtempSync(join(tmpdir(), 'pullwave-progress-e2e-'));
    const userData = join(workDir, 'user-data');
    mkdirSync(userData, { recursive: true });
    writeFileSync(join(userData, 'settings.json'), JSON.stringify({ language: 'en', theme, checkUpdatesOnStart: false }));
    app = await electron.launch({ executablePath: ELECTRON_PATH, args: [ROOT, '--no-sandbox', `--user-data-dir=${userData}`], env: { ...process.env, ...installedProgramsEnv(workDir) } as Record<string, string> });
    page = await app.firstWindow();
    await page.setViewportSize({ width: 1100, height: 780 });
    await page.waitForSelector('.logo');
    await expect(page.getByText('// BOOTING SYSTEMS…')).toBeHidden({ timeout: 60000 });
    await leaveHome(page);
}

test.afterEach(async () => {
    await app.close();
    rmSync(workDir, { recursive: true, force: true });
});

interface BarProbe {
    // The name of the animation of the bar, and whether the bar really moved between two looks at it.
    animation: string;
    playState: string;
    moves: boolean;
    // The drop shadows of the neon, whether they are in the colour of the state, and whether the bar has a box shadow left.
    layers: number;
    glow: boolean;
    boxShadow: string;
    overflow: string;
    // The track: its height and the animation that moves the pulse.
    trackHeight: string;
    trackAnimation: string;
    // The fill of the bar (its ::before): cut by the pulse over the thin band, the size of each, and whether the pulse moved between two looks at it.
    pulse: { masks: number; size: string; moves: boolean };
    // The same for the line that sweeps over the track (the ::after), when there is one, and whether it swells in step with the bar.
    sweep: { animation: string; moves: boolean; inStep: boolean } | null;
}

const BARS = ['plain', 'live', 'verify', 'waiting', 'processing', 'saving', 'merging', 'cloudflare', 'done', 'error'] as const;

// The train of pulses and the band, the train in a tile of 192px, and the train moving.
const PULSE = { masks: 2, size: '192px 100%, 100% 100%', moves: true };

interface Probes {
    plain: BarProbe;
    live: BarProbe;
    verify: BarProbe;
    waiting: BarProbe;
    processing: BarProbe;
    saving: BarProbe;
    merging: BarProbe;
    cloudflare: BarProbe;
    done: BarProbe;
    error: BarProbe;
    timeline: { layers: number; glow: boolean; sliderShadow: string; clip: string; buffered: { masks: number; height: number; trackInside: number } };
    volume: { layers: number; glow: boolean };
}

// Draws every kind of bar of the app in the page, with the classes the components give them, and reads how each one looks and moves.
async function probeBars(target: Page): Promise<Probes> {
    return target.evaluate(async () => {
        const HTML: Record<string, string> = {
            plain: '<div class="progress"><div class="progress__bar" style="width: 40%"></div></div>',
            live: '<div class="progress progress--live"><div class="progress__bar"></div></div>',
            verify: '<div class="progress progress--verify"><div class="progress__bar" style="animation-duration: 20s"></div></div>',
            waiting: '<div class="progress progress--waiting"><div class="progress__bar"></div></div>',
            processing: '<div class="progress progress--processing"><div class="progress__bar"></div></div>',
            saving: '<div class="progress progress--saving"><div class="progress__bar"></div></div>',
            merging: '<div class="progress progress--merging"><div class="progress__bar"></div></div>',
            cloudflare: '<div class="progress progress--cloudflare"><div class="progress__bar"></div></div>',
            done: '<div class="job job--done"><div class="progress"><div class="progress__bar" style="width: 100%"></div></div></div>',
            error: '<div class="job job--error"><div class="progress"><div class="progress__bar" style="width: 60%"></div></div></div>'
        };
        const colourOf = (variable: string): string => {
            const swatch = document.createElement('span');
            swatch.style.color = `var(${variable})`;
            document.body.append(swatch);
            const colour = getComputedStyle(swatch).color;
            swatch.remove();
            return colour;
        };
        const layersOf = (shadow: string): number => {
            let depth = 0;
            let layers = shadow === 'none' || shadow === '' ? 0 : 1;
            for (const character of shadow) {
                depth += character === '(' ? 1 : character === ')' ? -1 : 0;
                if (character === ',' && depth === 0) {
                    layers += 1;
                }
            }
            return layers;
        };
        const dropShadowsOf = (filter: string): number => {
            return (filter.match(/drop-shadow\(/g) ?? []).length;
        };
        // The layers of the mask (a picture or a gradient each), counted like the layers of a shadow.
        const masksOf = (element: Element, pseudo: string | null): number => {
            return layersOf(getComputedStyle(element, pseudo).maskImage);
        };
        const wait = (milliseconds: number): Promise<void> => {
            return new Promise((resolve) => {
                setTimeout(resolve, milliseconds);
            });
        };
        const position = (element: Element, pseudo: string | null, property: string): string => {
            return getComputedStyle(element, pseudo).getPropertyValue(property);
        };
        const host = document.createElement('div');
        host.style.cssText = 'position: fixed; left: 20px; top: 20px; width: 400px; z-index: 9999; display: flex; flex-direction: column; gap: 20px';
        document.body.append(host);
        const mounted: Record<string, { track: Element; bar: Element }> = {};
        Object.entries(HTML).forEach(([kind, html]) => {
            const wrapper = document.createElement('div');
            wrapper.innerHTML = html;
            host.append(wrapper);
            mounted[kind] = { track: wrapper.querySelector('.progress')!, bar: wrapper.querySelector('.progress__bar')! };
        });
        // The animations start at the first frame drawn after the bars are in the page, which may come late on a busy machine.
        await new Promise((resolve) => {
            requestAnimationFrame(() => {
                requestAnimationFrame(resolve);
            });
        });
        const MOVING: Record<string, string> = { plain: 'background-position-x', live: 'background-position-x', cloudflare: 'background-position-x' };
        const before: Record<string, string> = {};
        const sweepBefore: Record<string, string> = {};
        const pulseBefore: Record<string, string> = {};
        Object.entries(mounted).forEach(([kind, { track, bar }]) => {
            before[kind] = position(bar, null, MOVING[kind] ?? 'width');
            sweepBefore[kind] = position(track, '::after', 'background-position-x');
            pulseBefore[kind] = position(bar, '::before', 'mask-position');
        });
        await wait(450);
        const probes: Record<string, BarProbe> = {};
        Object.entries(mounted).forEach(([kind, { track, bar }]) => {
            const style = getComputedStyle(bar);
            const after = getComputedStyle(track, '::after');
            const hasSweep = after.content !== 'none' && after.content !== 'normal';
            const glowVariable = kind === 'live' || kind === 'error' ? '--red' : kind === 'done' || kind === 'merging' ? '--green' : kind === 'verify' ? '--yellow' : kind === 'waiting' || kind === 'processing' ? '--magenta' : '--cyan';
            const fill = getComputedStyle(bar, '::before');
            probes[kind] = {
                animation: style.animationName,
                playState: style.animationPlayState,
                moves: position(bar, null, MOVING[kind] ?? 'width') !== before[kind],
                layers: dropShadowsOf(style.filter),
                glow: style.filter.includes(colourOf(glowVariable)),
                boxShadow: style.boxShadow,
                overflow: getComputedStyle(track).overflow,
                trackHeight: getComputedStyle(track).height,
                trackAnimation: getComputedStyle(track).animationName,
                pulse: { masks: masksOf(bar, '::before'), size: fill.maskSize, moves: fill.maskPosition !== pulseBefore[kind] },
                sweep: hasSweep
                    ? {
                        animation: after.animationName,
                        moves: position(track, '::after', 'background-position-x') !== sweepBefore[kind],
                        inStep: masksOf(track, '::after') === 2 && after.maskPosition === fill.maskPosition
                    }
                    : null
            };
        });
        const range = (cssClass: string): { layers: number; glow: boolean } => {
            const input = document.createElement('input');
            input.type = 'range';
            input.className = cssClass;
            host.append(input);
            const shadow = getComputedStyle(input).boxShadow;
            return { layers: layersOf(shadow), glow: shadow.includes(colourOf('--cyan')) };
        };
        // The timeline of the player is the bar of a download with a transparent slider over it: the glow is the one of the bar.
        const timelineBox = document.createElement('div');
        timelineBox.className = 'player__timeline';
        timelineBox.innerHTML = '<div class="progress"><div class="player__buffered" style="width: 70%"></div><div class="progress__bar" style="width: 40%"></div></div><input type="range" class="player__range player__seek">';
        host.append(timelineBox);
        const timelineBar = timelineBox.querySelector('.progress__bar')!;
        const timelineStyle = getComputedStyle(timelineBar);
        const buffered = timelineBox.querySelector('.player__buffered')!;
        const timeline = {
            layers: dropShadowsOf(timelineStyle.filter),
            glow: timelineStyle.filter.includes(colourOf('--cyan')),
            sliderShadow: getComputedStyle(timelineBox.querySelector('.player__seek')!).boxShadow,
            clip: timelineStyle.clipPath,
            buffered: { masks: masksOf(buffered, null), height: buffered.getBoundingClientRect().height, trackInside: timelineBox.querySelector('.progress')!.clientHeight }
        };
        const volume = range('player__range player__volume');
        host.remove();
        return { ...probes, timeline, volume } as unknown as Probes;
    });
}

for (const theme of THEMES) {
    test.describe(`progress bars (${theme} theme)`, () => {
        test.beforeEach(async () => {
            await launch(theme);
        });

        test('every bar glows like neon, in the colour of its state, and the glow is not clipped by the track', async () => {
            const probes = await probeBars(page);
            BARS.forEach((kind) => {
                // A bright rim, a close halo and wider soft ones: four drop shadows that follow the wave, in the colour of the state, and no box shadow.
                expect(probes[kind].layers, `${kind} layers`).toBe(4);
                expect(probes[kind].glow, `${kind} glow colour`).toBe(true);
                expect(probes[kind].boxShadow, `${kind} box shadow`).toBe('none');
                expect(probes[kind].overflow, `${kind} track`).toBe('visible');
            });
            expect(probes.timeline).toEqual({ layers: 4, glow: true, sliderShadow: 'none', clip: 'inset(-40px -40px -40px 0px)', buffered: { masks: 0, height: 12, trackInside: 12 } });
            expect(probes.volume.layers).toBe(3);
            expect(probes.volume.glow).toBe(true);
        });

        test('the neon moves inside the bars that have an end that is not known, and the lines sweep over the ones that work', async () => {
            const probes = await probeBars(page);
            expect(probes.plain).toMatchObject({ animation: 'bar-wave-flow', playState: 'running', moves: true, sweep: null });
            expect(probes.live).toMatchObject({ animation: 'live-stripes', playState: 'running', moves: true, sweep: null });
            expect(probes.cloudflare).toMatchObject({ animation: 'bar-wave-flow', playState: 'running', moves: true });
            expect(probes.cloudflare.sweep).toEqual({ animation: 'scan-sweep', moves: true, inStep: true });
            expect(probes.verify).toMatchObject({ animation: 'verify-drain', playState: 'running' });
            expect(probes.verify.sweep).toEqual({ animation: 'scan-sweep', moves: true, inStep: true });
            expect(probes.waiting.sweep).toEqual({ animation: 'scan-sweep', moves: true, inStep: true });
            expect(probes.processing.sweep).toEqual({ animation: 'scan-sweep', moves: true, inStep: true });
            expect(probes.saving.sweep).toEqual({ animation: 'scan-sweep', moves: true, inStep: true });
            expect(probes.merging.sweep).toEqual({ animation: 'scan-sweep', moves: true, inStep: true });
        });

        test('a train of pulses runs along every bar, over its thin band, in a track as tall as the pulses', async () => {
            const probes = await probeBars(page);
            BARS.forEach((kind) => {
                expect(probes[kind].trackHeight, `${kind} track height`).toBe('14px');
                expect(probes[kind].trackAnimation, `${kind} track animation`).toBe(kind === 'done' ? 'bp-bar-flash, bar-pulse, bar-pulse-count' : 'bar-pulse, bar-pulse-count');
                expect(probes[kind].pulse, `${kind} pulse`).toEqual(PULSE);
            });
        });

        test('the number of pulses of a bar changes from one round to the next', async () => {
            const trains = await page.evaluate(async () => {
                const wrapper = document.createElement('div');
                wrapper.style.cssText = 'position: fixed; left: 20px; top: 20px; width: 400px; z-index: 9999';
                wrapper.innerHTML = '<div class="progress"><div class="progress__bar" style="width: 60%"></div></div>';
                document.body.append(wrapper);
                const bar = wrapper.querySelector('.progress__bar')!;
                // The number of swells of a train is the number of its slots that rise from the band (a point at the middle of each).
                const swellsOf = (): number => {
                    const image = getComputedStyle(bar, '::before').maskImage;
                    return [50, 100, 150, 200, 250, 300, 350].filter((x) => {
                        const point = new RegExp(`L${String(x)} ([\\d.]+)L`).exec(image);
                        return point !== null && Number(point[1]) < 30;
                    }).length;
                };
                const wait = (milliseconds: number): Promise<void> => {
                    return new Promise((resolve) => {
                        setTimeout(resolve, milliseconds);
                    });
                };
                // The rounds take 1.6s from the first frame drawn: the number is read in the middle of the first round and of the second.
                await new Promise((resolve) => {
                    requestAnimationFrame(() => {
                        requestAnimationFrame(resolve);
                    });
                });
                await wait(800);
                const first = swellsOf();
                await wait(1600);
                const second = swellsOf();
                wrapper.remove();
                return { first, second };
            });
            expect([1, 2, 3, 4]).toContain(trains.first);
            expect([1, 2, 3, 4]).toContain(trains.second);
            expect(trains.second).not.toBe(trains.first);
        });

        test('the bar of a finished download or of a failed one stands still', async () => {
            const probes = await probeBars(page);
            expect(probes.done).toMatchObject({ animation: 'none', moves: false });
            expect(probes.error).toMatchObject({ animation: 'none', moves: false });
        });

        test('when the system asks for less motion every wave, stripe and sweep keeps moving: the animations are always on (D-130)', async () => {
            await page.emulateMedia({ reducedMotion: 'reduce' });
            const probes = await probeBars(page);
            expect(probes.plain).toMatchObject({ animation: 'bar-wave-flow', moves: true });
            expect(probes.cloudflare).toMatchObject({ animation: 'bar-wave-flow', moves: true });
            expect(probes.live).toMatchObject({ animation: 'live-stripes', moves: true });
            expect(probes.verify.sweep).toEqual({ animation: 'scan-sweep', moves: true, inStep: true });
            expect(probes.waiting.sweep).toEqual({ animation: 'scan-sweep', moves: true, inStep: true });
            expect(probes.processing.sweep).toEqual({ animation: 'scan-sweep', moves: true, inStep: true });
            expect(probes.saving.sweep).toEqual({ animation: 'scan-sweep', moves: true, inStep: true });
            expect(probes.merging.sweep).toEqual({ animation: 'scan-sweep', moves: true, inStep: true });
            expect(probes.plain.glow).toBe(true);
            expect(probes.plain.layers).toBe(4);
            expect(probes.plain.pulse).toEqual(PULSE);
        });
    });
}
