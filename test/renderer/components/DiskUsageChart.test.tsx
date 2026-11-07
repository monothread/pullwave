// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { DiskSibling, DiskUsage } from '@shared/types';
import { DiskUsageChart } from '@renderer/components/DiskUsageChart';
import { REVEAL_MILLISECONDS } from '@renderer/hooks/useRevealProgress';
import { useAppStore } from '@renderer/store/appStore';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initial = useAppStore.getState();
const GB = 1024 ** 3;
const SIBLING: DiskSibling = { section: 'manga', directory: '/media/manga', bytes: 20 * GB, placement: 'same-disk' };
const USAGE: DiskUsage = { directory: '/media/anime', totalBytes: 100 * GB, freeBytes: 40 * GB, folderBytes: 10 * GB, sibling: SIBLING };

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
        expect(document.querySelector('.disk__spinner')).toHaveAttribute('aria-hidden', 'true');
        expect(mock.api.getDiskUsage).toHaveBeenCalledTimes(1);
        expect(mock.api.getDiskUsage).toHaveBeenCalledWith('anime');
    });

    it('starts the numbers at zero and counts them up to the real values', async () => {
        render(<DiskUsageChart section="anime" refreshKey="a" />);
        await advance(0);
        expect(screen.getByTestId('disk-usage-anime')).toBeInTheDocument();
        expect(screen.getByTestId('disk-percent')).toHaveTextContent('0%');
        expect(screen.getByTestId('disk-folder')).toHaveTextContent('0 B');
        expect(screen.getByTestId('disk-sibling')).toHaveTextContent('0 B');
        await advance(REVEAL_MILLISECONDS + 100);
        expect(screen.getByTestId('disk-percent')).toHaveTextContent('60%');
        expect(screen.getByTestId('disk-folder')).toHaveTextContent('10.0 GiB');
        expect(screen.getByTestId('disk-sibling')).toHaveTextContent('20.0 GiB');
        expect(screen.getByTestId('disk-others')).toHaveTextContent('30.0 GiB');
        expect(screen.getByTestId('disk-free')).toHaveTextContent('40.0 GiB');
        expect(screen.getByText('100.0 GiB')).toBeInTheDocument();
        ['This folder', 'Manga folder', 'Other files', 'Free', 'used'].forEach((label) => {
            expect(screen.getByText(label)).toBeInTheDocument();
        });
    });

    it('draws the ring with the folder, the folder of the other section, the other files and the full length at the end', async () => {
        const { container } = render(<DiskUsageChart section="anime" refreshKey="a" />);
        await advance(0);
        await advance(REVEAL_MILLISECONDS + 100);
        const folder = container.querySelector('.disk__segment--folder');
        const sibling = container.querySelector('.disk__segment--sibling');
        const others = container.querySelector('.disk__segment--others');
        expect(folder).toHaveAttribute('stroke-dasharray', '10 90');
        expect(folder).toHaveAttribute('stroke-dashoffset', '0');
        expect(sibling).toHaveAttribute('stroke-dasharray', '20 80');
        expect(sibling).toHaveAttribute('stroke-dashoffset', '-10');
        expect(others).toHaveAttribute('stroke-dasharray', '30 70');
        expect(others).toHaveAttribute('stroke-dashoffset', '-30');
        expect(screen.getByRole('img')).toHaveAttribute(
            'aria-label',
            'Disk space of the folder: 10.0 GiB in the folder, Manga folder 20.0 GiB, 30.0 GiB in other files, 40.0 GiB free of 100.0 GiB'
        );
    });

    it('starts the parts of the ring empty and grows them together', async () => {
        const { container } = render(<DiskUsageChart section="anime" refreshKey="a" />);
        await advance(0);
        expect(container.querySelector('.disk__segment--folder')).toHaveAttribute('stroke-dasharray', '0 100');
        expect(container.querySelector('.disk__segment--sibling')).toHaveAttribute('stroke-dasharray', '0 100');
        expect(container.querySelector('.disk__segment--others')).toHaveAttribute('stroke-dasharray', '0 100');
    });

    it('names the folder of the other section after the anime when the manga is the one open', async () => {
        mock.api.getDiskUsage.mockResolvedValue({ ...USAGE, directory: '/media/manga', sibling: { ...SIBLING, section: 'anime', directory: '/media/anime' } });
        render(<DiskUsageChart section="manga" refreshKey="a" />);
        await advance(0);
        await advance(REVEAL_MILLISECONDS + 100);
        expect(screen.getByText('Anime folder')).toBeInTheDocument();
        expect(screen.queryByText('Manga folder')).not.toBeInTheDocument();
        expect(screen.getByTestId('disk-sibling')).toHaveTextContent('20.0 GiB');
    });

    it('does not say anything about the folder of the other section when it is on the same disk and apart', async () => {
        render(<DiskUsageChart section="anime" refreshKey="a" />);
        await advance(0);
        expect(screen.queryByTestId('disk-sibling-note')).not.toBeInTheDocument();
    });

    it('warns that the folder of the other section is on another disk and leaves it out of the ring', async () => {
        mock.api.getDiskUsage.mockResolvedValue({ ...USAGE, sibling: { ...SIBLING, placement: 'other-disk' } });
        const { container } = render(<DiskUsageChart section="anime" refreshKey="a" />);
        await advance(0);
        await advance(REVEAL_MILLISECONDS + 100);
        expect(screen.getByTestId('disk-sibling-note')).toHaveTextContent('On another disk, so it is not part of the ring.');
        expect(screen.getByTestId('disk-sibling')).toHaveTextContent('20.0 GiB');
        expect(screen.getByTestId('disk-others')).toHaveTextContent('50.0 GiB');
        expect(container.querySelector('.disk__segment--sibling')).toHaveAttribute('stroke-dasharray', '0 100');
        expect(container.querySelector('.disk__segment--others')).toHaveAttribute('stroke-dasharray', '50 50');
        expect(container.querySelector('.disk__segment--others')).toHaveAttribute('stroke-dashoffset', '-10');
    });

    it('warns that the folders overlap and leaves the folder of the other section out of the ring', async () => {
        mock.api.getDiskUsage.mockResolvedValue({ ...USAGE, sibling: { ...SIBLING, placement: 'overlap', bytes: 10 * GB } });
        const { container } = render(<DiskUsageChart section="anime" refreshKey="a" />);
        await advance(0);
        await advance(REVEAL_MILLISECONDS + 100);
        expect(screen.getByTestId('disk-sibling-note')).toHaveTextContent('The folders overlap, so these files are counted only once.');
        expect(screen.getByTestId('disk-sibling')).toHaveTextContent('10.0 GiB');
        expect(screen.getByTestId('disk-others')).toHaveTextContent('50.0 GiB');
        expect(container.querySelector('.disk__segment--sibling')).toHaveAttribute('stroke-dasharray', '0 100');
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

    describe('while the files are being moved', () => {
        it('does not read the disk, and shows it is loading', async () => {
            render(<DiskUsageChart section="anime" refreshKey="a" busy />);
            await advance(0);
            expect(mock.api.getDiskUsage).not.toHaveBeenCalled();
            expect(screen.getByText('Reading the disk…')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'REFRESH' })).toBeDisabled();
        });

        it('reads the disk when the move ends', async () => {
            const { rerender } = render(<DiskUsageChart section="anime" refreshKey="a" busy />);
            await advance(0);
            rerender(<DiskUsageChart section="anime" refreshKey="a" busy={false} />);
            await advance(0);
            expect(mock.api.getDiskUsage).toHaveBeenCalledTimes(1);
            expect(mock.api.getDiskUsage).toHaveBeenCalledWith('anime');
            expect(screen.getByTestId('disk-folder')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'REFRESH' })).toBeEnabled();
        });

        it('keeps what was shown, does not read again and turns REFRESH off while the move runs', async () => {
            const { rerender } = render(<DiskUsageChart section="anime" refreshKey="a" />);
            await advance(0);
            await advance(REVEAL_MILLISECONDS + 100);
            rerender(<DiskUsageChart section="anime" refreshKey="a" busy />);
            await advance(0);
            expect(mock.api.getDiskUsage).toHaveBeenCalledTimes(1);
            expect(screen.getByTestId('disk-folder')).toHaveTextContent('10.0 GiB');
            expect(screen.getByRole('button', { name: 'REFRESH' })).toBeDisabled();
        });

        it('reads the disk again when the move ends, with the values of then', async () => {
            const { rerender } = render(<DiskUsageChart section="anime" refreshKey="a" />);
            await advance(0);
            await advance(REVEAL_MILLISECONDS + 100);
            rerender(<DiskUsageChart section="anime" refreshKey="a" busy />);
            mock.api.getDiskUsage.mockResolvedValue({ ...USAGE, folderBytes: 30 * GB });
            rerender(<DiskUsageChart section="anime" refreshKey="a" busy={false} />);
            await advance(0);
            await advance(REVEAL_MILLISECONDS + 100);
            expect(mock.api.getDiskUsage).toHaveBeenCalledTimes(2);
            expect(screen.getByTestId('disk-folder')).toHaveTextContent('30.0 GiB');
        });

        it('ignores the answer of a reading that was in flight when the move started', async () => {
            let resolve: (value: DiskUsage) => void = () => {
                return undefined;
            };
            mock.api.getDiskUsage.mockReturnValue(
                new Promise<DiskUsage>((done) => {
                    resolve = done;
                })
            );
            const { rerender } = render(<DiskUsageChart section="anime" refreshKey="a" />);
            rerender(<DiskUsageChart section="anime" refreshKey="a" busy />);
            resolve(USAGE);
            await advance(0);
            expect(screen.queryByTestId('disk-folder')).not.toBeInTheDocument();
            expect(screen.getByText('Reading the disk…')).toBeInTheDocument();
        });
    });
});
