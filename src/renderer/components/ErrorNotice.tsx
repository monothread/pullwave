import { useState } from 'react';
import { useTranslator } from '../i18n/useTranslator';
import { ErrorDetailsDialog } from './ErrorDetailsDialog';
import { hasMoreToSay, type ErrorReport } from './errorReport';

interface ErrorNoticeProps {
    report: ErrorReport;
}

// What went wrong, in words for the user. Clicking it opens a window with everything known about the error and a button to copy its text.
// It is only the words: the place that shows it gives the element around it (a warning, a line of a row). An error with nothing more to
// say than its words (a refusal that is no failure, like "already the latest") stays plain text.
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
