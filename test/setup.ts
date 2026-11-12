import '@testing-library/jest-dom/vitest';
import { fakeTextTrackList, type FakeTextTrackList } from './helpers/textTracks';
import { clearListMemories } from '../src/renderer/hooks/listMemory';
import { loadAllCatalogs } from '../src/renderer/i18n/catalogs';

// jsdom does not implement the list of text tracks of a media element: every video gets an empty one (a test can give its own).
if (typeof HTMLMediaElement !== 'undefined') {
    const lists = new WeakMap<HTMLMediaElement, FakeTextTrackList>();
    Object.defineProperty(HTMLMediaElement.prototype, 'textTracks', {
        configurable: true,
        get(this: HTMLMediaElement): FakeTextTrackList {
            const known = lists.get(this) ?? fakeTextTrackList();
            lists.set(this, known);
            return known;
        }
    });
}

// The long lists keep, between two times they are shown, how much of them was drawn: each test starts from lists never seen.
beforeEach(() => {
    clearListMemories();
});

// The window loads the texts of a language the first time it is shown: the tests have every language there from the start.
beforeAll(async () => {
    await loadAllCatalogs();
});
