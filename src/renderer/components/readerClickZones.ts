import type { ReaderDirection } from './readerPrefs';

// Where a click on the stage of the reader (one page at a time, or two side by side) falls, from how far across it the click was (0 at the left
// edge, 1 at the right edge): on the side it turns the page, in the strip in the middle a double click puts the reader in fullscreen, and between
// the two (only with two pages, where the sides are the corners) it does nothing.
export type ClickZone = 'previous' | 'next' | 'middle' | 'none';

// The strip in the middle, as a share of the width of the stage.
export const MIDDLE_STRIP_FROM = 0.4;
export const MIDDLE_STRIP_TO = 0.6;
// How much of the stage each side takes: with one page a half is left on each side of the strip (a click anywhere else turns the page); with two
// pages only the corner, so a click on a page does not turn it by accident.
export const SIDE_SHARE_ONE_PAGE = 0.4;
export const SIDE_SHARE_TWO_PAGES = 0.25;

export function clickZone(fraction: number, twoPages: boolean, direction: ReaderDirection): ClickZone {
    const side = twoPages ? SIDE_SHARE_TWO_PAGES : SIDE_SHARE_ONE_PAGE;
    if (fraction < side || fraction > 1 - side) {
        // From the left the right side goes forward; from the right (a manga) the left side does.
        const onLeft = fraction < 0.5;
        return onLeft === (direction === 'ltr') ? 'previous' : 'next';
    }
    return fraction >= MIDDLE_STRIP_FROM && fraction <= MIDDLE_STRIP_TO ? 'middle' : 'none';
}
