import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const THEME_DIRECTORY = resolve(__dirname, '../../src/renderer/theme');

export interface CssRule {
    selector: string;
    declarations: Record<string, string>;
    // The prelude of the at-rule the rule is in (for example "@media (prefers-reduced-motion: reduce)"), or null at the top.
    media: string | null;
}

export interface CssAtRule {
    prelude: string;
    body: string;
}

function stripComments(css: string): string {
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

// Splits at the commas that are not inside parentheses or brackets (a selector list, the layers of a shadow).
export function splitTopLevel(text: string, separator: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = '';
    for (const character of text) {
        if (character === '(' || character === '[') {
            depth += 1;
        } else if (character === ')' || character === ']') {
            depth -= 1;
        }
        if (character === separator && depth === 0) {
            parts.push(current.trim());
            current = '';
        } else {
            current += character;
        }
    }
    if (current.trim() !== '') {
        parts.push(current.trim());
    }
    return parts;
}

function parseDeclarations(body: string): Record<string, string> {
    const declarations: Record<string, string> = {};
    splitTopLevel(body, ';').forEach((declaration) => {
        const separator = declaration.indexOf(':');
        if (separator > 0) {
            declarations[declaration.slice(0, separator).trim()] = declaration.slice(separator + 1).replace(/\s+/g, ' ').trim();
        }
    });
    return declarations;
}

// The blocks at one level of the text: what comes before each pair of braces and what is inside it.
function blocksOf(css: string): CssAtRule[] {
    const blocks: CssAtRule[] = [];
    let depth = 0;
    let prelude = '';
    let body = '';
    for (const character of css) {
        if (character === '{') {
            depth += 1;
            if (depth === 1) {
                continue;
            }
        } else if (character === '}') {
            depth -= 1;
            if (depth === 0) {
                blocks.push({ prelude: prelude.trim(), body });
                prelude = '';
                body = '';
                continue;
            }
        }
        if (depth === 0) {
            prelude += character;
        } else {
            body += character;
        }
    }
    return blocks;
}

function collect(css: string, media: string | null, rules: CssRule[], atRules: CssAtRule[]): void {
    blocksOf(css).forEach((block) => {
        if (block.prelude.startsWith('@media') || block.prelude.startsWith('@container')) {
            collect(block.body, block.prelude, rules, atRules);
        } else if (block.prelude.startsWith('@')) {
            atRules.push(block);
        } else {
            splitTopLevel(block.prelude, ',').forEach((selector) => {
                rules.push({ selector: selector.replace(/\s+/g, ' '), declarations: parseDeclarations(block.body), media });
            });
        }
    });
}

export interface Stylesheet {
    rules: CssRule[];
    atRules: CssAtRule[];
    text: string;
}

export function readStylesheet(name: string): Stylesheet {
    const text = stripComments(readFileSync(resolve(THEME_DIRECTORY, name), 'utf-8'));
    const rules: CssRule[] = [];
    const atRules: CssAtRule[] = [];
    collect(text, null, rules, atRules);
    return { rules, atRules, text };
}

// What a selector ends up with at the top of the sheet (not inside an @media), the later rules winning over the earlier ones.
export function styleOf(sheet: Stylesheet, selector: string): Record<string, string> {
    return Object.assign(
        {},
        ...sheet.rules
            .filter((rule) => {
                return rule.selector === selector && rule.media === null;
            })
            .map((rule) => {
                return rule.declarations;
            })
    ) as Record<string, string>;
}

// What the selector gets inside the @media that has the text in its prelude.
export function mediaStyleOf(sheet: Stylesheet, media: string, selector: string): Record<string, string> {
    return Object.assign(
        {},
        ...sheet.rules
            .filter((rule) => {
                return rule.selector === selector && rule.media?.includes(media) === true;
            })
            .map((rule) => {
                return rule.declarations;
            })
    ) as Record<string, string>;
}

export function keyframesOf(sheet: Stylesheet, name: string): CssAtRule | undefined {
    return sheet.atRules.find((block) => {
        return block.prelude === `@keyframes ${name}`;
    });
}
