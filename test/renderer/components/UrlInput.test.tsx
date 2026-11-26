// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { UrlInput } from '@renderer/components/UrlInput';
import { useAppStore } from '@renderer/store/appStore';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initial = useAppStore.getState();

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initial, settings: DEFAULT_SETTINGS, notice: null });
});

function link(index: number): HTMLInputElement {
    return screen.getByLabelText(`Link ${index}`) as HTMLInputElement;
}

async function submit(): Promise<void> {
    await userEvent.setup().click(screen.getByRole('button', { name: 'DOWNLOAD' }));
}

describe('UrlInput layout', () => {
    it('starts with a single empty link row and the action buttons', () => {
        render(<UrlInput />);
        expect(link(1)).toHaveValue('');
        expect(screen.queryByLabelText('Link 2')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: '+ ADD LINK' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'DOWNLOAD' })).toBeInTheDocument();
        expect(screen.getByLabelText('AUDIO ONLY')).not.toBeChecked();
    });

    it('uses a single-line, non-resizable text input instead of a textarea', () => {
        const { container } = render(<UrlInput />);
        expect(container.querySelector('textarea')).toBeNull();
        expect(link(1).tagName).toBe('INPUT');
        expect(link(1)).toHaveAttribute('type', 'text');
        expect(link(1)).toHaveAttribute('inputmode', 'url');
    });

    it('does not show a remove button while there is only one row', () => {
        render(<UrlInput />);
        expect(screen.queryByRole('button', { name: /Remove link/ })).not.toBeInTheDocument();
    });
});

describe('UrlInput rows', () => {
    it('adds a new empty row and focuses it', async () => {
        render(<UrlInput />);
        await userEvent.setup().click(screen.getByRole('button', { name: '+ ADD LINK' }));
        expect(link(2)).toHaveValue('');
        expect(link(2)).toHaveFocus();
        expect(screen.getByRole('button', { name: 'Remove link 1' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Remove link 2' })).toBeInTheDocument();
    });

    it('can add several rows', async () => {
        const user = userEvent.setup();
        render(<UrlInput />);
        await user.click(screen.getByRole('button', { name: '+ ADD LINK' }));
        await user.click(screen.getByRole('button', { name: '+ ADD LINK' }));
        expect(screen.getAllByLabelText(/^Link \d$/)).toHaveLength(3);
    });

    it('removes the chosen row and keeps the values of the others', async () => {
        const user = userEvent.setup();
        render(<UrlInput />);
        await user.click(screen.getByRole('button', { name: '+ ADD LINK' }));
        await user.click(screen.getByRole('button', { name: '+ ADD LINK' }));
        fireEvent.change(link(1), { target: { value: 'https://a.com' } });
        fireEvent.change(link(2), { target: { value: 'https://b.com' } });
        fireEvent.change(link(3), { target: { value: 'https://c.com' } });
        await user.click(screen.getByRole('button', { name: 'Remove link 2' }));
        expect(screen.getAllByLabelText(/^Link \d$/)).toHaveLength(2);
        expect(link(1)).toHaveValue('https://a.com');
        expect(link(2)).toHaveValue('https://c.com');
        expect(screen.queryByRole('button', { name: 'Remove link 2' })).toBeInTheDocument();
    });

    it('hides the remove buttons again when a single row is left', async () => {
        const user = userEvent.setup();
        render(<UrlInput />);
        await user.click(screen.getByRole('button', { name: '+ ADD LINK' }));
        await user.click(screen.getByRole('button', { name: 'Remove link 2' }));
        expect(screen.queryByRole('button', { name: /Remove link/ })).not.toBeInTheDocument();
    });
});

describe('UrlInput long links', () => {
    it('keeps a very long link intact, exposes it as a tooltip and sends it whole', async () => {
        const longUrl = `https://example.com/watch?v=abc&list=${'x'.repeat(2000)}`;
        render(<UrlInput />);
        fireEvent.change(link(1), { target: { value: longUrl } });
        expect(link(1)).toHaveValue(longUrl);
        expect(link(1)).toHaveAttribute('title', longUrl);
        await submit();
        await waitFor(() => {
            expect(mock.api.addDownload).toHaveBeenCalledWith(longUrl);
        });
    });
});

describe('UrlInput submit', () => {
    it('sends every non-empty link trimmed, in order, and resets to a single empty row', async () => {
        const user = userEvent.setup();
        render(<UrlInput />);
        await user.click(screen.getByRole('button', { name: '+ ADD LINK' }));
        await user.click(screen.getByRole('button', { name: '+ ADD LINK' }));
        fireEvent.change(link(1), { target: { value: '  https://a.com  ' } });
        fireEvent.change(link(3), { target: { value: 'https://c.com' } });
        await user.click(screen.getByRole('button', { name: 'DOWNLOAD' }));
        await waitFor(() => {
            expect(mock.api.addDownload.mock.calls).toEqual([['https://a.com'], ['https://c.com']]);
        });
        await waitFor(() => {
            expect(screen.queryByLabelText('Link 2')).not.toBeInTheDocument();
        });
        expect(link(1)).toHaveValue('');
    });

    it('submits with Enter from a link field', async () => {
        render(<UrlInput />);
        fireEvent.change(link(1), { target: { value: 'https://a.com' } });
        await userEvent.setup().type(link(1), '{Enter}');
        await waitFor(() => {
            expect(mock.api.addDownload).toHaveBeenCalledWith('https://a.com');
        });
    });

    it('shows an error on the first row when everything is empty and does not call the API', async () => {
        render(<UrlInput />);
        await submit();
        expect(await screen.findByRole('alert')).toHaveTextContent('Paste at least one video URL.');
        expect(link(1)).toHaveAttribute('aria-invalid', 'true');
        expect(mock.api.addDownload).not.toHaveBeenCalled();
    });

    it('clears the row error as soon as the user types', async () => {
        render(<UrlInput />);
        await submit();
        await screen.findByRole('alert');
        fireEvent.change(link(1), { target: { value: 'h' } });
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(link(1)).toHaveAttribute('aria-invalid', 'false');
    });

    it('keeps only the rejected links, with their error message, and clears the accepted ones', async () => {
        mock.api.addDownload.mockResolvedValueOnce({ ok: true, job: null, message: null });
        mock.api.addDownload.mockResolvedValueOnce({ ok: false, job: null, message: 'Invalid URL. Use an http(s) link.' });
        const user = userEvent.setup();
        render(<UrlInput />);
        await user.click(screen.getByRole('button', { name: '+ ADD LINK' }));
        fireEvent.change(link(1), { target: { value: 'https://ok.com' } });
        fireEvent.change(link(2), { target: { value: 'not-a-url' } });
        await user.click(screen.getByRole('button', { name: 'DOWNLOAD' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Invalid URL. Use an http(s) link.');
        expect(screen.getAllByLabelText(/^Link \d$/)).toHaveLength(1);
        expect(link(1)).toHaveValue('not-a-url');
        expect(link(1)).toHaveAttribute('aria-invalid', 'true');
    });

    it('uses a generic message when a rejection has no message', async () => {
        mock.api.addDownload.mockResolvedValueOnce({ ok: false, job: null, message: null });
        render(<UrlInput />);
        fireEvent.change(link(1), { target: { value: 'https://x.com' } });
        await submit();
        expect(await screen.findByRole('alert')).toHaveTextContent('Could not add the download.');
    });

    it('shows a separate error for each rejected link', async () => {
        mock.api.addDownload.mockResolvedValueOnce({ ok: false, job: null, message: 'first bad' });
        mock.api.addDownload.mockResolvedValueOnce({ ok: false, job: null, message: 'second bad' });
        const user = userEvent.setup();
        render(<UrlInput />);
        await user.click(screen.getByRole('button', { name: '+ ADD LINK' }));
        fireEvent.change(link(1), { target: { value: 'bad-1' } });
        fireEvent.change(link(2), { target: { value: 'bad-2' } });
        await user.click(screen.getByRole('button', { name: 'DOWNLOAD' }));
        await waitFor(() => {
            expect(screen.getAllByRole('alert').map((alert) => {
                return alert.textContent;
            })).toEqual(['first bad', 'second bad']);
        });
        expect(link(1)).toHaveValue('bad-1');
        expect(link(2)).toHaveValue('bad-2');
    });
});

describe('UrlInput audio toggle', () => {
    it('reflects the stored audio-only setting', () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, audioOnly: true } });
        render(<UrlInput />);
        expect(screen.getByLabelText('AUDIO ONLY')).toBeChecked();
    });

    it('saves the settings when the toggle changes', async () => {
        render(<UrlInput />);
        await userEvent.setup().click(screen.getByLabelText('AUDIO ONLY'));
        await waitFor(() => {
            expect(mock.api.saveSettings).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, audioOnly: true });
        });
    });
});

describe('UrlInput folder for one link', () => {
    it('offers a folder button on every row, unmarked by default', () => {
        render(<UrlInput />);
        const button = screen.getByRole('button', { name: 'Choose folder for link 1' });
        expect(button).toHaveTextContent('FOLDER');
        expect(button).toHaveClass('btn--ghost');
        expect(button).toHaveAttribute('title', 'Save this link in another folder');
        expect(screen.queryByText(/Saving to:/)).not.toBeInTheDocument();
    });

    it('shows the chosen folder and sends it together with the link', async () => {
        const user = userEvent.setup();
        mock.api.chooseDirectory.mockResolvedValueOnce('/media/special');
        mock.api.addDownload.mockResolvedValue({ ok: true, job: null, message: null });
        render(<UrlInput />);
        await user.type(link(1), 'https://a.com/v');
        await user.click(screen.getByRole('button', { name: 'Choose folder for link 1' }));
        expect(await screen.findByText('Saving to: /media/special')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Choose folder for link 1' })).toHaveClass('btn--hot');
        expect(screen.getByRole('button', { name: 'Choose folder for link 1' })).toHaveAttribute('title', '/media/special');
        await submit();
        await waitFor(() => {
            expect(mock.api.addDownload).toHaveBeenCalledTimes(1);
        });
        expect(mock.api.addDownload).toHaveBeenCalledWith('https://a.com/v', '/media/special');
    });

    it('keeps the choice of each row separate', async () => {
        const user = userEvent.setup();
        mock.api.chooseDirectory.mockResolvedValueOnce('/media/second');
        mock.api.addDownload.mockResolvedValue({ ok: true, job: null, message: null });
        render(<UrlInput />);
        await user.type(link(1), 'https://a.com/1');
        await user.click(screen.getByRole('button', { name: '+ ADD LINK' }));
        await user.type(link(2), 'https://a.com/2');
        await user.click(screen.getByRole('button', { name: 'Choose folder for link 2' }));
        await screen.findByText('Saving to: /media/second');
        expect(screen.getAllByText(/Saving to:/)).toHaveLength(1);
        await submit();
        await waitFor(() => {
            expect(mock.api.addDownload).toHaveBeenCalledTimes(2);
        });
        expect(mock.api.addDownload.mock.calls).toEqual([['https://a.com/1'], ['https://a.com/2', '/media/second']]);
    });

    it('keeps the row unchanged when the folder dialog is cancelled', async () => {
        const user = userEvent.setup();
        mock.api.chooseDirectory.mockResolvedValueOnce(null);
        render(<UrlInput />);
        await user.click(screen.getByRole('button', { name: 'Choose folder for link 1' }));
        await waitFor(() => {
            expect(mock.api.chooseDirectory).toHaveBeenCalledTimes(1);
        });
        expect(screen.queryByText(/Saving to:/)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Choose folder for link 1' })).toHaveClass('btn--ghost');
    });

    it('goes back to the default folder when the choice is cleared', async () => {
        const user = userEvent.setup();
        mock.api.chooseDirectory.mockResolvedValueOnce('/media/special');
        mock.api.addDownload.mockResolvedValue({ ok: true, job: null, message: null });
        render(<UrlInput />);
        await user.type(link(1), 'https://a.com/v');
        await user.click(screen.getByRole('button', { name: 'Choose folder for link 1' }));
        await screen.findByText('Saving to: /media/special');
        await user.click(screen.getByRole('button', { name: 'Use the default folder for link 1' }));
        expect(screen.queryByText(/Saving to:/)).not.toBeInTheDocument();
        await submit();
        await waitFor(() => {
            expect(mock.api.addDownload).toHaveBeenCalledTimes(1);
        });
        expect(mock.api.addDownload).toHaveBeenCalledWith('https://a.com/v');
    });

    it('keeps the folder on a link that failed so it can be corrected and sent again', async () => {
        const user = userEvent.setup();
        mock.api.chooseDirectory.mockResolvedValueOnce('/media/special');
        mock.api.addDownload.mockResolvedValueOnce({ ok: false, job: null, message: 'Invalid URL. Use an http(s) link.' });
        render(<UrlInput />);
        await user.type(link(1), 'nope');
        await user.click(screen.getByRole('button', { name: 'Choose folder for link 1' }));
        await screen.findByText('Saving to: /media/special');
        await submit();
        expect(await screen.findByText('Invalid URL. Use an http(s) link.')).toBeInTheDocument();
        expect(screen.getByText('Saving to: /media/special')).toBeInTheDocument();
    });

    it('opens the folder chooser inside the configured download folder, or the row folder when already chosen', async () => {
        const user = userEvent.setup();
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, downloadDir: '/media/downloads' } });
        mock.api.chooseDirectory.mockResolvedValueOnce('/media/downloads/sub').mockResolvedValueOnce('/media/downloads/other').mockResolvedValueOnce(null);
        render(<UrlInput />);
        await user.click(screen.getByRole('button', { name: 'Choose folder for link 1' }));
        await screen.findByText('Saving to: /media/downloads/sub');
        await user.click(screen.getByRole('button', { name: 'Choose folder for link 1' }));
        await screen.findByText('Saving to: /media/downloads/other');
        await user.click(screen.getByRole('button', { name: '+ ADD LINK' }));
        await user.click(screen.getByRole('button', { name: 'Choose folder for link 2' }));
        expect(mock.api.chooseDirectory.mock.calls).toEqual([['/media/downloads'], ['/media/downloads/sub'], ['/media/downloads']]);
    });

    it('passes an empty starting folder when no custom download folder is set', async () => {
        const user = userEvent.setup();
        mock.api.chooseDirectory.mockResolvedValueOnce(null);
        render(<UrlInput />);
        await user.click(screen.getByRole('button', { name: 'Choose folder for link 1' }));
        await waitFor(() => {
            expect(mock.api.chooseDirectory).toHaveBeenCalledWith('');
        });
    });

    it('starts the next row without a folder after a successful submit', async () => {
        const user = userEvent.setup();
        mock.api.chooseDirectory.mockResolvedValueOnce('/media/special');
        mock.api.addDownload.mockResolvedValue({ ok: true, job: null, message: null });
        render(<UrlInput />);
        await user.type(link(1), 'https://a.com/v');
        await user.click(screen.getByRole('button', { name: 'Choose folder for link 1' }));
        await screen.findByText('Saving to: /media/special');
        await submit();
        await waitFor(() => {
            expect(link(1)).toHaveValue('');
        });
        expect(screen.queryByText(/Saving to:/)).not.toBeInTheDocument();
    });
});

describe('UrlInput options of one download', () => {
    async function openOptions(index: number): Promise<void> {
        await userEvent.setup().click(screen.getByRole('button', { name: `Options for link ${index}` }));
    }

    async function choose(label: string, value: string): Promise<void> {
        await userEvent.setup().selectOptions(within(screen.getByRole('dialog')).getByLabelText(label), value);
    }

    async function apply(): Promise<void> {
        await userEvent.setup().click(screen.getByRole('button', { name: 'APPLY' }));
    }

    it('has an options button on every row and no window until it is pressed', async () => {
        render(<UrlInput />);
        expect(screen.getByRole('button', { name: 'Options for link 1' })).toHaveTextContent('OPTIONS');
        expect(screen.getByRole('button', { name: 'Options for link 1' })).toHaveAttribute('aria-haspopup', 'dialog');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await userEvent.setup().click(screen.getByRole('button', { name: '+ ADD LINK' }));
        expect(screen.getByRole('button', { name: 'Options for link 2' })).toBeInTheDocument();
    });

    it('opens the window of the row that was pressed, with the settings as the defaults', async () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, maxResolution: '1080' } });
        render(<UrlInput />);
        await userEvent.setup().click(screen.getByRole('button', { name: '+ ADD LINK' }));
        await openOptions(2);
        expect(screen.getByRole('dialog', { name: 'Options for link 2' })).toBeInTheDocument();
        expect(within(screen.getByRole('dialog')).getByLabelText('Video quality').querySelector('option')).toHaveTextContent('Use the setting (Up to 1080p)');
    });

    it('sends the options chosen for a link with its URL', async () => {
        render(<UrlInput />);
        fireEvent.change(link(1), { target: { value: 'https://a.com/v' } });
        await openOptions(1);
        await choose('Video quality', '720');
        await choose('Wait for scheduled live streams to start', 'on');
        await apply();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await submit();
        await waitFor(() => {
            expect(mock.api.addDownload).toHaveBeenCalledTimes(1);
        });
        expect(mock.api.addDownload).toHaveBeenCalledWith('https://a.com/v', '', { maxResolution: '720', waitForLive: true });
    });

    it('highlights the button of a link that has options and not the others', async () => {
        render(<UrlInput />);
        await userEvent.setup().click(screen.getByRole('button', { name: '+ ADD LINK' }));
        expect(screen.getByRole('button', { name: 'Options for link 1' })).toHaveClass('btn--ghost');
        await openOptions(2);
        await choose('Audio only', 'on');
        await apply();
        expect(screen.getByRole('button', { name: 'Options for link 2' })).toHaveClass('btn--hot');
        expect(screen.getByRole('button', { name: 'Options for link 1' })).toHaveClass('btn--ghost');
    });

    it('does not highlight the button when the options were chosen and then reset', async () => {
        render(<UrlInput />);
        await openOptions(1);
        await choose('Audio only', 'on');
        await apply();
        await openOptions(1);
        await userEvent.setup().click(screen.getByRole('button', { name: 'RESET' }));
        await apply();
        expect(screen.getByRole('button', { name: 'Options for link 1' })).toHaveClass('btn--ghost');
    });

    it('keeps the options of each row separate', async () => {
        render(<UrlInput />);
        await userEvent.setup().click(screen.getByRole('button', { name: '+ ADD LINK' }));
        fireEvent.change(link(1), { target: { value: 'https://a.com/1' } });
        fireEvent.change(link(2), { target: { value: 'https://b.com/2' } });
        await openOptions(1);
        await choose('Video container', 'mkv');
        await apply();
        await openOptions(2);
        await choose('Audio format', 'opus');
        await choose('Audio only', 'on');
        await apply();
        await submit();
        await waitFor(() => {
            expect(mock.api.addDownload).toHaveBeenCalledTimes(2);
        });
        expect(mock.api.addDownload.mock.calls).toEqual([
            ['https://a.com/1', '', { videoContainer: 'mkv' }],
            ['https://b.com/2', '', { audioFormat: 'opus', audioOnly: true }]
        ]);
    });

    it('sends the options together with the folder of the link', async () => {
        mock.api.chooseDirectory.mockResolvedValue('/media/videos');
        render(<UrlInput />);
        fireEvent.change(link(1), { target: { value: 'https://a.com/v' } });
        await userEvent.setup().click(screen.getByRole('button', { name: 'Choose folder for link 1' }));
        await screen.findByText('Saving to: /media/videos');
        await openOptions(1);
        await choose('Video quality', '480');
        await apply();
        await submit();
        await waitFor(() => {
            expect(mock.api.addDownload).toHaveBeenCalledTimes(1);
        });
        expect(mock.api.addDownload).toHaveBeenCalledWith('https://a.com/v', '/media/videos', { maxResolution: '480' });
    });

    it('does not keep what was chosen when the window is cancelled', async () => {
        render(<UrlInput />);
        fireEvent.change(link(1), { target: { value: 'https://a.com/v' } });
        await openOptions(1);
        await choose('Video quality', '720');
        await userEvent.setup().click(screen.getByRole('button', { name: 'CANCEL' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Options for link 1' })).toHaveClass('btn--ghost');
        await submit();
        await waitFor(() => {
            expect(mock.api.addDownload).toHaveBeenCalledTimes(1);
        });
        expect(mock.api.addDownload).toHaveBeenCalledWith('https://a.com/v');
    });

    it('opens again with the options the link already has, and Escape keeps them', async () => {
        render(<UrlInput />);
        await openOptions(1);
        await choose('Video quality', '720');
        await apply();
        await openOptions(1);
        expect(within(screen.getByRole('dialog')).getByLabelText('Video quality')).toHaveValue('720');
        await userEvent.setup().keyboard('{Escape}');
        expect(screen.getByRole('button', { name: 'Options for link 1' })).toHaveClass('btn--hot');
    });

    it('starts the next download without options once the links were added', async () => {
        render(<UrlInput />);
        fireEvent.change(link(1), { target: { value: 'https://a.com/v' } });
        await openOptions(1);
        await choose('Video quality', '720');
        await apply();
        await submit();
        await waitFor(() => {
            expect(link(1)).toHaveValue('');
        });
        expect(screen.getByRole('button', { name: 'Options for link 1' })).toHaveClass('btn--ghost');
        fireEvent.change(link(1), { target: { value: 'https://b.com/v' } });
        await submit();
        await waitFor(() => {
            expect(mock.api.addDownload).toHaveBeenCalledTimes(2);
        });
        expect(mock.api.addDownload.mock.calls[1]).toEqual(['https://b.com/v']);
    });

    it('keeps the options of a link that could not be added', async () => {
        mock.api.addDownload.mockResolvedValueOnce({ ok: false, job: null, message: 'Invalid URL. Use an http(s) link.' });
        render(<UrlInput />);
        fireEvent.change(link(1), { target: { value: 'nope' } });
        await openOptions(1);
        await choose('Audio only', 'on');
        await apply();
        await submit();
        expect(await screen.findByRole('alert')).toHaveTextContent('Invalid URL. Use an http(s) link.');
        expect(screen.getByRole('button', { name: 'Options for link 1' })).toHaveClass('btn--hot');
        await openOptions(1);
        expect(within(screen.getByRole('dialog')).getByLabelText('Audio only')).toHaveValue('on');
    });

    it('moves the options with the row when an earlier row is removed', async () => {
        render(<UrlInput />);
        await userEvent.setup().click(screen.getByRole('button', { name: '+ ADD LINK' }));
        fireEvent.change(link(2), { target: { value: 'https://b.com/2' } });
        await openOptions(2);
        await choose('Video container', 'webm');
        await apply();
        await userEvent.setup().click(screen.getByRole('button', { name: 'Remove link 1' }));
        expect(screen.getByRole('button', { name: 'Options for link 1' })).toHaveClass('btn--hot');
        await submit();
        await waitFor(() => {
            expect(mock.api.addDownload).toHaveBeenCalledTimes(1);
        });
        expect(mock.api.addDownload).toHaveBeenCalledWith('https://b.com/2', '', { videoContainer: 'webm' });
    });

    it('is translated', async () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, language: 'es' } });
        render(<UrlInput />);
        const button = screen.getByRole('button', { name: 'Opciones del enlace 1' });
        expect(button).toHaveTextContent('OPCIONES');
        await userEvent.setup().click(button);
        expect(screen.getByRole('dialog', { name: 'Opciones del enlace 1' })).toBeInTheDocument();
    });
});

