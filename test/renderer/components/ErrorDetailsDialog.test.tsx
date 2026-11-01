// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { ErrorDetailsDialog } from '@renderer/components/ErrorDetailsDialog';
import { codedErrorReport, plainErrorReport, type ErrorReport } from '@renderer/components/errorReport';
import { INITIAL_APP_UPDATE, useAppStore } from '@renderer/store/appStore';
import { installMockApi } from '../../helpers/mockApi';

const initialApp = useAppStore.getState();

const REPORT: ErrorReport = codedErrorReport(
    'The site or the extension reported an error.',
    {
        code: 'API_ERROR',
        details: {
            occurredAt: 1700000000000,
            operation: 'GraphQL fetchMangaAndChapters',
            url: 'http://127.0.0.1:4567/api/graphql',
            httpStatus: 200,
            errorName: 'Error',
            stack: 'Error: boom\n    at requestOnce (suwayomiClient.ts:1:1)'
        }
    },
    'Exception while fetching data (/fetchChapters) : boom'
);

function stubClipboard(writeText: (text: string) => Promise<void>): void {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

function setup(report: ErrorReport = REPORT) {
    const onClose = vi.fn();
    const outside = vi.fn();
    document.addEventListener('keydown', outside);
    const view = render(<ErrorDetailsDialog report={report} onClose={onClose} />);
    return { onClose, outside, user: userEvent.setup(), ...view };
}

beforeEach(() => {
    installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS, toasts: [], appUpdate: { ...INITIAL_APP_UPDATE, currentVersion: '0.23.0' } });
});

describe('ErrorDetailsDialog', () => {
    it('is a window over the screen, named by its heading, with the words of the error', () => {
        setup();
        const dialog = screen.getByRole('dialog', { name: 'ERROR DETAILS' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveClass('modal', 'modal--error');
        expect(dialog.parentElement).toHaveClass('modal-backdrop');
        expect(screen.getByRole('heading', { name: 'ERROR DETAILS' })).toHaveClass('modal__title');
        expect(screen.getByText('The site or the extension reported an error.')).toHaveClass('modal__summary');
    });

    it('is in the body of the page, not inside what opened it', () => {
        const { container } = setup();
        const dialog = screen.getByRole('dialog');
        expect(container.contains(dialog)).toBe(false);
        expect(dialog.parentElement?.parentElement).toBe(document.body);
    });

    it('lists what is known of the error, one fact beside its name, in order', () => {
        setup();
        const rows = Array.from(document.querySelectorAll('.error-details__row')).map((row) => {
            return [row.querySelector('dt')?.textContent, row.querySelector('dd')?.textContent];
        });
        expect(rows).toEqual([
            ['Code', 'API_ERROR'],
            ['When', `${new Date(1700000000000).toLocaleString('en')} (2023-11-14T22:13:20.000Z)`],
            ['What was being done', 'GraphQL fetchMangaAndChapters'],
            ['Address', 'http://127.0.0.1:4567/api/graphql'],
            ['HTTP status', '200'],
            ['Kind of error', 'Error'],
            ['App version', '0.23.0'],
            ['System', navigator.userAgent]
        ]);
    });

    it('leaves the version of the app out while it is not known', () => {
        useAppStore.setState({ appUpdate: INITIAL_APP_UPDATE });
        setup();
        expect(screen.queryByText('App version')).not.toBeInTheDocument();
        expect(screen.getByText('System')).toBeInTheDocument();
    });

    it('shows the technical text as it came, and the stack of the error apart', () => {
        setup();
        expect(screen.getByRole('heading', { name: 'Technical error' })).toBeInTheDocument();
        expect(screen.getByTestId('error-message').textContent).toBe('Exception while fetching data (/fetchChapters) : boom');
        expect(screen.getByRole('heading', { name: 'Stack trace' })).toBeInTheDocument();
        expect(screen.getByTestId('error-stack').textContent).toBe('Error: boom\n    at requestOnce (suwayomiClient.ts:1:1)');
    });

    it('has no stack when the error carries none', () => {
        setup(plainErrorReport('The manga server could not start.', 'port in use'));
        expect(screen.queryByRole('heading', { name: 'Stack trace' })).not.toBeInTheDocument();
        expect(screen.queryByTestId('error-stack')).not.toBeInTheDocument();
        expect(screen.getByTestId('error-message').textContent).toBe('port in use');
    });

    it('says the error came without a text when it has none', () => {
        setup(plainErrorReport('The manga server could not start.', ''));
        expect(screen.getByTestId('error-message').textContent).toBe('The error came without a text.');
    });

    it('shows what the user can do when the error has a hint, and nothing when it has not', () => {
        const { unmount } = setup(codedErrorReport('Network failure', { code: 'NETWORK' }, 'getaddrinfo failed', 'Check your connection and try again.'));
        expect(screen.getByText('Check your connection and try again.', { exact: false })).toHaveClass('modal__hint');
        expect(screen.getByText('What to do:')).toBeInTheDocument();
        unmount();
        setup();
        expect(screen.queryByText('What to do:')).not.toBeInTheDocument();
    });

    it('has the copy and the close buttons, and the focus starts on copy', () => {
        setup();
        expect(
            within(screen.getByRole('dialog'))
                .getAllByRole('button')
                .map((button) => {
                    return button.textContent;
                })
        ).toEqual(['COPY', 'CLOSE']);
        expect(screen.getByRole('button', { name: 'CLOSE' })).toHaveClass('btn--hot');
        expect(screen.getByRole('button', { name: 'COPY' })).toHaveFocus();
    });

    it('copies only the text of the error, tells it, and stays open', async () => {
        const writeText = vi.fn(async () => {
            return undefined;
        });
        const { user, onClose } = setup();
        stubClipboard(writeText);
        await user.click(screen.getByRole('button', { name: 'COPY' }));
        expect(writeText).toHaveBeenCalledTimes(1);
        expect(writeText).toHaveBeenCalledWith('Exception while fetching data (/fetchChapters) : boom');
        await waitFor(() => {
            expect(useAppStore.getState().toasts.map((toast) => { return toast.message; })).toEqual(['Technical error copied.']);
        });
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('copies as many times as it is asked', async () => {
        const writeText = vi.fn(async () => {
            return undefined;
        });
        const { user } = setup();
        stubClipboard(writeText);
        await user.click(screen.getByRole('button', { name: 'COPY' }));
        await user.click(screen.getByRole('button', { name: 'COPY' }));
        expect(writeText).toHaveBeenCalledTimes(2);
    });

    it('tells when the copy was refused, and stays open', async () => {
        const { user, onClose } = setup();
        stubClipboard(async () => {
            throw new Error('denied');
        });
        await user.click(screen.getByRole('button', { name: 'COPY' }));
        await waitFor(() => {
            expect(useAppStore.getState().toasts.map((toast) => { return toast.message; })).toEqual(['Could not copy the technical error.']);
        });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('closes with the close button', async () => {
        const { user, onClose } = setup();
        await user.click(screen.getByRole('button', { name: 'CLOSE' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes with Esc, without the screen behind hearing it', async () => {
        const { user, onClose, outside } = setup();
        await user.keyboard('{Escape}');
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(outside).not.toHaveBeenCalled();
    });

    it('closes with a click outside the window, and not with a click inside it', async () => {
        const { user, onClose } = setup();
        await user.click(screen.getByRole('dialog'));
        await user.click(screen.getByTestId('error-message'));
        expect(onClose).not.toHaveBeenCalled();
        await user.click(screen.getByRole('dialog').parentElement as HTMLElement);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('keeps the Tab inside the window', async () => {
        const { user } = setup();
        await user.tab();
        expect(screen.getByRole('button', { name: 'CLOSE' })).toHaveFocus();
        await user.tab();
        expect(screen.getByRole('button', { name: 'COPY' })).toHaveFocus();
        await user.tab({ shift: true });
        expect(screen.getByRole('button', { name: 'CLOSE' })).toHaveFocus();
    });

    it('does not let a click in the window reach what it was opened from', async () => {
        const parentClick = vi.fn();
        const user = userEvent.setup();
        render(
            <div onClick={parentClick}>
                <ErrorDetailsDialog report={REPORT} onClose={vi.fn()} />
            </div>
        );
        await user.click(screen.getByRole('button', { name: 'COPY' }));
        await user.click(screen.getByRole('dialog').parentElement as HTMLElement);
        expect(parentClick).not.toHaveBeenCalled();
    });

    it.each([
        ['pt', 'DETALHES DO ERRO', 'COPIAR', 'FECHAR', 'Erro técnico', 'Pilha de chamadas', 'Código'],
        ['es', 'DETALLES DEL ERROR', 'COPIAR', 'CERRAR', 'Error técnico', 'Pila de llamadas', 'Código'],
        ['ja', 'エラーの詳細', 'コピー', '閉じる', '技術的なエラー', 'スタックトレース', 'コード'],
        ['zh', '错误详情', '复制', '关闭', '技术错误', '堆栈跟踪', '代码']
    ] as const)('speaks the language of the app: %s', (language, heading, copy, close, message, stack, code) => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, language } });
        setup();
        const dialog = screen.getByRole('dialog', { name: heading });
        expect(within(dialog).getByRole('button', { name: copy })).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: close })).toBeInTheDocument();
        expect(within(dialog).getByRole('heading', { name: message })).toBeInTheDocument();
        expect(within(dialog).getByRole('heading', { name: stack })).toBeInTheDocument();
        expect(within(dialog).getByText(code)).toBeInTheDocument();
    });
});
