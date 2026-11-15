import type { ReaderDirection } from './readerPrefs';

export type ClickZone = 'previous' | 'next' | 'middle' | 'none';

export const MIDDLE_STRIP_FROM = 0.4;
export const MIDDLE_STRIP_TO = 0.6;
export const SIDE_SHARE_ONE_PAGE = 0.4;
export const SIDE_SHARE_TWO_PAGES = 0.25;

export function clickZone(fraction: number, twoPages: boolean, direction: ReaderDirection): ClickZone {
    const side = twoPages ? SIDE_SHARE_TWO_PAGES : SIDE_SHARE_ONE_PAGE;
    if (fraction < side || fraction > 1 - side) {
        const onLeft = fraction < 0.5;
        return onLeft === (direction === 'ltr') ? 'previous' : 'next';
    }
    return fraction >= MIDDLE_STRIP_FROM && fraction <= MIDDLE_STRIP_TO ? 'middle' : 'none';
}
