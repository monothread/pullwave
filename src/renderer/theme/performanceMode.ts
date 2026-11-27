export const PERFORMANCE_MODE_ATTRIBUTE = 'data-performance-mode';
export const PERFORMANCE_MODE_STORAGE_KEY = 'pullwave-performance-mode';

export function applyPerformanceMode(enabled: boolean): boolean {
    document.documentElement.toggleAttribute(PERFORMANCE_MODE_ATTRIBUTE, enabled);
    return enabled;
}

export function isPerformanceModeActive(): boolean {
    return document.documentElement.hasAttribute(PERFORMANCE_MODE_ATTRIBUTE);
}

export function rememberPerformanceMode(enabled: boolean): void {
    try {
        window.localStorage.setItem(PERFORMANCE_MODE_STORAGE_KEY, enabled ? 'on' : 'off');
    } catch {
        return;
    }
}

export function rememberedPerformanceMode(): boolean {
    try {
        return window.localStorage.getItem(PERFORMANCE_MODE_STORAGE_KEY) === 'on';
    } catch {
        return false;
    }
}
