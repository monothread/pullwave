// @vitest-environment jsdom
import type { ExplorerEntry, ExplorerListing } from '@shared/explorer';
import { useAppStore } from '@renderer/store/appStore';
import { DEFAULT_EXPLORER_PREFS, EXPLORER_PREFS_STORAGE_KEY, readExplorerPrefs, useExplorerStore } from '@renderer/store/explorerStore';
import { installMockApi, makeJob, type MockApiHandle } from '../../helpers/mockApi';

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
    it('navigates folders with history back/forward/up and reveals a file in the explorer tab with fallback', async () => {
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

        mock.api.explorer.list.mockResolvedValueOnce({ ok: true, listing: makeListing('/downloads', [SUB_DIR, VIDEO_1, AUDIO_1]) });
        await useExplorerStore.getState().revealFile(VIDEO_1.path);
        expect(useExplorerStore.getState().directory).toBe('/downloads');
        expect(useExplorerStore.getState().highlightedPath).toBe(VIDEO_1.path);
        expect(useAppStore.getState().downloadsView).toBe('explorer');

        useExplorerStore.getState().clearHighlight();
        expect(useExplorerStore.getState().highlightedPath).toBeNull();

        useAppStore.setState({ downloadsView: 'history', notice: null });
        mock.api.explorer.list.mockResolvedValueOnce({ ok: true, listing: makeListing('/downloads', [SUB_DIR]) });
        await useExplorerStore.getState().revealFile('/downloads/deleted.mp4');
        expect(useAppStore.getState().downloadsView).toBe('history');
        expect(useAppStore.getState().notice).toEqual({
            kind: 'error',
            message: 'That file no longer exists.'
        });

        useAppStore.setState({ downloadsView: 'history', notice: null });
        mock.api.explorer.list.mockResolvedValueOnce({ ok: false, reason: 'denied' });
        await useExplorerStore.getState().revealFile('/outside/video.mp4');
        expect(useAppStore.getState().downloadsView).toBe('history');
        expect(useAppStore.getState().notice).toEqual({
            kind: 'error',
            message: 'That file is outside the configured downloads folder.'
        });
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

    it('refreshes the explorer automatically when a video download finishes after explorer was loaded', async () => {
        const cleanup = await useAppStore.getState().init();
        try {
            mock.api.explorer.list.mockResolvedValueOnce({ ok: true, listing: makeListing('/downloads', []) });
            await useExplorerStore.getState().open('/downloads');
            expect(useExplorerStore.getState().entries).toEqual([]);
            expect(mock.api.explorer.list).toHaveBeenCalledTimes(1);

            mock.api.explorer.list.mockResolvedValueOnce({ ok: true, listing: makeListing('/downloads', [VIDEO_1]) });
            mock.emitJobUpdate(makeJob({ id: 'dl-1', status: 'running', title: 'alpha' }));
            expect(mock.api.explorer.list).toHaveBeenCalledTimes(1);

            mock.emitJobUpdate(makeJob({ id: 'dl-1', status: 'done', title: 'alpha', filePath: VIDEO_1.path }));
            await vi.waitFor(() => {
                expect(mock.api.explorer.list).toHaveBeenCalledTimes(2);
            });
            expect(mock.api.explorer.list).toHaveBeenLastCalledWith('/downloads');
            expect(useExplorerStore.getState().entries).toEqual([VIDEO_1]);

            mock.emitJobUpdate(makeJob({ id: 'dl-1', status: 'done', title: 'alpha', filePath: VIDEO_1.path }));
            await Promise.resolve();
            expect(mock.api.explorer.list).toHaveBeenCalledTimes(2);

            mock.emitJobUpdate(makeJob({ id: 'dl-2', status: 'error', title: 'broken' }));
            mock.emitJobUpdate(makeJob({ id: 'dl-3', status: 'cancelled', title: 'stopped' }));
            await Promise.resolve();
            expect(mock.api.explorer.list).toHaveBeenCalledTimes(2);
        } finally {
            cleanup();
        }
    });

    it('does not call explorer.list on download completion when explorer was never loaded', async () => {
        const cleanup = await useAppStore.getState().init();
        try {
            mock.emitJobUpdate(makeJob({ id: 'dl-1', status: 'running', title: 'alpha' }));
            mock.emitJobUpdate(makeJob({ id: 'dl-1', status: 'done', title: 'alpha', filePath: VIDEO_1.path }));
            await Promise.resolve();
            expect(mock.api.explorer.list).not.toHaveBeenCalled();
        } finally {
            cleanup();
        }
    });

    it('re-lists and preserves history if a download finishes while the initial explorer open is still in flight', async () => {
        const cleanup = await useAppStore.getState().init();
        try {
            let resolveFirst: ((value: { ok: true; listing: ExplorerListing }) => void) | null = null;
            mock.api.explorer.list.mockImplementationOnce(() => {
                return new Promise((resolve) => {
                    resolveFirst = resolve;
                });
            });
            mock.api.explorer.list.mockResolvedValueOnce({ ok: true, listing: makeListing('/downloads', [VIDEO_1]) });

            const initialOpen = useExplorerStore.getState().open();
            expect(useExplorerStore.getState().loading).toBe(true);
            expect(useExplorerStore.getState().loaded).toBe(false);

            mock.emitJobUpdate(makeJob({ id: 'dl-1', status: 'running', title: 'alpha' }));
            mock.emitJobUpdate(makeJob({ id: 'dl-1', status: 'done', title: 'alpha', filePath: VIDEO_1.path }));

            resolveFirst!({ ok: true, listing: makeListing('/downloads', []) });
            await initialOpen;
            await vi.waitFor(() => {
                expect(useExplorerStore.getState().entries).toEqual([VIDEO_1]);
            });

            expect(useExplorerStore.getState().entries).toEqual([VIDEO_1]);
            expect(useExplorerStore.getState().history).toEqual(['/downloads']);
            expect(useExplorerStore.getState().historyIndex).toBe(0);
        } finally {
            cleanup();
        }
    });

    it('queues a silent trailing refresh without preempting an in-flight goBack navigation or flashing loading', async () => {
        const cleanup = await useAppStore.getState().init();
        try {
            mock.api.explorer.list.mockResolvedValueOnce({ ok: true, listing: makeListing('/downloads', []) });
            await useExplorerStore.getState().open('/downloads');
            mock.api.explorer.list.mockResolvedValueOnce({ ok: true, listing: makeListing('/downloads/Clips', []) });
            await useExplorerStore.getState().open('/downloads/Clips');

            let resolveBack: ((value: { ok: true; listing: ExplorerListing }) => void) | null = null;
            mock.api.explorer.list.mockImplementationOnce(() => {
                return new Promise((resolve) => {
                    resolveBack = resolve;
                });
            });
            mock.api.explorer.list.mockResolvedValueOnce({ ok: true, listing: makeListing('/downloads', [VIDEO_1]) });

            const goingBack = useExplorerStore.getState().goBack();
            mock.emitJobUpdate(makeJob({ id: 'dl-back', status: 'running', title: 'alpha' }));
            mock.emitJobUpdate(makeJob({ id: 'dl-back', status: 'done', title: 'alpha', filePath: VIDEO_1.path }));

            resolveBack!({ ok: true, listing: makeListing('/downloads', []) });
            await goingBack;
            await vi.waitFor(() => {
                expect(useExplorerStore.getState().entries).toEqual([VIDEO_1]);
            });

            expect(useExplorerStore.getState().directory).toBe('/downloads');
            expect(useExplorerStore.getState().history).toEqual(['/downloads', '/downloads/Clips']);
            expect(useExplorerStore.getState().historyIndex).toBe(0);

            const loadingStates: boolean[] = [];
            const unsubscribe = useExplorerStore.subscribe((state) => {
                loadingStates.push(state.loading);
            });
            try {
                mock.api.explorer.list.mockResolvedValueOnce({ ok: true, listing: makeListing('/downloads', [VIDEO_1, AUDIO_1]) });
                mock.emitJobUpdate(makeJob({ id: 'dl-silent', status: 'running', title: 'beta' }));
                mock.emitJobUpdate(makeJob({ id: 'dl-silent', status: 'done', title: 'beta', filePath: AUDIO_1.path }));
                await vi.waitFor(() => {
                    expect(useExplorerStore.getState().entries).toEqual([VIDEO_1, AUDIO_1]);
                });
                expect(loadingStates.every((flag) => {
                    return flag === false;
                })).toBe(true);
            } finally {
                unsubscribe();
            }
        } finally {
            cleanup();
        }
    });
});
