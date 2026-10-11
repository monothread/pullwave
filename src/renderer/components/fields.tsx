import type { ReactNode } from 'react';

interface FieldShellProps {
    label: string;
    hint?: string;
    children: ReactNode;
}

export function FieldShell({ label, hint, children }: FieldShellProps) {
    return (
        <label className="field">
            <span className="field__label">{label}</span>
            {children}
            {hint && <span className="field__hint">{hint}</span>}
        </label>
    );
}

interface TextFieldProps {
    label: string;
    value: string;
    hint?: string;
    placeholder?: string;
    disabled?: boolean;
    onChange: (value: string) => void;
}

export function TextField({ label, value, hint, placeholder, disabled = false, onChange }: TextFieldProps) {
    return (
        <FieldShell label={label} hint={hint}>
            <input
                className="input"
                type="text"
                aria-label={label}
                value={value}
                placeholder={placeholder}
                disabled={disabled}
                onChange={(event) => {
                    onChange(event.target.value);
                }}
            />
        </FieldShell>
    );
}

interface NumberFieldProps {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    hint?: string;
    disabled?: boolean;
    onChange: (value: number) => void;
}

export function NumberField({ label, value, min, max, step, hint, disabled = false, onChange }: NumberFieldProps) {
    return (
        <FieldShell label={label} hint={hint}>
            <input
                className="input"
                type="number"
                aria-label={label}
                value={value}
                min={min}
                max={max}
                step={step}
                disabled={disabled}
                onChange={(event) => {
                    const parsed = Number(event.target.value);
                    if (Number.isFinite(parsed)) {
                        onChange(parsed);
                    }
                }}
            />
        </FieldShell>
    );
}

interface SelectFieldProps<T extends string> {
    label: string;
    value: T;
    options: readonly T[];
    hint?: string;
    disabled?: boolean;
    formatOption?: (option: T) => string;
    onChange: (value: T) => void;
}

export function SelectField<T extends string>({ label, value, options, hint, disabled = false, formatOption, onChange }: SelectFieldProps<T>) {
    return (
        <FieldShell label={label} hint={hint}>
            <select
                className="input"
                aria-label={label}
                value={value}
                disabled={disabled}
                onChange={(event) => {
                    onChange(event.target.value as T);
                }}
            >
                {options.map((option) => {
                    return (
                        <option key={option} value={option}>
                            {formatOption ? formatOption(option) : option}
                        </option>
                    );
                })}
            </select>
        </FieldShell>
    );
}

interface SwitchInputProps {
    label: string;
    checked: boolean;
    // The text beside the switch (the label when omitted).
    children?: ReactNode;
    disabled?: boolean;
    onChange: (checked: boolean) => void;
}

// An on/off setting: a switch that reads as one to assistive technology and changes with a click or the space bar.
export function SwitchInput({ label, checked, children, disabled = false, onChange }: SwitchInputProps) {
    return (
        <span className="toggle">
            <input
                className="switch"
                type="checkbox"
                role="switch"
                aria-label={label}
                checked={checked}
                disabled={disabled}
                onChange={(event) => {
                    onChange(event.target.checked);
                }}
            />
            <span>{children ?? label}</span>
        </span>
    );
}

interface ToggleFieldProps {
    label: string;
    checked: boolean;
    hint?: string;
    onChange: (checked: boolean) => void;
}

export function ToggleField({ label, checked, hint, onChange }: ToggleFieldProps) {
    return (
        <label className="field field--toggle">
            <SwitchInput label={label} checked={checked} onChange={onChange} />
            {hint && <span className="field__hint">{hint}</span>}
        </label>
    );
}
