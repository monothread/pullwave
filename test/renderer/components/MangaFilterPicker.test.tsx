// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { isPickable, MangaFilterPicker, MAX_SUGGESTIONS, type PickableFilter } from '@renderer/components/MangaFilterPicker';
import { useAppStore } from '@renderer/store/appStore';
import { installMockApi } from '../../helpers/mockApi';

const initialApp = useAppStore.getState();

beforeEach(() => {
    installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS, toasts: [] });
});

const OPTIONS: PickableFilter[] = [
    { type: 'tristate', name: 'Action', value: 'ignore' },
    { type: 'tristate', name: 'Drama', value: 'include' },
    { type: 'tristate', name: 'Horror', value: 'exclude' },
    { type: 'tristate', name: 'Romance', value: 'ignore' }
];

function Harness({ initial, onChange }: { initial: PickableFilter[]; onChange?: (filters: PickableFilter[]) => void }) {
    const [filters, setFilters] = useState(initial);
    return (
        <MangaFilterPicker
            name="Genre"
            filters={filters}
            onChange={(next) => {
                setFilters(next);
                onChange?.(next);
            }}
        />
    );
}

describe('isPickable', () => {
    it('is true for the tri-state and the checkbox filters only', () => {
        expect(isPickable({ type: 'tristate', name: 'x', value: 'ignore' })).toBe(true);
        expect(isPickable({ type: 'checkbox', name: 'x', value: false })).toBe(true);
        expect(isPickable({ type: 'text', name: 'x', value: '' })).toBe(false);
        expect(isPickable({ type: 'separator', name: '' })).toBe(false);
    });
});

describe('MangaFilterPicker', () => {
    it('has a field to type in, and lists nothing until it is used', () => {
        render(<Harness initial={OPTIONS} />);
        const field = screen.getByRole('combobox', { name: 'Genre' });
        expect(field).toHaveAttribute('placeholder', 'Type to search…');
        expect(field).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('lists the options that were not picked when the field is used, and only those that match what is typed', async () => {
        const user = userEvent.setup();
        render(<Harness initial={OPTIONS} />);
        await user.click(screen.getByRole('combobox', { name: 'Genre' }));
        expect(
            screen.getAllByRole('option').map((option) => {
                return option.textContent;
            })
        ).toEqual(['Action', 'Romance']);
        await user.type(screen.getByRole('combobox', { name: 'Genre' }), 'ROM');
        expect(
            screen.getAllByRole('option').map((option) => {
                return option.textContent;
            })
        ).toEqual(['Romance']);
        await user.clear(screen.getByRole('combobox', { name: 'Genre' }));
        await user.type(screen.getByRole('combobox', { name: 'Genre' }), 'zzz');
        expect(screen.queryByRole('option')).not.toBeInTheDocument();
        expect(screen.getByText('Nothing matches.')).toBeInTheDocument();
    });

    it('picks an option with a click, clears the field and shows the pick as a chip', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<Harness initial={OPTIONS} onChange={onChange} />);
        await user.type(screen.getByRole('combobox', { name: 'Genre' }), 'act');
        await user.click(screen.getByRole('option', { name: 'Action' }));
        expect(onChange).toHaveBeenCalledWith([{ type: 'tristate', name: 'Action', value: 'include' }, ...OPTIONS.slice(1)]);
        expect(screen.getByRole('combobox', { name: 'Genre' })).toHaveValue('');
        expect(screen.getByRole('button', { name: 'Action: Only with this' })).toBeInTheDocument();
    });

    it('picks the first match with Enter, and does nothing with Enter when nothing matches', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<Harness initial={OPTIONS} onChange={onChange} />);
        const field = screen.getByRole('combobox', { name: 'Genre' });
        await user.type(field, 'zzz{Enter}');
        expect(onChange).not.toHaveBeenCalled();
        await user.clear(field);
        await user.type(field, 'r{Enter}');
        expect(onChange).toHaveBeenCalledWith([OPTIONS[0], OPTIONS[1], OPTIONS[2], { type: 'tristate', name: 'Romance', value: 'include' }]);
    });

    it('turns a chip into "without this" and back, and removes it', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<Harness initial={OPTIONS} onChange={onChange} />);
        expect(screen.getByRole('list', { name: 'Genre: chosen' })).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Drama: Only with this' }));
        expect(onChange).toHaveBeenLastCalledWith([OPTIONS[0], { type: 'tristate', name: 'Drama', value: 'exclude' }, OPTIONS[2], OPTIONS[3]]);
        await user.click(screen.getByRole('button', { name: 'Drama: Without this' }));
        expect(onChange).toHaveBeenLastCalledWith(OPTIONS);
        await user.click(screen.getByRole('button', { name: 'Remove: Horror' }));
        expect(onChange).toHaveBeenLastCalledWith([OPTIONS[0], OPTIONS[1], { type: 'tristate', name: 'Horror', value: 'ignore' }, OPTIONS[3]]);
        expect(screen.queryByRole('button', { name: 'Remove: Horror' })).not.toBeInTheDocument();
    });

    it('works for checkbox filters: picked is on, removed is off, and there is no "without this"', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        const boxes: PickableFilter[] = [
            { type: 'checkbox', name: 'One', value: false },
            { type: 'checkbox', name: 'Two', value: true }
        ];
        render(<Harness initial={boxes} onChange={onChange} />);
        expect(screen.queryByRole('button', { name: /Two: / })).not.toBeInTheDocument();
        await user.click(screen.getByRole('combobox', { name: 'Genre' }));
        await user.click(screen.getByRole('option', { name: 'One' }));
        expect(onChange).toHaveBeenLastCalledWith([{ type: 'checkbox', name: 'One', value: true }, boxes[1]]);
        await user.click(screen.getByRole('button', { name: 'Remove: Two' }));
        expect(onChange).toHaveBeenLastCalledWith([{ type: 'checkbox', name: 'One', value: true }, { type: 'checkbox', name: 'Two', value: false }]);
    });

    it('shows only the first matches of a long list and says how many more there are', async () => {
        const user = userEvent.setup();
        const many: PickableFilter[] = Array.from({ length: 2000 }, (_unused, index) => {
            return { type: 'tristate', name: `Artist ${String(index)}`, value: 'ignore' };
        });
        render(<Harness initial={many} />);
        const field = screen.getByRole('combobox', { name: 'Genre' });
        // A click lists the first of all the options at once, and says how many more there are.
        await user.click(field);
        expect(screen.getAllByRole('option')).toHaveLength(MAX_SUGGESTIONS);
        expect(screen.getByText('1970 more: type to narrow down.')).toBeInTheDocument();
        await user.type(field, 'artist 1');
        expect(screen.getAllByRole('option')).toHaveLength(MAX_SUGGESTIONS);
        expect(screen.getByText('1081 more: type to narrow down.')).toBeInTheDocument();
        await user.type(field, '99');
        expect(
            screen.getAllByRole('option').map((option) => {
                return option.textContent;
            })
        ).toEqual(['Artist 199', 'Artist 1990', 'Artist 1991', 'Artist 1992', 'Artist 1993', 'Artist 1994', 'Artist 1995', 'Artist 1996', 'Artist 1997', 'Artist 1998', 'Artist 1999']);
    });

    it('closes the list when an option is picked, and opens it again with the next letter', async () => {
        const user = userEvent.setup();
        render(<Harness initial={OPTIONS} />);
        const field = screen.getByRole('combobox', { name: 'Genre' });
        await user.type(field, 'act');
        await user.click(screen.getByRole('option', { name: 'Action' }));
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        await user.type(field, 'r');
        expect(screen.getByRole('option', { name: 'Romance' })).toBeInTheDocument();
    });

    it('says no option is left when every option was picked and the field is clicked', async () => {
        const user = userEvent.setup();
        render(<Harness initial={[{ type: 'tristate', name: 'Only', value: 'include' }]} />);
        await user.click(screen.getByRole('combobox', { name: 'Genre' }));
        expect(screen.getByRole('listbox')).toBeInTheDocument();
        expect(screen.queryByRole('option')).not.toBeInTheDocument();
        expect(screen.getByText('Nothing matches.')).toBeInTheDocument();
    });

    it('opens the list again with a click on the field after an option was picked', async () => {
        const user = userEvent.setup();
        render(<Harness initial={OPTIONS} />);
        const field = screen.getByRole('combobox', { name: 'Genre' });
        await user.click(field);
        await user.click(screen.getAllByRole('option')[0]!);
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        await user.click(field);
        expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('closes the list when the field loses the focus', async () => {
        const user = userEvent.setup();
        render(<Harness initial={OPTIONS} />);
        await user.click(screen.getByRole('combobox', { name: 'Genre' }));
        expect(screen.getByRole('listbox')).toBeInTheDocument();
        fireEvent.blur(screen.getByRole('combobox', { name: 'Genre' }));
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
});

describe('MangaFilterPicker the chips of what was picked', () => {
    it('gives a name with no state its own label, like the ones with a state', () => {
        render(<MangaFilterPicker name="Format" filters={[{ type: 'checkbox', name: 'Full Color', value: true }, { type: 'tristate', name: 'Long Strip', value: 'include' }]} onChange={vi.fn()} />);
        const chips = screen.getAllByRole('listitem');
        expect(chips[0]!.querySelector('.manga__chip-label')).toHaveTextContent('Full Color');
        expect(chips[1]!.querySelector('.manga__chip-state')).toHaveTextContent('Long Strip');
        expect(within(chips[0]!).getByRole('button', { name: 'Remove: Full Color' })).toHaveClass('manga__chip-remove');
    });
});
