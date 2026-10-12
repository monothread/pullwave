// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from '@renderer/components/ConfirmDialog';

function setup() {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const outside = vi.fn();
    document.addEventListener('keydown', outside);
    const view = render(<ConfirmDialog title="Remove it?" message="This cannot be undone." confirmLabel="REMOVE" cancelLabel="KEEP" onConfirm={onConfirm} onCancel={onCancel} />);
    return { onConfirm, onCancel, outside, user: userEvent.setup(), ...view };
}

describe('ConfirmDialog', () => {
    it('is a window over the screen, named by its title, with the message and the two answers', () => {
        setup();
        const dialog = screen.getByRole('dialog', { name: 'Remove it?' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveClass('modal', 'modal--confirm');
        expect(dialog.parentElement).toHaveClass('modal-backdrop');
        expect(screen.getByRole('heading', { name: 'Remove it?' })).toHaveClass('modal__title');
        expect(screen.getByText('This cannot be undone.')).toHaveClass('modal__hint');
        expect(
            screen.getAllByRole('button').map((button) => {
                return button.textContent;
            })
        ).toEqual(['KEEP', 'REMOVE']);
        expect(screen.getByRole('button', { name: 'REMOVE' })).toHaveClass('btn--hot');
    });

    it('is in the body of the page, not inside what opened it, so it does not take the style of a row', () => {
        const { container } = render(
            <div className="history__item" style={{ whiteSpace: 'nowrap' }}>
                <ConfirmDialog title="Remove it?" message="This cannot be undone." confirmLabel="REMOVE" cancelLabel="KEEP" onConfirm={vi.fn()} onCancel={vi.fn()} />
            </div>
        );
        const dialog = screen.getAllByRole('dialog').at(-1)!;
        expect(container.contains(dialog)).toBe(false);
        expect(dialog.parentElement?.parentElement).toBe(document.body);
    });

    it('puts the focus on the safe answer', () => {
        setup();
        expect(screen.getByRole('button', { name: 'KEEP' })).toHaveFocus();
    });

    it('confirms with the confirm button, and only then', async () => {
        const { user, onConfirm, onCancel } = setup();
        await user.click(screen.getByRole('button', { name: 'REMOVE' }));
        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(onConfirm).toHaveBeenCalledWith();
        expect(onCancel).not.toHaveBeenCalled();
    });

    it('is called off with the other button, with Escape and with a click outside the window', async () => {
        const { user, onConfirm, onCancel } = setup();
        await user.click(screen.getByRole('button', { name: 'KEEP' }));
        await user.keyboard('{Escape}');
        await user.click(document.querySelector('.modal-backdrop')!);
        expect(onCancel).toHaveBeenCalledTimes(3);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('does not take a click inside the window for one outside it', async () => {
        const { user, onCancel } = setup();
        await user.click(screen.getByRole('heading', { name: 'Remove it?' }));
        await user.click(screen.getByText('This cannot be undone.'));
        expect(onCancel).not.toHaveBeenCalled();
    });

    it('does not let Escape go to the screen behind it, and keeps Tab inside', async () => {
        const { user, outside } = setup();
        outside.mockClear();
        await user.keyboard('{Escape}');
        expect(outside).not.toHaveBeenCalledWith(expect.objectContaining({ key: 'Escape' }));
        await user.tab();
        expect(screen.getByRole('button', { name: 'REMOVE' })).toHaveFocus();
        await user.tab();
        expect(screen.getByRole('button', { name: 'KEEP' })).toHaveFocus();
        await user.tab({ shift: true });
        expect(screen.getByRole('button', { name: 'REMOVE' })).toHaveFocus();
    });
});
