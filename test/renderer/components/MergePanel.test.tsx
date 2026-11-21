// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { MergeMedia, MergeRun } from '@shared/merge';
import { MergePanel } from '@renderer/components/MergePanel';
import { useAppStore } from '@renderer/store/appStore';
import { useExplorerStore } from '@renderer/store/explorerStore';
import { useMergeStore } from '@renderer/store/mergeStore';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

const VIDEO_A: MergeMedia = {
    path: '/videos/first.mp4',
    name: 'first',
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
};

const VIDEO_B: MergeMedia = {
    path: '/videos/second.mp4',
    name: 'second',
    extension: '.mp4',
    durationSeconds: 25,
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
};

const initialApp = useAppStore.getState();
const initialMerge = useMergeStore.getInitialState();
let mock: MockApiHandle;

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: { ...DEFAULT_SETTINGS, downloadDir: '/downloads', videoContainer: 'mp4' } });
    useMergeStore.setState({ ...initialMerge });
});

describe('MergePanel', () => {
    it('lets the user add videos, reorder them with up/down controls, set options, and start merging', async () => {
        const user = userEvent.setup();
        mock.api.merge.choose.mockResolvedValueOnce({ ok: true, media: [VIDEO_A], rejected: [] });
        mock.api.merge.choose.mockResolvedValueOnce({ ok: true, media: [VIDEO_B], rejected: [] });
        const startedRun: MergeRun = {
            id: 1,
            format: 'mkv',
            outputMode: 'source',
            outputDirectory: '/videos',
            outputName: 'Episode Mix.mkv',
            inputCount: 2,
            totalDurationSeconds: 35,
            method: 'copy',
            status: 'running',
            percent: 50,
            outputPath: null,
            error: null
        };
        mock.api.merge.start.mockResolvedValueOnce({ ok: true, run: startedRun });

        render(<MergePanel />);
        await user.click(screen.getByRole('button', { name: 'CHOOSE VIDEOS' }));
        expect(await screen.findByText('Add at least 2 videos to merge.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'MERGE (1)' })).toBeDisabled();

        await user.click(screen.getByRole('button', { name: '+ ADD VIDEOS' }));
        const rows = await screen.findAllByTestId('merge-item');
        expect(rows).toHaveLength(2);
        expect(rows[0]).toHaveTextContent('#1');
        expect(rows[0]).toHaveTextContent('first.mp4');
        expect(rows[1]).toHaveTextContent('#2');
        expect(rows[1]).toHaveTextContent('second.mp4');
        expect(within(rows[0]!).getByRole('button', { name: 'Move up: first.mp4' })).toBeDisabled();
        expect(within(rows[1]!).getByRole('button', { name: 'Move down: second.mp4' })).toBeDisabled();

        await user.click(within(rows[1]!).getByRole('button', { name: 'Move up: second.mp4' }));
        const reordered = screen.getAllByTestId('merge-item');
        expect(reordered[0]).toHaveTextContent('second.mp4');
        expect(reordered[1]).toHaveTextContent('first.mp4');

        await user.type(screen.getByLabelText('Output file name'), 'Episode Mix');
        await user.selectOptions(screen.getByLabelText('Video format'), 'mkv');
        await user.selectOptions(screen.getByLabelText('Save to'), 'source');
        expect(screen.getByText('Saved in the same folder as the first video in the list.')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'MERGE (2)' }));
        expect(mock.api.merge.start).toHaveBeenCalledWith({
            paths: ['/videos/second.mp4', '/videos/first.mp4'],
            format: 'mkv',
            outputMode: 'source',
            outputName: 'Episode Mix'
        });

        expect(await screen.findByText('FAST COPY')).toBeInTheDocument();
        expect(screen.getByRole('progressbar', { name: 'Merging Episode Mix.mkv' })).toBeInTheDocument();

        const revealSpy = vi.spyOn(useExplorerStore.getState(), 'revealFile').mockResolvedValueOnce(undefined);
        mock.emitMergeProgress({ ...startedRun, status: 'done', percent: 100, outputPath: '/videos/Episode Mix.mkv' });

        expect(await screen.findByText('Done: Episode Mix.mkv saved.')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'SHOW FILE' }));
        expect(revealSpy).toHaveBeenCalledWith('/videos/Episode Mix.mkv');
        await user.click(screen.getByRole('button', { name: 'OPEN FOLDER' }));
        expect(mock.api.showItemInFolder).toHaveBeenCalledWith('/videos/Episode Mix.mkv');
    });

    it('accepts dropped video files and reports invalid drops', async () => {
        mock.api.merge.probe.mockResolvedValueOnce({ ok: true, media: VIDEO_A });
        render(<MergePanel />);
        const region = screen.getByRole('region', { name: 'Merge videos' });

        const file = new File(['data'], 'first.mp4', { type: 'video/mp4' });
        fireEvent.dragEnter(region, { dataTransfer: { types: ['Files'], files: [file] } });
        expect(screen.getByTestId('merge-drop')).toHaveTextContent('DROP VIDEOS HERE');
        fireEvent.drop(region, { dataTransfer: { types: ['Files'], files: [file] } });
        expect(await screen.findByText('first.mp4')).toBeInTheDocument();

        mock.api.merge.pathForFile.mockReturnValueOnce('');
        fireEvent.drop(region, { dataTransfer: { types: ['Files'], files: [file] } });
        expect(await screen.findByRole('alert')).toHaveTextContent('Could not take the dropped files. Use CHOOSE VIDEOS.');
    });

    it('skips store initialization when skipInit is set', () => {
        render(<MergePanel skipInit />);
        expect(mock.api.merge.onProgress).not.toHaveBeenCalled();
    });
});
