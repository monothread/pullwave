// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';
import { useSearchShortcuts } from '@renderer/hooks/useSearchShortcuts';
import { FIND_DOUBLE_MS } from '@renderer/navigation/searchShortcuts';

function Screen({ children }: { children?: React.ReactNode }) {
    useSearchShortcuts();
    return (
        <div>
            <header>
                <input className="global-search__input" aria-label="Search" defaultValue="naruto" />
            </header>
            <main className="app__main">{children}</main>
        </div>
    );
}

function field(label: string): HTMLInputElement {
    return document.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
}

function ctrlF(init: KeyboardEventInit = {}): boolean {
    return fireEvent.keyDown(window, { key: 'f', ctrlKey: true, ...init });
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 7, 12, 0, 0));
});

afterEach(() => {
    vi.useRealTimers();
});

describe('Ctrl+F', () => {
    it('puts the cursor in the search of the screen, with what it holds selected, and holds back the key', () => {
        render(
            <Screen>
                <input aria-label="Anime name" data-search-field defaultValue="frieren" />
            </Screen>
        );
        expect(ctrlF()).toBe(false);
        expect(document.activeElement).toBe(field('Anime name'));
        expect([field('Anime name').selectionStart, field('Anime name').selectionEnd]).toEqual([0, 7]);
    });

    it('goes to the search of the top bar on a screen with none', () => {
        render(<Screen />);
        ctrlF();
        expect(document.activeElement).toBe(field('Search'));
        expect([field('Search').selectionStart, field('Search').selectionEnd]).toEqual([0, 6]);
    });

    it('works with the letter in capitals, and from inside a field', () => {
        render(
            <Screen>
                <input aria-label="Anime name" data-search-field />
                <input aria-label="Other" />
            </Screen>
        );
        field('Other').focus();
        fireEvent.keyDown(field('Other'), { key: 'F', ctrlKey: true });
        expect(document.activeElement).toBe(field('Anime name'));
    });

    it('is not Ctrl+Shift+F, Ctrl+Alt+F nor the letter alone: nothing moves and the key is not held back', () => {
        render(
            <Screen>
                <input aria-label="Anime name" data-search-field />
            </Screen>
        );
        expect(ctrlF({ shiftKey: true })).toBe(true);
        expect(ctrlF({ altKey: true })).toBe(true);
        expect(fireEvent.keyDown(window, { key: 'f' })).toBe(true);
        expect(document.activeElement).toBe(document.body);
    });
});

describe('Ctrl+F twice', () => {
    it('goes to the search of the top bar when the second press comes soon after the first', () => {
        render(
            <Screen>
                <input aria-label="Anime name" data-search-field />
            </Screen>
        );
        ctrlF();
        expect(document.activeElement).toBe(field('Anime name'));
        vi.setSystemTime(Date.now() + FIND_DOUBLE_MS);
        ctrlF();
        expect(document.activeElement).toBe(field('Search'));
    });

    it('goes back to the search of the screen when the second press is late', () => {
        render(
            <Screen>
                <input aria-label="Anime name" data-search-field />
            </Screen>
        );
        ctrlF();
        vi.setSystemTime(Date.now() + FIND_DOUBLE_MS + 1);
        ctrlF();
        expect(document.activeElement).toBe(field('Anime name'));
    });

    it('starts counting again after a twice: a third press soon after is the first of a new pair', () => {
        render(
            <Screen>
                <input aria-label="Anime name" data-search-field />
            </Screen>
        );
        ctrlF();
        vi.setSystemTime(Date.now() + 100);
        ctrlF();
        expect(document.activeElement).toBe(field('Search'));
        vi.setSystemTime(Date.now() + 100);
        ctrlF();
        expect(document.activeElement).toBe(field('Anime name'));
        vi.setSystemTime(Date.now() + 100);
        ctrlF();
        expect(document.activeElement).toBe(field('Search'));
    });

    it('stays in the search of the top bar when the screen has none', () => {
        render(<Screen />);
        ctrlF();
        vi.setSystemTime(Date.now() + 100);
        ctrlF();
        expect(document.activeElement).toBe(field('Search'));
    });

    it('does not count the repeat of a key held down as a second press, but still holds the key back', () => {
        render(
            <Screen>
                <input aria-label="Anime name" data-search-field />
            </Screen>
        );
        ctrlF();
        vi.setSystemTime(Date.now() + 50);
        expect(ctrlF({ repeat: true })).toBe(false);
        expect(document.activeElement).toBe(field('Anime name'));
    });
});

describe('Ctrl+F where the keys belong to something else', () => {
    it('leaves the key alone in the player and in the reader, which have no search', () => {
        const { container } = render(
            <Screen>
                <input aria-label="Anime name" data-search-field />
            </Screen>
        );
        const player = document.createElement('div');
        player.className = 'player';
        container.appendChild(player);
        expect(ctrlF()).toBe(true);
        expect(document.activeElement).toBe(document.body);
        player.className = 'reader';
        expect(ctrlF()).toBe(true);
        expect(document.activeElement).toBe(document.body);
    });

    it('stays inside a window that is open: its own search, or nothing, and never the page behind it', () => {
        const { container } = render(
            <Screen>
                <input aria-label="Anime name" data-search-field />
            </Screen>
        );
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        container.appendChild(dialog);
        ctrlF();
        expect(document.activeElement).toBe(document.body);
        const own = document.createElement('input');
        own.setAttribute('data-search-field', '');
        dialog.appendChild(own);
        vi.setSystemTime(Date.now() + FIND_DOUBLE_MS + 1);
        ctrlF();
        expect(document.activeElement).toBe(own);
    });
});

describe('useSearchShortcuts when the app goes away', () => {
    it('stops listening', () => {
        const { unmount } = render(
            <Screen>
                <input aria-label="Anime name" data-search-field />
            </Screen>
        );
        unmount();
        expect(ctrlF()).toBe(true);
    });
});
