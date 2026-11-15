import { useId } from 'react';
import { createPortal } from 'react-dom';
import { useAppLanguage, useTranslator } from '../i18n/useTranslator';
import { useModalDialog } from '../hooks/useModalDialog';
import { useAppStore } from '../store/appStore';
import { errorFields, type ErrorReport } from './errorReport';

interface ErrorDetailsDialogProps {
    report: ErrorReport;
    onClose: () => void;
}

export function ErrorDetailsDialog({ report, onClose }: ErrorDetailsDialogProps) {
    const t = useTranslator();
    const language = useAppLanguage();
    const titleId = useId();
    const { dialogRef, handleKeyDown } = useModalDialog(onClose, true);
    const appVersion = useAppStore((state) => {
        return state.appUpdate.currentVersion;
    });
    const pushToast = useAppStore((state) => {
        return state.pushToast;
    });
    const fields = errorFields(report, { appVersion, system: navigator.userAgent, language });
    const stack = report.details?.stack;

    async function copy(): Promise<void> {
        try {
            await navigator.clipboard.writeText(report.message);
            pushToast(t('errorDialog.copied'));
        } catch {
            pushToast(t('errorDialog.copyFailed'));
        }
    }

    return createPortal(
        <div
            className="modal-backdrop"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                    onClose();
                }
            }}
            onClick={(event) => {
                event.stopPropagation();
            }}
        >
            <div ref={dialogRef} className="modal modal--error" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={handleKeyDown}>
                <h2 id={titleId} className="modal__title">
                    {t('errorDialog.heading')}
                </h2>
                <p className="modal__summary">{report.summary}</p>
                {report.hint !== null && (
                    <p className="modal__hint">
                        <strong>{t('errorDialog.hint')}:</strong> {report.hint}
                    </p>
                )}
                <dl className="error-details">
                    {fields.map((field) => {
                        return (
                            <div key={field.label} className="error-details__row">
                                <dt>{t(field.label)}</dt>
                                <dd>{field.value}</dd>
                            </div>
                        );
                    })}
                </dl>
                <h3 className="error-details__label">{t('errorDialog.message')}</h3>
                <pre className="error-details__text" data-testid="error-message">
                    {report.message === '' ? t('errorDialog.noMessage') : report.message}
                </pre>
                {stack !== undefined && (
                    <>
                        <h3 className="error-details__label">{t('errorDialog.stack')}</h3>
                        <pre className="error-details__text" data-testid="error-stack">
                            {stack}
                        </pre>
                    </>
                )}
                <div className="modal__actions">
                    <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => {
                            void copy();
                        }}
                    >
                        {t('errorDialog.copy')}
                    </button>
                    <button
                        type="button"
                        className="btn btn--small btn--hot"
                        onClick={() => {
                            onClose();
                        }}
                    >
                        {t('errorDialog.close')}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}
