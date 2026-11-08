// @vitest-environment jsdom
import {
    FIND_DOUBLE_MS,
    focusField,
    globalSearchField,
    isEditable,
    sectionStepOf,
    GLOBAL_SEARCH_SELECTOR,
    isDoubleFind,
    isFindShortcut,
    localSearchField,
    LOCAL_SEARCH_SELECTOR,
    openModal,
    tabStepOf,
    type ShortcutKey
} from '@renderer/navigation/searchShortcuts';

function key(name: string, modifiers: Partial<Omit<ShortcutKey, 'key'>> = {}): ShortcutKey {
    return { key: name, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...modifiers };
}

afterEach(() => {
    document.body.innerHTML = '';
});

describe('the constants', () => {
    it('wait six tenths of a second for the second Ctrl+F, and look for the fields by what marks them', () => {
        expect(FIND_DOUBLE_MS).toBe(600);
        expect(LOCAL_SEARCH_SELECTOR).toBe('[data-search-field]');
        expect(GLOBAL_SEARCH_SELECTOR).toBe('.global-search__input');
    });
});

describe('isFindShortcut', () => {
    it.each(['f', 'F'])('is Ctrl+%s', (letter) => {
        expect(isFindShortcut(key(letter, { ctrlKey: true }))).toBe(true);
    });

    it('is not the letter alone, nor with Alt, Shift or Meta, nor another letter', () => {
        expect(isFindShortcut(key('f'))).toBe(false);
        expect(isFindShortcut(key('f', { ctrlKey: true, altKey: true }))).toBe(false);
        expect(isFindShortcut(key('f', { ctrlKey: true, shiftKey: true }))).toBe(false);
        expect(isFindShortcut(key('f', { ctrlKey: true, metaKey: true }))).toBe(false);
        expect(isFindShortcut(key('g', { ctrlKey: true }))).toBe(false);
    });
});

describe('tabStepOf', () => {
    it('is -1 for Ctrl+Page Up and 1 for Ctrl+Page Down', () => {
        expect(tabStepOf(key('PageUp', { ctrlKey: true }))).toBe(-1);
        expect(tabStepOf(key('PageDown', { ctrlKey: true }))).toBe(1);
    });

    it('is null for the keys alone, with other modifiers, or for other keys', () => {
        expect(tabStepOf(key('PageUp'))).toBeNull();
        expect(tabStepOf(key('PageDown'))).toBeNull();
        expect(tabStepOf(key('PageDown', { ctrlKey: true, shiftKey: true }))).toBeNull();
        expect(tabStepOf(key('PageDown', { ctrlKey: true, altKey: true }))).toBeNull();
        expect(tabStepOf(key('PageDown', { ctrlKey: true, metaKey: true }))).toBeNull();
        expect(tabStepOf(key('Tab', { ctrlKey: true }))).toBeNull();
        expect(tabStepOf(key('ArrowDown', { ctrlKey: true }))).toBeNull();
    });
});

describe('isDoubleFind', () => {
    it('is true for a second press up to 600 ms after the first, and false after', () => {
        expect(isDoubleFind(1000, 1001)).toBe(true);
        expect(isDoubleFind(1000, 1600)).toBe(true);
        expect(isDoubleFind(1000, 1601)).toBe(false);
    });

    it('is false when there was no earlier press', () => {
        expect(isDoubleFind(0, 100)).toBe(false);
    });
});

function mount(html: string): void {
    document.body.innerHTML = html;
}

describe('localSearchField', () => {
    it('is the first field of the page that searches, not a field that does not and not one of another part of the app', () => {
        mount(`
            <input id="top" data-search-field />
            <main class="app__main">
                <input id="plain" />
                <input id="first" data-search-field />
                <input id="second" data-search-field />
            </main>`);
        expect(localSearchField()?.id).toBe('first');
    });

    it('is null on a page with no field that searches, or with no page', () => {
        mount('<main class="app__main"><input id="plain" /></main>');
        expect(localSearchField()).toBeNull();
        mount('<input data-search-field />');
        expect(localSearchField()).toBeNull();
    });

    it('skips a field that is disabled, hidden, inert, out of the accessibility tree or taken out of the layout', () => {
        mount(`
            <main class="app__main">
                <input id="off" data-search-field disabled />
                <div hidden><input id="hidden" data-search-field /></div>
                <div inert><input id="inert" data-search-field /></div>
                <div aria-hidden="true"><input id="aria" data-search-field /></div>
                <input id="none" data-search-field style="display: none" />
                <input id="ok" data-search-field />
            </main>`);
        expect(localSearchField()?.id).toBe('ok');
    });

    it('looks inside the window that is open over the page, and nowhere else', () => {
        mount(`
            <main class="app__main"><input id="page" data-search-field /></main>
            <div role="dialog" aria-modal="true"><input id="window" data-search-field /></div>`);
        expect(localSearchField()?.id).toBe('window');
        mount(`
            <main class="app__main"><input id="page" data-search-field /></main>
            <div role="dialog" aria-modal="true"><button type="button">OK</button></div>`);
        expect(localSearchField()).toBeNull();
    });
});

describe('openModal', () => {
    it('is the last window that is open, or null with none', () => {
        expect(openModal()).toBeNull();
        mount('<div role="dialog" aria-modal="true" id="a"></div><div role="dialog" aria-modal="true" id="b"></div><div role="dialog" id="c"></div>');
        expect(openModal()?.id).toBe('b');
    });
});

describe('globalSearchField', () => {
    it('is the search of the top bar', () => {
        mount('<header><input class="global-search__input" id="global" /></header>');
        expect(globalSearchField()?.id).toBe('global');
    });

    it('is null when it is not there, is disabled or hidden, or a window is open over the app', () => {
        expect(globalSearchField()).toBeNull();
        mount('<input class="global-search__input" disabled />');
        expect(globalSearchField()).toBeNull();
        mount('<div hidden><input class="global-search__input" /></div>');
        expect(globalSearchField()).toBeNull();
        mount('<input class="global-search__input" /><div role="dialog" aria-modal="true"></div>');
        expect(globalSearchField()).toBeNull();
    });
});

describe('focusField', () => {
    it('puts the cursor in the field with what it holds selected', () => {
        mount('<input id="field" value="one piece" />');
        const field = document.getElementById('field') as HTMLInputElement;
        focusField(field);
        expect(document.activeElement).toBe(field);
        expect([field.selectionStart, field.selectionEnd]).toEqual([0, 9]);
    });
});

describe('sectionStepOf', () => {
    it('is -1 for Ctrl+Home and 1 for Ctrl+End', () => {
        expect(sectionStepOf(key('Home', { ctrlKey: true }))).toBe(-1);
        expect(sectionStepOf(key('End', { ctrlKey: true }))).toBe(1);
    });

    it('is null for the keys alone, with other modifiers, or for other keys', () => {
        expect(sectionStepOf(key('Home'))).toBeNull();
        expect(sectionStepOf(key('End'))).toBeNull();
        expect(sectionStepOf(key('End', { ctrlKey: true, shiftKey: true }))).toBeNull();
        expect(sectionStepOf(key('Home', { ctrlKey: true, altKey: true }))).toBeNull();
        expect(sectionStepOf(key('Home', { ctrlKey: true, metaKey: true }))).toBeNull();
        expect(sectionStepOf(key('PageDown', { ctrlKey: true }))).toBeNull();
    });
});

describe('isEditable', () => {
    function made(html: string): HTMLElement {
        document.body.innerHTML = html;
        return document.body.firstElementChild as HTMLElement;
    }

    it.each(['<input />', '<input type="text" />', '<input type="search" />', '<input type="number" />', '<input type="password" />', '<input type="email" />', '<input type="url" />', '<input type="tel" />', '<textarea></textarea>', '<select><option>a</option></select>'])('is true for %s', (html) => {
        expect(isEditable(made(html))).toBe(true);
    });

    it.each(['<input type="checkbox" />', '<input type="radio" />', '<input type="range" />', '<input type="button" />', '<input type="color" />', '<button type="button">OK</button>', '<div>text</div>'])('is false for %s', (html) => {
        expect(isEditable(made(html))).toBe(false);
    });

    it('is true for a text that can be edited, when the browser says so', () => {
        const editable = made('<div>text</div>');
        Object.defineProperty(editable, 'isContentEditable', { value: true });
        expect(isEditable(editable)).toBe(true);
    });

    it('is false for nothing and for what is not an element', () => {
        expect(isEditable(null)).toBe(false);
        expect(isEditable(window)).toBe(false);
        expect(isEditable(document)).toBe(false);
    });
});
