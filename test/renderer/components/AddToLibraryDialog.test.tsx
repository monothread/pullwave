// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SeriesChoice } from '@shared/series';
import { AddToLibraryDialog } from '@renderer/components/AddToLibraryDialog';
import { installMockApi } from '../../helpers/mockApi';

beforeEach(() => {
    installMockApi();
});

// The orders each series uses (the series are compared as the library does: without regard to case).
const USED: Record<string, number[]> = { frieren: [1, 3], naruto: [2], bleach: [1, 2, 3] };

function setup(initial: SeriesChoice, overrides: { suggestions?: string[]; onConfirm?: (choice: SeriesChoice | null) => Promise<boolean> } = {}) {
    const usedOrders = vi.fn((series: string): readonly number[] => {
        return USED[series.trim().toLowerCase()] ?? [];
    });
    const onConfirm = vi.fn(overrides.onConfirm ?? (async (): Promise<boolean> => {
        return true;
    }));
    const onClose = vi.fn();
    render(<AddToLibraryDialog initial={initial} suggestions={overrides.suggestions ?? ['Bleach', 'Frieren', 'Naruto']} usedOrders={usedOrders} onConfirm={onConfirm} onClose={onClose} />);
    const dialog = within(screen.getByRole('dialog', { name: 'Add to the library' }));
    return { dialog, usedOrders, onConfirm, onClose };
}

describe('AddToLibraryDialog', () => {
    describe('the window', () => {
        it('explains the series and the order, and that the series cannot change afterwards', () => {
            const { dialog } = setup({ series: 'Cyberpunk', season: 1 });

            expect(dialog.getByRole('heading', { name: 'Add to the library' })).toBeInTheDocument();
            expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
            expect(dialog.getByText('Adds the anime and all its episodes to the library. Nothing is downloaded.')).toBeInTheDocument();
            expect(dialog.getByText('Series: the group the anime belongs to, such as all the seasons of the same show.')).toBeInTheDocument();
            expect(dialog.getByText('Order: the place of this season in the series (1, 2, 3…). Each order is used once per series.')).toBeInTheDocument();
            expect(dialog.getByText('The series cannot be changed after adding.')).toBeInTheDocument();
        });

        it('starts with what the anime suggests, a name shown that is empty, and the anime that can be confirmed', () => {
            const { dialog } = setup({ series: 'Cyberpunk', season: 1 });

            expect(dialog.getByRole('textbox', { name: 'Series' })).toHaveValue('Cyberpunk');
            expect(dialog.getByRole('spinbutton', { name: 'Order' })).toHaveValue(1);
            expect(dialog.getByRole('textbox', { name: 'Name shown' })).toHaveValue('');
            expect(dialog.queryByRole('alert')).not.toBeInTheDocument();
            expect(dialog.getByRole('button', { name: 'CONFIRM' })).toBeEnabled();
            expect(dialog.getByRole('button', { name: 'CANCEL' })).toBeEnabled();
        });

        it('starts with the name shown that the anime suggests', () => {
            const { dialog } = setup({ series: 'Frieren', season: 2, seasonName: 'The Second Season' });

            expect(dialog.getByRole('textbox', { name: 'Name shown' })).toHaveValue('The Second Season');
        });

        it('puts the focus on the first field, and gives it back to what had it when it closes', () => {
            const opener = document.createElement('button');
            document.body.appendChild(opener);
            opener.focus();
            const { dialog } = setup({ series: 'Cyberpunk', season: 1 });

            expect(dialog.getByRole('textbox', { name: 'Series' })).toHaveFocus();
            cleanup();
            expect(opener).toHaveFocus();
            opener.remove();
        });
    });

    describe('the order when the window opens', () => {
        it('is the one the title suggests when the series does not use it', () => {
            const { dialog, usedOrders } = setup({ series: 'Frieren', season: 2 });

            expect(dialog.getByRole('spinbutton', { name: 'Order' })).toHaveValue(2);
            expect(usedOrders).toHaveBeenCalledWith('Frieren');
        });

        it('is the next one when the series the title suggests uses the order it suggests', () => {
            const { dialog } = setup({ series: 'Bleach', season: 2 });

            expect(dialog.getByRole('spinbutton', { name: 'Order' })).toHaveValue(4);
            expect(dialog.queryByRole('alert')).not.toBeInTheDocument();
            expect(dialog.getByRole('button', { name: 'CONFIRM' })).toBeEnabled();
        });

        it('goes after the last order the series uses, not into a gap', () => {
            const { dialog } = setup({ series: 'Frieren', season: 1 });

            expect(dialog.getByRole('spinbutton', { name: 'Order' })).toHaveValue(4);
        });

        it('compares the name of the series with the library as it does: without regard to case', () => {
            const { dialog } = setup({ series: 'FRIEREN', season: 3 });

            expect(dialog.getByRole('spinbutton', { name: 'Order' })).toHaveValue(4);
        });

        it('asks for the orders of nothing when the name suggested is empty, and keeps the order', () => {
            const { dialog, usedOrders } = setup({ series: '  ', season: 1 });

            expect(dialog.getByRole('spinbutton', { name: 'Order' })).toHaveValue(1);
            expect(usedOrders).not.toHaveBeenCalled();
        });
    });

    describe('the order when the series changes', () => {
        it('becomes the next one when the series typed uses the order that is in the field', async () => {
            const user = userEvent.setup();
            const { dialog } = setup({ series: 'Cyberpunk', season: 1 });

            await user.clear(dialog.getByRole('textbox', { name: 'Series' }));
            await user.type(dialog.getByRole('textbox', { name: 'Series' }), 'Frieren');

            expect(dialog.getByRole('spinbutton', { name: 'Order' })).toHaveValue(4);
            expect(dialog.queryByRole('alert')).not.toBeInTheDocument();
            expect(dialog.getByRole('button', { name: 'CONFIRM' })).toBeEnabled();
        });

        it('becomes the next one when the series is picked from the ones of the library', async () => {
            const user = userEvent.setup();
            const { dialog } = setup({ series: 'Cyberpunk', season: 2 });
            await user.clear(dialog.getByRole('textbox', { name: 'Series' }));

            await user.click(screen.getByRole('option', { name: 'Naruto' }));

            expect(dialog.getByRole('textbox', { name: 'Series' })).toHaveValue('Naruto');
            expect(dialog.getByRole('spinbutton', { name: 'Order' })).toHaveValue(3);
        });

        it('stays when the series typed does not use the order that is in the field', async () => {
            const user = userEvent.setup();
            const { dialog } = setup({ series: 'Cyberpunk', season: 1 });

            await user.clear(dialog.getByRole('textbox', { name: 'Series' }));
            await user.type(dialog.getByRole('textbox', { name: 'Series' }), 'Naruto');

            expect(dialog.getByRole('spinbutton', { name: 'Order' })).toHaveValue(1);
            expect(dialog.queryByRole('alert')).not.toBeInTheDocument();
        });

        it('stays when the series is a new one that no anime of the library has', async () => {
            const user = userEvent.setup();
            const { dialog } = setup({ series: 'Cyberpunk', season: 3 });

            await user.clear(dialog.getByRole('textbox', { name: 'Series' }));
            await user.type(dialog.getByRole('textbox', { name: 'Series' }), 'Brand new');

            expect(dialog.getByRole('spinbutton', { name: 'Order' })).toHaveValue(3);
        });

        it('stays when the series is emptied', async () => {
            const user = userEvent.setup();
            const { dialog } = setup({ series: 'Frieren', season: 2 });

            await user.clear(dialog.getByRole('textbox', { name: 'Series' }));

            expect(dialog.getByRole('spinbutton', { name: 'Order' })).toHaveValue(2);
            expect(dialog.queryByRole('alert')).not.toBeInTheDocument();
        });

        it('stays at the order that was chosen by hand when the series goes on to a name that does not use it', async () => {
            const user = userEvent.setup();
            const { dialog } = setup({ series: 'Frieren', season: 2 });

            await user.type(dialog.getByRole('textbox', { name: 'Series' }), ' Part');

            expect(dialog.getByRole('spinbutton', { name: 'Order' })).toHaveValue(2);
        });

        it('uses what was typed in the order field for the next change: it moves on from there', async () => {
            const user = userEvent.setup();
            const { dialog } = setup({ series: 'Cyberpunk', season: 1 });
            await user.clear(dialog.getByRole('spinbutton', { name: 'Order' }));
            await user.type(dialog.getByRole('spinbutton', { name: 'Order' }), '2');

            await user.clear(dialog.getByRole('textbox', { name: 'Series' }));
            await user.type(dialog.getByRole('textbox', { name: 'Series' }), 'Naruto');

            expect(dialog.getByRole('spinbutton', { name: 'Order' })).toHaveValue(3);
        });
    });

    describe('an order typed by hand that the series uses', () => {
        it('is not allowed: the window says so, with the next order, and the anime cannot be confirmed', async () => {
            const user = userEvent.setup();
            const { dialog, onConfirm } = setup({ series: 'Frieren', season: 2 });

            await user.clear(dialog.getByRole('spinbutton', { name: 'Order' }));
            await user.type(dialog.getByRole('spinbutton', { name: 'Order' }), '3');

            expect(dialog.getByRole('alert')).toHaveTextContent('Order 3 is already used by another anime of the series. Use 4, the next one.');
            expect(dialog.getByRole('button', { name: 'CONFIRM' })).toBeDisabled();
            await user.click(dialog.getByRole('button', { name: 'CONFIRM' }));
            expect(onConfirm).not.toHaveBeenCalled();
        });

        it('is allowed again once the order is changed', async () => {
            const user = userEvent.setup();
            const { dialog } = setup({ series: 'Frieren', season: 2 });
            await user.clear(dialog.getByRole('spinbutton', { name: 'Order' }));
            await user.type(dialog.getByRole('spinbutton', { name: 'Order' }), '1');
            expect(dialog.getByRole('button', { name: 'CONFIRM' })).toBeDisabled();

            await user.clear(dialog.getByRole('spinbutton', { name: 'Order' }));
            await user.type(dialog.getByRole('spinbutton', { name: 'Order' }), '4');

            expect(dialog.queryByRole('alert')).not.toBeInTheDocument();
            expect(dialog.getByRole('button', { name: 'CONFIRM' })).toBeEnabled();
        });

        it('is the next one for a series that uses a single order too', () => {
            const { dialog } = setup({ series: 'Naruto', season: 2 });

            expect(dialog.getByRole('spinbutton', { name: 'Order' })).toHaveValue(3);
        });

        it('is not checked when the anime stays on its own', async () => {
            const user = userEvent.setup();
            const { dialog } = setup({ series: 'Frieren', season: 2 });

            await user.clear(dialog.getByRole('textbox', { name: 'Series' }));

            expect(dialog.queryByRole('alert')).not.toBeInTheDocument();
            expect(dialog.getByRole('button', { name: 'CONFIRM' })).toBeEnabled();
        });
    });

    describe('confirming', () => {
        it('asks for the anime to be added with the series, the order that is in the field and the name shown', async () => {
            const user = userEvent.setup();
            const { dialog, onConfirm } = setup({ series: 'Cyberpunk', season: 1 });
            await user.clear(dialog.getByRole('textbox', { name: 'Series' }));
            await user.type(dialog.getByRole('textbox', { name: 'Series' }), 'Frieren');
            await user.type(dialog.getByRole('textbox', { name: 'Name shown' }), 'The Return');

            await user.click(dialog.getByRole('button', { name: 'CONFIRM' }));

            expect(onConfirm).toHaveBeenCalledTimes(1);
            expect(onConfirm).toHaveBeenCalledWith({ series: 'Frieren', season: 4, seasonName: 'The Return' });
        });

        it('asks for the anime to be added on its own when the series is empty', async () => {
            const user = userEvent.setup();
            const { dialog, onConfirm } = setup({ series: 'Cyberpunk', season: 1 });
            await user.clear(dialog.getByRole('textbox', { name: 'Series' }));

            await user.click(dialog.getByRole('button', { name: 'CONFIRM' }));

            expect(onConfirm).toHaveBeenCalledWith(null);
        });

        it('closes once the anime was added', async () => {
            const user = userEvent.setup();
            const { dialog, onClose } = setup({ series: 'Cyberpunk', season: 1 });

            await user.click(dialog.getByRole('button', { name: 'CONFIRM' }));

            expect(onClose).toHaveBeenCalledTimes(1);
        });

        it('stays open, ready to be changed, when the anime was not added', async () => {
            const user = userEvent.setup();
            const { dialog, onClose } = setup(
                { series: 'Cyberpunk', season: 1 },
                {
                    onConfirm: async () => {
                        return false;
                    }
                }
            );

            await user.click(dialog.getByRole('button', { name: 'CONFIRM' }));

            expect(onClose).not.toHaveBeenCalled();
            expect(dialog.getByRole('button', { name: 'CONFIRM' })).toBeEnabled();
        });

        it('keeps CONFIRM off while the anime is being added', async () => {
            const user = userEvent.setup();
            let finish: (added: boolean) => void = () => {
                return undefined;
            };
            const { dialog, onConfirm } = setup(
                { series: 'Cyberpunk', season: 1 },
                {
                    onConfirm: () => {
                        return new Promise<boolean>((resolve) => {
                            finish = resolve;
                        });
                    }
                }
            );

            await user.click(dialog.getByRole('button', { name: 'CONFIRM' }));
            expect(dialog.getByRole('button', { name: 'CONFIRM' })).toBeDisabled();
            await user.click(dialog.getByRole('button', { name: 'CONFIRM' }));
            expect(onConfirm).toHaveBeenCalledTimes(1);

            finish(false);
            await vi.waitFor(() => {
                expect(dialog.getByRole('button', { name: 'CONFIRM' })).toBeEnabled();
            });
        });
    });

    describe('closing without adding', () => {
        it('closes with CANCEL', async () => {
            const user = userEvent.setup();
            const { dialog, onClose, onConfirm } = setup({ series: 'Cyberpunk', season: 1 });

            await user.click(dialog.getByRole('button', { name: 'CANCEL' }));

            expect(onClose).toHaveBeenCalledTimes(1);
            expect(onConfirm).not.toHaveBeenCalled();
        });

        it('closes with Esc', async () => {
            const user = userEvent.setup();
            const { onClose, onConfirm } = setup({ series: 'Cyberpunk', season: 1 });

            await user.keyboard('{Escape}');

            expect(onClose).toHaveBeenCalledTimes(1);
            expect(onConfirm).not.toHaveBeenCalled();
        });

        it('closes with a click outside the window, and not with one inside it', () => {
            const { dialog, onClose } = setup({ series: 'Cyberpunk', season: 1 });

            fireEvent.mouseDown(dialog.getByRole('heading', { name: 'Add to the library' }));
            expect(onClose).not.toHaveBeenCalled();
            fireEvent.mouseDown(document.querySelector('.modal-backdrop') as HTMLElement);

            expect(onClose).toHaveBeenCalledTimes(1);
        });
    });

    describe('the keyboard', () => {
        it('keeps Tab inside the window: from the last button it goes to the first field, and Shift+Tab from the first field goes to the last button', async () => {
            const user = userEvent.setup();
            const { dialog } = setup({ series: 'Cyberpunk', season: 1 });

            dialog.getByRole('button', { name: 'CONFIRM' }).focus();
            await user.tab();
            expect(dialog.getByRole('textbox', { name: 'Series' })).toHaveFocus();

            await user.tab({ shift: true });
            expect(dialog.getByRole('button', { name: 'CONFIRM' })).toHaveFocus();
        });
    });
});
