import { useState, type ReactNode } from 'react';
import { useTranslator } from '../i18n/useTranslator';
import { ConfirmDialog } from './ConfirmDialog';

interface ConfirmButtonProps {
    className: string;
    children: ReactNode;
    // What the button says to the screen readers, when its text is not enough (it also names what the action is about).
    ariaLabel?: string;
    title?: string;
    disabled?: boolean;
    // What the window asks and warns about, and what its buttons say. The way back is "keep" unless another word is given.
    dialog: {
        title: string;
        message: string;
        confirmLabel: string;
        cancelLabel?: string;
    };
    onConfirm: () => void;
}

// A button for what takes something away (a removal, a clear, a cancel, a reset): it opens a window to confirm instead of acting at once.
export function ConfirmButton({ className, children, ariaLabel, title, disabled, dialog, onConfirm }: ConfirmButtonProps) {
    const t = useTranslator();
    const [asking, setAsking] = useState(false);
    return (
        <>
            <button
                type="button"
                className={className}
                aria-label={ariaLabel}
                title={title}
                disabled={disabled}
                onClick={() => {
                    setAsking(true);
                }}
            >
                {children}
            </button>
            {asking && (
                <ConfirmDialog
                    title={dialog.title}
                    message={dialog.message}
                    confirmLabel={dialog.confirmLabel}
                    cancelLabel={dialog.cancelLabel ?? t('manga.remove.cancel')}
                    onConfirm={() => {
                        setAsking(false);
                        onConfirm();
                    }}
                    onCancel={() => {
                        setAsking(false);
                    }}
                />
            )}
        </>
    );
}
