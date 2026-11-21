import type { ExplorerEntry, ExplorerRoot } from '@shared/explorer';
import {
    contextMenuPosition,
    countEntries,
    filterAndSortEntries,
    formatBytes,
    rootDisplayLabel,
    splitEntryName
} from '@renderer/components/explorerHelpers';
import { createTranslator } from '@shared/i18n';

const DIR_B: ExplorerEntry = {
    path: '/m/Beta',
    name: 'Beta',
    kind: 'directory',
    extension: '',
    sizeBytes: 0,
    modifiedAt: 200,
    token: null,
    thumbnailUrl: null,
    mediaUrl: null
};

const DIR_A: ExplorerEntry = {
    path: '/m/Alpha',
    name: 'Alpha',
    kind: 'directory',
    extension: '',
    sizeBytes: 0,
    modifiedAt: 100,
    token: null,
    thumbnailUrl: null,
    mediaUrl: null
};

const VID_1: ExplorerEntry = {
    path: '/m/clip2.mp4',
    name: 'clip2.mp4',
    kind: 'video',
    extension: '.mp4',
    sizeBytes: 5000,
    modifiedAt: 300,
    token: 1,
    thumbnailUrl: 'pullwave-explorer://thumbnail/1',
    mediaUrl: 'pullwave-explorer://media/1'
};

const AUD_1: ExplorerEntry = {
    path: '/m/clip10.mp3',
    name: 'clip10.mp3',
    kind: 'audio',
    extension: '.mp3',
    sizeBytes: 1000,
    modifiedAt: 400,
    token: 2,
    thumbnailUrl: null,
    mediaUrl: 'pullwave-explorer://media/2'
};

describe('explorerHelpers', () => {
    it('formats byte sizes cleanly', () => {
        expect(formatBytes(0)).toBe('0 B');
        expect(formatBytes(512)).toBe('512 B');
        expect(formatBytes(1536)).toBe('1.50 KB');
        expect(formatBytes(25 * 1024 * 1024)).toBe('25.0 MB');
    });

    it('counts folders, videos and audios in one pass', () => {
        expect(countEntries([DIR_A, DIR_B, VID_1, AUD_1])).toEqual({ folders: 2, videos: 1, audios: 1 });
    });

    it('filters by kind and search query and sorts keeping directories first', () => {
        const all = [AUD_1, DIR_B, VID_1, DIR_A];
        expect(
            filterAndSortEntries(all, 'all', '', 'name', 'asc').map((entry) => {
                return entry.name;
            })
        ).toEqual(['Alpha', 'Beta', 'clip2.mp4', 'clip10.mp3']);

        expect(
            filterAndSortEntries(all, 'video', '', 'name', 'asc').map((entry) => {
                return entry.name;
            })
        ).toEqual(['Alpha', 'Beta', 'clip2.mp4']);

        expect(
            filterAndSortEntries(all, 'audio', 'clip', 'size', 'desc').map((entry) => {
                return entry.name;
            })
        ).toEqual(['clip10.mp3']);

        expect(
            filterAndSortEntries([VID_1, AUD_1], 'all', '', 'modified', 'desc').map((entry) => {
                return entry.name;
            })
        ).toEqual(['clip10.mp3', 'clip2.mp4']);

        expect(
            filterAndSortEntries([VID_1, AUD_1], 'all', '', 'kind', 'asc').map((entry) => {
                return entry.name;
            })
        ).toEqual(['clip10.mp3', 'clip2.mp4']);
    });

    it('formats root labels and splits entry stems preserving extensions', () => {
        const t = createTranslator('en');
        const roots: ExplorerRoot[] = [
            { id: 'd', label: 'downloads', path: '/d', kind: 'downloads' },
            { id: 'h', label: 'home', path: '/h', kind: 'home' },
            { id: 'v', label: 'videos', path: '/v', kind: 'videos' },
            { id: 'm', label: 'music', path: '/m', kind: 'music' },
            { id: 'c', label: 'C:', path: 'C:\\', kind: 'drive' }
        ];
        expect(
            roots.map((root) => {
                return rootDisplayLabel(root, t);
            })
        ).toEqual(['DOWNLOADS', 'HOME', 'VIDEOS', 'MUSIC', 'C:']);

        expect(splitEntryName(DIR_A)).toEqual({ stem: 'Alpha', extension: '' });
        expect(splitEntryName(VID_1)).toEqual({ stem: 'clip2', extension: '.mp4' });
        expect(splitEntryName({ kind: 'video', name: 'Movie.MKV', extension: '.mkv' })).toEqual({ stem: 'Movie', extension: '.MKV' });
    });

    it('positions the context menu at the cursor across zoom levels and flips near viewport edges', () => {
        expect(
            contextMenuPosition({
                clientX: 400,
                clientY: 300,
                menuWidth: 200,
                menuHeight: 160,
                viewportWidth: 1200,
                viewportHeight: 800,
                zoom: 1
            })
        ).toEqual({ left: 400, top: 300 });

        const zoomed = contextMenuPosition({
            clientX: 1200,
            clientY: 840,
            menuWidth: 200,
            menuHeight: 160,
            viewportWidth: 3440,
            viewportHeight: 1440,
            zoom: 1.2
        });
        expect(zoomed.left).toBeCloseTo(1000, 5);
        expect(zoomed.top).toBeCloseTo(700, 5);

        expect(
            contextMenuPosition({
                clientX: 1180,
                clientY: 780,
                menuWidth: 200,
                menuHeight: 160,
                viewportWidth: 1200,
                viewportHeight: 800,
                zoom: 1
            })
        ).toEqual({ left: 980, top: 620 });
    });
});
