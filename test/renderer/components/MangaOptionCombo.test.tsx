// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MangaOptionCombo } from '@renderer/components/MangaOptionCombo';

const OPTIONS = ['Any', 'A day', 'A week', 'A month'];

describe('MangaOptionCombo', () => {
    it('shows the option that is chosen, with the list closed', () => {
        render(<MangaOptionCombo label="Created within" options={OPTIONS} value={2} onChange={vi.fn()} />);
        const field = screen.getByRole('combobox', { name: 'Created within' });
        expect(field).toHaveValue('A week');
        expect(field).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('shows nothing for an option that does not exist', () => {
        render(<MangaOptionCombo label="Created within" options={OPTIONS} value={9} onChange={vi.fn()} />);
        expect(screen.getByRole('combobox', { name: 'Created within' })).toHaveValue('');
    });

    it('lists every option when the field is clicked, with the chosen one marked', async () => {
        const user = userEvent.setup();
        render(<MangaOptionCombo label="Created within" options={OPTIONS} value={1} onChange={vi.fn()} />);
        await user.click(screen.getByRole('combobox', { name: 'Created within' }));
        expect(screen.getByRole('combobox', { name: 'Created within' })).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('listbox', { name: 'Created within' })).toBeInTheDocument();
        expect(
            screen.getAllByRole('option').map((option) => {
                return [option.textContent, option.getAttribute('aria-selected')];
            })
        ).toEqual([
            ['Any', 'false'],
            ['A day', 'true'],
            ['A week', 'false'],
            ['A month', 'false']
        ]);
        expect(screen.getByRole('option', { name: 'A day' })).toHaveClass('manga__picker-option--chosen');
    });

    it('lists the options when the field gets the focus, and selects what it shows so typing replaces it', async () => {
        const user = userEvent.setup();
        render(<MangaOptionCombo label="Created within" options={OPTIONS} value={0} onChange={vi.fn()} />);
        await user.tab();
        expect(screen.getByRole('listbox')).toBeInTheDocument();
        const field = screen.getByRole<HTMLInputElement>('combobox', { name: 'Created within' });
        expect(field.selectionStart).toBe(0);
        expect(field.selectionEnd).toBe('Any'.length);
    });

    it('narrows the list as the user types, without regard to case', async () => {
        const user = userEvent.setup();
        render(<MangaOptionCombo label="Created within" options={OPTIONS} value={0} onChange={vi.fn()} />);
        await user.click(screen.getByRole('combobox', { name: 'Created within' }));
        await user.keyboard('A W');
        expect(
            screen.getAllByRole('option').map((option) => {
                return option.textContent;
            })
        ).toEqual(['A week']);
        expect(screen.getByRole('combobox', { name: 'Created within' })).toHaveValue('A W');
    });

    it('says nothing matches when nothing does', async () => {
        const user = userEvent.setup();
        render(<MangaOptionCombo label="Created within" options={OPTIONS} value={0} onChange={vi.fn()} />);
        await user.click(screen.getByRole('combobox', { name: 'Created within' }));
        await user.keyboard('zzz');
        expect(screen.queryByRole('option')).not.toBeInTheDocument();
        expect(screen.getByText('Nothing matches.')).toBeInTheDocument();
    });

    it('picks an option with a click, closes the list and shows the chosen one again', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        const { rerender } = render(<MangaOptionCombo label="Created within" options={OPTIONS} value={0} onChange={onChange} />);
        await user.click(screen.getByRole('combobox', { name: 'Created within' }));
        await user.keyboard('mon');
        await user.click(screen.getByRole('option', { name: 'A month' }));
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith(3);
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        rerender(<MangaOptionCombo label="Created within" options={OPTIONS} value={3} onChange={onChange} />);
        expect(screen.getByRole('combobox', { name: 'Created within' })).toHaveValue('A month');
    });

    it('picks the first of the options that match with Enter', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<MangaOptionCombo label="Created within" options={OPTIONS} value={0} onChange={onChange} />);
        await user.click(screen.getByRole('combobox', { name: 'Created within' }));
        await user.keyboard('a w{Enter}');
        expect(onChange).toHaveBeenCalledWith(2);
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('picks the first option with Enter when nothing was typed', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<MangaOptionCombo label="Created within" options={OPTIONS} value={2} onChange={onChange} />);
        await user.click(screen.getByRole('combobox', { name: 'Created within' }));
        await user.keyboard('{Enter}');
        expect(onChange).toHaveBeenCalledWith(0);
    });

    it('does nothing with Enter when no option matches or the list is closed', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<MangaOptionCombo label="Created within" options={OPTIONS} value={0} onChange={onChange} />);
        const field = screen.getByRole('combobox', { name: 'Created within' });
        await user.click(field);
        await user.keyboard('zzz{Enter}');
        expect(onChange).not.toHaveBeenCalled();
        fireEvent.keyDown(field, { key: 'Escape' });
        fireEvent.keyDown(field, { key: 'Enter' });
        expect(onChange).not.toHaveBeenCalled();
    });

    it('closes the list with Escape, keeps the option that was chosen and does not let the key go further', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        const outside = vi.fn();
        document.addEventListener('keydown', outside);
        render(<MangaOptionCombo label="Created within" options={OPTIONS} value={1} onChange={onChange} />);
        const field = screen.getByRole('combobox', { name: 'Created within' });
        await user.click(field);
        await user.keyboard('zz');
        outside.mockClear();
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        expect(field).toHaveValue('A day');
        expect(onChange).not.toHaveBeenCalled();
        expect(outside).not.toHaveBeenCalled();
        document.removeEventListener('keydown', outside);
    });

    it('lets Escape go further when the list is closed', () => {
        const outside = vi.fn();
        document.addEventListener('keydown', outside);
        render(<MangaOptionCombo label="Created within" options={OPTIONS} value={1} onChange={vi.fn()} />);
        fireEvent.keyDown(screen.getByRole('combobox', { name: 'Created within' }), { key: 'Escape' });
        expect(outside).toHaveBeenCalled();
        document.removeEventListener('keydown', outside);
    });

    it('closes the list and forgets what was typed when the field loses the focus', async () => {
        const user = userEvent.setup();
        render(<MangaOptionCombo label="Created within" options={OPTIONS} value={1} onChange={vi.fn()} />);
        const field = screen.getByRole('combobox', { name: 'Created within' });
        await user.click(field);
        await user.keyboard('zz');
        fireEvent.blur(field);
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        expect(field).toHaveValue('A day');
    });

    it('opens again with a click after a pick', async () => {
        const user = userEvent.setup();
        render(<MangaOptionCombo label="Created within" options={OPTIONS} value={0} onChange={vi.fn()} />);
        const field = screen.getByRole('combobox', { name: 'Created within' });
        await user.click(field);
        await user.click(screen.getByRole('option', { name: 'A day' }));
        await user.click(field);
        expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('lists options that have the same name, each one', async () => {
        const user = userEvent.setup();
        render(<MangaOptionCombo label="Order" options={['Same', 'Same']} value={0} onChange={vi.fn()} />);
        await user.click(screen.getByRole('combobox', { name: 'Order' }));
        expect(screen.getAllByRole('option')).toHaveLength(2);
    });
});
