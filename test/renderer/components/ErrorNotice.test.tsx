// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { ErrorNotice } from '@renderer/components/ErrorNotice';
import { codedErrorReport, plainErrorReport } from '@renderer/components/errorReport';
import { useAppStore } from '@renderer/store/appStore';
import { installMockApi } from '../../helpers/mockApi';

const initialApp = useAppStore.getState();

beforeEach(() => {
    installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS, toasts: [] });
});

describe('ErrorNotice', () => {
    it('shows the words of the error as a button with a hint that there is more to see', () => {
        render(<ErrorNotice report={codedErrorReport('The download failed.', { code: 'DOWNLOAD_FAILED' }, 'offline')} />);
        const button = screen.getByRole('button', { name: 'The download failed.' });
        expect(button).toHaveClass('error-notice');
        expect(button).toHaveAttribute('type', 'button');
        expect(button).toHaveAttribute('title', 'Click to see the technical error');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('opens the window with the details when it is clicked, and closes it with the close button', async () => {
        const user = userEvent.setup();
        render(<ErrorNotice report={codedErrorReport('The download failed.', { code: 'DOWNLOAD_FAILED', details: { occurredAt: 1700000000000, httpStatus: 404 } }, 'offline')} />);
        await user.click(screen.getByRole('button', { name: 'The download failed.' }));
        const dialog = screen.getByRole('dialog', { name: 'ERROR DETAILS' });
        expect(within(dialog).getByText('DOWNLOAD_FAILED')).toBeInTheDocument();
        expect(within(dialog).getByText('404')).toBeInTheDocument();
        expect(within(dialog).getByTestId('error-message').textContent).toBe('offline');
        await user.click(within(dialog).getByRole('button', { name: 'CLOSE' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('can be opened again after it was closed', async () => {
        const user = userEvent.setup();
        render(<ErrorNotice report={plainErrorReport('The manga server could not start.', 'port in use')} />);
        await user.click(screen.getByRole('button', { name: 'The manga server could not start.' }));
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'The manga server could not start.' }));
        expect(screen.getByTestId('error-message').textContent).toBe('port in use');
    });

    it('gives the focus back to the words when the window is closed', async () => {
        const user = userEvent.setup();
        render(<ErrorNotice report={plainErrorReport('The manga server could not start.', 'port in use')} />);
        const button = screen.getByRole('button', { name: 'The manga server could not start.' });
        await user.click(button);
        await user.click(screen.getByRole('button', { name: 'CLOSE' }));
        expect(button).toHaveFocus();
    });

    it('is only the words when there is nothing more to say', () => {
        render(<ErrorNotice report={plainErrorReport('Already on the latest version.', '')} />);
        expect(screen.getByText('Already on the latest version.')).toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('does not open the window of a row it is in by being clicked', async () => {
        const user = userEvent.setup();
        const rowClick = vi.fn();
        render(
            <div onClick={rowClick}>
                <ErrorNotice report={plainErrorReport('The manga server could not start.', 'port in use')} />
            </div>
        );
        await user.click(screen.getByRole('button', { name: 'The manga server could not start.' }));
        await user.click(screen.getByRole('button', { name: 'COPY' }));
        expect(rowClick).toHaveBeenCalledTimes(1);
    });
});
