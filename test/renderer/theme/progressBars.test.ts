import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { keyframesOf, mediaStyleOf, readStylesheet, splitTopLevel, styleOf } from '../../helpers/cssRules';

const COMPONENTS_DIRECTORY = resolve(__dirname, '../../../src/renderer/components');
const cyberpunk = readStylesheet('cyberpunk.css');
const themes = readStylesheet('themes.css');
const responsive = readStylesheet('responsive.css');

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const PLAIN_BAR = ".progress:not([class*='progress--']) .progress__bar";

// Every place of the app that draws a progress bar (a `.progress` with a `.progress__bar`, or a range of the player), by the file that
// draws it: when a bar is added to a file that is not here, this list has to say so, and the CSS below has to cover it.
const FILES_WITH_BARS: Record<string, string[]> = {
    'AnimeJobs.tsx': ['progress'],
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

    it('does not turn the glow off in any theme or screen size', () => {
        [themes, responsive].forEach((sheet) => {
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

describe('the bars when the system asks for less motion', () => {
    const reduced = cyberpunk.rules.filter((rule) => { return rule.media?.includes(REDUCED_MOTION) === true; });

    it('stops the sweeps and the stripes, which are decoration', () => {
        expect(mediaStyleOf(cyberpunk, REDUCED_MOTION, '.progress--live .progress__bar')['animation']).toBe('none');
        ['verify', 'waiting', 'merging', 'saving', 'processing'].forEach((kind) => {
            expect(mediaStyleOf(cyberpunk, REDUCED_MOTION, `.progress--${kind}::after`)['animation'], kind).toBe('none');
        });
    });

    it('keeps the wave of a download and the one of the check of Cloudflare flowing: they are the sign that something is going on', () => {
        expect(
            reduced.filter((rule) => {
                return /\.progress:not|\.progress--cloudflare/.test(rule.selector);
            })
        ).toEqual([]);
    });

    it('keeps the bar that drains from being frozen empty: it shows its full width', () => {
        const verify = mediaStyleOf(cyberpunk, REDUCED_MOTION, '.progress--verify .progress__bar');
        expect(verify).toMatchObject({ animation: 'none', width: '100%' });
    });

    it('slows the spinner of the player instead of stopping it, and stops the wave of its timeline', () => {
        expect(mediaStyleOf(cyberpunk, REDUCED_MOTION, '.player__spinner')['animation-duration']).toBe('3s');
        expect(mediaStyleOf(cyberpunk, REDUCED_MOTION, '.player__controls .player__seek')['animation']).toBe('none');
    });
});

describe('the timeline and the volume of the player', () => {
    it('glow like neon, in every theme', () => {
        const layers = layersOf(styleOf(cyberpunk, '.player__range')['box-shadow']);
        expect(layers).toEqual(['0 0 3px var(--cyan)', '0 0 10px var(--cyan)', '0 0 20px color-mix(in srgb, var(--cyan) 60%, transparent)']);
    });

    it('flows a neon wave over the part already watched while the video plays, and stands still when it is paused', () => {
        const seek = styleOf(cyberpunk, '.player__controls .player__seek');
        expect(seek['animation']).toBe('player-wave-phase 1.2s linear infinite, player-wave-glow-filter 2s ease-in-out infinite');
        expect(seek['animation-play-state']).toBe('paused');
        expect(styleOf(cyberpunk, ".player__controls[data-playing='true'] .player__seek")['animation-play-state']).toBe('running');
        expect(keyframesOf(cyberpunk, 'player-wave-phase')?.body.replace(/\s+/g, ' ').trim()).toBe('from { --wave-phase: 0px; } to { --wave-phase: 160px; }');
        expect(cyberpunk.atRules.some((block) => { return block.prelude === '@property --wave-phase'; })).toBe(true);
    });

    it('is a thick bar, so the wave can be seen, with the wave only as wide as what was watched, over a faint track', () => {
        const seek = styleOf(cyberpunk, '.player__controls .player__seek');
        expect(seek['height']).toBe('10px');
        expect(seek['border-color']).toBe('transparent');
        expect(seek['box-shadow']).toBe('none');
        const layers = splitTopLevel(seek['background'] ?? '', ',');
        expect(layers).toHaveLength(3);
        expect(seek['background']).toContain('0 0 / var(--progress) 100% no-repeat');
        expect(seek['background']).toContain('0 0 / var(--buffered) 100% no-repeat');
        expect(seek['background']).toContain('var(--seek-track)');
    });

    it('has a wave with a dark trough and a bright crest, so it shows also in the themes whose two colours are close', () => {
        const background = styleOf(cyberpunk, '.player__controls .player__seek')['background'] ?? '';
        expect(background).toContain('color-mix(in srgb, var(--cyan) 55%, black) var(--wave-phase)');
        expect(background).toContain('color-mix(in srgb, var(--magenta) 35%, white) calc(var(--wave-phase) + 80px)');
        expect(background).toContain('color-mix(in srgb, var(--cyan) 55%, black) calc(var(--wave-phase) + 160px)');
    });

    it('glows around the watched part as a drop shadow of what is painted, strong and in both colours of the theme', () => {
        const keyframes = keyframesOf(cyberpunk, 'player-wave-glow-filter')?.body.replace(/\s+/g, ' ') ?? '';
        expect(keyframes).toContain('drop-shadow(0 0 3px var(--cyan))');
        expect(keyframes).toContain('drop-shadow(0 0 10px color-mix(in srgb, var(--cyan) 85%, transparent))');
        expect(keyframes).toContain('drop-shadow(0 0 3px var(--magenta))');
        expect(keyframes).toContain('drop-shadow(0 0 12px color-mix(in srgb, var(--magenta) 90%, transparent))');
    });

    it('makes the track and the loaded part of the colours of the theme, so they show on light and dark panels', () => {
        const seek = styleOf(cyberpunk, '.player__controls .player__seek');
        expect(seek['--seek-track']).toBe('color-mix(in srgb, var(--text) 16%, transparent)');
        expect(seek['--seek-buffered']).toBe('color-mix(in srgb, var(--cyan) 42%, transparent)');
    });

    it('makes the track and the loaded part white over the video in fullscreen, where they show on any picture', () => {
        const seek = styleOf(cyberpunk, '.player__stage:fullscreen .player__controls .player__seek');
        expect(seek).toEqual({ '--seek-track': 'rgba(255, 255, 255, 0.16)', '--seek-buffered': 'rgba(255, 255, 255, 0.5)' });
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
