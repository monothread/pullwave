// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from '@testing-library/react';
import { INFO_NOTICE_MS, Toast } from '@renderer/components/Toast';
import { useAppStore } from '@renderer/store/appStore';

const initial = useAppStore.getState();

beforeEach(() => {
    useAppStore.setState({ ...initial, notice: null, toasts: [] });
});

describe('Toast', () => {
    it('renders nothing without a notice', () => {
        const { container } = render(<Toast />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders an error notice as an alert', () => {
        useAppStore.setState({ notice: { kind: 'error', message: 'Boom' } });
        render(<Toast />);
        expect(screen.getByRole('alert')).toHaveTextContent('Boom');
        expect(screen.getByRole('alert')).toHaveClass('toast--error');
    });

    it('renders an info notice as a status', () => {
        useAppStore.setState({ notice: { kind: 'info', message: 'Saved' } });
        render(<Toast />);
        expect(screen.getByRole('status')).toHaveTextContent('Saved');
        expect(screen.getByRole('status')).toHaveClass('toast--info');
    });

    describe('going away by itself', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('removes an info notice after five seconds', () => {
            expect(INFO_NOTICE_MS).toBe(5000);
            useAppStore.setState({ notice: { kind: 'info', message: 'Queued' } });
            render(<Toast />);

            act(() => {
                vi.advanceTimersByTime(INFO_NOTICE_MS - 1);
            });
            expect(screen.getByText('Queued')).toBeInTheDocument();

            act(() => {
                vi.advanceTimersByTime(1);
            });
            expect(useAppStore.getState().notice).toBeNull();
            expect(screen.queryByText('Queued')).not.toBeInTheDocument();
        });

        it('keeps an error notice until it is dismissed', () => {
            useAppStore.setState({ notice: { kind: 'error', message: 'Boom' } });
            render(<Toast />);
            act(() => {
                vi.advanceTimersByTime(INFO_NOTICE_MS * 10);
            });
            expect(screen.getByText('Boom')).toBeInTheDocument();
            expect(useAppStore.getState().notice).toEqual({ kind: 'error', message: 'Boom' });
        });

        it('counts the five seconds again when a new notice replaces the old one', () => {
            useAppStore.setState({ notice: { kind: 'info', message: 'First' } });
            render(<Toast />);
            act(() => {
                vi.advanceTimersByTime(INFO_NOTICE_MS - 1000);
            });
            act(() => {
                useAppStore.setState({ notice: { kind: 'info', message: 'Second' } });
            });
            act(() => {
                vi.advanceTimersByTime(INFO_NOTICE_MS - 1000);
            });
            expect(screen.getByText('Second')).toBeInTheDocument();
            act(() => {
                vi.advanceTimersByTime(1000);
            });
            expect(screen.queryByText('Second')).not.toBeInTheDocument();
        });

        it('does not clear a newer error when the timer of an older info notice fires', () => {
            useAppStore.setState({ notice: { kind: 'info', message: 'Info' } });
            render(<Toast />);
            act(() => {
                useAppStore.setState({ notice: { kind: 'error', message: 'Boom' } });
            });
            act(() => {
                vi.advanceTimersByTime(INFO_NOTICE_MS * 2);
            });
            expect(screen.getByText('Boom')).toBeInTheDocument();
        });

        it('stops the timer when the notice is dismissed by hand', () => {
            useAppStore.setState({ notice: { kind: 'info', message: 'Saved' } });
            render(<Toast />);
            act(() => {
                useAppStore.getState().setNotice(null);
            });
            act(() => {
                useAppStore.getState().setNotice({ kind: 'error', message: 'Later error' });
                vi.advanceTimersByTime(INFO_NOTICE_MS * 2);
            });
            expect(screen.getByText('Later error')).toBeInTheDocument();
        });
    });

    describe('the stack of notices that say something finished', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        function messages(): string[] {
            return screen.getAllByRole('status').map((toast) => {
                return toast.querySelector('.toast__message')?.textContent ?? '';
            });
        }

        it('shows a toast as an information notice, in the stack', () => {
            render(<Toast />);
            act(() => {
                useAppStore.getState().pushToast('Download complete: One');
            });
            expect(screen.getByRole('status')).toHaveTextContent('Download complete: One');
            expect(screen.getByRole('status')).toHaveClass('toast', 'toast--info');
            expect(screen.getByRole('status').parentElement).toHaveClass('toasts');
        });

        it('shows all the toasts together, in the order they came, and not one after the other', () => {
            render(<Toast />);
            act(() => {
                useAppStore.getState().pushToast('One');
                useAppStore.getState().pushToast('Two');
                useAppStore.getState().pushToast('Three');
            });
            expect(messages()).toEqual(['One', 'Two', 'Three']);
        });

        it('takes each toast away five seconds after it showed up, whatever the others do', () => {
            render(<Toast />);
            act(() => {
                useAppStore.getState().pushToast('One');
            });
            act(() => {
                vi.advanceTimersByTime(2000);
            });
            act(() => {
                useAppStore.getState().pushToast('Two');
            });
            expect(messages()).toEqual(['One', 'Two']);

            act(() => {
                vi.advanceTimersByTime(INFO_NOTICE_MS - 2000 - 1);
            });
            expect(messages()).toEqual(['One', 'Two']);
            act(() => {
                vi.advanceTimersByTime(1);
            });
            expect(messages()).toEqual(['Two']);

            act(() => {
                vi.advanceTimersByTime(1999);
            });
            expect(messages()).toEqual(['Two']);
            act(() => {
                vi.advanceTimersByTime(1);
            });
            expect(screen.queryByRole('status')).not.toBeInTheDocument();
            expect(useAppStore.getState().toasts).toEqual([]);
        });

        it('takes away only the toast that is dismissed by hand', async () => {
            vi.useRealTimers();
            render(<Toast />);
            act(() => {
                useAppStore.getState().pushToast('One');
                useAppStore.getState().pushToast('Two');
            });
            const dismiss = screen.getAllByRole('button', { name: 'Dismiss notification' });
            expect(dismiss).toHaveLength(2);

            await userEvent.setup().click(dismiss[0] as HTMLElement);

            expect(messages()).toEqual(['Two']);
            expect(useAppStore.getState().toasts).toEqual([{ id: expect.any(Number), message: 'Two' }]);
        });

        it('shows the notice of an action together with the toasts, which it does not replace', () => {
            useAppStore.setState({ notice: { kind: 'error', message: 'Boom' } });
            render(<Toast />);
            act(() => {
                useAppStore.getState().pushToast('Done');
            });
            expect(screen.getByRole('alert')).toHaveTextContent('Boom');
            expect(screen.getByRole('status')).toHaveTextContent('Done');
            expect(screen.getByRole('alert').parentElement).toBe(screen.getByRole('status').parentElement);
        });

        it('keeps the toasts when the notice of an action goes away, and the notice when a toast does', () => {
            useAppStore.setState({ notice: { kind: 'error', message: 'Boom' } });
            render(<Toast />);
            act(() => {
                useAppStore.getState().pushToast('Done');
            });
            act(() => {
                useAppStore.getState().setNotice(null);
            });
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
            expect(screen.getByText('Done')).toBeInTheDocument();

            act(() => {
                useAppStore.getState().setNotice({ kind: 'error', message: 'Again' });
                vi.advanceTimersByTime(INFO_NOTICE_MS);
            });
            expect(screen.queryByText('Done')).not.toBeInTheDocument();
            expect(screen.getByText('Again')).toBeInTheDocument();
        });

        it('renders nothing when there is neither a notice nor a toast, and shows the toasts without a notice', () => {
            const { container } = render(<Toast />);
            expect(container).toBeEmptyDOMElement();
            act(() => {
                useAppStore.getState().pushToast('Only a toast');
            });
            expect(container).not.toBeEmptyDOMElement();
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });
    });

    it('dismisses the notice', async () => {
        useAppStore.setState({ notice: { kind: 'info', message: 'Saved' } });
        render(<Toast />);
        await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss notification' }));
        expect(useAppStore.getState().notice).toBeNull();
        expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    });
});
