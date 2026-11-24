// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ExplorerEntry, ExplorerListing } from '@shared/explorer';
import { ExplorerPanel } from '@renderer/components/ExplorerPanel';
import { useAppStore } from '@renderer/store/appStore';
import { useConvertStore } from '@renderer/store/convertStore';
import { useCutStore } from '@renderer/store/cutStore';
import { DEFAULT_EXPLORER_PREFS, readExplorerPrefs, useExplorerStore } from '@renderer/store/explorerStore';
import { useMergeStore } from '@renderer/store/mergeStore';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

const FOLDER: ExplorerEntry = {
    path: '/downloads/Clips',
    name: 'Clips',
    kind: 'directory',
    extension: '',
    sizeBytes: 0,
    modifiedAt: 1700000000000,
    token: null,
    thumbnailUrl: null,
    mediaUrl: null
};

const VIDEO: ExplorerEntry = {
    path: '/downloads/demo.mp4',
    name: 'demo.mp4',
    kind: 'video',
    extension: '.mp4',
    sizeBytes: 4096,
    modifiedAt: 1700000001000,
    token: 1,
    thumbnailUrl: 'pullwave-explorer://thumbnail/1',
    mediaUrl: 'pullwave-explorer://media/1'
};

const AUDIO: ExplorerEntry = {
    path: '/downloads/track.mp3',
    name: 'track.mp3',
    kind: 'audio',
    extension: '.mp3',
    sizeBytes: 2048,
    modifiedAt: 1700000002000,
    token: 2,
    thumbnailUrl: null,
    mediaUrl: 'pullwave-explorer://media/2'
};

const LISTING: ExplorerListing = {
    directory: '/downloads',
    parent: '/',
    breadcrumbs: [
        { name: '/', path: '/' },
        { name: 'downloads', path: '/downloads' }
    ],
    entries: [FOLDER, VIDEO, AUDIO],
    roots: [{ id: 'downloads', label: 'downloads', path: '/downloads', kind: 'downloads' }]
};

const initialApp = useAppStore.getState();
const initialExplorer = useExplorerStore.getInitialState();
const initialConvert = useConvertStore.getInitialState();
const initialCut = useCutStore.getInitialState();
const initialMerge = useMergeStore.getInitialState();
let mock: MockApiHandle;

beforeEach(() => {
    window.localStorage.clear();
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, tab: 'downloads', downloadsView: 'explorer', toolsMode: 'cut' });
    useExplorerStore.setState({ ...initialExplorer, ...DEFAULT_EXPLORER_PREFS });
    useConvertStore.setState({ ...initialConvert });
    useCutStore.setState({ ...initialCut });
    useMergeStore.setState({ ...initialMerge });
    mock.api.explorer.list.mockResolvedValue({ ok: true, listing: LISTING });
});

describe('ExplorerPanel', () => {
    it('lists folders, videos with thumbnails, and audios, provides a single OPEN FOLDER button next to summary, and filters by type and query', async () => {
        const user = userEvent.setup();
        render(<ExplorerPanel />);

        expect(await screen.findByText('demo.mp4')).toBeInTheDocument();
        expect(screen.getByText('track.mp3')).toBeInTheDocument();
        expect(screen.getByText('Clips')).toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'Thumbnail of demo.mp4' })).toHaveAttribute('src', 'pullwave-explorer://thumbnail/1');
        expect(screen.queryByRole('button', { name: 'OPEN' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'PLAY' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'RENAME' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'TRASH' })).not.toBeInTheDocument();

        const openFolderBtn = screen.getByRole('button', { name: 'OPEN FOLDER' });
        await user.click(openFolderBtn);
        expect(mock.api.explorer.openFolder).toHaveBeenCalledWith('/downloads');

        await user.click(screen.getByRole('button', { name: 'AUDIO' }));
        expect(screen.queryByText('demo.mp4')).not.toBeInTheDocument();
        expect(screen.getByText('track.mp3')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'ALL' }));
        await user.type(screen.getByLabelText('Filter by name'), 'demo');
        expect(screen.getByText('demo.mp4')).toBeInTheDocument();
        expect(screen.queryByText('track.mp3')).not.toBeInTheDocument();
    });

    it('toggles hidden folders and media files via the Hidden switch and persists the choice', async () => {
        const user = userEvent.setup();
        const hiddenFolder: ExplorerEntry = {
            path: '/downloads/.Secret',
            name: '.Secret',
            kind: 'directory',
            extension: '',
            sizeBytes: 0,
            modifiedAt: 1700000003000,
            token: null,
            thumbnailUrl: null,
            mediaUrl: null
        };
        const hiddenVideo: ExplorerEntry = {
            path: '/downloads/.clip.mp4',
            name: '.clip.mp4',
            kind: 'video',
            extension: '.mp4',
            sizeBytes: 1024,
            modifiedAt: 1700000004000,
            token: 3,
            thumbnailUrl: 'pullwave-explorer://thumbnail/3',
            mediaUrl: 'pullwave-explorer://media/3'
        };
        const hiddenAudio: ExplorerEntry = {
            path: '/downloads/.song.mp3',
            name: '.song.mp3',
            kind: 'audio',
            extension: '.mp3',
            sizeBytes: 512,
            modifiedAt: 1700000005000,
            token: 4,
            thumbnailUrl: null,
            mediaUrl: 'pullwave-explorer://media/4'
        };
        mock.api.explorer.list.mockImplementation(async (_directory?: string, showHidden?: boolean) => {
            return {
                ok: true,
                listing: {
                    ...LISTING,
                    entries: showHidden === true ? [FOLDER, hiddenFolder, VIDEO, hiddenVideo, AUDIO, hiddenAudio] : [FOLDER, VIDEO, AUDIO]
                }
            };
        });

        render(<ExplorerPanel />);
        expect(await screen.findByText('demo.mp4')).toBeInTheDocument();
        const hiddenSwitch = screen.getByRole('switch', { name: 'Hidden' });
        expect(hiddenSwitch).not.toBeChecked();
        expect(screen.queryByText('.Secret')).not.toBeInTheDocument();
        expect(screen.queryByText('.clip.mp4')).not.toBeInTheDocument();
        expect(screen.queryByText('.song.mp3')).not.toBeInTheDocument();

        await user.click(hiddenSwitch);
        expect(hiddenSwitch).toBeChecked();
        expect(readExplorerPrefs().showHidden).toBe(true);
        expect(mock.api.explorer.list).toHaveBeenLastCalledWith('/downloads', true);
        expect(await screen.findByText('.Secret')).toBeInTheDocument();
        expect(screen.getByText('.clip.mp4')).toBeInTheDocument();
        expect(screen.getByText('.song.mp3')).toBeInTheDocument();

        await user.click(hiddenSwitch);
        expect(hiddenSwitch).not.toBeChecked();
        expect(readExplorerPrefs().showHidden).toBe(false);
        expect(mock.api.explorer.list).toHaveBeenLastCalledWith('/downloads', false);
        expect(screen.queryByText('.Secret')).not.toBeInTheDocument();
        expect(screen.queryByText('.clip.mp4')).not.toBeInTheDocument();
        expect(screen.queryByText('.song.mp3')).not.toBeInTheDocument();
    });

    it('opens video directly by clicking its card, navigates next/previous, and falls back on media error', async () => {
        const user = userEvent.setup();
        mock.api.explorer.preview.mockResolvedValueOnce({ ok: true, url: 'pullwave-explorer://preview/1', converted: true });
        render(<ExplorerPanel />);

        const videoCard = await screen.findByTestId('explorer-item-video');
        await user.click(within(videoCard).getByTitle('/downloads/demo.mp4'));

        const dialog = screen.getByRole('dialog', { name: 'demo.mp4' });
        expect(dialog).toBeInTheDocument();
        const videoEl = screen.getByTestId('explorer-player-video');
        expect(videoEl).toHaveAttribute('src', 'pullwave-explorer://media/1');

        fireEvent.error(videoEl);
        expect(await within(dialog).findByText('PREVIEW')).toBeInTheDocument();
        const convertedVideoEl = screen.getByTestId('explorer-player-video');
        expect(convertedVideoEl).toHaveAttribute('src', 'pullwave-explorer://preview/1');

        fireEvent.error(convertedVideoEl);
        expect(await within(dialog).findByRole('alert')).toHaveTextContent('This file could not be played in the internal player.');

        await user.click(within(dialog).getByRole('button', { name: 'NEXT' }));
        const audioDialog = screen.getByRole('dialog', { name: 'track.mp3' });
        expect(audioDialog).toBeInTheDocument();
        expect(screen.getByTestId('explorer-player-video')).toHaveAttribute('src', 'pullwave-explorer://media/2');

        fireEvent.keyDown(audioDialog, { key: 'Escape' });
        expect(screen.queryByRole('dialog', { name: 'track.mp3' })).not.toBeInTheDocument();
    });

    it('creates a folder, renames an item keeping its extension, and moves to trash via right-click context menu with confirmation', async () => {
        const user = userEvent.setup();
        mock.api.convert.probe.mockResolvedValueOnce({ ok: true, media: { path: VIDEO.path, name: 'demo', extension: '.mp4', durationSeconds: 10 } });
        mock.api.cut.probe.mockResolvedValueOnce({ ok: true, media: { path: AUDIO.path, name: 'track', extension: '.mp3', kind: 'audio', durationSeconds: 20 } });
        render(<ExplorerPanel />);
        await screen.findByText('demo.mp4');

        fireEvent.contextMenu(screen.getByLabelText('Filter by name'), { clientX: 50, clientY: 50 });
        expect(screen.queryByRole('menu', { name: 'File actions' })).not.toBeInTheDocument();

        fireEvent.contextMenu(screen.getByRole('region', { name: 'Media explorer' }), { clientX: 120, clientY: 120 });
        const bgMenu = screen.getByRole('menu', { name: 'File actions' });
        await user.click(within(bgMenu).getByRole('menuitem', { name: 'New folder' }));
        const folderDialog = screen.getByRole('dialog', { name: 'New folder' });
        await user.type(within(folderDialog).getByLabelText('Folder name'), 'Exports');
        await user.click(within(folderDialog).getByRole('button', { name: 'CREATE' }));
        expect(mock.api.explorer.createFolder).toHaveBeenCalledWith('/downloads', 'Exports');

        const videoCard = await screen.findByTestId('explorer-item-video');
        fireEvent.contextMenu(videoCard, { clientX: 200, clientY: 200 });
        const itemMenu = screen.getByRole('menu', { name: 'File actions' });
        await user.click(within(itemMenu).getByRole('menuitem', { name: 'Rename' }));
        const renameDialog = screen.getByRole('dialog', { name: 'Rename' });
        const nameInput = within(renameDialog).getByLabelText('New name');
        expect(nameInput).toHaveValue('demo');
        await user.clear(nameInput);
        await user.type(nameInput, 'final');
        await user.click(within(renameDialog).getByRole('button', { name: 'RENAME' }));
        expect(mock.api.explorer.rename).toHaveBeenCalledWith('/downloads/demo.mp4', 'final.mp4');

        const videoCardAfterRename = await screen.findByTestId('explorer-item-video');
        fireEvent.contextMenu(videoCardAfterRename, { clientX: 200, clientY: 200 });
        const trashMenu = screen.getByRole('menu', { name: 'File actions' });
        await user.click(within(trashMenu).getByRole('menuitem', { name: 'Move to trash' }));
        const confirmTrash = screen.getByRole('dialog', { name: 'Move to trash?' });
        await user.click(within(confirmTrash).getByRole('button', { name: 'MOVE TO TRASH' }));
        expect(mock.api.explorer.trash).toHaveBeenCalledWith('/downloads/demo.mp4');

        mock.api.explorer.trash.mockResolvedValueOnce({ ok: false, reason: 'not-empty' });
        const folderCard = await screen.findByTestId('explorer-item-directory');
        fireEvent.contextMenu(folderCard, { clientX: 180, clientY: 180 });
        const folderMenu = screen.getByRole('menu', { name: 'File actions' });
        await user.click(within(folderMenu).getByRole('menuitem', { name: 'Move to trash' }));
        const confirmFolderTrash = screen.getByRole('dialog', { name: 'Move to trash?' });
        await user.click(within(confirmFolderTrash).getByRole('button', { name: 'MOVE TO TRASH' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Only completely empty folders can be moved to the trash.');

        mock.api.merge.probe.mockResolvedValueOnce({
            ok: true,
            media: {
                path: VIDEO.path,
                name: 'demo',
                extension: '.mp4',
                durationSeconds: 10,
                width: 1280,
                height: 720,
                fps: 30,
                videoCodec: 'h264',
                pixelFormat: 'yuv420p',
                videoTimebase: '15360',
                hasAudio: true,
                audioCodec: 'aac',
                audioSampleRate: 48000,
                audioChannels: 'stereo',
                streamOrder: 'va'
            }
        });
        const videoCardAfterTrash = await screen.findByTestId('explorer-item-video');
        await user.click(within(videoCardAfterTrash).getByRole('button', { name: 'TO AUDIO' }));
        expect(useAppStore.getState().downloadsView).toBe('tools');
        expect(useAppStore.getState().toolsMode).toBe('convert');

        await user.click(within(videoCardAfterTrash).getByRole('button', { name: 'MERGE' }));
        expect(useAppStore.getState().downloadsView).toBe('tools');
        expect(useAppStore.getState().toolsMode).toBe('merge');
        expect(mock.api.merge.probe).toHaveBeenCalledWith(VIDEO.path);

        const audioCard = await screen.findByTestId('explorer-item-audio');
        await user.click(within(audioCard).getByRole('button', { name: 'CUT' }));
        expect(useAppStore.getState().downloadsView).toBe('tools');
        expect(useAppStore.getState().toolsMode).toBe('cut');
    });

    it('formats folder and file modified dates in the configured time zone', async () => {
        const boundary = Date.UTC(2026, 9, 3, 23, 30, 0);
        useAppStore.setState({ settings: { ...initialApp.settings, language: 'en', timeZone: 'Asia/Tokyo' } });
        mock.api.explorer.list.mockResolvedValue({
            ok: true,
            listing: {
                ...LISTING,
                entries: [
                    { ...FOLDER, modifiedAt: boundary },
                    { ...VIDEO, modifiedAt: boundary }
                ]
            }
        });
        render(<ExplorerPanel />);

        const folder = await screen.findByTestId('explorer-item-directory');
        const video = screen.getByTestId('explorer-item-video');
        const expectedDate = new Date(boundary).toLocaleDateString('en', { timeZone: 'Asia/Tokyo' });
        expect(within(folder).getByText(expectedDate)).toBeInTheDocument();
        expect(within(video).getByText(`4.00 KB · ${expectedDate}`)).toBeInTheDocument();
    });
});
