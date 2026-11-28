// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { MangaCategoryFilterDialog } from '@renderer/components/MangaCategoryFilterDialog';
import { useAppStore } from '@renderer/store/appStore';

const initialApp = useAppStore.getState();

beforeEach(() => {
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS });
});

describe('MangaCategoryFilterDialog', () => {
    const CATEGORIES = ['Action', 'Comedy', 'Romance', 'School Life', 'Shōnen', 'Slice of Life'];
    const EMPTY_MESSAGE = 'No categories available in this group.';

    it('shows all categories with initial selection and mode, and switches between OR and AND before applying', async () => {
        const user = userEvent.setup();
        const onApply = vi.fn();
        const onClose = vi.fn();
        render(
            <MangaCategoryFilterDialog
                categories={CATEGORIES}
                selected={['romance']}
                mode="and"
                emptyMessage={EMPTY_MESSAGE}
                onApply={onApply}
                onClose={onClose}
            />
        );

        const dialog = screen.getByRole('dialog', { name: 'Filter by categories' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        const modeGroup = within(dialog).getByRole('group', { name: 'Match mode' });
        expect(within(modeGroup).getByRole('button', { name: 'AND (all)' })).toHaveAttribute('aria-pressed', 'true');
        expect(within(modeGroup).getByRole('button', { name: 'OR (any)' })).toHaveAttribute('aria-pressed', 'false');

        const list = within(dialog).getByRole('list', { name: 'Available categories' });
        expect(within(list).getByRole('button', { name: 'Romance' })).toHaveAttribute('aria-pressed', 'true');
        expect(within(list).getByRole('button', { name: 'Comedy' })).toHaveAttribute('aria-pressed', 'false');

        await user.click(within(list).getByRole('button', { name: 'Comedy' }));
        await user.click(within(modeGroup).getByRole('button', { name: 'OR (any)' }));
        expect(within(modeGroup).getByRole('button', { name: 'OR (any)' })).toHaveAttribute('aria-pressed', 'true');
        expect(onApply).not.toHaveBeenCalled();

        await user.click(within(dialog).getByRole('button', { name: 'APPLY' }));
        expect(onApply).toHaveBeenCalledTimes(1);
        expect(onApply).toHaveBeenCalledWith(['romance', 'Comedy'], 'or');
        expect(onClose).not.toHaveBeenCalled();
    });

    it('toggles a selected category off, moves focus inside dialog on CLEAR so Escape still closes, and applies empty selection', async () => {
        const user = userEvent.setup();
        const onApply = vi.fn();
        const onClose = vi.fn();
        render(
            <MangaCategoryFilterDialog
                categories={CATEGORIES}
                selected={['Comedy', 'Romance']}
                mode="and"
                emptyMessage={EMPTY_MESSAGE}
                onApply={onApply}
                onClose={onClose}
            />
        );
        const dialog = screen.getByRole('dialog', { name: 'Filter by categories' });
        await user.click(within(dialog).getByRole('button', { name: 'Comedy' }));
        expect(within(dialog).getByRole('button', { name: 'Comedy' })).toHaveAttribute('aria-pressed', 'false');

        await user.click(within(dialog).getByRole('button', { name: 'CLEAR' }));
        expect(within(dialog).queryByRole('button', { name: 'CLEAR' })).not.toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: 'Romance' })).toHaveAttribute('aria-pressed', 'false');
        expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'APPLY' }));

        await user.keyboard('{Escape}');
        expect(onClose).toHaveBeenCalledTimes(1);

        await user.click(within(dialog).getByRole('button', { name: 'APPLY' }));
        expect(onApply).toHaveBeenCalledWith([], 'and');
    });

    it('filters categories case- and accent-insensitively while preserving hidden selected categories', async () => {
        const user = userEvent.setup();
        const onApply = vi.fn();
        render(
            <MangaCategoryFilterDialog
                categories={CATEGORIES}
                selected={[]}
                mode="or"
                emptyMessage={EMPTY_MESSAGE}
                onApply={onApply}
                onClose={vi.fn()}
            />
        );
        const dialog = screen.getByRole('dialog', { name: 'Filter by categories' });
        expect(within(dialog).queryByRole('button', { name: 'CLEAR' })).not.toBeInTheDocument();
        await user.click(within(dialog).getByRole('button', { name: 'Action' }));

        const input = within(dialog).getByRole('textbox', { name: 'Search categories' });
        await user.type(input, '  SHONEN ');
        const list = within(dialog).getByRole('list', { name: 'Available categories' });
        expect(
            within(list)
                .getAllByRole('button')
                .map((button) => {
                    return button.textContent;
                })
        ).toEqual(['Shōnen']);

        await user.click(within(list).getByRole('button', { name: 'Shōnen' }));
        await user.clear(input);
        await user.type(input, 'mecha');
        expect(within(dialog).getByText('// NO CATEGORY MATCHES THIS SEARCH.')).toBeInTheDocument();

        await user.click(within(dialog).getByRole('button', { name: 'APPLY' }));
        expect(onApply).toHaveBeenCalledWith(['Action', 'Shōnen'], 'or');
    });

    it('prunes picked categories removed in the background while open', async () => {
        const user = userEvent.setup();
        const onApply = vi.fn();
        const { rerender } = render(
            <MangaCategoryFilterDialog
                categories={['Action', 'Comedy']}
                selected={['Action']}
                mode="or"
                emptyMessage={EMPTY_MESSAGE}
                onApply={onApply}
                onClose={vi.fn()}
            />
        );
        const dialog = screen.getByRole('dialog', { name: 'Filter by categories' });
        expect(within(dialog).getByRole('button', { name: 'CLEAR' })).toBeInTheDocument();

        rerender(
            <MangaCategoryFilterDialog
                categories={['Comedy']}
                selected={['Action']}
                mode="or"
                emptyMessage={EMPTY_MESSAGE}
                onApply={onApply}
                onClose={vi.fn()}
            />
        );
        expect(within(dialog).queryByRole('button', { name: 'CLEAR' })).not.toBeInTheDocument();
        await user.click(within(dialog).getByRole('button', { name: 'APPLY' }));
        expect(onApply).toHaveBeenCalledWith([], 'or');
    });

    it('shows the provided empty message when there are no categories', () => {
        render(
            <MangaCategoryFilterDialog
                categories={[]}
                selected={[]}
                mode="or"
                emptyMessage="No categories available in the library."
                onApply={vi.fn()}
                onClose={vi.fn()}
            />
        );
        const dialog = screen.getByRole('dialog', { name: 'Filter by categories' });
        expect(within(dialog).getByText('No categories available in the library.')).toBeInTheDocument();
        expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
        expect(within(dialog).queryByRole('button', { name: 'CLEAR' })).not.toBeInTheDocument();
    });

    it('closes without applying on cancel, Escape, or backdrop click, and ignores clicks inside the dialog', async () => {
        const user = userEvent.setup();
        const onApply = vi.fn();
        const onClose = vi.fn();
        const { unmount } = render(
            <MangaCategoryFilterDialog
                categories={CATEGORIES}
                selected={[]}
                mode="or"
                emptyMessage={EMPTY_MESSAGE}
                onApply={onApply}
                onClose={onClose}
            />
        );
        const dialog = screen.getByRole('dialog', { name: 'Filter by categories' });
        await user.click(within(dialog).getByRole('heading', { name: 'Filter by categories' }));
        expect(onClose).not.toHaveBeenCalled();

        await user.click(within(dialog).getByRole('button', { name: 'Action' }));
        await user.click(within(dialog).getByRole('button', { name: 'CANCEL' }));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onApply).not.toHaveBeenCalled();

        await user.keyboard('{Escape}');
        expect(onClose).toHaveBeenCalledTimes(2);

        const backdrop = dialog.parentElement as HTMLElement;
        await user.click(backdrop);
        expect(onClose).toHaveBeenCalledTimes(3);
        expect(onApply).not.toHaveBeenCalled();
        unmount();
    });
});
