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

// A window over the screen that asks before something that cannot be undone. The focus starts on the safe answer (keep), Esc and a click
// outside the window also keep. It is put in the body of the page, not where the button is: inside a row it took the text style of the row
// (no line breaks, as the buttons of a row have) and its text came out of the window.
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
                    <button type="button" className="btn btn--small" onClick={onCancel}>
                        {cancelLabel}
                    </button>
                    <button type="button" className="btn btn--small btn--hot" onClick={onConfirm}>
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}
