import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { keyframesOf, readStylesheet, splitTopLevel, styleOf } from '../../helpers/cssRules';

const COMPONENTS_DIRECTORY = resolve(__dirname, '../../../src/renderer/components');
const cyberpunk = readStylesheet('cyberpunk.css');
const themes = readStylesheet('themes.css');
const responsive = readStylesheet('responsive.css');
const consoleLayer = readStylesheet('console.css');

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const PLAIN_BAR = ".progress:not([class*='progress--']) .progress__bar";
const SWEEPS = ['.progress--verify::after', '.progress--waiting::after', '.progress--processing::after', '.progress--saving::after', '.progress--merging::after', '.progress--cloudflare::after'];
const PULSING_LAYERS = ['.progress .progress__bar::before', ...SWEEPS];
const BAND = 'linear-gradient(transparent 30%, #000 30% 70%, transparent 70%)';

// Every place of the app that draws a progress bar (a `.progress` with a `.progress__bar`, or a range of the player), by the file that
// draws it: when a bar is added to a file that is not here, this list has to say so, and the CSS below has to cover it.
const FILES_WITH_BARS: Record<string, string[]> = {
    'AnimeJobs.tsx': ['progress'],
    'AnimeSubtitleJobs.tsx': ['progress'],
    'AutoNextPanel.tsx': ['progress'],
    'CutPanel.tsx': ['progress', 'progress--waiting'],
    'GenerateProgressPanel.tsx': ['progress'],
    'JobProgress.tsx': ['progress', 'progress--verify', 'progress--processing', 'progress--saving', 'progress--merging', 'progress--waiting', 'progress--live'],
    'MangaCloudflareNotice.tsx': ['progress', 'progress--cloudflare'],
    'MangaHelperNotice.tsx': ['progress'],
    'MangaHelperSettings.tsx': ['progress'],
    'MangaJobs.tsx': ['progress'],
    'MangaReader.tsx': ['progress'],
    'MangaSetup.tsx': ['progress'],
    'ProgramsSetup.tsx': ['progress'],
    'ProgramsStatusBlock.tsx': ['progress'],
    'ReaderChapterZone.tsx': ['progress'],
    'VideoControls.tsx': ['player__range', 'player__seek', 'player__volume']
};

function componentsWithBars(): string[] {
    return readdirSync(COMPONENTS_DIRECTORY)
        .filter((file) => {
            return /\.tsx$/.test(file) && /progress__bar|player__range/.test(readFileSync(resolve(COMPONENTS_DIRECTORY, file), 'utf-8'));
        })
        .sort();
}

function classesUsedBy(file: string): string[] {
    const source = readFileSync(resolve(COMPONENTS_DIRECTORY, file), 'utf-8');
    return [...new Set([...source.matchAll(/\b(progress--[a-z]+|player__range|player__seek|player__volume)\b/g)].map((match) => { return match[1]!; }))];
}

function layersOf(shadow: string | undefined): string[] {
    return splitTopLevel(shadow ?? '', ',');
}

describe('the map of the progress bars of the app', () => {
    it('lists every file that draws a progress bar, and the kinds of bar it draws', () => {
        expect(componentsWithBars()).toEqual(Object.keys(FILES_WITH_BARS).sort());
    });

    it.each(Object.entries(FILES_WITH_BARS))('%s draws only the kinds of bar the CSS knows', (file, kinds) => {
        const modifiers = classesUsedBy(file).filter((name) => {
            return name.startsWith('progress--');
        });
        expect(modifiers.sort()).toEqual(kinds.filter((kind) => { return kind.startsWith('progress--'); }).sort());
    });

    it('has a rule in the CSS for every kind of bar a file draws', () => {
        const modifiers = [...new Set(Object.values(FILES_WITH_BARS).flat().filter((kind) => { return kind.startsWith('progress--'); }))];
        modifiers.forEach((modifier) => {
            expect(cyberpunk.rules.some((rule) => { return rule.selector.includes(`.${modifier}`); }), modifier).toBe(true);
        });
    });

    it('draws every bar with the track and the bar inside it, with the values for a screen reader', () => {
        Object.keys(FILES_WITH_BARS)
            .filter((file) => { return file !== 'VideoControls.tsx'; })
            .forEach((file) => {
                const source = readFileSync(resolve(COMPONENTS_DIRECTORY, file), 'utf-8');
                expect(source, file).toContain('role="progressbar"');
                expect(source, file).toContain('progress__bar');
                // Every bar has a name for a screen reader; the ones that know how far they are also say it.
                expect(source, file).toMatch(/aria-label=/);
            });
    });
});

describe('the neon of every bar', () => {
    const track = styleOf(cyberpunk, '.progress');
    const bar = styleOf(cyberpunk, '.progress .progress__bar');

    it('lets the glow out of the track on every side, and no kind of bar clips it again', () => {
        expect(track['overflow']).toBe('visible');
        const tracks = new Set(
            cyberpunk.rules
                .filter((rule) => { return rule.media === null && /^\.progress(--[a-z]+)?$/.test(rule.selector); })
                .map((rule) => { return rule.selector; })
        );
        expect([...tracks].sort()).toEqual(['.progress', '.progress--cloudflare', '.progress--merging', '.progress--processing', '.progress--saving', '.progress--verify', '.progress--waiting']);
        tracks.forEach((selector) => {
            expect(styleOf(cyberpunk, selector)['overflow'], selector).not.toBe('hidden');
        });
    });

    it('gives the bar a bright rim, a close halo and wider soft ones, in the colour of its state, as drop shadows that follow the shape of the wave', () => {
        expect(bar['--bar-glow']).toBe('var(--cyan)');
        expect(bar['--bar-neon']).toBe(
            'drop-shadow(0 0 1px rgba(255, 255, 255, 0.85)) drop-shadow(0 0 3px var(--bar-glow)) drop-shadow(0 0 7px var(--bar-glow)) drop-shadow(0 0 14px color-mix(in srgb, var(--bar-glow) 65%, transparent))'
        );
        expect(bar['filter']).toBe('var(--bar-neon)');
        // A box shadow would glow around the box of the bar, not around the wave.
        expect(bar['box-shadow']).toBe('none');
    });

    it('wins over the box shadows the kinds of bar had: the neon rule comes after all of them and is as specific as they are', () => {
        const order = cyberpunk.rules.map((rule) => {
            return rule.selector;
        });
        const neon = order.indexOf('.progress .progress__bar');
        ['live', 'verify', 'waiting', 'processing', 'saving', 'merging'].forEach((kind) => {
            const selector = `.progress--${kind} .progress__bar`;
            expect(styleOf(cyberpunk, selector)['box-shadow'], kind).toMatch(/^0 0 10px var\(--[a-z]+\)$/);
            expect(order.indexOf(selector), kind).toBeLessThan(neon);
        });
    });

    it.each([
        ['.job--done .progress__bar', 'var(--green)'],
        ['.progress--merging .progress__bar', 'var(--green)'],
        ['.job--error .progress__bar', 'var(--red)'],
        ['.progress--live .progress__bar', 'var(--red)'],
        ['.progress--verify .progress__bar', 'var(--yellow)'],
        ['.progress--waiting .progress__bar', 'var(--magenta)'],
        ['.progress--processing .progress__bar', 'var(--magenta)']
    ])('makes the glow of %s %s', (selector, colour) => {
        expect(styleOf(cyberpunk, selector)['--bar-glow']).toBe(colour);
    });

    it('does not turn the glow off in any theme, screen size or in the console layer', () => {
        [themes, responsive, consoleLayer].forEach((sheet) => {
            sheet.rules
                .filter((rule) => { return /\.progress|\.player__range|\.player__seek/.test(rule.selector); })
                .forEach((rule) => {
                    expect(rule.declarations['box-shadow'], rule.selector).not.toBe('none');
                    expect(rule.declarations['animation'], rule.selector).not.toBe('none');
                    expect(rule.declarations['filter'], rule.selector).not.toBe('none');
                });
        });
    });
});

describe('the pulses that run along every bar', () => {
    const track = styleOf(cyberpunk, '.progress');
    const fill = styleOf(cyberpunk, '.progress .progress__bar::before');
    const bar = styleOf(cyberpunk, '.progress .progress__bar');
    const COUNTS = [1, 2, 3, 4];
    const ROUNDS = [2, 4, 1, 3, 2, 1, 4, 3, 1, 2, 4, 3];
    // The points of the outline of a train: the top edge from the left to the right, then the bottom edge back.
    const outlineOf = (count: number): Array<[number, number]> => {
        return [...(track[`--bar-pulses-${String(count)}`] ?? '').matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((match) => {
            return [Number(match[1]), Number(match[2])];
        });
    };
    const topEdgeOf = (count: number): Array<[number, number]> => {
        return outlineOf(count).slice(0, 81);
    };
    // The middles of the swells: the points of the top edge higher than the band and than the points around them.
    const crestsOf = (count: number): Array<[number, number]> => {
        const top = topEdgeOf(count);
        return top.filter(([, y], index) => {
            return y < 30 && y < (top[index - 1]?.[1] ?? 30) && y <= (top[index + 1]?.[1] ?? 30);
        });
    };

    it('makes the track as tall as the pulses, with its line around it, and gives it the band, the trains and the movements of the pulses', () => {
        expect(track).toEqual({
            height: '14px',
            background: 'var(--input-bg)',
            border: '1px solid var(--line)',
            overflow: 'visible',
            '--bar-band': BAND,
            '--bar-pulses-1': track['--bar-pulses-1'],
            '--bar-pulses-2': track['--bar-pulses-2'],
            '--bar-pulses-3': track['--bar-pulses-3'],
            '--bar-pulses-4': track['--bar-pulses-4'],
            '--bar-pulses': 'var(--bar-pulses-1)',
            animation: 'bar-pulse 1.6s linear infinite, bar-pulse-count 19.2s linear infinite'
        });
        expect(styleOf(cyberpunk, '.progress--cloudflare')).toEqual({ position: 'relative' });
    });

    it('lets the bar paint nothing itself, over the fill of every kind of bar, and draws the fill in its ::before with the background of the bar', () => {
        expect(bar['background-clip']).toBe('text !important');
        expect(bar['position']).toBe('relative');
        expect(fill).toEqual({
            content: "''",
            position: 'absolute',
            inset: '0',
            background: 'inherit',
            'background-clip': 'border-box',
            'mask-image': 'var(--bar-pulses), var(--bar-band)',
            'mask-size': '192px 100%, 100% 100%',
            'mask-repeat': 'no-repeat, repeat-x',
            'mask-position': 'inherit'
        });
    });

    it.each(PULSING_LAYERS)('cuts %s in the shape of the train of the round over the band, the train first so it takes the position the track moves', (selector) => {
        const rule = cyberpunk.rules.find((candidate) => {
            return candidate.selector === selector && candidate.declarations['mask-image'] !== undefined;
        });
        expect(rule?.media).toBeNull();
        expect(rule?.declarations).toEqual({
            'mask-image': 'var(--bar-pulses), var(--bar-band)',
            'mask-size': '192px 100%, 100% 100%',
            'mask-repeat': 'no-repeat, repeat-x',
            'mask-position': 'inherit'
        });
    });

    it.each(COUNTS)('draws a train of %i swells as a picture of four slots, stretched over its tile', (count) => {
        expect(track[`--bar-pulses-${String(count)}`]).toMatch(/^url\("data:image\/svg\+xml,%3Csvg xmlns='http:\/\/www\.w3\.org\/2000\/svg' viewBox='0 0 400 100' preserveAspectRatio='none'%3E%3Cpath d='M0 30L.+Z'\/%3E%3C\/svg%3E"\)$/);
        expect(outlineOf(count)).toHaveLength(162);
    });

    it.each(COUNTS)('swells %i times, a slot apart, in the middle of the tile', (count) => {
        const middles = Array.from({ length: count }, (_value, index) => {
            return 200 + (index - (count - 1) / 2) * 100;
        });
        expect(crestsOf(count)).toEqual(middles.map((x) => { return [x, 10]; }));
    });

    it.each(COUNTS)('flattens the %i swells: they reach four fifths of the track, from a band of two fifths, and go into the band with no step', (count) => {
        const top = topEdgeOf(count);
        expect(top[0]).toEqual([0, 30]);
        expect(top[80]).toEqual([400, 30]);
        top.forEach(([, y]) => {
            expect(y).toBeGreaterThanOrEqual(10);
            expect(y).toBeLessThanOrEqual(30);
        });
    });

    it.each(COUNTS)('swells the %i swells the same up and down: each point of the bottom edge is the mirror of the one of the top edge', (count) => {
        const top = topEdgeOf(count);
        const bottom = outlineOf(count).slice(81).reverse();
        top.forEach(([x, y], index) => {
            expect(bottom[index]).toEqual([x, Number((100 - y).toFixed(1))]);
        });
    });

    it('runs the train from out of the start of the bar to past its head, a tile away at both ends, whatever the width of the bar', () => {
        expect(keyframesOf(cyberpunk, 'bar-pulse')?.body.replace(/\s+/g, ' ').trim()).toBe('from { mask-position: calc(0% - 192px) 0; } to { mask-position: calc(100% + 192px) 0; }');
        expect(keyframesOf(cyberpunk, 'bar-swell')).toBeUndefined();
    });

    it('picks the number of swells of each round in an order that does not show, every number as often, and changes it only between two rounds', () => {
        const frames = [...(keyframesOf(cyberpunk, 'bar-pulse-count')?.body ?? '').matchAll(/([\d.]+)%, ([\d.]+)% \{ --bar-pulses: var\(--bar-pulses-(\d)\); \}/g)].map((match) => {
            return { from: Number(match[1]), to: Number(match[2]), count: Number(match[3]) };
        });
        expect(frames.map((frame) => { return frame.count; })).toEqual(ROUNDS);
        frames.forEach((frame, index) => {
            expect(frame.from).toBeCloseTo((100 * index) / ROUNDS.length, 1);
            expect(frame.to).toBeCloseTo((100 * (index + 1)) / ROUNDS.length - 0.01, 1);
        });
        COUNTS.forEach((count) => {
            expect(ROUNDS.filter((round) => { return round === count; })).toHaveLength(3);
        });
        ROUNDS.forEach((round, index) => {
            expect(round).not.toBe(ROUNDS[(index + 1) % ROUNDS.length]);
        });
        // Twelve rounds of the pulse in one loop of the number, so a round and its number start together.
        expect(1.6 * ROUNDS.length).toBeCloseTo(19.2, 5);
    });

    it('passes the position and the number of swells from the track down to the bar, so the fill and the line that sweeps over it pulse in step', () => {
        expect(bar['mask-position']).toBe('inherit');
        expect(bar['mask-image']).toBeUndefined();
        expect(bar['--bar-pulses']).toBeUndefined();
    });

    it('leaves what the player has loaded as tall as the track: neither the band nor the pulses cut it', () => {
        expect(styleOf(cyberpunk, '.player__buffered')).toEqual({});
        expect(cyberpunk.rules.filter((rule) => { return rule.selector.includes('.player__buffered'); })).toEqual([]);
    });
});

describe('the movement of the neon inside each bar', () => {
    const MOVEMENTS: Array<[string, string, string, string]> = [
        ['a download that grows (a wave that flows)', PLAIN_BAR, 'bar-wave-flow', '1.4s linear infinite'],
        ['a live recording (stripes that run)', '.progress--live .progress__bar', 'live-stripes', '0.9s linear infinite'],
        ['the check of the end of a live stream (a bar that drains)', '.progress--verify .progress__bar', 'verify-drain', 'linear forwards'],
        ['the check of Cloudflare (a wave that flows)', '.progress--cloudflare .progress__bar', 'bar-wave-flow', '1s linear infinite']
    ];

    it.each(MOVEMENTS)('moves %s', (_name, selector, keyframes, timing) => {
        expect(styleOf(cyberpunk, selector)['animation']).toBe(`${keyframes} ${timing}`.trim());
        expect(keyframesOf(cyberpunk, keyframes), keyframes).toBeDefined();
    });

    it('makes the wave of a download out of the two colours of the theme, the same at both ends so the flow has no seam', () => {
        const wave = styleOf(cyberpunk, PLAIN_BAR);
        expect(wave['background']).toBe('linear-gradient(90deg, var(--cyan), var(--magenta) 35%, color-mix(in srgb, var(--magenta) 80%, white) 50%, var(--magenta) 65%, var(--cyan))');
        expect(wave['background-size']).toBe('160px 100%');
        expect(keyframesOf(cyberpunk, 'bar-wave-flow')?.body.replace(/\s+/g, ' ').trim()).toBe('from { background-position: 0 0; } to { background-position: 160px 0; }');
    });

    it('makes the wave of the check of Cloudflare out of the same wave', () => {
        const wave = styleOf(cyberpunk, '.progress--cloudflare .progress__bar');
        expect(wave['background']).toBe(styleOf(cyberpunk, PLAIN_BAR)['background']);
        expect(wave['background-size']).toBe('160px 100%');
        expect(wave['width']).toBe('100%');
    });

    const WHITE_LINE = 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.55), transparent)';
    it.each([
        ['.progress--verify::after', `${WHITE_LINE} 0 0 / 28% 100% no-repeat`, 'scan-sweep 1s linear infinite'],
        ['.progress--waiting::after', 'linear-gradient(90deg, transparent, var(--magenta), transparent) 0 0 / 22% 100% no-repeat', 'scan-sweep 1.8s ease-in-out infinite alternate'],
        ['.progress--processing::after', `${WHITE_LINE} 0 0 / 28% 100% no-repeat`, 'scan-sweep 1s linear infinite'],
        ['.progress--saving::after', `${WHITE_LINE} 0 0 / 28% 100% no-repeat`, 'scan-sweep 0.9s linear infinite'],
        ['.progress--merging::after', `${WHITE_LINE} 0 0 / 28% 100% no-repeat`, 'scan-sweep 1.1s linear infinite'],
        ['.progress--cloudflare::after', 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.75), transparent) 0 0 / 30% 100% no-repeat', 'scan-sweep 1.4s ease-in-out infinite alternate']
    ])('sweeps a bright line over the bar with %s, as a band that slides inside a box as wide as the track', (selector, background, animation) => {
        const sweep = styleOf(cyberpunk, selector);
        expect(sweep).toMatchObject({ content: "''", position: 'absolute', inset: '0', background, animation });
        // The box does not move (the wave that cuts it is in the place of the one of the bar): the band moves inside it.
        expect(sweep['width']).toBeUndefined();
        expect(sweep['left']).toBeUndefined();
    });

    it('slides every band from the start of the track to its end, so it stays inside the track and nothing has to clip the glow', () => {
        expect(keyframesOf(cyberpunk, 'scan-sweep')?.body.replace(/\s+/g, ' ').trim()).toBe('from { background-position: 0 0; } to { background-position: 100% 0; }');
        expect(keyframesOf(cyberpunk, 'cloudflare-sweep')).toBeUndefined();
        expect(styleOf(cyberpunk, '.progress--cloudflare')['overflow']).toBeUndefined();
    });

    it('gives the waiting, processing, saving and merging bars a stripe pattern and the glow of their colour, as bright as the others', () => {
        ['waiting', 'processing', 'saving', 'merging'].forEach((kind) => {
            const style = styleOf(cyberpunk, `.progress--${kind} .progress__bar`);
            expect(style['width'], kind).toBe('100%');
            expect(style['background'], kind).toMatch(/^repeating-linear-gradient\(90deg, var\(--(magenta|cyan|green)\) 0 /);
            expect(style['box-shadow'], kind).toMatch(/^0 0 10px var\(--(magenta|cyan|green)\)$/);
        });
        const brightness = styleOf(cyberpunk, '.progress--waiting .progress__bar');
        expect(brightness['opacity']).toBe('0.9');
    });

    it('stops the wave of a finished or failed download, and gives it the colour of the state', () => {
        expect(styleOf(cyberpunk, '.job--done .progress .progress__bar')).toEqual({ background: 'var(--green)', animation: 'none' });
        expect(styleOf(cyberpunk, '.job--error .progress .progress__bar')).toEqual({ background: 'var(--red)', animation: 'none' });
    });

    it('wins over the wave of a download: the rules are as specific as it is, and come after it', () => {
        const order = cyberpunk.rules.map((rule) => {
            return rule.selector;
        });
        const wave = order.indexOf(PLAIN_BAR);
        expect(wave).toBeGreaterThan(-1);
        expect(order.indexOf('.job--done .progress .progress__bar')).toBeGreaterThan(wave);
        expect(order.indexOf('.job--error .progress .progress__bar')).toBeGreaterThan(wave);
        // .progress:not([class*='progress--']) .progress__bar: a class, an attribute and a class.
        expect(PLAIN_BAR.match(/\.[a-z_-]+|\[[^\]]+\]/g)).toHaveLength(3);
    });

    it('lets a bar grow smoothly, except the ones that are moved by the screen at each step', () => {
        expect(styleOf(cyberpunk, '.progress__bar')['transition']).toBe('width 0.25s ease');
        expect(styleOf(cyberpunk, '.progress__bar--smooth')['transition']).toBe('none');
        expect(styleOf(cyberpunk, '.progress--verify .progress__bar')['transition']).toBe('none');
    });
});

describe('the bars whatever the system says about motion', () => {
    it('keep every sweep, stripe, wave and spinner moving: no style sheet has a rule for less motion (D-130)', () => {
        [cyberpunk, themes, responsive, consoleLayer].forEach((sheet) => {
            expect(sheet.text).not.toContain('prefers-reduced-motion');
        });
        expect(styleOf(cyberpunk, '.progress--live .progress__bar')['animation']).toBe('live-stripes 0.9s linear infinite');
        expect(styleOf(cyberpunk, '.player__spinner')['animation']).toBe('player-spin 0.9s linear infinite');
    });
});

describe('the timeline and the volume of the player', () => {
    it('glow like neon, in every theme', () => {
        const layers = layersOf(styleOf(cyberpunk, '.player__range')['box-shadow']);
        expect(layers).toEqual(['0 0 3px var(--cyan)', '0 0 10px var(--cyan)', '0 0 20px color-mix(in srgb, var(--cyan) 60%, transparent)']);
    });

    it('has no rule of its own for the look of the timeline: its frame, glow and wave are the ones of the bar of a download', () => {
        const rules = cyberpunk.rules.filter((rule) => { return rule.selector.includes('.player__seek') || rule.selector.includes('.player__timeline') || rule.selector.includes('.player__wave'); });
        expect(rules.map((rule) => { return rule.selector; })).toEqual(['.player__timeline', '.player__timeline .progress__bar', '.player__timeline .player__seek']);
        expect(cyberpunk.text).not.toContain('--wave-phase');
        expect(cyberpunk.text).not.toContain('player-wave-phase');
        expect(cyberpunk.text).not.toContain('player-wave-glow-filter');
    });

    it('lays the box of the timeline out as the bar that grows and fills the row, with the slider over it', () => {
        expect(styleOf(cyberpunk, '.player__timeline')).toEqual({ position: 'relative', flex: '1', 'min-width': '80px' });
    });

    it('lets the watched part follow the video at every frame, with no transition of its width behind it', () => {
        expect(styleOf(cyberpunk, '.player__timeline .progress__bar')).toEqual({ transition: 'none' });
    });

    it('makes the slider transparent, without frame or glow, as big as the box, so only its thumb is seen over the bar', () => {
        expect(styleOf(cyberpunk, '.player__timeline .player__seek')).toEqual({
            position: 'absolute',
            inset: '0',
            width: '100%',
            height: '100%',
            background: 'transparent',
            border: '0',
            'box-shadow': 'none'
        });
    });

    it('lets the bar of a download, which the timeline uses, flow its wave and glow in every state of the video', () => {
        const wave = styleOf(cyberpunk, ".progress:not([class*='progress--']) .progress__bar");
        expect(wave['animation']).toBe('bar-wave-flow 1.4s linear infinite');
        expect(wave['background-size']).toBe('160px 100%');
        expect(styleOf(cyberpunk, '.progress')).toMatchObject({ height: '14px', border: '1px solid var(--line)', overflow: 'visible', animation: 'bar-pulse 1.6s linear infinite, bar-pulse-count 19.2s linear infinite' });
        expect(cyberpunk.rules.some((rule) => { return rule.media?.includes(REDUCED_MOTION) === true && rule.selector.includes('.player__seek'); })).toBe(false);
    });

    it('does not carry a rule of the timeline in fullscreen: the bar is the one of a download there too', () => {
        expect(cyberpunk.rules.some((rule) => { return rule.selector.includes(':fullscreen') && rule.selector.includes('.player__seek'); })).toBe(false);
        expect(cyberpunk.rules.some((rule) => { return rule.selector.includes(':fullscreen') && rule.selector.includes('.player__timeline'); })).toBe(false);
    });

    it('has the same fullscreen rules in every theme: none of them is for the neon themes only', () => {
        const fullscreenRules = cyberpunk.rules.filter((rule) => { return rule.selector.includes(':fullscreen'); });
        expect(fullscreenRules.length).toBeGreaterThan(6);
        fullscreenRules.forEach((rule) => {
            expect(rule.selector, rule.selector).not.toContain('data-theme');
        });
        expect(cyberpunk.text).not.toMatch(/data-theme-style='neon'\]\s*\.player/);
    });
});

describe('the controls of the player in fullscreen, in every theme', () => {
    it('float over the video with no background and no border, out of the layout, so they take no room', () => {
        expect(styleOf(cyberpunk, '.player__stage:fullscreen .player__controls')).toMatchObject({
            position: 'absolute',
            left: '0',
            right: '0',
            bottom: '0',
            background: 'transparent',
            'border-top': '0'
        });
        expect(styleOf(cyberpunk, '.player__stage:fullscreen')['position']).toBe('relative');
    });

    it('make the buttons and the selects glow with the neon of the theme', () => {
        expect(styleOf(cyberpunk, '.player__stage:fullscreen .player__button')).toMatchObject({
            'border-color': 'var(--cyan)',
            color: 'var(--cyan)',
            'box-shadow': '0 0 6px color-mix(in srgb, var(--cyan) 45%, transparent)'
        });
        expect(styleOf(cyberpunk, '.player__stage:fullscreen .player__select')).toMatchObject({ background: 'transparent', 'border-color': 'var(--cyan)' });
    });

    it('go away when the mouse stands still: they leave the layout, fade out and let the mouse through', () => {
        expect(styleOf(cyberpunk, ".player__controls[data-hidden='true']")).toEqual({
            position: 'absolute',
            left: '0',
            right: '0',
            bottom: '0',
            opacity: '0',
            'pointer-events': 'none'
        });
        expect(styleOf(cyberpunk, '.player__controls')['transition']).toBe('opacity 0.25s ease');
        expect(styleOf(cyberpunk, ".player__stage:has(.player__controls[data-hidden='true']) .player__video")['cursor']).toBe('none');
    });
});
