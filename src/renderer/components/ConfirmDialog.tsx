import { useId } from 'react';
import { createPortal } from 'react-dom';
import { useModalDialog } from '../hooks/useModalDialog';

interface ConfirmDialogProps {
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel: string;
    onConfirm: () => void;
    onCancel: () => void;
}

export function ConfirmDialog({ title, message, confirmLabel, cancelLabel, onConfirm, onCancel }: ConfirmDialogProps) {
    const titleId = useId();
    const { dialogRef, handleKeyDown } = useModalDialog(onCancel, true);
    return createPortal(
        <div
            className="modal-backdrop"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                    onCancel();
                }
            }}
        >
            <div ref={dialogRef} className="modal modal--confirm" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={handleKeyDown}>
                <h2 id={titleId} className="modal__title">
                    {title}
                </h2>
                <p className="modal__hint">{message}</p>
                <div className="modal__actions">
                    <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => {
                            onCancel();
                        }}
                    >
                        {cancelLabel}
                    </button>
                    <button
                        type="button"
                        className="btn btn--small btn--hot"
                        onClick={() => {
                            onConfirm();
                        }}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}
