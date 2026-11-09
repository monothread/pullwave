// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SubtitleManagerSetting } from '@renderer/components/PlayerSettings';
import { SubtitleManagerDialog } from '@renderer/components/SubtitleManagerDialog';
import { installMockApi } from '../../helpers/mockApi';

interface Setup {
    onClose: ReturnType<typeof vi.fn<() => void>>;
    onLoad: ReturnType<typeof vi.fn<() => void>>;
    onCreate: ReturnType<typeof vi.fn<() => void>>;
    onCheck: ReturnType<typeof vi.fn<() => void>>;
}

function setup(overrides: Partial<SubtitleManagerSetting> = {}): Setup {
    const onClose = vi.fn<() => void>();
    const onLoad = vi.fn<() => void>();
    const onCreate = vi.fn<() => void>();
    const onCheck = vi.fn<() => void>();
    const manager: SubtitleManagerSetting = { loaded: true, hasSubtitles: true, checking: false, failure: null, onLoad, onCreate, onCheck, ...overrides };
    render(<SubtitleManagerDialog manager={manager} onClose={onClose} />);
    return { onClose, onLoad, onCreate, onCheck };
}

beforeEach(() => {
    installMockApi();
});

describe('SubtitleManagerDialog', () => {
    it('is a modal window named after what it does, in the wide size every theme gives the wide windows', () => {
        setup();
        const dialog = screen.getByRole('dialog', { name: 'Manage subtitles' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveClass('modal', 'modal--wide', 'player__manager');
        expect(screen.getByRole('heading', { name: 'Manage subtitles' })).toHaveClass('modal__title');
        expect(dialog.parentElement).toHaveClass('modal-backdrop');
    });

    it('moves the focus into the window when it opens', () => {
        setup();
        expect(screen.getByRole('dialog', { name: 'Manage subtitles' }).contains(document.activeElement)).toBe(true);
    });

    it('has only the buttons: no menu of the subtitles and no size, which are in the settings of the player', () => {
        setup();
        const dialog = screen.getByRole('dialog', { name: 'Manage subtitles' });
        expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument();
        expect(within(dialog).queryByRole('group', { name: 'Subtitle size' })).not.toBeInTheDocument();
        expect(within(dialog).queryByRole('switch')).not.toBeInTheDocument();
    });

    describe('the ways to get more subtitles', () => {
        it('has the buttons in this order, in the row of actions: load, translate, check and close', () => {
            setup();
            const actions = screen.getByRole('dialog', { name: 'Manage subtitles' }).querySelector('.modal__actions') as HTMLElement;
            expect(within(actions).getAllByRole('button').map((button) => {
                return button.textContent;
            })).toEqual(['LOAD SUBTITLE', 'TRANSLATE SUBTITLE', 'CHECK SUBTITLES', 'CLOSE']);
            expect(within(actions).getByRole('button', { name: 'CLOSE' })).toHaveClass('btn--ghost');
        });

        it('loads a file, translates or creates, and checks, each asking its own thing once', async () => {
            const user = userEvent.setup();
            const { onLoad, onCreate, onCheck, onClose } = setup();
            await user.click(screen.getByRole('button', { name: 'LOAD SUBTITLE' }));
            expect(onLoad).toHaveBeenCalledTimes(1);
            expect(onCreate).not.toHaveBeenCalled();
            expect(onCheck).not.toHaveBeenCalled();
            await user.click(screen.getByRole('button', { name: 'TRANSLATE SUBTITLE' }));
            expect(onCreate).toHaveBeenCalledTimes(1);
            expect(onCheck).not.toHaveBeenCalled();
            await user.click(screen.getByRole('button', { name: 'CHECK SUBTITLES' }));
            expect(onCheck).toHaveBeenCalledTimes(1);
            expect(onLoad).toHaveBeenCalledTimes(1);
            expect(onClose).not.toHaveBeenCalled();
        });

        it('offers to create the subtitle from the audio, not to translate, when the episode has none', () => {
            setup({ hasSubtitles: false });
            expect(screen.getByRole('button', { name: 'CREATE SUBTITLE' })).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'TRANSLATE SUBTITLE' })).not.toBeInTheDocument();
        });

        it('offers neither to translate nor to create until the list of the subtitles arrived, but has the other buttons', () => {
            setup({ loaded: false, hasSubtitles: false });
            expect(screen.queryByRole('button', { name: 'CREATE SUBTITLE' })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'TRANSLATE SUBTITLE' })).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'LOAD SUBTITLE' })).toBeEnabled();
            expect(screen.getByRole('button', { name: 'CHECK SUBTITLES' })).toBeEnabled();
        });

        it('says it is checking, with the button off, while the check goes on', async () => {
            const user = userEvent.setup();
            const { onCheck } = setup({ checking: true });
            const checking = screen.getByRole('button', { name: 'CHECKING…' });
            expect(checking).toBeDisabled();
            expect(screen.queryByRole('button', { name: 'CHECK SUBTITLES' })).not.toBeInTheDocument();
            await user.click(checking);
            expect(onCheck).not.toHaveBeenCalled();
        });
    });

    describe('when a file could not be loaded', () => {
        it('says why, as an alert in the window, above the buttons', () => {
            setup({ failure: 'The subtitle file could not be read.' });
            const dialog = screen.getByRole('dialog', { name: 'Manage subtitles' });
            const alert = screen.getByRole('alert');
            expect(alert).toHaveTextContent('The subtitle file could not be read.');
            expect(alert).toHaveClass('field__warning');
            expect(dialog).toContainElement(alert);
            expect(alert.compareDocumentPosition(dialog.querySelector('.modal__actions') as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        });

        it('has no alert when nothing went wrong', () => {
            setup();
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });
    });

    describe('closing', () => {
        it('closes with the CLOSE button', async () => {
            const user = userEvent.setup();
            const { onClose } = setup();
            await user.click(screen.getByRole('button', { name: 'CLOSE' }));
            expect(onClose).toHaveBeenCalledTimes(1);
        });

        it('closes with Esc, without the player behind hearing it', () => {
            const { onClose } = setup();
            const heard = vi.fn();
            document.addEventListener('keydown', heard);
            fireEvent.keyDown(screen.getByRole('dialog', { name: 'Manage subtitles' }), { key: 'Escape' });
            document.removeEventListener('keydown', heard);
            expect(onClose).toHaveBeenCalledTimes(1);
            expect(heard).not.toHaveBeenCalled();
        });

        it('keeps Tab inside the window, from the last control to the first and back', () => {
            setup();
            const dialog = screen.getByRole('dialog', { name: 'Manage subtitles' });
            const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled])'));
            const first = controls[0] as HTMLElement;
            const last = controls[controls.length - 1] as HTMLElement;
            last.focus();
            fireEvent.keyDown(last, { key: 'Tab' });
            expect(document.activeElement).toBe(first);
            first.focus();
            fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
            expect(document.activeElement).toBe(last);
        });

        it('keeps the keys of the window from reaching the player: they do not seek, pause or change the volume', () => {
            setup();
            const heard = vi.fn();
            window.addEventListener('keydown', heard);
            const button = screen.getByRole('button', { name: 'LOAD SUBTITLE' });
            fireEvent.keyDown(button, { key: 'ArrowRight' });
            fireEvent.keyDown(button, { key: ' ' });
            fireEvent.keyDown(button, { key: 'ArrowUp' });
            window.removeEventListener('keydown', heard);
            expect(heard).not.toHaveBeenCalled();
        });
    });
});
