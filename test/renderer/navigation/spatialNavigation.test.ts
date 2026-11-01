// @vitest-environment jsdom
import {
    NAVIGABLE_SELECTOR,
    OWN_ARROWS_SELECTOR,
    arrowsAreOwned,
    candidatesIn,
    directionOfKey,
    firstFocusTarget,
    isNavigable,
    moveFocus,
    pickNext,
    scopeOf,
    shouldMoveFocus,
    type Box,
    type Candidate
} from '@renderer/navigation/spatialNavigation';

const scrollIntoView = vi.fn();

// Places an element on the screen for the code that measures it (jsdom lays nothing out).
function place(element: HTMLElement, box: Box): HTMLElement {
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
        x: box.left,
        y: box.top,
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        right: box.left + box.width,
        bottom: box.top + box.height,
        toJSON: () => {
            return {};
        }
    });
    return element;
}

function button(parent: HTMLElement, label: string, box: Box): HTMLButtonElement {
    const element = document.createElement('button');
    element.textContent = label;
    parent.appendChild(element);
    place(element, box);
    return element;
}

function app(): HTMLElement {
    const root = document.createElement('div');
    root.className = 'app';
    document.body.appendChild(root);
    return root;
}

function keyEvent(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
}

beforeEach(() => {
    document.body.innerHTML = '';
    scrollIntoView.mockClear();
    Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('the selectors', () => {
    it('lists the controls the focus can land on and leaves the fields out', () => {
        expect(NAVIGABLE_SELECTOR).toBe('button:not([disabled]), a[href], summary, [role="button"]:not([aria-disabled="true"]), [tabindex]:not([tabindex="-1"]):not(input):not(select):not(textarea)');
    });

    it('names the screens that use the arrows themselves', () => {
        expect(OWN_ARROWS_SELECTOR).toBe('.player, .reader');
    });
});

describe('directionOfKey', () => {
    it.each([
        ['ArrowUp', 'up'],
        ['ArrowDown', 'down'],
        ['ArrowLeft', 'left'],
        ['ArrowRight', 'right']
    ])('turns %s into %s', (key, direction) => {
        expect(directionOfKey(key)).toBe(direction);
    });

    it.each(['Enter', ' ', 'Tab', 'a', 'PageDown', ''])('ignores %j', (key) => {
        expect(directionOfKey(key)).toBeNull();
    });
});

describe('pickNext', () => {
    const origin: Box = { left: 100, top: 100, width: 100, height: 40 };
    const candidates: Array<Candidate<string>> = [
        { item: 'right', box: { left: 220, top: 100, width: 100, height: 40 } },
        { item: 'far-right', box: { left: 400, top: 100, width: 100, height: 40 } },
        { item: 'left', box: { left: 0, top: 100, width: 80, height: 40 } },
        { item: 'below', box: { left: 100, top: 160, width: 100, height: 40 } },
        { item: 'below-aside', box: { left: 230, top: 150, width: 100, height: 40 } },
        { item: 'above', box: { left: 100, top: 40, width: 100, height: 40 } }
    ];

    it.each([
        ['right', 'right'],
        ['left', 'left'],
        ['down', 'below'],
        ['up', 'above']
    ] as const)('goes %s to the closest candidate in that direction', (direction, expected) => {
        expect(pickNext(origin, candidates, direction)).toBe(expected);
    });

    it('prefers the candidate straight in the direction over a closer one off to the side', () => {
        const options: Array<Candidate<string>> = [
            { item: 'aside', box: { left: 260, top: 150, width: 40, height: 40 } },
            { item: 'straight', box: { left: 100, top: 190, width: 100, height: 40 } }
        ];
        expect(pickNext(origin, options, 'down')).toBe('straight');
    });

    it('returns null when nothing is in the direction', () => {
        expect(pickNext(origin, [{ item: 'right', box: { left: 220, top: 100, width: 100, height: 40 } }], 'left')).toBeNull();
    });

    it('returns null when there is no candidate at all', () => {
        expect(pickNext(origin, [], 'down')).toBeNull();
    });

    it('does not pick a candidate whose middle is level with the origin', () => {
        expect(pickNext(origin, [{ item: 'level', box: { left: 300, top: 100, width: 100, height: 40 } }], 'down')).toBeNull();
    });
});

describe('isNavigable', () => {
    it('accepts a button, a link, a summary, a role button and an element with a tabindex', () => {
        const link = document.createElement('a');
        link.href = 'https://example.com';
        const role = document.createElement('div');
        role.setAttribute('role', 'button');
        const tabbable = document.createElement('div');
        tabbable.tabIndex = 0;
        [document.createElement('button'), link, document.createElement('summary'), role, tabbable].forEach((element) => {
            expect(isNavigable(element)).toBe(true);
        });
    });

    it('refuses fields, disabled buttons, links with no address, elements out of the tab order and null', () => {
        const disabled = document.createElement('button');
        disabled.disabled = true;
        const outOfOrder = document.createElement('div');
        outOfOrder.tabIndex = -1;
        const disabledRole = document.createElement('div');
        disabledRole.setAttribute('role', 'button');
        disabledRole.setAttribute('aria-disabled', 'true');
        [document.createElement('input'), document.createElement('select'), document.createElement('textarea'), disabled, document.createElement('a'), outOfOrder, disabledRole, document.createElement('div')].forEach((element) => {
            expect(isNavigable(element)).toBe(false);
        });
        expect(isNavigable(null)).toBe(false);
    });
});

describe('scopeOf', () => {
    it('is the open window when the element is inside one', () => {
        const root = app();
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        root.appendChild(dialog);
        const inside = button(dialog, 'OK', { left: 0, top: 0, width: 10, height: 10 });
        expect(scopeOf(inside)).toBe(dialog);
    });

    it('is the app otherwise', () => {
        const root = app();
        const inside = button(root, 'OK', { left: 0, top: 0, width: 10, height: 10 });
        expect(scopeOf(inside)).toBe(root);
    });

    it('is null outside the app', () => {
        const outside = button(document.body, 'OK', { left: 0, top: 0, width: 10, height: 10 });
        expect(scopeOf(outside)).toBeNull();
    });

    it('ignores a dialog that is not modal', () => {
        const root = app();
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        root.appendChild(dialog);
        const inside = button(dialog, 'OK', { left: 0, top: 0, width: 10, height: 10 });
        expect(scopeOf(inside)).toBe(root);
    });
});

describe('arrowsAreOwned', () => {
    it('is true while the player is open', () => {
        const player = document.createElement('div');
        player.className = 'player';
        document.body.appendChild(player);
        expect(arrowsAreOwned()).toBe(true);
    });

    it('is true while the reader is open', () => {
        const reader = document.createElement('section');
        reader.className = 'manga__reader reader reader--dark';
        document.body.appendChild(reader);
        expect(arrowsAreOwned()).toBe(true);
    });

    it('is false otherwise', () => {
        app();
        expect(arrowsAreOwned()).toBe(false);
    });

    it('looks inside the root it is given', () => {
        const holder = document.createElement('div');
        holder.innerHTML = '<div class="player"></div>';
        expect(arrowsAreOwned(holder)).toBe(true);
        expect(arrowsAreOwned(document.createElement('div'))).toBe(false);
    });
});

describe('candidatesIn', () => {
    it('keeps the shown controls of the scope, without the origin, hidden ones, empty ones or ones of a window inside it', () => {
        const root = app();
        const from = button(root, 'FROM', { left: 0, top: 0, width: 50, height: 20 });
        const shown = button(root, 'SHOWN', { left: 60, top: 0, width: 50, height: 20 });
        const hidden = button(root, 'HIDDEN', { left: 120, top: 0, width: 50, height: 20 });
        hidden.style.visibility = 'hidden';
        button(root, 'EMPTY', { left: 180, top: 0, width: 0, height: 0 });
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        root.appendChild(dialog);
        button(dialog, 'IN WINDOW', { left: 0, top: 100, width: 50, height: 20 });
        expect(candidatesIn(root, from)).toEqual([{ item: shown, box: { left: 60, top: 0, width: 50, height: 20 } }]);
    });
});

describe('moveFocus', () => {
    it('moves the focus to the next control in the direction and scrolls it into view', () => {
        const root = app();
        const from = button(root, 'A', { left: 0, top: 0, width: 50, height: 20 });
        const right = button(root, 'B', { left: 60, top: 0, width: 50, height: 20 });
        button(root, 'C', { left: 0, top: 40, width: 50, height: 20 });
        from.focus();
        expect(moveFocus(from, 'right')).toBe(true);
        expect(document.activeElement).toBe(right);
        expect(scrollIntoView).toHaveBeenCalledTimes(1);
        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    });

    it('stays when nothing is in the direction', () => {
        const root = app();
        const from = button(root, 'A', { left: 0, top: 0, width: 50, height: 20 });
        button(root, 'B', { left: 60, top: 0, width: 50, height: 20 });
        from.focus();
        expect(moveFocus(from, 'left')).toBe(false);
        expect(document.activeElement).toBe(from);
        expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it('stays inside an open window', () => {
        const root = app();
        button(root, 'BEHIND', { left: 0, top: 200, width: 50, height: 20 });
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        root.appendChild(dialog);
        const from = button(dialog, 'CANCEL', { left: 0, top: 0, width: 50, height: 20 });
        from.focus();
        expect(moveFocus(from, 'down')).toBe(false);
        expect(document.activeElement).toBe(from);
    });

    it('does nothing outside the app', () => {
        const from = button(document.body, 'A', { left: 0, top: 0, width: 50, height: 20 });
        button(document.body, 'B', { left: 60, top: 0, width: 50, height: 20 });
        from.focus();
        expect(moveFocus(from, 'right')).toBe(false);
        expect(document.activeElement).toBe(from);
    });
});

describe('firstFocusTarget', () => {
    it('is the active section of the navigation at the top', () => {
        const root = app();
        root.innerHTML = '<nav class="tabs tabs--main"><button>ONE</button><button aria-current="page">TWO</button></nav>';
        expect(firstFocusTarget()?.textContent).toBe('TWO');
    });

    it('is the first section when none is marked', () => {
        const root = app();
        root.innerHTML = '<nav class="tabs tabs--main"><button>ONE</button><button>TWO</button></nav>';
        expect(firstFocusTarget()?.textContent).toBe('ONE');
    });

    it('is null when there is no navigation', () => {
        app();
        expect(firstFocusTarget()).toBeNull();
    });

    it('looks inside the root it is given', () => {
        const holder = document.createElement('div');
        holder.innerHTML = '<nav class="tabs tabs--main"><button>HERE</button></nav>';
        expect(firstFocusTarget(holder)?.textContent).toBe('HERE');
    });
});

describe('shouldMoveFocus', () => {
    it('is true for a plain arrow on a control of the app', () => {
        const root = app();
        const control = button(root, 'A', { left: 0, top: 0, width: 50, height: 20 });
        expect(shouldMoveFocus(keyEvent('ArrowDown'), control)).toBe(true);
    });

    it('is false for a key that is not an arrow', () => {
        const root = app();
        const control = button(root, 'A', { left: 0, top: 0, width: 50, height: 20 });
        expect(shouldMoveFocus(keyEvent('Enter'), control)).toBe(false);
    });

    it.each([{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }])('is false with a modifier (%j)', (modifier) => {
        const root = app();
        const control = button(root, 'A', { left: 0, top: 0, width: 50, height: 20 });
        expect(shouldMoveFocus(keyEvent('ArrowDown', modifier), control)).toBe(false);
    });

    it('is false when someone already took the key', () => {
        const root = app();
        const control = button(root, 'A', { left: 0, top: 0, width: 50, height: 20 });
        const event = keyEvent('ArrowDown');
        event.preventDefault();
        expect(shouldMoveFocus(event, control)).toBe(false);
    });

    it('is false in a field, which keeps its arrows', () => {
        const root = app();
        const field = document.createElement('input');
        root.appendChild(field);
        expect(shouldMoveFocus(keyEvent('ArrowLeft'), field)).toBe(false);
    });

    it('is false when nothing has the focus', () => {
        expect(shouldMoveFocus(keyEvent('ArrowDown'), null)).toBe(false);
        expect(shouldMoveFocus(keyEvent('ArrowDown'), document.body)).toBe(false);
    });

    it('is false outside the app', () => {
        const control = button(document.body, 'A', { left: 0, top: 0, width: 50, height: 20 });
        expect(shouldMoveFocus(keyEvent('ArrowDown'), control)).toBe(false);
    });

    it('is false while the player or the reader is open', () => {
        const root = app();
        const control = button(root, 'A', { left: 0, top: 0, width: 50, height: 20 });
        const player = document.createElement('div');
        player.className = 'player';
        root.appendChild(player);
        expect(shouldMoveFocus(keyEvent('ArrowRight'), control)).toBe(false);
    });
});
