import '@testing-library/jest-dom/vitest';
import { fakeTextTrackList, type FakeTextTrackList } from './helpers/textTracks';
import { clearListMemories } from '../src/renderer/hooks/listMemory';
import { loadAllCatalogs } from '../src/renderer/i18n/catalogs';

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

beforeEach(() => {
    clearListMemories();
});

beforeAll(async () => {
    await loadAllCatalogs();
});
