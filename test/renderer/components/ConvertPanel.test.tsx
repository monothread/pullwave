// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { ConvertMedia, ConvertRun } from '@shared/convert';
import { ConvertPanel } from '@renderer/components/ConvertPanel';
import { useAppStore } from '@renderer/store/appStore';
import { useConvertStore } from '@renderer/store/convertStore';
import { useExplorerStore } from '@renderer/store/explorerStore';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

const VIDEO_A: ConvertMedia = { path: '/v/talk.mp4', name: 'talk', extension: '.mp4', durationSeconds: 75 };
const initialApp = useAppStore.getState();
const initialConvert = useConvertStore.getInitialState();
let mock: MockApiHandle;

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: { ...DEFAULT_SETTINGS, downloadDir: '/downloads', audioFormat: 'mp3' } });
    useConvertStore.setState({ ...initialConvert });
});

describe('ConvertPanel', () => {
    it('chooses videos, selects format and output mode, runs conversion, and opens output folder', async () => {
        const user = userEvent.setup();
        mock.api.convert.choose.mockResolvedValueOnce({ ok: true, media: [VIDEO_A], rejected: [] });
        const runningRun: ConvertRun = {
            id: 1,
            format: 'flac',
            outputMode: 'source',
            outputDirectory: null,
            status: 'running',
            items: [{ path: VIDEO_A.path, name: 'talk.mp4', status: 'converting', percent: 50, outputPath: null, error: null }]
        };
        mock.api.convert.start.mockResolvedValueOnce({ ok: true, run: runningRun });

        render(<ConvertPanel />);
        await user.click(screen.getByRole('button', { name: 'CHOOSE VIDEOS' }));
        expect(await screen.findByText('talk.mp4')).toBeInTheDocument();
        expect(screen.getByText('Length: 1:15')).toBeInTheDocument();

        await user.selectOptions(screen.getByLabelText('Audio format'), 'flac');
        await user.selectOptions(screen.getByLabelText('Save to'), 'source');
        expect(screen.getByText('Each audio is saved next to its video file.')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'CONVERT (1)' }));
        expect(mock.api.convert.start).toHaveBeenCalledWith({
            paths: [VIDEO_A.path],
            format: 'flac',
            outputMode: 'source'
        });
        expect(await screen.findByText('CONVERTING')).toBeInTheDocument();

        act(() => {
            mock.emitConvertProgress({
                ...runningRun,
                status: 'done',
                items: [{ path: VIDEO_A.path, name: 'talk.mp4', status: 'done', percent: 100, outputPath: '/v/talk.flac', error: null }]
            });
        });
        expect(await screen.findByText('Done: 1 audio file(s) saved.')).toBeInTheDocument();

        mock.api.explorer.list.mockResolvedValueOnce({
            ok: true,
            listing: {
                directory: '/v',
                parent: null,
                breadcrumbs: [{ name: 'v', path: '/v' }],
                entries: [
                    {
                        path: '/v/talk.flac',
                        name: 'talk.flac',
                        kind: 'audio',
                        extension: '.flac',
                        sizeBytes: 1024,
                        modifiedAt: 1000,
                        token: 1,
                        thumbnailUrl: null,
                        mediaUrl: 'pullwave-explorer://media/1'
                    }
                ],
                roots: [{ id: 'downloads', label: 'v', path: '/v', kind: 'downloads' }]
            }
        });
        await user.click(screen.getByRole('button', { name: 'SHOW FILE' }));
        expect(mock.api.explorer.list).toHaveBeenCalledWith('/v', false);
        expect(useAppStore.getState().downloadsView).toBe('explorer');
        expect(useExplorerStore.getState().highlightedPath).toBe('/v/talk.flac');
    });

    it('accepts dropped video files and reports drop failure cleanly', async () => {
        mock.api.convert.probe.mockResolvedValueOnce({ ok: true, media: VIDEO_A });
        render(<ConvertPanel />);
        const panel = screen.getByRole('region', { name: 'Convert video to audio' });
        const file = new File(['video'], 'talk.mp4', { type: 'video/mp4' });

        fireEvent.dragEnter(panel, { dataTransfer: { types: ['Files'] } });
        expect(screen.getByTestId('convert-drop')).toHaveTextContent('DROP VIDEOS HERE');
        fireEvent.drop(panel, { dataTransfer: { types: ['Files'], files: [file] } });

        expect(await screen.findByText('talk.mp4')).toBeInTheDocument();

        mock.api.convert.pathForFile.mockReturnValueOnce('');
        fireEvent.drop(panel, { dataTransfer: { types: ['Files'], files: [file] } });
        expect(await screen.findByRole('alert')).toHaveTextContent('Could not take the dropped files. Use CHOOSE VIDEOS.');
    });

    it('clears the list after confirmation and allows cancelling a restored run when items are empty', async () => {
        const user = userEvent.setup();
        useConvertStore.setState({ items: [VIDEO_A] });
        const { unmount } = render(<ConvertPanel />);
        await user.click(screen.getByRole('button', { name: 'CLEAR' }));
        const dialog = screen.getByRole('dialog', { name: 'Clear the list?' });
        await user.click(within(dialog).getByRole('button', { name: 'CLEAR' }));
        expect(mock.api.convert.clear).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('talk.mp4')).not.toBeInTheDocument();
        unmount();

        mock.api.convert.current.mockResolvedValueOnce({
            id: 5,
            format: 'mp3',
            outputMode: 'downloads',
            outputDirectory: '/downloads',
            status: 'running',
            items: [{ path: VIDEO_A.path, name: 'talk.mp4', status: 'converting', percent: 30, outputPath: null, error: null }]
        });
        render(<ConvertPanel />);
        const cancelBtn = await screen.findByRole('button', { name: 'CANCEL' });
        await user.click(cancelBtn);
        expect(mock.api.convert.cancel).toHaveBeenCalledTimes(1);
    });
});
