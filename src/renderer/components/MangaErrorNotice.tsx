import type { MangaError } from '@shared/manga';
import { useTranslator } from '../i18n/useTranslator';
import { ErrorNotice } from './ErrorNotice';
import { mangaErrorReport } from './mangaText';

interface MangaErrorNoticeProps {
    error: MangaError;
}

// An error of the manga section, in words for the user. Clicking it opens the window with everything known about the error.
export function MangaErrorNotice({ error }: MangaErrorNoticeProps) {
    const t = useTranslator();
    return (
        <div className="field__warning manga__error" role="alert">
            <ErrorNotice report={mangaErrorReport(t, error)} />
        </div>
    );
}
