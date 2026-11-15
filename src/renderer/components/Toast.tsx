import { useEffect } from 'react';
import { useTranslator } from '../i18n/useTranslator';
import { useAppStore, type ToastItem } from '../store/appStore';

export const INFO_NOTICE_MS = 5000;

function StackedToast({ toast }: { toast: ToastItem }) {
    const t = useTranslator();
    const dismissToast = useAppStore((state) => {
        return state.dismissToast;
    });
    useEffect(() => {
        const timer = setTimeout(() => {
            dismissToast(toast.id);
        }, INFO_NOTICE_MS);
        return () => {
            clearTimeout(timer);
        };
    }, [toast.id, dismissToast]);

    return (
        <div className="toast toast--info" role="status">
            <span className="toast__message">{toast.message}</span>
            <button
                type="button"
                className="btn btn--small btn--ghost"
                aria-label={t('toast.dismiss')}
                onClick={() => {
                    dismissToast(toast.id);
                }}
            >
                ✕
            </button>
        </div>
    );
}

export function Toast() {
    const t = useTranslator();
    const notice = useAppStore((state) => {
        return state.notice;
    });
    const toasts = useAppStore((state) => {
        return state.toasts;
    });
    const setNotice = useAppStore((state) => {
        return state.setNotice;
    });
    useEffect(() => {
        if (notice?.kind !== 'info') {
            return undefined;
        }
        const timer = setTimeout(() => {
            setNotice(null);
        }, INFO_NOTICE_MS);
        return () => {
            clearTimeout(timer);
        };
    }, [notice, setNotice]);

    if (!notice && toasts.length === 0) {
        return null;
    }
    return (
        <div className="toasts">
            {notice && (
                <div className={`toast toast--${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
                    <span className="toast__message">{notice.message}</span>
                    <button
                        type="button"
                        className="btn btn--small btn--ghost"
                        aria-label={t('toast.dismiss')}
                        onClick={() => {
                            setNotice(null);
                        }}
                    >
                        ✕
                    </button>
                </div>
            )}
            {toasts.map((toast) => {
                return <StackedToast key={toast.id} toast={toast} />;
            })}
        </div>
    );
}
