import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { keyframesOf, readStylesheet, styleOf } from '../../helpers/cssRules';

const sheet = readStylesheet('bp-fun.css');
const others = ['cyberpunk.css', 'console.css', 'bp-shell.css', 'bp-home.css', 'bp-library.css', 'bp-downloads.css'].map((file) => {
    return readStylesheet(file);
});
const consoleSheet = readStylesheet('console.css');
const MAIN_SOURCE = readFileSync(resolve(__dirname, '../../../src/renderer/main.tsx'), 'utf-8');
const BOXES = ['.panel', '.url-input', '.job', '.history__item', '.cover-card', '.app__main > *', '.settings > .panel', '.series-menu__panel', '.toast', '.home', '.hero', '.spotlight', '.section-card', '.download-hero', '.stats', '.error-banner'];

function keyframesNamed(name: string): boolean {
    return [sheet, ...others].some((candidate) => {
        return keyframesOf(candidate, name) !== undefined;
    });
}

function animationNames(value: string): string[] {
    return value
        .split(',')
        .map((part) => {
            return part.trim().split(' ')[0] ?? '';
        })
        .filter((name) => {
            return name !== 'none' && name !== '';
        });
}

describe('bp-fun.css: where it is loaded', () => {
    it('is the last style sheet, after the screens of the console interface', () => {
        const order = ['console.css', 'bp-shell.css', 'bp-home.css', 'bp-library.css', 'bp-downloads.css', 'bp-fun.css'].map((file) => {
            return MAIN_SOURCE.indexOf(`import './theme/${file}';`);
        });
        order.forEach((position) => {
            expect(position).toBeGreaterThan(-1);
        });
        expect([...order].sort((a, b) => { return a - b; })).toEqual(order);
    });
});

describe('bp-fun.css: the rules of the project', () => {
    it('writes no colour of its own (only black, white and the variables of the themes)', () => {
        expect(sheet.text).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        [...sheet.text.matchAll(/rgba?\(([^)]*)\)/g)].forEach((match) => {
            const channels = (match[1] ?? '').split(',').slice(0, 3).map((channel) => { return channel.trim(); }).join(',');
            expect(['0,0,0', '255,255,255']).toContain(channels);
        });
    });

    it('keeps every animation on whatever the system says about motion: no rule for less motion (D-130)', () => {
        expect(sheet.text).not.toContain('prefers-reduced-motion');
        expect(sheet.rules.filter((rule) => { return rule.media?.includes('prefers-reduced-motion') === true; })).toEqual([]);
        // The sheet has no rule of a media query at all.
        expect(
            sheet.rules.filter((rule) => { return rule.media !== null; }).map((rule) => { return rule.media; })
        ).toEqual([]);
    });

    it('names only its own (bp-) keyframes, once each', () => {
        const names = sheet.atRules.filter((block) => { return block.prelude.startsWith('@keyframes'); }).map((block) => { return block.prelude.replace('@keyframes ', ''); });
        expect(names.length).toBeGreaterThan(20);
        expect(new Set(names).size).toBe(names.length);
        names.forEach((name) => {
            expect(name).toMatch(/^bp-/);
        });
    });

    it('defines the keyframes that every animation uses', () => {
        const used = sheet.rules.flatMap((rule) => {
            return [rule.declarations.animation, rule.declarations['animation-name']].flatMap((value) => {
                return value === undefined ? [] : animationNames(value);
            });
        });
        expect(used.length).toBeGreaterThan(20);
        used.forEach((name) => {
            expect(keyframesNamed(name), name).toBe(true);
        });
    });

    it.each(BOXES)('never leaves a transform on %s', (selector) => {
        sheet.rules
            .filter((rule) => {
                const rest = rule.selector.slice(selector.length);
                return rule.selector.startsWith(selector) && (rest === '' || (rest.startsWith(':') && !rest.startsWith('::') && !/\s/.test(rest)));
            })
            .forEach((rule) => {
                expect(rule.declarations.transform, rule.selector).toBeUndefined();
                expect(rule.declarations.translate, rule.selector).toBeUndefined();
                expect(rule.declarations.filter, rule.selector).toBeUndefined();
            });
    });

    it('does not change the size of a field or of a button', () => {
        sheet.rules
            .filter((rule) => { return /(^|[\s,>])\.(btn|input)(?![-_\w])/.test(rule.selector) && !rule.selector.includes('::'); })
            .forEach((rule) => {
                ['height', 'min-height', 'padding', 'padding-top', 'padding-bottom', 'padding-block', 'font-size', 'line-height', 'border-width'].forEach((property) => {
                    expect(rule.declarations[property], `${rule.selector} sets ${property}`).toBeUndefined();
                });
            });
        expect(sheet.text).not.toContain('--control-height');
    });
});

describe('bp-fun.css: tokens and the colour of the sections', () => {
    it('has three durations of motion', () => {
        expect(styleOf(sheet, ':root')).toMatchObject({ '--bp-dur-fast': '0.15s', '--bp-dur-base': '0.3s', '--bp-dur-slow': '0.6s' });
    });

    it('registers the three lights of the aurora as colours, so the change between sections is a slow blend', () => {
        ['--bp-aurora-a', '--bp-aurora-b', '--bp-aurora-c'].forEach((name) => {
            const block = sheet.atRules.find((candidate) => { return candidate.prelude === `@property ${name}`; });
            expect(block?.body.replace(/\s+/g, ' ')).toContain("syntax: '<color>'");
        });
        expect(styleOf(sheet, ':root').transition).toBe('--bp-aurora-a 0.9s ease, --bp-aurora-b 0.9s ease, --bp-aurora-c 0.9s ease');
    });

    it('lights the aurora in the colours of each section', () => {
        expect(styleOf(sheet, ":root[data-section='downloads']")).toEqual({ '--bp-aurora-a': 'color-mix(in srgb, var(--cyan) 30%, transparent)', '--bp-aurora-b': 'color-mix(in srgb, var(--cyan) 14%, transparent)' });
        expect(styleOf(sheet, ":root[data-section='anime']")).toEqual({ '--bp-aurora-a': 'color-mix(in srgb, var(--magenta) 28%, transparent)', '--bp-aurora-b': 'color-mix(in srgb, var(--cyan) 14%, transparent)' });
        expect(styleOf(sheet, ":root[data-section='manga']")).toEqual({ '--bp-aurora-a': 'color-mix(in srgb, var(--yellow) 24%, transparent)', '--bp-aurora-c': 'color-mix(in srgb, var(--green) 20%, transparent)' });
    });
});

describe('bp-fun.css: the wave of the name', () => {
    it('lies almost flat when idle, rises when busy and races in a rush, keeping the delays of each bar', () => {
        expect(styleOf(sheet, '.brand__wave--idle .brand__bar')).toEqual({ 'animation-name': 'bp-wave-idle', 'animation-duration': '3.4s' });
        expect(styleOf(sheet, '.brand__wave--busy .brand__bar')).toEqual({ 'animation-duration': '0.9s' });
        expect(styleOf(sheet, '.brand__wave--rush .brand__bar')).toEqual({ 'animation-duration': '0.5s' });
        expect(sheet.rules.filter((rule) => { return rule.selector.startsWith('.brand__wave') && rule.declarations['animation-delay'] !== undefined; })).toEqual([]);
    });

    it('dances three times and runs through every colour in the secret mode', () => {
        expect(styleOf(sheet, '.brand__wave--dance .brand__bar')).toEqual({ 'animation-name': 'bp-wave-dance', 'animation-duration': '0.45s', 'animation-iteration-count': '3', 'animation-timing-function': 'var(--bp-ease-spring)' });
        expect(styleOf(sheet, '.brand__wave--rainbow .brand__bar')).toMatchObject({ 'animation-name': 'bp-wave-bar, bp-hue', 'animation-duration': '0.9s, 2.4s' });
        expect(keyframesOf(sheet, 'bp-hue')?.body.replace(/\s+/g, ' ')).toContain('hue-rotate(360deg)');
    });

    it('is clickable', () => {
        expect(styleOf(sheet, '.brand')).toEqual({ cursor: 'pointer' });
    });
});

describe('bp-fun.css: the bars and the notices', () => {
    it('puts a comet at the head of a bar that has grown, and not on the special bars, nor on a finished or failed one', () => {
        expect(styleOf(sheet, '.progress__bar')).toEqual({ position: 'relative' });
        expect(styleOf(sheet, ".progress:not([class*='progress--']) .progress__bar:not([style*='width: 0%'])::after")).toMatchObject({ position: 'absolute', 'pointer-events': 'none', animation: 'bp-comet 0.9s ease-in-out infinite alternate' });
        expect(styleOf(sheet, '.job--done .progress__bar::after')).toEqual({ display: 'none' });
        expect(sheet.rules.find((rule) => { return rule.selector === '.job--error .progress__bar::after'; })?.declarations).toEqual({ display: 'none' });
    });

    it('flashes the bar of a download that is done and stamps its badge', () => {
        expect(styleOf(sheet, '.job--done .progress')).toEqual({ animation: 'bp-bar-flash 0.8s ease-out' });
        expect(styleOf(sheet, '.badge--done')).toEqual({ animation: 'bp-stamp 0.55s var(--bp-ease-spring) backwards' });
    });

    it('gives the notice a timer of the five seconds it stays', () => {
        expect(styleOf(sheet, '.toast--info::before')).toMatchObject({ position: 'absolute', bottom: '0', height: '3px', 'transform-origin': 'left center', animation: 'bp-toast-drain 5s linear forwards' });
        expect(keyframesOf(sheet, 'bp-toast-drain')?.body.replace(/\s+/g, ' ')).toContain('to { transform: scaleX(0); }');
    });

    it('shakes an error once', () => {
        expect(styleOf(sheet, '.error-banner')).toEqual({ animation: 'bp-shake 0.5s ease-in-out' });
    });
});

describe('bp-fun.css: the pictures', () => {
    it('shimmers while a cover is looked for', () => {
        expect(styleOf(sheet, '.cover--none:empty')).toMatchObject({ animation: 'bp-shimmer 1.4s linear infinite' });
    });

    it('blurs a cover until it has loaded and then brings it into focus', () => {
        expect(styleOf(sheet, '.cover--loading')).toEqual({ filter: 'blur(14px) saturate(1.4)', opacity: '0.6' });
        expect(styleOf(sheet, 'img.cover:not(.cover--loading)')).toEqual({ animation: 'bp-cover-focus 0.6s var(--bp-ease-out) backwards' });
    });

    it.each([
        ['home', 'bp-icon-hop 0.7s var(--bp-ease-spring)'],
        ['downloads', 'bp-icon-drop 0.8s var(--bp-ease-out)'],
        ['anime', 'bp-icon-pulse 0.8s var(--bp-ease-out)'],
        ['manga', 'bp-icon-page 0.8s var(--bp-ease-out)']
    ])('gives the picture of %s its own trick, when pointed at and when chosen', (section, animation) => {
        expect(styleOf(sheet, `.sidenav .tab:hover .section-icon--${section}`)).toEqual({ animation });
        expect(styleOf(sheet, `.sidenav .tab--active .section-icon--${section}`)).toEqual({ animation });
    });
});

describe('bp-fun.css: the presses', () => {
    it('sends a ripple from the point of the press, with its radius and strength as registered numbers', () => {
        ['--bp-ripple', '--bp-ripple-alpha'].forEach((name) => {
            expect(sheet.atRules.find((candidate) => { return candidate.prelude === `@property ${name}`; })?.body.replace(/\s+/g, ' ')).toContain("syntax: '<number>'");
        });
        const ripple = styleOf(sheet, '.is-rippling');
        expect(ripple.animation).toBe('bp-ripple 0.6s var(--bp-ease-out)');
        expect(ripple['background-image']).toContain('radial-gradient(circle at var(--rx, 50%) var(--ry, 50%)');
        expect(keyframesOf(sheet, 'bp-ripple')?.body.replace(/\s+/g, ' ')).toContain('to { --bp-ripple: 260; --bp-ripple-alpha: 0; }');
    });

    it('fills what takes something away with red while it is held', () => {
        expect(styleOf(sheet, "[data-hold='confirm']:active:not(:disabled)")).toMatchObject({ 'background-size': '0% 100%', animation: 'bp-hold-fill 0.7s linear forwards' });
        expect(keyframesOf(sheet, 'bp-hold-fill')?.body.replace(/\s+/g, ' ')).toContain('to { background-size: 100% 100%; }');
    });
});

describe('bp-fun.css: the tiles, the carousel and the tabs', () => {
    it('leans a tile toward the pointer and lights it where the pointer is', () => {
        expect(styleOf(sheet, '.cover-grid > .cover-card:hover > .cover')).toEqual({
            transform: 'perspective(700px) rotateX(var(--tilt-x, 0deg)) rotateY(var(--tilt-y, 0deg)) translateY(-4px) scale(1.04)',
            transition: 'transform 0.12s linear, box-shadow 0.3s, filter 0.3s'
        });
        expect(styleOf(sheet, '.cover-grid > .cover-card::after').background).toBe('radial-gradient(circle at var(--glare-x, 50%) var(--glare-y, 50%), var(--bp-sheen) 0%, transparent 55%)');
        expect(styleOf(sheet, '.cover-grid > .cover-card::after').opacity).toBe('0');
        expect(styleOf(sheet, '.cover-grid > .cover-card:hover::after')).toEqual({ opacity: '1' });
    });

    it('moves the cover of a slide against the pointer, which starts at the middle', () => {
        expect(styleOf(sheet, '.spotlight__stage')).toEqual({ '--px': '0', '--py': '0' });
        expect(styleOf(sheet, '.spotlight__slide .hero__art')).toEqual({ transform: 'translate3d(calc(var(--px) * -10px), calc(var(--py) * -8px), 0)', transition: 'transform 0.25s ease-out' });
    });

    it('fills the current dot as the five seconds of the slide pass', () => {
        expect(styleOf(sheet, '.spotlight__dot--current')).toEqual({ position: 'relative', overflow: 'hidden' });
        expect(styleOf(sheet, '.spotlight__dot--current::after')).toMatchObject({ animation: 'bp-dot-fill 5s linear forwards' });
    });

    it('draws a pill behind the active tab, in the tab, and lets the item of the menu pulse', () => {
        expect(styleOf(sheet, '.tab')).toEqual({ isolation: 'isolate' });
        expect(styleOf(sheet, '.tab__pill')).toMatchObject({ position: 'absolute', inset: '0', 'z-index': '-1', 'border-radius': 'inherit' });
        expect(styleOf(sheet, '.tab--pulse')).toEqual({ animation: 'bp-nav-pulse 0.9s var(--bp-ease-out)' });
    });
});

describe('bp-fun.css: the halo, the clock, the week and the empty screens', () => {
    it('lays the halo of the focus over the screen with no margin, even with the generic margin of the children of the app', () => {
        expect(styleOf(sheet, '.app > .focus-halo')).toEqual({ margin: '0' });
    });

    it('lays the halo of the focus over the screen without taking the mouse', () => {
        expect(styleOf(sheet, '.focus-halo')).toMatchObject({ position: 'fixed', 'pointer-events': 'none', 'z-index': '150', opacity: '0' });
    });

    it('flips the characters of the clock, keeping its spaces', () => {
        expect(styleOf(sheet, '.flip__char')).toEqual({ display: 'inline-block', 'white-space': 'pre', animation: 'bp-flip 0.45s var(--bp-ease-spring) backwards' });
    });

    it('draws the numbers of the week with digits of one width, and has no achievements', () => {
        expect(styleOf(sheet, '.stats__number')).toMatchObject({ display: 'flex', 'flex-direction': 'column-reverse' });
        expect(styleOf(sheet, '.stats__number dd')).toMatchObject({ 'font-variant-numeric': 'tabular-nums' });
        expect(sheet.text).not.toContain('stats__badge');
        expect(keyframesOf(sheet, 'bp-badge-pop')).toBeUndefined();
    });
});

describe('bp-fun.css: the player and the settings', () => {
    it('flashes a seek over the video, on the side it went to', () => {
        expect(styleOf(sheet, '.player__skip')).toMatchObject({ position: 'absolute', 'pointer-events': 'none', animation: 'bp-skip 0.65s var(--bp-ease-out) forwards' });
        expect(styleOf(sheet, '.player__skip--forward')).toEqual({ right: '14%' });
        expect(styleOf(sheet, '.player__skip--backward')).toEqual({ left: '14%' });
    });

    it('swaps the icons of the buttons with a spring and gives the sliders a springy thumb', () => {
        expect(styleOf(sheet, '.player__button .player__icon')).toEqual({ animation: 'bp-icon-swap 0.3s var(--bp-ease-spring) backwards' });
        expect(styleOf(sheet, '.player__range::-webkit-slider-thumb')).toEqual({ transition: 'transform 0.2s var(--bp-ease-spring)' });
        expect(styleOf(sheet, '.player__range:active::-webkit-slider-thumb')).toEqual({ transform: 'scale(1.4)' });
    });

    it('draws the ring of the next episode in the corner of its panel, emptying as the time passes', () => {
        expect(styleOf(sheet, '.player__auto-next-ring')).toMatchObject({ position: 'absolute', width: '34px', height: '34px', transform: 'rotate(-90deg)' });
        expect(styleOf(sheet, '.player__auto-next-ring-fill')).toMatchObject({ stroke: 'var(--magenta)', transition: 'stroke-dashoffset 0.1s linear' });
        expect(styleOf(sheet, '.player__auto-next-title')).toEqual({ 'padding-right': '44px' });
    });

    it('styles the slider of the volume of the sounds', () => {
        expect(styleOf(sheet, '.settings__volume')).toEqual({ width: '100%', 'max-width': '320px', 'accent-color': 'var(--magenta)' });
    });

    it('opens the new theme as a circle from where it was chosen, with the old one standing still', () => {
        expect(styleOf(sheet, '.vt-theme::view-transition-old(root)')).toEqual({ animation: 'none', 'mix-blend-mode': 'normal' });
        expect(styleOf(sheet, '.vt-theme::view-transition-new(root)')).toEqual({ 'mix-blend-mode': 'normal', animation: 'bp-reveal 0.75s var(--bp-ease-out) both' });
        const frames = keyframesOf(sheet, 'bp-reveal')?.body.replace(/\s+/g, ' ');
        expect(frames).toContain('from { clip-path: circle(0% at var(--reveal-x, 50%) var(--reveal-y, 50%)); }');
        expect(frames).toContain('to { clip-path: circle(150% at var(--reveal-x, 50%) var(--reveal-y, 50%)); }');
    });
});

describe('bp-fun.css: the player', () => {
    it('opens with a fade of the screen and a rise of the box, with no scale that would change the size of the controls', () => {
        expect(styleOf(sheet, '.player')).toEqual({ animation: 'bp-fade-in 0.25s ease-out backwards' });
        expect(styleOf(sheet, '.player__box')).toEqual({ animation: 'bp-rise 0.4s var(--bp-ease-out) backwards' });
        const rise = keyframesOf(consoleSheet, 'bp-rise')?.body.replace(/\s+/g, ' ');
        expect(rise).toContain('translateY(10px)');
        expect(rise).not.toContain('scale');
    });

    it('slides the bar down and out when it hides, with the fade it already had', () => {
        expect(styleOf(sheet, '.player__controls')).toEqual({ transition: 'opacity 0.25s ease, transform 0.3s var(--bp-ease-out)' });
        expect(styleOf(sheet, ".player__controls[data-hidden='true']")).toEqual({ transform: 'translateY(16px)' });
    });

    it('pops a round mark in the middle of the video, over it and out of the way of the mouse', () => {
        expect(styleOf(sheet, '.player__center')).toMatchObject({ position: 'absolute', top: '50%', left: '50%', 'border-radius': '50%', 'pointer-events': 'none', animation: 'bp-center 0.6s var(--bp-ease-out) forwards' });
    });

    it('shows the volume in a bubble over the slider, which goes away by itself', () => {
        expect(styleOf(sheet, '.player__volume-wrap')).toEqual({ position: 'relative', display: 'inline-flex', 'align-items': 'center' });
        expect(styleOf(sheet, '.player__volume-bubble')).toMatchObject({ position: 'absolute', 'pointer-events': 'none', 'font-variant-numeric': 'tabular-nums', animation: 'bp-bubble 1s var(--bp-ease-out) forwards' });
        expect(styleOf(sheet, '.player__icon--volume-low')).toEqual({ 'font-size': '1em' });
    });

    it('draws what is loaded as a lighter stretch under the part watched, which the mouse goes through', () => {
        expect(styleOf(sheet, '.player__timeline .progress')).toEqual({ position: 'relative' });
        expect(styleOf(sheet, '.player__buffered')).toMatchObject({ position: 'absolute', left: '0', 'pointer-events': 'none', transition: 'width 0.3s ease' });
    });

    it('opens the settings with a rise and has its lines come one after the other', () => {
        expect(styleOf(sheet, '.player__settings')).toEqual({ animation: 'bp-rise 0.35s var(--bp-ease-out) backwards' });
        expect(styleOf(sheet, '.player__settings > *')).toEqual({ animation: 'bp-rise 0.35s var(--bp-ease-out) backwards' });
        expect(styleOf(sheet, '.player__settings > :nth-child(2)')).toEqual({ 'animation-delay': '0.05s' });
        expect(styleOf(sheet, '.player__settings > :nth-child(3)')).toEqual({ 'animation-delay': '0.1s' });
        expect(styleOf(sheet, '.player__settings > :nth-child(n + 4)')).toEqual({ 'animation-delay': '0.15s' });
    });

    it('says where the episode picked up for four seconds and then is gone', () => {
        expect(styleOf(sheet, '.player__resumed')).toMatchObject({ position: 'absolute', 'pointer-events': 'none', animation: 'bp-resumed 4s var(--bp-ease-out) forwards' });
    });

    it('brings the panel of the next episode in from the side, with the cover beside the name', () => {
        expect(styleOf(sheet, '.player__auto-next')).toEqual({ animation: 'bp-slide-left 0.5s var(--bp-ease-spring) backwards' });
        expect(styleOf(sheet, '.player__auto-next--cover')).toEqual({ 'min-height': '96px', 'padding-left': '84px' });
        expect(styleOf(sheet, '.player__auto-next-cover')).toMatchObject({ position: 'absolute', width: '56px', height: '80px', overflow: 'hidden' });
        expect(styleOf(sheet, '.player__auto-next-cover .cover')).toMatchObject({ width: '100%', height: '100%', 'object-fit': 'cover' });
    });
});

describe('bp-fun.css: the reader', () => {
    it('brings a page turned one at a time in from the side the reading goes to', () => {
        expect(styleOf(sheet, '.reader__stage[data-turn] .reader__img:not(.reader__img--pending)')).toEqual({ '--turn-from': '40px', animation: 'bp-page-turn 0.35s var(--bp-ease-out) backwards' });
        ['.reader__stage[data-turn=\'forward\'][data-direction=\'rtl\'] .reader__img:not(.reader__img--pending)', '.reader__stage[data-turn=\'back\'][data-direction=\'ltr\'] .reader__img:not(.reader__img--pending)'].forEach((selector) => {
            expect(styleOf(sheet, selector), selector).toEqual({ '--turn-from': '-40px' });
        });
        expect(keyframesOf(sheet, 'bp-page-turn')?.body.replace(/\s+/g, ' ')).toContain('from { opacity: 0; transform: translateX(var(--turn-from)); }');
        expect(keyframesOf(sheet, 'bp-page-turn')?.body.replace(/\s+/g, ' ')).toContain('to { opacity: 1; transform: none; }');
    });

    it('only fades in the first page and the pages of the scroll, with no filter on them', () => {
        expect(styleOf(sheet, '.reader__stage:not([data-turn]) .reader__img:not(.reader__img--pending)')).toEqual({ animation: 'bp-reader-fade 0.5s ease-out backwards' });
        expect(styleOf(sheet, '.reader__scroll .reader__img:not(.reader__img--pending)')).toEqual({ animation: 'bp-reader-fade 0.5s ease-out backwards' });
        expect(keyframesOf(sheet, 'bp-reader-fade')?.body).not.toContain('filter');
    });

    it('shimmers the block of a page that is loading, and makes the page that was brought to glow', () => {
        expect(styleOf(sheet, '.reader__loading-page')).toMatchObject({ animation: 'bp-shimmer 1.4s linear infinite' });
        expect(styleOf(sheet, '.reader__scroll .reader__img.reader__img--restored:not(.reader__img--pending)')).toEqual({ animation: 'bp-reader-fade 0.5s ease-out backwards, bp-restored 1.4s ease-out' });
    });

    it('flips the number of the page when it changes and changes the background softly', () => {
        expect(styleOf(sheet, '.reader__page-text')).toEqual({ display: 'inline-block', animation: 'bp-flip 0.4s var(--bp-ease-spring) backwards' });
        expect(styleOf(sheet, '.reader__stage')).toEqual({ transition: 'background 0.4s ease' });
        expect(styleOf(sheet, '.reader__scroll')).toEqual({ transition: 'background 0.4s ease' });
    });

    it('opens the settings with a rise and has its fields come one after the other', () => {
        expect(styleOf(sheet, '.reader__settings')).toEqual({ animation: 'bp-rise 0.4s var(--bp-ease-out) backwards' });
        expect(styleOf(sheet, '.reader__settings > .field:nth-child(2)')).toEqual({ animation: 'bp-rise 0.4s var(--bp-ease-out) 0.04s backwards' });
        expect(styleOf(sheet, '.reader__settings > .field:nth-child(n + 5)')).toEqual({ animation: 'bp-rise 0.4s var(--bp-ease-out) 0.16s backwards' });
    });

    it('beckons with an arrow in the zone between chapters, down at the end and up at the start, and shines the bar when it is nearly full', () => {
        expect(styleOf(sheet, '.reader__zone-arrow')).toMatchObject({ animation: 'bp-zone-arrow 1.2s ease-in-out infinite' });
        expect(styleOf(sheet, '.reader__zone--start .reader__zone-arrow')).toEqual({ 'animation-name': 'bp-zone-arrow-up' });
        expect(styleOf(sheet, ".reader__zone-bar[data-full='true'] .progress__bar")).toEqual({
            'animation-name': 'bar-wave-flow, bp-zone-full',
            'animation-duration': '1.4s, 0.5s',
            'animation-iteration-count': 'infinite, infinite',
            'animation-direction': 'normal, alternate',
            'animation-timing-function': 'linear, ease-in-out'
        });
    });

    it('runs chevrons down the button of the auto scroll, each a little after the one before, with the speed beside them', () => {
        expect(styleOf(sheet, '.reader__auto-flow > span:not(.reader__auto-speed)')).toMatchObject({ animation: 'bp-flow-down 0.9s ease-in-out infinite' });
        expect(styleOf(sheet, '.reader__auto-flow > :nth-child(2)')).toEqual({ 'animation-delay': '0.15s' });
        expect(styleOf(sheet, '.reader__auto-flow > :nth-child(3)')).toEqual({ 'animation-delay': '0.3s' });
        expect(styleOf(sheet, '.reader__auto-speed')).toMatchObject({ 'font-variant-numeric': 'tabular-nums' });
    });

    it('springs the button back to the top in, with a ring that fills as the chapter is read', () => {
        expect(styleOf(sheet, '.reader__top')).toEqual({ animation: 'bp-top-pop 0.4s var(--bp-ease-spring) backwards' });
        expect(styleOf(sheet, '.reader__top-ring')).toMatchObject({ position: 'absolute', transform: 'rotate(-90deg)', 'pointer-events': 'none' });
        expect(styleOf(sheet, '.reader__top-ring-fill')).toMatchObject({ stroke: 'var(--magenta)', transition: 'stroke-dashoffset 0.15s linear' });
    });

    it('stamps a chapter that was read to its end, over the page and out of the way of the mouse', () => {
        expect(styleOf(sheet, '.reader__complete')).toMatchObject({ position: 'fixed', top: '42%', left: '50%', 'pointer-events': 'none', animation: 'bp-complete 2.2s var(--bp-ease-out) forwards' });
    });
});

describe('bp-fun.css: the pointer', () => {
    it('makes the arrow the shape of the whole window, the windows that open over the app included', () => {
        expect(styleOf(sheet, 'body')).toEqual({ cursor: 'default' });
        expect(styleOf(sheet, '.app')).toEqual({});
    });

    it('gives the hand to what can be pressed', () => {
        expect(styleOf(sheet, "button, summary, select, [role='button'], [role='option'], [role='tab'], input[type='checkbox'], input[type='radio'], input[type='range'], input[type='color']")).toEqual({});
        ['button', 'summary', 'select', "[role='button']", "[role='option']", "[role='tab']", "input[type='checkbox']", "input[type='radio']", "input[type='range']", "input[type='color']"].forEach((selector) => {
            expect(styleOf(sheet, selector), selector).toEqual({ cursor: 'pointer' });
        });
    });

    it('gives the hand to the whole line of an on/off setting', () => {
        ["label:has(> input[type='checkbox'])", "label:has(> input[type='radio'])", 'label:has(input.switch)', '.toggle'].forEach((selector) => {
            expect(styleOf(sheet, selector), selector).toEqual({ cursor: 'pointer' });
        });
    });

    it('says a disabled control cannot be pressed, and keeps the busy shape for what is working', () => {
        ['button:disabled', 'select:disabled', 'input:disabled', '.btn:disabled', '.player__button:disabled', 'label:has(> input:disabled)', 'label:has(input.switch:disabled)'].forEach((selector) => {
            expect(styleOf(sheet, selector), selector).toEqual({ cursor: 'not-allowed' });
        });
        expect(styleOf(sheet, ".btn[aria-busy='true']")).toEqual({ cursor: 'progress' });
        expect(styleOf(sheet, "button[aria-busy='true']")).toEqual({ cursor: 'progress' });
    });

    it('keeps the text shape for the fields that take text and for the text that is meant to be copied', () => {
        expect(styleOf(sheet, 'textarea:not(:disabled)')).toEqual({ cursor: 'text' });
        expect(styleOf(sheet, '.error-details__text')).toEqual({ cursor: 'text' });
        expect(styleOf(sheet, '.error-details dd')).toEqual({ cursor: 'text' });
        const field = sheet.rules.find((rule) => {
            return rule.selector.startsWith("input:not([type='checkbox'])");
        });
        expect(field?.declarations).toEqual({ cursor: 'text' });
        ["[type='checkbox']", "[type='radio']", "[type='range']", "[type='color']", "[type='button']", "[type='submit']", ':disabled'].forEach((part) => {
            expect(field?.selector, part).toContain(`:not(${part.startsWith(':') ? part : `[${part.slice(1, -1)}]`})`);
        });
    });

    it('does not use the pointer of the system for the shapes it has no say in: it sets only the shapes and never an image', () => {
        expect(sheet.text).not.toMatch(/cursor:\s*url\(/);
    });
});

describe('bp-fun.css: the wave of the name', () => {
    it('is forty pixels tall, with bars of six', () => {
        expect(styleOf(sheet, '.brand__wave')).toEqual({ height: '40px', gap: '4px' });
        expect(styleOf(sheet, '.brand__bar')).toEqual({ width: '6px' });
    });
});

describe('bp-fun.css: the pictures of the menu stay in their boxes', () => {
    it('never grow the picture of a section by more than a tenth, and never with a spring that overshoots', () => {
        ['bp-icon-hop', 'bp-icon-drop', 'bp-icon-pulse', 'bp-icon-page'].forEach((name) => {
            const body = keyframesOf(sheet, name)?.body ?? '';
            [...body.matchAll(/scale\(([0-9.]+)\)/g)].forEach((match) => {
                expect(Number(match[1]), name).toBeLessThanOrEqual(1.1);
            });
        });
        ['home', 'downloads', 'anime', 'manga'].forEach((section) => {
            expect(styleOf(sheet, `.sidenav .tab:hover .section-icon--${section}`).animation, section).toContain('var(--bp-ease-');
        });
        expect(styleOf(sheet, '.sidenav .tab:hover .section-icon--anime').animation).not.toContain('spring');
    });
});

describe('bp-fun.css: what was in the way of something else', () => {
    it('cuts the part watched of the timeline at the start of the bar, so its glow and the light at its head do not spill out on the left', () => {
        expect(styleOf(sheet, '.player__timeline .progress__bar')).toEqual({ 'clip-path': 'inset(-8px -14px -8px 0)' });
    });

    it('puts the notices at the top of the video while it plays, away from the panel of the next episode and from the bar, and above the buttons of the reader', () => {
        expect(styleOf(sheet, 'body:has(.player) .toasts')).toEqual({ top: '124px', right: '36px', bottom: 'auto' });
        expect(styleOf(sheet, 'body:has(.reader) .toasts')).toEqual({ bottom: '88px' });
    });
});
