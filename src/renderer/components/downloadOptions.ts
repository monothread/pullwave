import { MAX_LIVE_END_CHECK_SECONDS, MIN_LIVE_END_CHECK_SECONDS } from '@shared/constants';
import type { DownloadOptions } from '@shared/types';

export const FOLLOW_SETTING = '';
export const SWITCH_ON = 'on';
export const SWITCH_OFF = 'off';
export type SwitchChoice = typeof FOLLOW_SETTING | typeof SWITCH_ON | typeof SWITCH_OFF;

export function hasOptions(options: DownloadOptions): boolean {
    return Object.keys(options).length > 0;
}

export function switchChoice(value: boolean | undefined): SwitchChoice {
    if (value === undefined) {
        return FOLLOW_SETTING;
    }
    return value ? SWITCH_ON : SWITCH_OFF;
}

export function switchValue(choice: string): boolean | undefined {
    if (choice === FOLLOW_SETTING) {
        return undefined;
    }
    return choice === SWITCH_ON;
}

export function withOption<K extends keyof DownloadOptions>(options: DownloadOptions, key: K, value: DownloadOptions[K] | undefined): DownloadOptions {
    const next: DownloadOptions = { ...options };
    delete next[key];
    if (value !== undefined) {
        next[key] = value;
    }
    return next;
}

export function clampCheckSeconds(seconds: number): number {
    return Math.min(MAX_LIVE_END_CHECK_SECONDS, Math.max(MIN_LIVE_END_CHECK_SECONDS, Math.round(seconds)));
}
