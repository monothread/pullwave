import { readStylesheet, styleOf } from '../../helpers/cssRules';

const cyberpunk = readStylesheet('cyberpunk.css');
const consoleLayer = readStylesheet('console.css');
const funLayer = readStylesheet('bp-fun.css');

// How much a selector weighs, as (ids, classes and attributes, elements), to know which rule wins.
function specificity(selector: string): [number, number, number] {
    const withoutNot = selector.replace(/:not\(([^)]*)\)/g, ' $1');
    const ids = (withoutNot.match(/#[\w-]+/g) ?? []).length;
    const classes = (withoutNot.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
    const elements = (withoutNot.replace(/\[[^\]]+\]/g, '').match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
    return [ids, classes, elements];
}

function heavier(first: string, second: string): boolean {
    const [a, b] = [specificity(first), specificity(second)];
    return a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];
}

describe('the end of a list drawn a part at a time', () => {
    it('takes a line of the grid of its own, with no mark of a list item', () => {
        expect(styleOf(cyberpunk, '.list-more')).toEqual({ 'min-height': '1px', 'grid-column': '1 / -1', 'list-style': 'none' });
    });
});

describe('the spacer of a block of a long list that is not drawn', () => {
    it('takes a line of the grid of its own, with no mark, margin or padding', () => {
        expect(styleOf(cyberpunk, '.list-window__spacer')).toEqual({ 'grid-column': '1 / -1', 'list-style': 'none', margin: '0', padding: '0' });
    });
});

describe('a card of a long list drawn again after its block left the screen', () => {
    it.each(['.cover-grid > .cover-card[data-window-back]', '[data-window-back] .cover-grid > .cover-card', '.cover-card[data-window-back] img.cover', '[data-window-back] .cover-card img.cover'])(
        'does not play the entrance of %s again',
        (selector) => {
            expect(styleOf(cyberpunk, selector)).toEqual({ animation: 'none' });
        }
    );

    it('shows its cover sharp, not blurred as one that is still loading', () => {
        expect(styleOf(cyberpunk, '[data-window-back] .cover--loading')).toEqual({ filter: 'none', opacity: '1' });
    });

    it('wins over the entrance of the cards and of their covers, which come in later style sheets', () => {
        expect(styleOf(consoleLayer, '.cover-grid > .cover-card')['animation']).toBe('bp-rise 0.4s var(--bp-ease-out) backwards');
        expect(styleOf(funLayer, 'img.cover:not(.cover--loading)')['animation']).toBe('bp-cover-focus 0.6s var(--bp-ease-out) backwards');
        expect(styleOf(funLayer, '.cover--loading')).toEqual({ filter: 'blur(14px) saturate(1.4)', opacity: '0.6' });
        expect(heavier('.cover-grid > .cover-card[data-window-back]', '.cover-grid > .cover-card')).toBe(true);
        expect(heavier('[data-window-back] .cover-grid > .cover-card', '.cover-grid > .cover-card')).toBe(true);
        expect(heavier('.cover-card[data-window-back] img.cover', 'img.cover:not(.cover--loading)')).toBe(true);
        expect(heavier('[data-window-back] .cover-card img.cover', 'img.cover:not(.cover--loading)')).toBe(true);
        expect(heavier('[data-window-back] .cover--loading', '.cover--loading')).toBe(true);
    });

    it('leaves the entrance of the cards drawn for the first time as it is', () => {
        expect(cyberpunk.rules.filter((rule) => {
            return rule.selector.includes('data-window-back') === false && rule.selector.includes('cover-card') && rule.declarations['animation'] === 'none';
        })).toEqual([]);
    });
});
