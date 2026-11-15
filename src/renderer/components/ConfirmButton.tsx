import { useState, type ReactNode } from 'react';
import { useTranslator } from '../i18n/useTranslator';
import { ConfirmDialog } from './ConfirmDialog';

interface ConfirmButtonProps {
    className: string;
    children: ReactNode;
    ariaLabel?: string;
    title?: string;
    disabled?: boolean;
    dialog: {
        title: string;
        message: string;
        confirmLabel: string;
        cancelLabel?: string;
    };
    onConfirm: () => void;
}

export function ConfirmButton({ className, children, ariaLabel, title, disabled, dialog, onConfirm }: ConfirmButtonProps) {
    const t = useTranslator();
    const [asking, setAsking] = useState(false);
    return (
        <>
            <button
                type="button"
                className={className}
                data-hold="confirm"
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
