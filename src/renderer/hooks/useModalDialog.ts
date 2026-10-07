import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';

const FOCUSABLE = 'button:not([disabled]), select:not([disabled]), input:not([disabled])';

interface ModalDialog {
    dialogRef: RefObject<HTMLDivElement | null>;
    handleKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

// What a window over the screen needs: the focus goes into it and comes back to what had it when it closes, Esc closes it (unless it cannot
// be closed now) without the screen behind hearing it, and Tab stays inside it.
export function useModalDialog(onClose: () => void, canClose: boolean): ModalDialog {
    const dialogRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
        return () => {
            opener?.focus();
        };
    }, []);

    function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
        if (event.key === 'Escape') {
            event.stopPropagation();
            if (canClose) {
                onClose();
            }
            return;
        }
        if (event.key !== 'Tab') {
            return;
        }
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
        }
    }

    return { dialogRef, handleKeyDown };
}
