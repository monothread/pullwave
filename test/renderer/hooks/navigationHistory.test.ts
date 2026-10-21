import { MAX_NAVIGATION_ENTRIES, NavigationHistory } from '@renderer/hooks/navigationHistory';

interface Page {
    name: string;
    content: string;
}

function page(name: string, content = ''): Page {
    return { name, content };
}

function makeHistory(limit = MAX_NAVIGATION_ENTRIES): NavigationHistory<Page> {
    return new NavigationHistory<Page>(limit, (entry) => {
        return entry.name;
    });
}

describe('NavigationHistory', () => {
    it('keeps the limit at 50 pages', () => {
        expect(MAX_NAVIGATION_ENTRIES).toBe(50);
    });

    it('has nowhere to go while it is empty', () => {
        const history = makeHistory();
        expect(history.back()).toBeNull();
        expect(history.forward()).toBeNull();
    });

    it('has nowhere to go with a single page', () => {
        const history = makeHistory();
        history.record(page('a'));
        expect(history.back()).toBeNull();
        expect(history.forward()).toBeNull();
    });

    it('goes back and forward through the pages in order', () => {
        const history = makeHistory();
        history.record(page('a'));
        history.record(page('b'));
        history.record(page('c'));

        expect(history.back()).toEqual(page('b'));
        expect(history.back()).toEqual(page('a'));
        expect(history.back()).toBeNull();
        expect(history.forward()).toEqual(page('b'));
        expect(history.forward()).toEqual(page('c'));
        expect(history.forward()).toBeNull();
    });

    it('does not move the cursor when going past either end', () => {
        const history = makeHistory();
        history.record(page('a'));
        history.record(page('b'));
        expect(history.forward()).toBeNull();
        expect(history.back()).toEqual(page('a'));
        expect(history.back()).toBeNull();
        expect(history.forward()).toEqual(page('b'));
    });

    it('refreshes the current page instead of adding one when the key is the same', () => {
        const history = makeHistory();
        history.record(page('a', 'loading'));
        history.record(page('b', 'loading'));
        history.record(page('b', 'ready'));

        expect(history.back()).toEqual(page('a', 'loading'));
        expect(history.forward()).toEqual(page('b', 'ready'));
        expect(history.forward()).toBeNull();
    });

    it('drops the pages ahead when a new page is recorded after going back', () => {
        const history = makeHistory();
        history.record(page('a'));
        history.record(page('b'));
        history.record(page('c'));
        history.back();
        history.back();
        history.record(page('d'));

        expect(history.forward()).toBeNull();
        expect(history.back()).toEqual(page('a'));
        expect(history.forward()).toEqual(page('d'));
    });

    it('adds a page that came back to an earlier key when it is not the current one', () => {
        const history = makeHistory();
        history.record(page('a'));
        history.record(page('b'));
        history.record(page('a'));

        expect(history.back()).toEqual(page('b'));
        expect(history.back()).toEqual(page('a'));
        expect(history.back()).toBeNull();
    });

    it('forgets the oldest pages beyond the limit', () => {
        const history = makeHistory(3);
        ['a', 'b', 'c', 'd', 'e'].forEach((name) => {
            history.record(page(name));
        });

        expect(history.back()).toEqual(page('d'));
        expect(history.back()).toEqual(page('c'));
        expect(history.back()).toBeNull();
    });

    describe('scroll of the pages', () => {
        it('has no scroll before anything was remembered', () => {
            const history = makeHistory();
            expect(history.currentScroll()).toBe(0);
            history.record(page('a'));
            expect(history.currentScroll()).toBe(0);
        });

        it('ignores a scroll to remember while it is empty', () => {
            const history = makeHistory();
            history.rememberScroll(300);
            expect(history.currentScroll()).toBe(0);
            history.record(page('a'));
            expect(history.currentScroll()).toBe(0);
        });

        it('gives back the scroll of each page when the viewer comes to it again', () => {
            const history = makeHistory();
            history.record(page('a'));
            history.rememberScroll(120);
            history.record(page('b'));
            history.rememberScroll(480);
            history.record(page('c'));

            history.back();
            expect(history.currentScroll()).toBe(480);
            history.back();
            expect(history.currentScroll()).toBe(120);
            history.forward();
            expect(history.currentScroll()).toBe(480);
            history.forward();
            expect(history.currentScroll()).toBe(0);
        });

        it('keeps the scroll of a page that is refreshed with the same key', () => {
            const history = makeHistory();
            history.record(page('a', 'loading'));
            history.rememberScroll(250);
            history.record(page('a', 'ready'));
            expect(history.currentScroll()).toBe(250);
        });

        it('starts a new page at the top and forgets the scroll of the pages dropped ahead', () => {
            const history = makeHistory();
            history.record(page('a'));
            history.record(page('b'));
            history.rememberScroll(900);
            history.back();
            history.record(page('c'));
            expect(history.currentScroll()).toBe(0);
            expect(history.forward()).toBeNull();
            history.back();
            history.forward();
            expect(history.currentScroll()).toBe(0);
        });

        it('keeps each scroll with its page when the oldest ones are forgotten', () => {
            const history = makeHistory(2);
            history.record(page('a'));
            history.rememberScroll(10);
            history.record(page('b'));
            history.rememberScroll(20);
            history.record(page('c'));
            history.rememberScroll(30);

            expect(history.back()).toEqual(page('b'));
            expect(history.currentScroll()).toBe(20);
            history.forward();
            expect(history.currentScroll()).toBe(30);
        });
    });
});
