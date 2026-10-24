// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { ConfirmButton } from '@renderer/components/ConfirmButton';
import { useAppStore } from '@renderer/store/appStore';
import { answerDialog, confirmDialog } from '../../helpers/confirmDialog';
import { installMockApi } from '../../helpers/mockApi';

const initialApp = useAppStore.getState();

const DIALOG = { title: 'Remove "Naruto"?', message: 'Only the entry goes.', confirmLabel: 'REMOVE' };

beforeEach(() => {
    installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS });
});

function setup(props: { disabled?: boolean; title?: string; ariaLabel?: string; cancelLabel?: string } = {}) {
    const onConfirm = vi.fn();
    const { cancelLabel, ...button } = props;
    render(
        <ConfirmButton className="btn btn--hot" dialog={{ ...DIALOG, ...(cancelLabel === undefined ? {} : { cancelLabel }) }} onConfirm={onConfirm} {...button}>
            REMOVE
        </ConfirmButton>
    );
    return { onConfirm, user: userEvent.setup() };
}

describe('ConfirmButton', () => {
    it('shows only the button, with its class and its text, and nothing is asked until it is used', () => {
        const { onConfirm } = setup();
        const button = screen.getByRole('button', { name: 'REMOVE' });
        expect(button).toHaveClass('btn', 'btn--hot');
        expect(button).toHaveAttribute('type', 'button');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('opens a window with the title and the message, and the focus on KEEP, without acting', async () => {
        const { onConfirm, user } = setup();
        await user.click(screen.getByRole('button', { name: 'REMOVE' }));
        const dialog = confirmDialog('Remove "Naruto"?');
        expect(within(dialog).getByText('Only the entry goes.')).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: 'KEEP' })).toHaveFocus();
        expect(within(dialog).getByRole('button', { name: 'REMOVE' })).toBeInTheDocument();
        expect(document.body).toContainElement(dialog);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('acts once, and closes the window, only when the answer is confirmed', async () => {
        const { onConfirm, user } = setup();
        await user.click(screen.getByRole('button', { name: 'REMOVE' }));
        await answerDialog(user, 'Remove "Naruto"?', 'REMOVE');
        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(onConfirm).toHaveBeenCalledWith();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('does not act when the user keeps it, presses Esc or clicks outside the window, and it can be opened again', async () => {
        const { onConfirm, user } = setup();
        await user.click(screen.getByRole('button', { name: 'REMOVE' }));
        await answerDialog(user, 'Remove "Naruto"?', 'KEEP');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'REMOVE' }));
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'REMOVE' }));
        fireEvent.mouseDown(document.querySelector('.modal-backdrop') as HTMLElement);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'REMOVE' }));
        expect(screen.getByRole('dialog', { name: 'Remove "Naruto"?' })).toBeInTheDocument();
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('does not close the window when the click starts inside it', async () => {
        const { user } = setup();
        await user.click(screen.getByRole('button', { name: 'REMOVE' }));
        fireEvent.mouseDown(screen.getByText('Only the entry goes.'));
        expect(screen.getByRole('dialog', { name: 'Remove "Naruto"?' })).toBeInTheDocument();
    });

    it('uses the way back that is given instead of KEEP', async () => {
        const { onConfirm, user } = setup({ cancelLabel: 'BACK' });
        await user.click(screen.getByRole('button', { name: 'REMOVE' }));
        expect(screen.queryByRole('button', { name: 'KEEP' })).not.toBeInTheDocument();
        await answerDialog(user, 'Remove "Naruto"?', 'BACK');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('speaks the language of the settings in the way back', async () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, language: 'pt' } });
        const { user } = setup();
        await user.click(screen.getByRole('button', { name: 'REMOVE' }));
        expect(within(confirmDialog('Remove "Naruto"?')).getByRole('button', { name: 'MANTER' })).toBeInTheDocument();
    });

    it('gives the button the name, the title and the state it is given', () => {
        setup({ ariaLabel: 'Remove: Naruto', title: 'Why not', disabled: true });
        const button = screen.getByRole('button', { name: 'Remove: Naruto' });
        expect(button).toHaveAttribute('title', 'Why not');
        expect(button).toBeDisabled();
    });

    it('opens nothing when the button is off', async () => {
        const { onConfirm, user } = setup({ disabled: true });
        await user.click(screen.getByRole('button', { name: 'REMOVE' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(onConfirm).not.toHaveBeenCalled();
    });
});
