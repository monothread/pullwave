// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    applyPerformanceMode,
    isPerformanceModeActive,
    PERFORMANCE_MODE_ATTRIBUTE,
    PERFORMANCE_MODE_STORAGE_KEY,
    rememberedPerformanceMode,
    rememberPerformanceMode
} from '@renderer/theme/performanceMode';
import { readStylesheet, styleOf } from '../../helpers/cssRules';

const MAIN_SOURCE = readFileSync(resolve(__dirname, '../../../src/renderer/main.tsx'), 'utf-8');
const sheet = readStylesheet('performance.css');

afterEach(() => {
    document.documentElement.removeAttribute(PERFORMANCE_MODE_ATTRIBUTE);
    window.localStorage.clear();
    vi.restoreAllMocks();
});

describe('performanceMode helper', () => {
    it('applies and removes the root attribute and reports active state', () => {
        expect(isPerformanceModeActive()).toBe(false);
        expect(applyPerformanceMode(true)).toBe(true);
        expect(document.documentElement.hasAttribute(PERFORMANCE_MODE_ATTRIBUTE)).toBe(true);
        expect(isPerformanceModeActive()).toBe(true);
        expect(applyPerformanceMode(false)).toBe(false);
        expect(document.documentElement.hasAttribute(PERFORMANCE_MODE_ATTRIBUTE)).toBe(false);
        expect(isPerformanceModeActive()).toBe(false);
    });

    it('remembers and restores the choice from localStorage and defaults to false', () => {
        expect(rememberedPerformanceMode()).toBe(false);
        rememberPerformanceMode(true);
        expect(window.localStorage.getItem(PERFORMANCE_MODE_STORAGE_KEY)).toBe('on');
        expect(rememberedPerformanceMode()).toBe(true);
        rememberPerformanceMode(false);
        expect(window.localStorage.getItem(PERFORMANCE_MODE_STORAGE_KEY)).toBe('off');
        expect(rememberedPerformanceMode()).toBe(false);
    });

    it('treats unknown stored values as disabled', () => {
        window.localStorage.setItem(PERFORMANCE_MODE_STORAGE_KEY, 'yes');
        expect(rememberedPerformanceMode()).toBe(false);
    });

    it('does not throw when localStorage is unavailable', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        expect(() => {
            rememberPerformanceMode(true);
        }).not.toThrow();
        expect(rememberedPerformanceMode()).toBe(false);
    });
});

function splitTopLevelSelectors(selector: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index < selector.length; index += 1) {
        const char = selector[index];
        if (char === '(' || char === '[') {
            depth += 1;
        } else if (char === ')' || char === ']') {
            depth -= 1;
        } else if (char === ',' && depth === 0) {
            parts.push(selector.slice(start, index).trim());
            start = index + 1;
        }
    }
    parts.push(selector.slice(start).trim());
    return parts;
}

describe('performance.css', () => {
    it('is loaded last in main.tsx after bp-fun.css so its overrides take effect', () => {
        const bpFun = MAIN_SOURCE.indexOf("import './theme/bp-fun.css';");
        const perf = MAIN_SOURCE.indexOf("import './theme/performance.css';");
        expect(bpFun).toBeGreaterThan(-1);
        expect(perf).toBeGreaterThan(bpFun);
    });

    it('scopes every individual selector under :root[data-performance-mode]', () => {
        expect(sheet.rules.length).toBeGreaterThan(20);
        sheet.rules.forEach((rule) => {
            splitTopLevelSelectors(rule.selector).forEach((part) => {
                expect(part.startsWith(':root[data-performance-mode]'), part).toBe(true);
            });
        });
    });

    it('keeps the aurora visible statically without drifting and removes heavy blurs and progress mask pulses', () => {
        expect(styleOf(sheet, ':root[data-performance-mode] body::before')).toEqual({ inset: '0', animation: 'none' });
        expect(styleOf(sheet, ':root[data-performance-mode] .topbar')['backdrop-filter']).toBe('none');
        expect(styleOf(sheet, ':root[data-performance-mode] .sidenav')['backdrop-filter']).toBe('none');
        expect(styleOf(sheet, ':root[data-performance-mode] .progress')).toMatchObject({ overflow: 'hidden', animation: 'none' });
        expect(styleOf(sheet, ':root[data-performance-mode] .progress .progress__bar')).toMatchObject({
            filter: 'none',
            'mask-image': 'none',
            'box-shadow': 'none',
            animation: 'none'
        });
        expect(styleOf(sheet, ":root[data-performance-mode][data-theme-style='neon'] .progress .progress__bar")['box-shadow']).toContain('8px');
        expect(styleOf(sheet, ':root[data-performance-mode] .download-hero--done .progress .progress__bar')).toEqual({ background: 'var(--green)' });
        expect(styleOf(sheet, ':root[data-performance-mode] .btn--primary::after')).toEqual({ display: 'none', animation: 'none' });
        expect(styleOf(sheet, ':root[data-performance-mode] .spotlight__dot--current::after')).toEqual({ display: 'none', animation: 'none' });
        expect(styleOf(sheet, ':root[data-performance-mode] .backdrop')).toEqual({ display: 'none' });
        expect(styleOf(sheet, ":root[data-performance-mode][data-theme='high-contrast'] .hero")).toEqual({ background: 'var(--panel)' });
        expect(styleOf(sheet, ':root[data-performance-mode] .disk__segment--folder')).toMatchObject({ filter: 'none' });
        expect(styleOf(sheet, ':root[data-performance-mode] .not-found__lens svg')).toEqual({ filter: 'none' });
        expect(sheet.text).not.toContain('.reader__complete');
    });
});
