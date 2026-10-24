import { useTranslator } from '../i18n/useTranslator';
import { ConfirmButton } from './ConfirmButton';

interface AnimeRemoveProps {
    label: string;
    // What the button says to the screen readers: it also names what is removed.
    ariaLabel: string;
    // What the window asks and warns about (the warning says that the files on the disk go too).
    title: string;
    message: string;
    onRemove: () => void;
    // Why it cannot be removed, when it cannot: the button is then off and says it.
    blocked?: string;
}

// Removing opens a window to confirm, which warns that the files on the disk go too.
export function AnimeRemove({ label, ariaLabel, title, message, onRemove, blocked }: AnimeRemoveProps) {
    const t = useTranslator();
    return (
        <ConfirmButton
            className="btn btn--small btn--ghost"
            ariaLabel={ariaLabel}
            title={blocked}
            disabled={blocked !== undefined}
            dialog={{ title, message, confirmLabel: t('manga.remove.confirm') }}
            onConfirm={onRemove}
        >
            {label}
        </ConfirmButton>
    );
}
