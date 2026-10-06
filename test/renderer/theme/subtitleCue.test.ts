import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const THEME_DIRECTORY = resolve(__dirname, '../../../src/renderer/theme');
const CYBERPUNK_CSS = readFileSync(resolve(THEME_DIRECTORY, 'cyberpunk.css'), 'utf-8');
const THEME_FILES = ['cyberpunk.css', 'themes.css', 'responsive.css'];

const OUTLINE_COLOR = '#0b1a4a';
const OUTLINE_RINGS_EM = [0.12, 0.06];
const OUTLINE_STEPS = 16;

function readCueRule(): string {
    const match = /\.player__video::cue\s*\{([^}]*)\}/.exec(CYBERPUNK_CSS);
    if (!match?.[1]) {
        throw new Error('The rule of the subtitles was not found');
    }
    return match[1];
}

function readDeclarations(rule: string): Record<string, string> {
    const declarations: Record<string, string> = {};
    rule.split(';').forEach((declaration) => {
        const separator = declaration.indexOf(':');
        if (separator > 0) {
            declarations[declaration.slice(0, separator).trim()] = declaration.slice(separator + 1).replace(/\s+/g, ' ').trim();
        }
    });
    return declarations;
}

// The layers of the shadow, split by the commas that are not inside a color like rgba(...).
function splitLayers(shadow: string): string[] {
    return shadow.split(/,\s*(?![^(]*\))/);
}

function expectedOutline(): string[] {
    const layers: string[] = [];
    OUTLINE_RINGS_EM.forEach((radius) => {
        for (let step = 0; step < OUTLINE_STEPS; step += 1) {
            const angle = (2 * Math.PI * step) / OUTLINE_STEPS;
            layers.push(`${(Math.cos(angle) * radius).toFixed(3)}em ${(Math.sin(angle) * radius).toFixed(3)}em 0 ${OUTLINE_COLOR}`);
        }
    });
    return layers;
}

describe('the style of the subtitles (.player__video::cue)', () => {
    const declarations = readDeclarations(readCueRule());
    const shadow = declarations['text-shadow'] ?? '';

    it('is one lettering for every theme: lavender-white, bold, wide and with no box behind it', () => {
        expect(declarations.color).toBe('#f6e9ff');
        expect(declarations.background).toBe('transparent');
        expect(declarations['font-weight']).toBe('700');
        expect(declarations['font-family']).toBe("Verdana, 'DejaVu Sans', 'Open Sans', sans-serif");
    });

    it('follows the size the viewer chose and reads no variable for the color, the font or the background', () => {
        expect(declarations['font-size']).toBe('calc(var(--subtitle-scale, 1) * 100%)');
        expect(Object.values(declarations).join(' ')).not.toMatch(/--subtitle-(color|background|font|weight|text-shadow)/);
    });

    it('draws the navy outline with two rings of 16 shadows in em, then a soft drop shadow', () => {
        const layers = splitLayers(shadow);
        expect(layers).toHaveLength(OUTLINE_RINGS_EM.length * OUTLINE_STEPS + 1);
        expect(layers.slice(0, -1)).toEqual(expectedOutline());
        expect(layers[layers.length - 1]).toBe('0 0.08em 0.1em rgba(0, 0, 0, 0.6)');
    });

    it('is written once: no other style sheet changes the subtitles', () => {
        THEME_FILES.filter((file) => {
            return file !== 'cyberpunk.css';
        }).forEach((file) => {
            expect(readFileSync(resolve(THEME_DIRECTORY, file), 'utf-8')).not.toContain('::cue');
        });
        expect(CYBERPUNK_CSS.match(/::cue/g)).toHaveLength(1);
    });
});
