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

export const NAVIGABLE_SELECTOR = 'button:not([disabled]), a[href], summary, [role="button"]:not([aria-disabled="true"]), [tabindex]:not([tabindex="-1"]):not(input):not(select):not(textarea)';

export const OWN_ARROWS_SELECTOR = '.player, .reader';

const SCOPE_SELECTOR = '[role="dialog"][aria-modal="true"], .app';

const CROSS_AXIS_WEIGHT = 3;

export function directionOfKey(key: string): Direction | null {
    return DIRECTION_BY_KEY[key] ?? null;
}

function centerOf(box: Box): { x: number; y: number } {
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

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

export function scopeOf(element: Element): HTMLElement | null {
    return element.closest<HTMLElement>(SCOPE_SELECTOR);
}

export function arrowsAreOwned(root: ParentNode = document): boolean {
    return root.querySelector(OWN_ARROWS_SELECTOR) !== null;
}

export function candidatesIn(scope: HTMLElement, from: HTMLElement): Array<Candidate<HTMLElement>> {
    return Array.from(scope.querySelectorAll<HTMLElement>(NAVIGABLE_SELECTOR))
        .filter((element) => {
            return element !== from && isShown(element) && scopeOf(element) === scope;
        })
        .map((element) => {
            return { item: element, box: boxOf(element) };
        });
}

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

export function firstFocusTarget(root: ParentNode = document): HTMLElement | null {
    return root.querySelector<HTMLElement>('.tabs--main [aria-current="page"]') ?? root.querySelector<HTMLElement>('.tabs--main button');
}

export function shouldMoveFocus(event: KeyboardEvent, active: Element | null): active is HTMLElement {
    if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
        return false;
    }
    if (directionOfKey(event.key) === null || !isNavigable(active)) {
        return false;
    }
    return scopeOf(active) !== null && !arrowsAreOwned();
}
