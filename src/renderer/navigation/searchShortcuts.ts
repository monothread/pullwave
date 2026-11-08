// The keys that go straight to a search and that move through the tabs of a section: Ctrl+F finds the search of the screen, Ctrl+F twice
// finds the search of the whole app, Ctrl+Page Up and Ctrl+Page Down move through the tabs of the section.

// How soon the second Ctrl+F has to come after the first for the two to count as one "twice" (milliseconds).
export const FIND_DOUBLE_MS = 600;

// The fields that search what the screen shows carry this attribute (see TextField).
export const LOCAL_SEARCH_SELECTOR = '[data-search-field]';
// The search of the top bar.
export const GLOBAL_SEARCH_SELECTOR = '.global-search__input';
const MODAL_SELECTOR = '[role="dialog"][aria-modal="true"]';
const MAIN_SELECTOR = '.app__main';

// What of a key press the shortcuts need to know.
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

// Ctrl+F, with the letter in either case (caps lock) and no other modifier.
export function isFindShortcut(event: ShortcutKey): boolean {
    return onlyControl(event) && event.key.toLowerCase() === 'f';
}

// The way Ctrl+Page Up (-1) and Ctrl+Page Down (1) move through the tabs; null for any other key.
export function tabStepOf(event: ShortcutKey): -1 | 1 | null {
    if (!onlyControl(event)) {
        return null;
    }
    if (event.key === 'PageUp') {
        return -1;
    }
    return event.key === 'PageDown' ? 1 : null;
}

// Whether a second Ctrl+F at `now` follows the one at `last` closely enough (a `last` of 0 is no earlier press).
export function isDoubleFind(last: number, now: number): boolean {
    return last > 0 && now - last <= FIND_DOUBLE_MS;
}

// Whether something of the page can be seen and reached: not hidden, not inert, not out of the accessibility tree, not taken out of the layout.
function reachable(element: HTMLElement): boolean {
    if (element.closest('[hidden], [inert], [aria-hidden="true"]') !== null) {
        return false;
    }
    return getComputedStyle(element).display !== 'none';
}

// The window that is open over the app, the last one when there are several.
export function openModal(root: ParentNode = document): HTMLElement | null {
    const modals = root.querySelectorAll<HTMLElement>(MODAL_SELECTOR);
    return modals.item(modals.length - 1);
}

// The search of the screen: the first field of the open window that searches, and with none open the first one of the page that is shown.
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

// The search of the top bar, which a window that is open over the app does not leave within reach.
export function globalSearchField(root: ParentNode = document): HTMLInputElement | null {
    if (openModal(root) !== null) {
        return null;
    }
    const field = root.querySelector<HTMLInputElement>(GLOBAL_SEARCH_SELECTOR);
    return field !== null && !field.disabled && reachable(field) ? field : null;
}

// Puts the cursor in the field with what it holds selected, so typing replaces the last search.
export function focusField(field: HTMLInputElement): void {
    field.focus();
    field.select();
}

// The way Ctrl+Home (-1, toward the first section) and Ctrl+End (1, toward the last) move through the sections of the app; null for any other key.
export function sectionStepOf(event: ShortcutKey): -1 | 1 | null {
    if (!onlyControl(event)) {
        return null;
    }
    if (event.key === 'Home') {
        return -1;
    }
    return event.key === 'End' ? 1 : null;
}

// The kinds of field where Home and End move the cursor through the text, so Ctrl+Home and Ctrl+End belong to the field.
const TEXT_INPUT_TYPES: ReadonlySet<string> = new Set(['', 'text', 'search', 'number', 'password', 'email', 'url', 'tel']);

// Whether a key pressed on `target` is typed into something: a field of text, a list of choices or a text that can be edited.
export function isEditable(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
        return false;
    }
    if (target instanceof HTMLInputElement) {
        return TEXT_INPUT_TYPES.has(target.type);
    }
    return target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable === true;
}

