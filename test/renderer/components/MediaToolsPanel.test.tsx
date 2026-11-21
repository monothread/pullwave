// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { MediaToolsPanel } from '@renderer/components/MediaToolsPanel';
import { useAppStore } from '@renderer/store/appStore';
import { useConvertStore } from '@renderer/store/convertStore';
import { useCutStore } from '@renderer/store/cutStore';
import { useMergeStore } from '@renderer/store/mergeStore';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

const initialApp = useAppStore.getState();
const initialCut = useCutStore.getInitialState();
const initialConvert = useConvertStore.getInitialState();
const initialMerge = useMergeStore.getInitialState();
let mock: MockApiHandle;

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, tab: 'downloads', downloadsView: 'tools', toolsMode: 'cut', settings: DEFAULT_SETTINGS });
    useCutStore.setState({ ...initialCut });
    useConvertStore.setState({ ...initialConvert });
    useMergeStore.setState({ ...initialMerge });
});

describe('MediaToolsPanel', () => {
    it('switches between CUT, CONVERT and MERGE modes and initializes each tool subscription once', async () => {
        const user = userEvent.setup();
        render(<MediaToolsPanel />);

        const tablist = screen.getByRole('tablist', { name: 'Tool mode' });
        expect(
            within(tablist)
                .getAllByRole('tab')
                .map((tab) => {
                    return tab.textContent;
                })
        ).toEqual(['CUT', 'CONVERT', 'MERGE']);
        expect(within(tablist).getByRole('tab', { name: 'CUT' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('region', { name: 'Cut a file' })).toBeInTheDocument();

        await user.click(within(tablist).getByRole('tab', { name: 'CONVERT' }));
        expect(useAppStore.getState().toolsMode).toBe('convert');
        expect(within(tablist).getByRole('tab', { name: 'CONVERT' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('region', { name: 'Convert video to audio' })).toBeInTheDocument();

        await user.click(within(tablist).getByRole('tab', { name: 'MERGE' }));
        expect(useAppStore.getState().toolsMode).toBe('merge');
        expect(within(tablist).getByRole('tab', { name: 'MERGE' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('region', { name: 'Merge videos' })).toBeInTheDocument();

        expect(mock.api.cut.onProgress).toHaveBeenCalledTimes(1);
        expect(mock.api.convert.onProgress).toHaveBeenCalledTimes(1);
        expect(mock.api.merge.onProgress).toHaveBeenCalledTimes(1);
    });

    it('shows a running indicator on a tool tab while it runs in the background', () => {
        useMergeStore.setState({
            run: {
                id: 1,
                format: 'mp4',
                outputMode: 'downloads',
                outputDirectory: '/downloads',
                outputName: 'clip - merged.mp4',
                inputCount: 2,
                totalDurationSeconds: 20,
                method: 'copy',
                status: 'running',
                percent: 25,
                outputPath: null,
                error: null
            }
        });
        render(<MediaToolsPanel />);

        const mergeTab = screen.getByRole('tab', { name: /MERGE/ });
        expect(within(mergeTab).getByLabelText('Running')).toBeInTheDocument();
        const cutTab = screen.getByRole('tab', { name: 'CUT' });
        expect(within(cutTab).queryByLabelText('Running')).not.toBeInTheDocument();
    });
});
