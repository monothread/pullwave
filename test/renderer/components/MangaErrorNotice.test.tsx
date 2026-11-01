// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { MangaError } from '@shared/manga';
import { MangaErrorNotice } from '@renderer/components/MangaErrorNotice';
import { useAppStore } from '@renderer/store/appStore';
import { openErrorDialog } from '../../helpers/errorDialog';
import { installMockApi } from '../../helpers/mockApi';

const initialApp = useAppStore.getState();

const ERROR: MangaError = { code: 'API_ERROR', message: 'Exception while fetching data (/fetchChapters) : boom\n\tat suwayomi.Main(Main.kt:1)' };
const SUMMARY = 'The site or the extension reported an error.';

function stubClipboard(writeText: (text: string) => Promise<void>): void {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

beforeEach(() => {
    installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS, toasts: [] });
});

describe('MangaErrorNotice', () => {
    it('says what went wrong in words, as an alert, with a hint that the details are a click away', () => {
        render(<MangaErrorNotice error={ERROR} />);
        const alert = screen.getByRole('alert');
        expect(alert).toHaveClass('field__warning');
        const button = screen.getByRole('button', { name: SUMMARY });
        expect(alert).toContainElement(button);
        expect(button).toHaveAttribute('title', 'Click to see the technical error');
        expect(button).toHaveAttribute('type', 'button');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('opens the window with the code and the whole message of the backend when it is clicked', async () => {
        const user = userEvent.setup();
        render(<MangaErrorNotice error={ERROR} />);
        const dialog = await openErrorDialog(user, SUMMARY);
        expect(within(dialog).getByText('API_ERROR')).toBeInTheDocument();
        expect(within(dialog).getByTestId('error-message').textContent).toBe(ERROR.message);
        expect(within(dialog).getByText(SUMMARY)).toBeInTheDocument();
    });

    it('shows in the window everything the backend knew about the error', async () => {
        const user = userEvent.setup();
        const error: MangaError = {
            ...ERROR,
            details: {
                occurredAt: 1700000000000,
                operation: 'GraphQL fetchMangaAndChapters',
                url: 'http://127.0.0.1:4567/api/graphql',
                httpStatus: 200,
                errorName: 'Error',
                stack: 'Error: boom\n    at requestOnce (suwayomiClient.ts:1:1)'
            }
        };
        render(<MangaErrorNotice error={error} />);
        const dialog = await openErrorDialog(user, SUMMARY);
        expect(within(dialog).getByText('GraphQL fetchMangaAndChapters')).toBeInTheDocument();
        expect(within(dialog).getByText('http://127.0.0.1:4567/api/graphql')).toBeInTheDocument();
        expect(within(dialog).getByText('200')).toBeInTheDocument();
        expect(within(dialog).getByText('Error')).toBeInTheDocument();
        expect(within(dialog).getByText('2023-11-14T22:13:20.000Z', { exact: false })).toBeInTheDocument();
        expect(within(dialog).getByTestId('error-stack').textContent).toBe('Error: boom\n    at requestOnce (suwayomiClient.ts:1:1)');
    });

    it('copies only the message of the backend from the window, tells it and leaves the window open', async () => {
        const user = userEvent.setup();
        const writeText = vi.fn(async () => {
            return undefined;
        });
        stubClipboard(writeText);
        render(<MangaErrorNotice error={ERROR} />);
        const dialog = await openErrorDialog(user, SUMMARY);
        await user.click(within(dialog).getByRole('button', { name: 'COPY' }));
        expect(writeText).toHaveBeenCalledTimes(1);
        expect(writeText).toHaveBeenCalledWith(ERROR.message);
        await waitFor(() => {
            expect(useAppStore.getState().toasts.map((toast) => { return toast.message; })).toEqual(['Technical error copied.']);
        });
        expect(screen.getByRole('dialog', { name: 'ERROR DETAILS' })).toBeInTheDocument();
    });

    it('does not copy anything by just being clicked', async () => {
        const user = userEvent.setup();
        const writeText = vi.fn(async () => {
            return undefined;
        });
        stubClipboard(writeText);
        render(<MangaErrorNotice error={ERROR} />);
        await openErrorDialog(user, SUMMARY);
        expect(writeText).not.toHaveBeenCalled();
        expect(useAppStore.getState().toasts).toEqual([]);
    });

    it('tells when the copy was refused', async () => {
        const user = userEvent.setup();
        stubClipboard(async () => {
            throw new Error('denied');
        });
        render(<MangaErrorNotice error={ERROR} />);
        const dialog = await openErrorDialog(user, SUMMARY);
        await user.click(within(dialog).getByRole('button', { name: 'COPY' }));
        await waitFor(() => {
            expect(useAppStore.getState().toasts.map((toast) => { return toast.message; })).toEqual(['Could not copy the technical error.']);
        });
        expect(screen.getByRole('dialog', { name: 'ERROR DETAILS' })).toBeInTheDocument();
    });

    it('closes the window only when the user closes it', async () => {
        const user = userEvent.setup();
        render(<MangaErrorNotice error={ERROR} />);
        const dialog = await openErrorDialog(user, SUMMARY);
        await user.click(within(dialog).getByRole('button', { name: 'CLOSE' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: SUMMARY })).toBeInTheDocument();
    });

    it('explains that a source handed over no pages, and still gives the real error in the window', async () => {
        const user = userEvent.setup();
        const error: MangaError = { code: 'API_ERROR', message: 'Exception while fetching data (/fetchChapterPages) : Failed to find page list. Non-English entries are not supported.' };
        render(<MangaErrorNotice error={error} />);
        const summary = 'This source did not hand over the pages of this chapter. The site may have changed how it shows them; updating the extensions may fix it.';
        const dialog = await openErrorDialog(user, summary);
        expect(within(dialog).getByTestId('error-message').textContent).toBe(error.message);
    });

    it('speaks the language of the app', async () => {
        const user = userEvent.setup();
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, language: 'pt' } });
        render(<MangaErrorNotice error={{ code: 'NOT_FOUND', message: 'x' }} />);
        expect(screen.getByRole('button', { name: 'Não foi encontrado.' })).toHaveAttribute('title', 'Clique para ver o erro técnico');
        await user.click(screen.getByRole('button', { name: 'Não foi encontrado.' }));
        const dialog = screen.getByRole('dialog', { name: 'DETALHES DO ERRO' });
        expect(within(dialog).getByRole('button', { name: 'COPIAR' })).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: 'FECHAR' })).toBeInTheDocument();
        expect(within(dialog).getByText('Erro técnico')).toBeInTheDocument();
    });
});
