import { useState } from 'react';
import { useTranslator } from '../i18n/useTranslator';
import { ErrorDetailsDialog } from './ErrorDetailsDialog';
import { hasMoreToSay, type ErrorReport } from './errorReport';

interface ErrorNoticeProps {
    report: ErrorReport;
}

export function ErrorNotice({ report }: ErrorNoticeProps) {
    const t = useTranslator();
    const [open, setOpen] = useState(false);
    if (!hasMoreToSay(report)) {
        return <>{report.summary}</>;
    }
    return (
        <>
            <button
                type="button"
                className="error-notice"
                title={t('errorDialog.open')}
                onClick={() => {
                    setOpen(true);
                }}
            >
                {report.summary}
            </button>
            {open && (
                <ErrorDetailsDialog
                    report={report}
                    onClose={() => {
                        setOpen(false);
                    }}
                />
            )}
        </>
    );
}
