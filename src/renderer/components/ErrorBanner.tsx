import { useState } from 'react';
import type { DownloadError } from '@shared/types';
import { useTranslator } from '../i18n/useTranslator';
import { ErrorDetailsDialog } from './ErrorDetailsDialog';
import { codedErrorReport } from './errorReport';

interface ErrorBannerProps {
    error: DownloadError;
    onRetry: () => void;
}

export function ErrorBanner({ error, onRetry }: ErrorBannerProps) {
    const t = useTranslator();
    const [showDetails, setShowDetails] = useState(false);
    return (
        <div className="error-banner" role="alert">
            <div className="error-banner__head">
                <span className="error-banner__code">{error.code}</span>
                <strong className="error-banner__title">{error.title}</strong>
            </div>
            <p className="error-banner__hint">{error.hint}</p>
            <div className="error-banner__actions">
                <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => {
                        setShowDetails(true);
                    }}
                >
                    {t('errorBanner.showDetails')}
                </button>
                <button type="button" className="btn btn--small btn--hot" onClick={onRetry}>
                    {t('errorBanner.retry')}
                </button>
            </div>
            {showDetails && (
                <ErrorDetailsDialog
                    report={codedErrorReport(error.title, error, error.raw, error.hint)}
                    onClose={() => {
                        setShowDetails(false);
                    }}
                />
            )}
        </div>
    );
}
