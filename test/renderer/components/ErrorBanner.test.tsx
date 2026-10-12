// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
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

    it('hides the raw details by default and toggles them', async () => {
        const user = userEvent.setup();
        render(<ErrorBanner error={ERROR} onRetry={vi.fn()} />);
        expect(screen.queryByText('getaddrinfo failed')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'SHOW DETAILS' }));
        expect(screen.getByText('getaddrinfo failed')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'HIDE DETAILS' }));
        expect(screen.queryByText('getaddrinfo failed')).not.toBeInTheDocument();
    });

    it('calls onRetry when retry is clicked', async () => {
        const onRetry = vi.fn();
        render(<ErrorBanner error={ERROR} onRetry={onRetry} />);
        await userEvent.setup().click(screen.getByRole('button', { name: 'RETRY' }));
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
