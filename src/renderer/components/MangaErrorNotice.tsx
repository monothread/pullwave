import type { MangaError } from '@shared/manga';
import { useTranslator } from '../i18n/useTranslator';
import { useAppStore } from '../store/appStore';
import { mangaErrorTextKey, technicalErrorText } from './mangaText';

interface MangaErrorNoticeProps {
    error: MangaError;
}

// An error of the manga section, in words for the user. Clicking it copies everything the backend said about it (the technical error), so
// it can be pasted when it is debugged.
export function MangaErrorNotice({ error }: MangaErrorNoticeProps) {
    const t = useTranslator();
    const pushToast = useAppStore((state) => {
        return state.pushToast;
    });

    async function copy(): Promise<void> {
        try {
            await navigator.clipboard.writeText(technicalErrorText(error));
            pushToast(t('manga.error.copied'));
        } catch {
            pushToast(t('manga.error.copyFailed'));
        }
    }

    return (
        <div className="field__warning manga__error" role="alert">
            <button
                type="button"
                className="manga__error-text"
                title={t('manga.error.copyHint')}
                onClick={() => {
                    void copy();
                }}
            >
                {t(mangaErrorTextKey(error))}
            </button>
        </div>
    );
}
