import { useTranslator } from '../i18n/useTranslator';
import { ConfirmButton } from './ConfirmButton';

interface AnimeRemoveProps {
    label: string;
    ariaLabel: string;
    title: string;
    message: string;
    onRemove: () => void;
    blocked?: string;
}

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
