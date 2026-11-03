// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { DiskUsageChart } from '@renderer/components/DiskUsageChart';
import { REVEAL_MILLISECONDS } from '@renderer/hooks/useRevealProgress';
import { useAppStore } from '@renderer/store/appStore';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initial = useAppStore.getState();
const GB = 1024 ** 3;
const USAGE = { directory: '/media/anime', totalBytes: 100 * GB, freeBytes: 40 * GB, folderBytes: 10 * GB };

beforeEach(() => {
    vi.useFakeTimers();
    mock = installMockApi();
    useAppStore.setState({ ...initial, settings: DEFAULT_SETTINGS });
    mock.api.getDiskUsage.mockResolvedValue(USAGE);
});

afterEach(() => {
    vi.useRealTimers();
});

async function advance(ms: number): Promise<void> {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
}

describe('DiskUsageChart', () => {
    it('reads the disk of the section when it opens and shows it is loading', async () => {
        mock.api.getDiskUsage.mockReturnValue(
            new Promise(() => {
                return undefined;
            })
        );
        render(<DiskUsageChart section="anime" refreshKey="a" />);
        expect(screen.getByText('DISK SPACE')).toBeInTheDocument();
        expect(screen.getByText('Reading the disk…')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'REFRESH' })).toBeDisabled();
        expect(mock.api.getDiskUsage).toHaveBeenCalledTimes(1);
        expect(mock.api.getDiskUsage).toHaveBeenCalledWith('anime');
    });

    it('starts the numbers at zero and counts them up to the real values', async () => {
        render(<DiskUsageChart section="anime" refreshKey="a" />);
        await advance(0);
        expect(screen.getByTestId('disk-usage-anime')).toBeInTheDocument();
        expect(screen.getByTestId('disk-percent')).toHaveTextContent('0%');
        expect(screen.getByTestId('disk-folder')).toHaveTextContent('0 B');
        await advance(REVEAL_MILLISECONDS + 100);
        expect(screen.getByTestId('disk-percent')).toHaveTextContent('60%');
        expect(screen.getByTestId('disk-folder')).toHaveTextContent('10.0 GiB');
        expect(screen.getByTestId('disk-others')).toHaveTextContent('50.0 GiB');
        expect(screen.getByTestId('disk-free')).toHaveTextContent('40.0 GiB');
        expect(screen.getByText('100.0 GiB')).toBeInTheDocument();
        ['This folder', 'Other files', 'Free', 'used'].forEach((label) => {
            expect(screen.getByText(label)).toBeInTheDocument();
        });
    });

    it('draws the ring with the folder, the other files and the full length at the end', async () => {
        const { container } = render(<DiskUsageChart section="anime" refreshKey="a" />);
        await advance(0);
        await advance(REVEAL_MILLISECONDS + 100);
        const folder = container.querySelector('.disk__segment--folder');
        const others = container.querySelector('.disk__segment--others');
        expect(folder).toHaveAttribute('stroke-dasharray', '10 90');
        expect(folder).toHaveAttribute('stroke-dashoffset', '0');
        expect(others).toHaveAttribute('stroke-dasharray', '50 50');
        expect(others).toHaveAttribute('stroke-dashoffset', '-10');
        expect(screen.getByRole('img')).toHaveAttribute(
            'aria-label',
            'Disk space of the folder: 10.0 GiB in the folder, 50.0 GiB in other files, 40.0 GiB free of 100.0 GiB'
        );
    });

    it('reads the disk of the manga section', async () => {
        render(<DiskUsageChart section="manga" refreshKey="a" />);
        await advance(0);
        expect(mock.api.getDiskUsage).toHaveBeenCalledWith('manga');
        expect(screen.getByTestId('disk-usage-manga')).toBeInTheDocument();
    });

    it('reads the disk again when the refresh key changes', async () => {
        const { rerender } = render(<DiskUsageChart section="anime" refreshKey="a" />);
        await advance(0);
        rerender(<DiskUsageChart section="anime" refreshKey="b" />);
        await advance(0);
        expect(mock.api.getDiskUsage).toHaveBeenCalledTimes(2);
    });

    it('shows it is loading again while the disk is read for a new key, then the new values', async () => {
        const { rerender } = render(<DiskUsageChart section="anime" refreshKey="a" />);
        await advance(0);
        await advance(REVEAL_MILLISECONDS + 100);
        mock.api.getDiskUsage.mockResolvedValue({ ...USAGE, folderBytes: 20 * GB });
        rerender(<DiskUsageChart section="anime" refreshKey="b" />);
        expect(screen.getByText('Reading the disk…')).toBeInTheDocument();
        await advance(0);
        await advance(REVEAL_MILLISECONDS + 100);
        expect(screen.getByTestId('disk-folder')).toHaveTextContent('20.0 GiB');
    });

    it('reads the disk again when REFRESH is pressed', async () => {
        render(<DiskUsageChart section="anime" refreshKey="a" />);
        await advance(0);
        fireEvent.click(screen.getByRole('button', { name: 'REFRESH' }));
        await advance(0);
        expect(mock.api.getDiskUsage).toHaveBeenCalledTimes(2);
        expect(mock.api.getDiskUsage).toHaveBeenLastCalledWith('anime');
    });

    it('says the disk could not be read when the answer is empty', async () => {
        mock.api.getDiskUsage.mockResolvedValue(null);
        render(<DiskUsageChart section="manga" refreshKey="a" />);
        await advance(0);
        expect(screen.getByText('The disk of this folder could not be read.')).toBeInTheDocument();
        expect(screen.queryByTestId('disk-percent')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'REFRESH' })).toBeEnabled();
    });

    it('says the disk could not be read when the call fails', async () => {
        mock.api.getDiskUsage.mockRejectedValue(new Error('boom'));
        render(<DiskUsageChart section="manga" refreshKey="a" />);
        await advance(0);
        expect(screen.getByText('The disk of this folder could not be read.')).toBeInTheDocument();
    });

    it('ignores the answer that arrives after it was closed', async () => {
        let resolve: (value: typeof USAGE) => void = () => {
            return undefined;
        };
        mock.api.getDiskUsage.mockReturnValue(
            new Promise<typeof USAGE>((done) => {
                resolve = done;
            })
        );
        const { unmount } = render(<DiskUsageChart section="anime" refreshKey="a" />);
        unmount();
        resolve(USAGE);
        await advance(0);
        expect(mock.api.getDiskUsage).toHaveBeenCalledTimes(1);
    });
});
