// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { CutMedia } from '@shared/cut';
import { CutPreviewPlayer, PREVIEW_FAILURE_KEYS } from '@renderer/components/CutPreviewPlayer';
import { useAppStore } from '@renderer/store/appStore';
import { useCutStore, type CutPreviewState } from '@renderer/store/cutStore';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialCut = useCutStore.getInitialState();

const VIDEO: CutMedia = { path: '/media/Talk.mp4', name: 'Talk', extension: '.mp4', kind: 'video', durationSeconds: 150 };
const READY: CutPreviewState = { rowId: 1, number: 2, segment: { start: 94, end: 103 }, status: 'ready', url: 'pullwave-cut://media/1', start: 94, end: 103, converted: false, error: null };

function open(preview: Partial<CutPreviewState> = {}): void {
    useCutStore.setState({ media: VIDEO, preview: { ...READY, ...preview } });
}

function player(): HTMLElement {
    return screen.getByRole('dialog', { name: 'Part 2: 1:34 – 1:43' });
}

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: { ...DEFAULT_SETTINGS } });
    useCutStore.setState(initialCut, true);
});

describe('PREVIEW_FAILURE_KEYS', () => {
    it('has words for each reason a part cannot be played', () => {
        expect(PREVIEW_FAILURE_KEYS).toEqual({
            'no-file': 'cut.preview.error.no-file',
            invalid: 'cut.preview.error.invalid',
            'no-ffmpeg': 'cut.preview.error.no-ffmpeg',
            failed: 'cut.preview.error.failed'
        });
    });
});

describe('CutPreviewPlayer', () => {
    it('shows nothing while no part is being seen', () => {
        const { container } = render(<CutPreviewPlayer />);
        expect(container).toBeEmptyDOMElement();
    });

    it('covers the window as the player of the app, named after the part, with the focus on its close button', () => {
        open();
        render(<CutPreviewPlayer />);
        const dialog = player();
        expect(dialog).toHaveClass('player', 'cut-preview');
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(within(dialog).getByRole('heading', { name: 'Part 2: 1:34 – 1:43' })).toHaveClass('player__title');
        expect(within(dialog).getByRole('button', { name: 'CLOSE' })).toHaveFocus();
    });

    it('plays the address it was given, with the controls of the player on the part only', () => {
        open();
        render(<CutPreviewPlayer />);
        const video = within(player()).getByTestId('cut-preview-video');
        expect(video).toHaveAttribute('src', 'pullwave-cut://media/1');
        expect(video).toHaveAttribute('autoplay');
        expect(video).toHaveClass('player__video');
        expect(video).not.toHaveAttribute('poster');
        const seek = within(player()).getByRole('slider', { name: 'Seek' });
        expect(seek).toHaveAttribute('max', '9');
        expect(within(player()).getByText('0:09')).toBeInTheDocument();
        expect(within(player()).getByRole('button', { name: 'Play' })).toBeInTheDocument();
        expect(within(player()).queryByText('PREVIEW')).not.toBeInTheDocument();
    });

    it('shows the picture of the file over the player while an audio plays', () => {
        open();
        useCutStore.setState({ thumbnail: { status: 'ready', url: 'pullwave-cut://thumbnail/2' } });
        render(<CutPreviewPlayer />);
        expect(within(player()).getByTestId('cut-preview-video')).toHaveAttribute('poster', 'pullwave-cut://thumbnail/2');
    });

    it.each([
        ['being made', { status: 'loading' as const }],
        ['missing', { status: 'none' as const }]
    ])('shows no picture over the player while it is %s', (_what, thumbnail) => {
        open();
        useCutStore.setState({ thumbnail });
        render(<CutPreviewPlayer />);
        expect(within(player()).getByTestId('cut-preview-video')).not.toHaveAttribute('poster');
    });

    it('shows that it is opening the part while it asks where to play it', () => {
        open({ status: 'loading', url: null });
        render(<CutPreviewPlayer />);
        expect(within(player()).getByRole('status')).toHaveTextContent('Opening the part…');
        expect(within(player()).queryByTestId('cut-preview-video')).not.toBeInTheDocument();
    });

    it('shows that it is preparing the part while it converts it', () => {
        open({ status: 'converting', url: null });
        render(<CutPreviewPlayer />);
        expect(within(player()).getByRole('status')).toHaveTextContent('The player cannot play this format: preparing the part…');
        expect(within(player()).queryByTestId('cut-preview-video')).not.toBeInTheDocument();
    });

    it('marks a part that was converted, which plays from its own start', () => {
        open({ url: 'pullwave-cut://preview/3', start: 0, end: 9, converted: true });
        render(<CutPreviewPlayer />);
        expect(within(player()).getByText('PREVIEW')).toHaveClass('badge', 'badge--waiting');
        expect(within(player()).getByTestId('cut-preview-video')).toHaveAttribute('src', 'pullwave-cut://preview/3');
        expect(within(player()).getByRole('slider', { name: 'Seek' })).toHaveAttribute('max', '9');
    });

    it.each([
        ['no-file', 'The file is not in the cutter any more.'],
        ['invalid', 'Check the part: it needs a start and an end inside the file.'],
        ['no-ffmpeg', 'ffmpeg could not be started to prepare the part.'],
        ['failed', 'This part could not be played.'],
        ['cancelled', 'This part could not be played.']
    ] as const)('says why the part cannot be played (%s)', (error, message) => {
        open({ status: 'failed', url: null, error });
        render(<CutPreviewPlayer />);
        expect(within(player()).getByRole('alert')).toHaveTextContent(message);
        expect(within(player()).queryByTestId('cut-preview-video')).not.toBeInTheDocument();
    });

    it('says the part could not be played when no reason came', () => {
        open({ status: 'failed', url: null, error: null });
        render(<CutPreviewPlayer />);
        expect(within(player()).getByRole('alert')).toHaveTextContent('This part could not be played.');
    });

    it('converts the part when the player cannot play the file as it is', async () => {
        open();
        mock.api.cut.preview.mockResolvedValueOnce({ ok: true, url: 'pullwave-cut://preview/3', start: 0, end: 9, converted: true });
        render(<CutPreviewPlayer />);
        await act(async () => {
            fireEvent.error(within(player()).getByTestId('cut-preview-video'));
        });
        expect(mock.api.cut.preview).toHaveBeenCalledTimes(1);
        expect(mock.api.cut.preview).toHaveBeenCalledWith({ segment: { start: 94, end: 103 }, convert: true });
        expect(within(player()).getByTestId('cut-preview-video')).toHaveAttribute('src', 'pullwave-cut://preview/3');
        expect(within(player()).getByText('PREVIEW')).toBeInTheDocument();
    });

    it('says the part cannot be played when the converted one fails too, without converting again', async () => {
        open({ url: 'pullwave-cut://preview/3', start: 0, end: 9, converted: true });
        render(<CutPreviewPlayer />);
        await act(async () => {
            fireEvent.error(within(player()).getByTestId('cut-preview-video'));
        });
        expect(mock.api.cut.preview).not.toHaveBeenCalled();
    });

    it('closes with its button', async () => {
        open();
        render(<CutPreviewPlayer />);
        await userEvent.setup().click(within(player()).getByRole('button', { name: 'CLOSE' }));
        expect(useCutStore.getState().preview).toBeNull();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('closes with Escape, and stops listening for it once closed', () => {
        open();
        render(<CutPreviewPlayer />);
        const close = vi.fn(() => {
            useCutStore.setState({ preview: null });
        });
        act(() => {
            useCutStore.setState({ closePreview: close });
        });
        act(() => {
            fireEvent.keyDown(window, { key: 'Escape' });
        });
        expect(close).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('does not close with other keys', () => {
        open();
        render(<CutPreviewPlayer />);
        fireEvent.keyDown(window, { key: 'Enter' });
        expect(useCutStore.getState().preview).toEqual(READY);
    });

    it('speaks the language of the app', () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, language: 'pt' } });
        open({ converted: true });
        render(<CutPreviewPlayer />);
        const dialog = screen.getByRole('dialog', { name: 'Parte 2: 1:34 – 1:43' });
        expect(within(dialog).getByRole('button', { name: 'FECHAR' })).toBeInTheDocument();
        expect(within(dialog).getByText('PRÉVIA')).toBeInTheDocument();
    });
});
