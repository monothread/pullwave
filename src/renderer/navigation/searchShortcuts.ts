export const FIND_DOUBLE_MS = 600;

export const LOCAL_SEARCH_SELECTOR = '[data-search-field]';
export const GLOBAL_SEARCH_SELECTOR = '.global-search__input';
const MODAL_SELECTOR = '[role="dialog"][aria-modal="true"]';
const MAIN_SELECTOR = '.app__main';

export interface ShortcutKey {
    key: string;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
}

function onlyControl(event: ShortcutKey): boolean {
    return event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
}

export function isFindShortcut(event: ShortcutKey): boolean {
    return onlyControl(event) && event.key.toLowerCase() === 'f';
}

export function tabStepOf(event: ShortcutKey): -1 | 1 | null {
    if (!onlyControl(event)) {
        return null;
    }
    if (event.key === 'PageUp') {
        return -1;
    }
    return event.key === 'PageDown' ? 1 : null;
}

export function isDoubleFind(last: number, now: number): boolean {
    return last > 0 && now - last <= FIND_DOUBLE_MS;
}

function reachable(element: HTMLElement): boolean {
    if (element.closest('[hidden], [inert], [aria-hidden="true"]') !== null) {
        return false;
    }
    return getComputedStyle(element).display !== 'none';
}

export function openModal(root: ParentNode = document): HTMLElement | null {
    const modals = root.querySelectorAll<HTMLElement>(MODAL_SELECTOR);
    return modals.item(modals.length - 1);
}

export function localSearchField(root: ParentNode = document): HTMLInputElement | null {
    const scope = openModal(root) ?? root.querySelector<HTMLElement>(MAIN_SELECTOR);
    if (scope === null) {
        return null;
    }
    const fields = Array.from(scope.querySelectorAll<HTMLInputElement>(LOCAL_SEARCH_SELECTOR));
    return (
        fields.find((field) => {
            return !field.disabled && reachable(field);
        }) ?? null
    );
}

export function globalSearchField(root: ParentNode = document): HTMLInputElement | null {
    if (openModal(root) !== null) {
        return null;
    }
    const field = root.querySelector<HTMLInputElement>(GLOBAL_SEARCH_SELECTOR);
    return field !== null && !field.disabled && reachable(field) ? field : null;
}

export function focusField(field: HTMLInputElement): void {
    field.focus();
    field.select();
}

export function sectionStepOf(event: ShortcutKey): -1 | 1 | null {
    if (!onlyControl(event)) {
        return null;
    }
    if (event.key === 'Home') {
        return -1;
    }
    return event.key === 'End' ? 1 : null;
}

const TEXT_INPUT_TYPES: ReadonlySet<string> = new Set(['', 'text', 'search', 'number', 'password', 'email', 'url', 'tel']);

export function isEditable(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
        return false;
    }
    if (target instanceof HTMLInputElement) {
        return TEXT_INPUT_TYPES.has(target.type);
    }
    return target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable === true;
}

