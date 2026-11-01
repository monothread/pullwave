// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DownloadError } from '@shared/types';
import { ErrorBanner } from '@renderer/components/ErrorBanner';

const ERROR: DownloadError = { code: 'NETWORK', title: 'Network failure', hint: 'Check your connection and try again.', raw: 'getaddrinfo failed' };

describe('ErrorBanner', () => {
    it('renders the code, title and hint as an alert', () => {
        render(<ErrorBanner error={ERROR} onRetry={vi.fn()} />);
        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByText('NETWORK')).toBeInTheDocument();
        expect(screen.getByText('Network failure')).toBeInTheDocument();
        expect(screen.getByText('Check your connection and try again.')).toBeInTheDocument();
    });

    it('keeps the details out of sight until the button asks for them, in a window that the user closes', async () => {
        const user = userEvent.setup();
        render(<ErrorBanner error={ERROR} onRetry={vi.fn()} />);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.queryByText('getaddrinfo failed')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'SHOW DETAILS' }));
        const dialog = screen.getByRole('dialog', { name: 'ERROR DETAILS' });
        expect(within(dialog).getByTestId('error-message')).toHaveTextContent('getaddrinfo failed');
        expect(within(dialog).getByText('Network failure')).toBeInTheDocument();
        expect(within(dialog).getByText('NETWORK')).toBeInTheDocument();
        expect(within(dialog).getByText('Check your connection and try again.', { exact: false })).toBeInTheDocument();
        await user.click(within(dialog).getByRole('button', { name: 'CLOSE' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.queryByText('getaddrinfo failed')).not.toBeInTheDocument();
    });

    it('shows in the window what the app knows about the failure of the download', async () => {
        const user = userEvent.setup();
        const error: DownloadError = {
            ...ERROR,
            details: { occurredAt: 1700000000000, operation: 'Running yt-dlp', command: 'yt-dlp --newline https://x.test/v', exitCode: 1 }
        };
        render(<ErrorBanner error={error} onRetry={vi.fn()} />);
        await user.click(screen.getByRole('button', { name: 'SHOW DETAILS' }));
        const dialog = screen.getByRole('dialog', { name: 'ERROR DETAILS' });
        expect(within(dialog).getByText('Running yt-dlp')).toBeInTheDocument();
        expect(within(dialog).getByText('yt-dlp --newline https://x.test/v')).toBeInTheDocument();
        expect(within(dialog).getByText('1')).toBeInTheDocument();
    });

    it('calls onRetry when retry is clicked', async () => {
        const onRetry = vi.fn();
        render(<ErrorBanner error={ERROR} onRetry={onRetry} />);
        await userEvent.setup().click(screen.getByRole('button', { name: 'RETRY' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('keeps retrying from the banner after the window of the details is closed', async () => {
        const user = userEvent.setup();
        const onRetry = vi.fn();
        render(<ErrorBanner error={ERROR} onRetry={onRetry} />);
        await user.click(screen.getByRole('button', { name: 'SHOW DETAILS' }));
        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'CLOSE' }));
        await user.click(screen.getByRole('button', { name: 'RETRY' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('has only the details and retry buttons', () => {
        render(<ErrorBanner error={ERROR} onRetry={vi.fn()} />);
        expect(
            screen.getAllByRole('button').map((button) => {
                return button.textContent;
            })
        ).toEqual(['SHOW DETAILS', 'RETRY']);
    });
});
