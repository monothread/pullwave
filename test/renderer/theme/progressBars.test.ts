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
    'MangaHealthSettings.tsx': ['progress'],
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

    it('gives the bar a bright core, a close halo and wider soft ones, in the colour of its state', () => {
        expect(bar['--bar-glow']).toBe('var(--cyan)');
        const layers = layersOf(bar['box-shadow']);
        expect(layers).toHaveLength(5);
        expect(layers[0]).toBe('inset 0 0 3px rgba(255, 255, 255, 0.85)');
        expect(layers.slice(1)).toEqual(['0 0 3px var(--bar-glow)', '0 0 8px var(--bar-glow)', '0 0 16px var(--bar-glow)', '0 0 28px color-mix(in srgb, var(--bar-glow) 65%, transparent)']);
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

    it.each([
        ['.progress--verify::after', 'scan-sweep 1s linear infinite'],
        ['.progress--waiting::after', 'scan-sweep 1.8s ease-in-out infinite alternate'],
        ['.progress--processing::after', 'scan-sweep 1s linear infinite'],
        ['.progress--saving::after', 'scan-sweep 0.9s linear infinite'],
        ['.progress--merging::after', 'scan-sweep 1.1s linear infinite'],
        ['.progress--cloudflare::after', 'cloudflare-sweep 1.4s ease-in-out infinite']
    ])('sweeps a bright line over the bar with %s', (selector, animation) => {
        const sweep = styleOf(cyberpunk, selector);
        expect(sweep['animation']).toBe(animation);
        expect(sweep['position']).toBe('absolute');
        expect(sweep['content']).toBe("''");
    });

    it('keeps every sweep inside the track, so nothing has to clip the glow', () => {
        expect(keyframesOf(cyberpunk, 'scan-sweep')?.body.replace(/\s+/g, ' ').trim()).toBe('from { left: 0; } to { left: 72%; }');
        expect(keyframesOf(cyberpunk, 'cloudflare-sweep')?.body.replace(/\s+/g, ' ').trim()).toBe('from { left: 0; } to { left: 70%; }');
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
        expect(styleOf(cyberpunk, '.progress')).toMatchObject({ height: '8px', border: '1px solid var(--line)', overflow: 'visible' });
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
