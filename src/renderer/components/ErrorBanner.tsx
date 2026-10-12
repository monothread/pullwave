import { useState } from 'react';
import type { DownloadError } from '@shared/types';
import { useTranslator } from '../i18n/useTranslator';

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
                        setShowDetails((previous) => {
                            return !previous;
                        });
                    }}
                >
                    {showDetails ? t('errorBanner.hideDetails') : t('errorBanner.showDetails')}
                </button>
                <button type="button" className="btn btn--small btn--hot" onClick={onRetry}>
                    {t('errorBanner.retry')}
                </button>
            </div>
            {showDetails && <pre className="error-banner__raw">{error.raw}</pre>}
        </div>
    );
}
