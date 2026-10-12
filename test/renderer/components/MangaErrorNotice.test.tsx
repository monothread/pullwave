// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { MangaError } from '@shared/manga';
import { MangaErrorNotice } from '@renderer/components/MangaErrorNotice';
import { useAppStore } from '@renderer/store/appStore';
import { installMockApi } from '../../helpers/mockApi';

const initialApp = useAppStore.getState();

const ERROR: MangaError = { code: 'API_ERROR', message: 'Exception while fetching data (/fetchChapters) : boom\n\tat suwayomi.Main(Main.kt:1)' };

function stubClipboard(writeText: (text: string) => Promise<void>): void {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

beforeEach(() => {
    installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS, toasts: [] });
});

describe('MangaErrorNotice', () => {
    it('says what went wrong in words, as an alert, with a hint that it can be copied', () => {
        render(<MangaErrorNotice error={ERROR} />);
        const alert = screen.getByRole('alert');
        expect(alert).toHaveClass('field__warning');
        const button = screen.getByRole('button', { name: 'The site or the extension reported an error.' });
        expect(alert).toContainElement(button);
        expect(button).toHaveAttribute('title', 'Click to copy the technical error');
        expect(button).toHaveAttribute('type', 'button');
    });

    it('copies the code and everything the backend said when it is clicked, and tells it', async () => {
        const user = userEvent.setup();
        const writeText = vi.fn(async () => {
            return undefined;
        });
        stubClipboard(writeText);
        render(<MangaErrorNotice error={ERROR} />);
        await user.click(screen.getByRole('button'));
        expect(writeText).toHaveBeenCalledTimes(1);
        expect(writeText).toHaveBeenCalledWith('API_ERROR\nException while fetching data (/fetchChapters) : boom\n\tat suwayomi.Main(Main.kt:1)');
        await waitFor(() => {
            expect(useAppStore.getState().toasts.map((toast) => { return toast.message; })).toEqual(['Technical error copied.']);
        });
    });

    it('tells when the copy was refused', async () => {
        const user = userEvent.setup();
        stubClipboard(async () => {
            throw new Error('denied');
        });
        render(<MangaErrorNotice error={ERROR} />);
        await user.click(screen.getByRole('button'));
        await waitFor(() => {
            expect(useAppStore.getState().toasts.map((toast) => { return toast.message; })).toEqual(['Could not copy the technical error.']);
        });
    });

    it('explains that a source handed over no pages, and still copies the real error', async () => {
        const user = userEvent.setup();
        const writeText = vi.fn(async () => {
            return undefined;
        });
        stubClipboard(writeText);
        const error: MangaError = { code: 'API_ERROR', message: 'Exception while fetching data (/fetchChapterPages) : Failed to find page list. Non-English entries are not supported.' };
        render(<MangaErrorNotice error={error} />);
        const button = screen.getByRole('button', {
            name: 'This source did not hand over the pages of this chapter. The site may have changed how it shows them; updating the extensions may fix it.'
        });
        await user.click(button);
        expect(writeText).toHaveBeenCalledWith(`API_ERROR\n${error.message}`);
    });

    it('speaks the language of the app', () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, language: 'pt' } });
        render(<MangaErrorNotice error={{ code: 'NOT_FOUND', message: 'x' }} />);
        expect(screen.getByRole('button', { name: 'Não foi encontrado.' })).toHaveAttribute('title', 'Clique para copiar o erro técnico');
    });
});
