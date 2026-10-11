import type { MessageKey } from '@shared/i18n';
import type { ToolState } from '@shared/tools';
import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';
import { toolErrorKey } from './mangaText';

const PROGRESS_KEYS: Record<Exclude<ToolState['status'], 'ready' | 'error'>, MessageKey> = {
    missing: 'manga.setup.missing',
    downloading: 'manga.setup.downloading',
    verifying: 'manga.setup.verifying',
    extracting: 'manga.setup.extracting'
};

// What the manga section shows until the program that runs the extensions is on the disk: how the download goes, or why it failed.
export function MangaSetup() {
    const t = useTranslator();
    const tool = useMangaStore((state) => {
        return state.status.tool;
    });
    const retryInstall = useMangaStore((state) => {
        return state.retryInstall;
    });
    if (tool === null || tool.status === 'ready') {
        return null;
    }
    return (
        <section className="panel manga__setup" aria-label={t('manga.setup.title')}>
            <p className="section-label">{t('manga.setup.title')}</p>
            <p className="field__hint">{t('manga.setup.hint')}</p>
            {tool.status === 'error' && tool.error ? (
                <>
                    <p className="field__warning" role="alert" title={tool.error.message}>
                        {t(toolErrorKey(tool.error.code))}
                    </p>
                    <div className="job__actions">
                        <button
                            type="button"
                            className="btn btn--small btn--primary"
                            onClick={() => {
                                void retryInstall();
                            }}
                        >
                            {t('manga.setup.retry')}
                        </button>
                    </div>
                </>
            ) : (
                <>
                    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(tool.percent)} aria-label={t('manga.setup.title')}>
                        <div className="progress__bar" style={{ width: `${tool.percent}%` }} />
                    </div>
                    <p className="job__meta">{t(PROGRESS_KEYS[tool.status === 'error' ? 'missing' : tool.status], { percent: Math.round(tool.percent) })}</p>
                </>
            )}
        </section>
    );
}
