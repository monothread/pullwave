// Moving the focus with the arrow keys or the directional pad of a gamepad, like the interface of a console: the next control is the one
// closest to the focused one in the direction asked for. The screens that already use the arrows (the player and the reader) keep them.

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Box {
    left: number;
    top: number;
    width: number;
    height: number;
}

export interface Candidate<T> {
    item: T;
    box: Box;
}

const DIRECTION_BY_KEY: Readonly<Record<string, Direction>> = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right'
};

// The controls the focus can land on. The fields are left out: inside them the arrows move the caret, the value or the choice.
export const NAVIGABLE_SELECTOR = 'button:not([disabled]), a[href], summary, [role="button"]:not([aria-disabled="true"]), [tabindex]:not([tabindex="-1"]):not(input):not(select):not(textarea)';

// Screens that use the arrows themselves: the focus is never moved inside them.
export const OWN_ARROWS_SELECTOR = '.player, .reader';

// The place the focus may move in: an open window keeps it, otherwise the whole app.
const SCOPE_SELECTOR = '[role="dialog"][aria-modal="true"], .app';

// How much a step to the side weighs against a step in the direction asked for: the control right below wins over a closer one off to the side.
const CROSS_AXIS_WEIGHT = 3;

export function directionOfKey(key: string): Direction | null {
    return DIRECTION_BY_KEY[key] ?? null;
}

function centerOf(box: Box): { x: number; y: number } {
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

// How far a box is from another in a direction: null when it is not in that direction at all.
function distanceTowards(from: Box, to: Box, direction: Direction): number | null {
    const origin = centerOf(from);
    const target = centerOf(to);
    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    const along = { up: -dy, down: dy, left: -dx, right: dx }[direction];
    const across = direction === 'up' || direction === 'down' ? Math.abs(dx) : Math.abs(dy);
    if (along <= 0) {
        return null;
    }
    return along + across * CROSS_AXIS_WEIGHT;
}

// The candidate closest to the box in the direction, or null when there is none that way.
export function pickNext<T>(from: Box, candidates: ReadonlyArray<Candidate<T>>, direction: Direction): T | null {
    let best: T | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
        const distance = distanceTowards(from, candidate.box, direction);
        if (distance !== null && distance < bestDistance) {
            best = candidate.item;
            bestDistance = distance;
        }
    }
    return best;
}

function boxOf(element: Element): Box {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function isShown(element: HTMLElement): boolean {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden';
}

export function isNavigable(element: Element | null): element is HTMLElement {
    return element instanceof HTMLElement && element.matches(NAVIGABLE_SELECTOR);
}

// The place the focus may move in from an element, or null when the element is not in the app.
export function scopeOf(element: Element): HTMLElement | null {
    return element.closest<HTMLElement>(SCOPE_SELECTOR);
}

// Whether the arrows belong to the screen: a player or the reader is open, so they seek, change the volume or turn the pages.
export function arrowsAreOwned(root: ParentNode = document): boolean {
    return root.querySelector(OWN_ARROWS_SELECTOR) !== null;
}

// The controls of the scope the focus can move to from the element.
export function candidatesIn(scope: HTMLElement, from: HTMLElement): Array<Candidate<HTMLElement>> {
    return Array.from(scope.querySelectorAll<HTMLElement>(NAVIGABLE_SELECTOR))
        .filter((element) => {
            return element !== from && isShown(element) && scopeOf(element) === scope;
        })
        .map((element) => {
            return { item: element, box: boxOf(element) };
        });
}

// Moves the focus from the element to the next control in the direction; says whether it moved.
export function moveFocus(from: HTMLElement, direction: Direction): boolean {
    const scope = scopeOf(from);
    if (scope === null) {
        return false;
    }
    const next = pickNext(boxOf(from), candidatesIn(scope, from), direction);
    if (next === null) {
        return false;
    }
    next.focus();
    next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return true;
}

// The first control to take the focus when nothing has it (a gamepad was just picked up): the active section of the navigation.
export function firstFocusTarget(root: ParentNode = document): HTMLElement | null {
    return root.querySelector<HTMLElement>('.tabs--main [aria-current="page"]') ?? root.querySelector<HTMLElement>('.tabs--main button');
}

// Whether an arrow key press should move the focus: a plain arrow, not taken by anyone before, on a control of the app, with no screen
// open that uses the arrows itself.
export function shouldMoveFocus(event: KeyboardEvent, active: Element | null): active is HTMLElement {
    if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
        return false;
    }
    if (directionOfKey(event.key) === null || !isNavigable(active)) {
        return false;
    }
    return scopeOf(active) !== null && !arrowsAreOwned();
}
