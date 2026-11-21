// @vitest-environment jsdom
import type { ExplorerEntry, ExplorerListing } from '@shared/explorer';
import { DEFAULT_EXPLORER_PREFS, EXPLORER_PREFS_STORAGE_KEY, readExplorerPrefs, useExplorerStore } from '@renderer/store/explorerStore';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

const VIDEO_1: ExplorerEntry = {
    path: '/downloads/alpha.mp4',
    name: 'alpha.mp4',
    kind: 'video',
    extension: '.mp4',
    sizeBytes: 2048,
    modifiedAt: 1000,
    token: 1,
    thumbnailUrl: 'pullwave-explorer://thumbnail/1',
    mediaUrl: 'pullwave-explorer://media/1'
};

const AUDIO_1: ExplorerEntry = {
    path: '/downloads/beta.mp3',
    name: 'beta.mp3',
    kind: 'audio',
    extension: '.mp3',
    sizeBytes: 1024,
    modifiedAt: 2000,
    token: 2,
    thumbnailUrl: null,
    mediaUrl: 'pullwave-explorer://media/2'
};

const SUB_DIR: ExplorerEntry = {
    path: '/downloads/Clips',
    name: 'Clips',
    kind: 'directory',
    extension: '',
    sizeBytes: 0,
    modifiedAt: 500,
    token: null,
    thumbnailUrl: null,
    mediaUrl: null
};

function makeListing(directory: string, entries: ExplorerEntry[]): ExplorerListing {
    return {
        directory,
        parent: directory === '/' ? null : '/',
        breadcrumbs: [{ name: '/', path: '/' }, { name: directory.slice(1), path: directory }],
        entries,
        roots: [{ id: 'downloads', label: 'downloads', path: '/downloads', kind: 'downloads' }]
    };
}

let mock: MockApiHandle;
const initial = useExplorerStore.getInitialState();

beforeEach(() => {
    window.localStorage.clear();
    mock = installMockApi();
    useExplorerStore.setState({ ...initial, ...DEFAULT_EXPLORER_PREFS });
});

describe('explorerStore', () => {
    it('navigates folders with history back/forward/up and showHidden reload', async () => {
        mock.api.explorer.list.mockResolvedValueOnce({ ok: true, listing: makeListing('/downloads', [SUB_DIR, VIDEO_1, AUDIO_1]) });
        await useExplorerStore.getState().open('/downloads');
        expect(useExplorerStore.getState().directory).toBe('/downloads');
        expect(useExplorerStore.getState().history).toEqual(['/downloads']);

        mock.api.explorer.list.mockResolvedValueOnce({ ok: true, listing: makeListing('/downloads/Clips', []) });
        await useExplorerStore.getState().open('/downloads/Clips');
        expect(useExplorerStore.getState().historyIndex).toBe(1);

        mock.api.explorer.list.mockResolvedValueOnce({ ok: true, listing: makeListing('/downloads', [SUB_DIR, VIDEO_1, AUDIO_1]) });
        await useExplorerStore.getState().goBack();
        expect(useExplorerStore.getState().directory).toBe('/downloads');
        expect(useExplorerStore.getState().historyIndex).toBe(0);

        mock.api.explorer.list.mockResolvedValueOnce({ ok: true, listing: makeListing('/downloads/Clips', []) });
        await useExplorerStore.getState().goForward();
        expect(useExplorerStore.getState().directory).toBe('/downloads/Clips');
        expect(useExplorerStore.getState().historyIndex).toBe(1);

        mock.api.explorer.list.mockResolvedValueOnce({ ok: true, listing: makeListing('/downloads/Clips', []) });
        await useExplorerStore.getState().setShowHidden(true);
        expect(mock.api.explorer.list).toHaveBeenLastCalledWith('/downloads/Clips', true);
    });

    it('plays entries in internal player, steps next/previous, and runs fallback preview on error', async () => {
        mock.api.explorer.list.mockResolvedValueOnce({ ok: true, listing: makeListing('/downloads', [SUB_DIR, VIDEO_1, AUDIO_1]) });
        await useExplorerStore.getState().open('/downloads');

        useExplorerStore.getState().playEntry(SUB_DIR);
        expect(useExplorerStore.getState().playing).toBeNull();

        useExplorerStore.getState().playEntry(VIDEO_1);
        expect(useExplorerStore.getState().playing).toEqual({
            entry: VIDEO_1,
            status: 'ready',
            url: VIDEO_1.mediaUrl,
            converted: false,
            error: null
        });

        useExplorerStore.getState().playStep(1);
        expect(useExplorerStore.getState().playing?.entry).toEqual(AUDIO_1);

        useExplorerStore.getState().playStep(-1);
        expect(useExplorerStore.getState().playing?.entry).toEqual(VIDEO_1);

        mock.api.explorer.preview.mockResolvedValueOnce({ ok: true, url: 'pullwave-explorer://preview/1', converted: true });
        await useExplorerStore.getState().convertPlayback();
        expect(useExplorerStore.getState().playing).toEqual({
            entry: VIDEO_1,
            status: 'ready',
            url: 'pullwave-explorer://preview/1',
            converted: true,
            error: null
        });

        await useExplorerStore.getState().convertPlayback();
        expect(useExplorerStore.getState().playing).toEqual({
            entry: VIDEO_1,
            status: 'failed',
            url: null,
            converted: true,
            error: 'failed'
        });

        useExplorerStore.getState().closePlayer();
        expect(useExplorerStore.getState().playing).toBeNull();
        expect(mock.api.explorer.cancelPreview).toHaveBeenCalled();
    });

    it('creates folders, renames entries, and trashes entries closing player if active', async () => {
        mock.api.explorer.list.mockResolvedValue({ ok: true, listing: makeListing('/downloads', [VIDEO_1]) });
        await useExplorerStore.getState().open('/downloads');

        expect(await useExplorerStore.getState().createFolder('New')).toEqual({ ok: true, path: '/downloads/New' });
        expect(mock.api.explorer.createFolder).toHaveBeenCalledWith('/downloads', 'New');

        expect(await useExplorerStore.getState().renameEntry(VIDEO_1, 'renamed.mp4')).toEqual({
            ok: true,
            path: '/downloads/renamed.mp4',
            name: 'renamed.mp4'
        });

        useExplorerStore.getState().playEntry(VIDEO_1);
        expect(await useExplorerStore.getState().trashEntry(VIDEO_1)).toEqual({ ok: true });
        expect(useExplorerStore.getState().playing).toBeNull();
    });

    it('persists sortBy, sortDirection, and viewMode in localStorage and falls back safely on invalid data', () => {
        expect(readExplorerPrefs()).toEqual(DEFAULT_EXPLORER_PREFS);

        useExplorerStore.getState().setSortBy('modified');
        useExplorerStore.getState().toggleSortDirection();
        useExplorerStore.getState().setViewMode('list');

        expect(useExplorerStore.getState().sortBy).toBe('modified');
        expect(useExplorerStore.getState().sortDirection).toBe('desc');
        expect(useExplorerStore.getState().viewMode).toBe('list');
        expect(readExplorerPrefs()).toEqual({
            sortBy: 'modified',
            sortDirection: 'desc',
            viewMode: 'list'
        });

        window.localStorage.setItem(EXPLORER_PREFS_STORAGE_KEY, JSON.stringify({ sortBy: 'invalid', sortDirection: 'bad', viewMode: 'list' }));
        expect(readExplorerPrefs()).toEqual({
            sortBy: 'name',
            sortDirection: 'asc',
            viewMode: 'list'
        });

        window.localStorage.setItem(EXPLORER_PREFS_STORAGE_KEY, '{not-json');
        expect(readExplorerPrefs()).toEqual(DEFAULT_EXPLORER_PREFS);
    });
});
