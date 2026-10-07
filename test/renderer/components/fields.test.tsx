// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NumberField, SelectField, TextField, ToggleField } from '@renderer/components/fields';

describe('TextField', () => {
    it('renders label, value, placeholder and hint and reports changes', async () => {
        const onChange = vi.fn();
        render(<TextField label="Folder" value="abc" placeholder="ph" hint="a hint" onChange={onChange} />);
        const input = screen.getByLabelText('Folder');
        expect(input).toHaveValue('abc');
        expect(input).toHaveAttribute('placeholder', 'ph');
        expect(screen.getByText('a hint')).toBeInTheDocument();
        await userEvent.setup().type(input, 'd');
        expect(onChange).toHaveBeenCalledWith('abcd');
    });

    it('renders without a hint', () => {
        render(<TextField label="Folder" value="" onChange={vi.fn()} />);
        expect(document.querySelector('.field__hint')).toBeNull();
    });

    it('is enabled by default and can be disabled, when it does not report changes', async () => {
        const onChange = vi.fn();
        const { rerender } = render(<TextField label="Folder" value="abc" onChange={onChange} />);
        expect(screen.getByLabelText('Folder')).toBeEnabled();
        rerender(<TextField label="Folder" value="abc" disabled onChange={onChange} />);
        expect(screen.getByLabelText('Folder')).toBeDisabled();
        await userEvent.setup().type(screen.getByLabelText('Folder'), 'd');
        expect(onChange).not.toHaveBeenCalled();
    });
});

describe('NumberField', () => {
    it('renders bounds and reports numeric changes', () => {
        const onChange = vi.fn();
        render(<NumberField label="Count" value={3} min={1} max={5} hint="between" onChange={onChange} />);
        const input = screen.getByLabelText('Count');
        expect(input).toHaveValue(3);
        expect(input).toHaveAttribute('min', '1');
        expect(input).toHaveAttribute('max', '5');
        fireEvent.change(input, { target: { value: '4' } });
        expect(onChange).toHaveBeenCalledWith(4);
        expect(screen.getByText('between')).toBeInTheDocument();
    });

    it('is enabled by default and can be disabled', () => {
        const { rerender } = render(<NumberField label="Count" value={3} min={1} max={5} onChange={vi.fn()} />);
        expect(screen.getByLabelText('Count')).toBeEnabled();
        rerender(<NumberField label="Count" value={3} min={1} max={5} disabled onChange={vi.fn()} />);
        expect(screen.getByLabelText('Count')).toBeDisabled();
    });

    it('ignores non-numeric input', () => {
        const onChange = vi.fn();
        render(<NumberField label="Count" value={3} min={1} max={5} onChange={onChange} />);
        fireEvent.change(screen.getByLabelText('Count'), { target: { value: '' } });
        expect(onChange).toHaveBeenCalledWith(0);
    });
});

describe('SelectField', () => {
    it('renders options with the raw value by default', async () => {
        const onChange = vi.fn();
        render(<SelectField label="Format" value="mp4" options={['mp4', 'mkv']} onChange={onChange} />);
        expect(screen.getByLabelText('Format')).toHaveValue('mp4');
        expect(screen.getAllByRole('option').map((option) => {
            return option.textContent;
        })).toEqual(['mp4', 'mkv']);
        await userEvent.setup().selectOptions(screen.getByLabelText('Format'), 'mkv');
        expect(onChange).toHaveBeenCalledWith('mkv');
    });

    it('uses formatOption for option labels and shows the hint', () => {
        render(
            <SelectField
                label="Quality"
                value="best"
                options={['best', '720']}
                hint="pick"
                formatOption={(option) => {
                    return option.toUpperCase();
                }}
                onChange={vi.fn()}
            />
        );
        expect(screen.getAllByRole('option').map((option) => {
            return option.textContent;
        })).toEqual(['BEST', '720']);
        expect(screen.getByText('pick')).toBeInTheDocument();
    });

    it('is enabled by default and can be turned off, with no change reported', async () => {
        const onChange = vi.fn();
        const { rerender } = render(<SelectField label="Format" value="mp4" options={['mp4', 'mkv']} onChange={onChange} />);
        expect(screen.getByLabelText('Format')).toBeEnabled();
        rerender(<SelectField label="Format" value="mp4" options={['mp4', 'mkv']} disabled onChange={onChange} />);
        expect(screen.getByLabelText('Format')).toBeDisabled();
        await userEvent.setup().selectOptions(screen.getByLabelText('Format'), 'mkv');
        expect(onChange).not.toHaveBeenCalled();
    });
});

describe('ToggleField', () => {
    it('renders the state and reports changes', async () => {
        const onChange = vi.fn();
        render(<ToggleField label="Enable" checked={false} hint="explain" onChange={onChange} />);
        const checkbox = screen.getByLabelText('Enable');
        expect(checkbox).not.toBeChecked();
        await userEvent.setup().click(checkbox);
        expect(onChange).toHaveBeenCalledWith(true);
        expect(screen.getByText('explain')).toBeInTheDocument();
    });

    it('renders checked without a hint', () => {
        render(<ToggleField label="Enable" checked onChange={vi.fn()} />);
        expect(screen.getByLabelText('Enable')).toBeChecked();
        expect(document.querySelector('.field__hint')).toBeNull();
    });
});
