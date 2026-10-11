import type { MessageKey } from '@shared/i18n';
import type { ToolState } from '@shared/tools';
import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';
import { toolErrorKey } from './mangaText';

const PROGRESS_KEYS: Record<Exclude<ToolState['status'], 'ready' | 'error'>, MessageKey> = {
    missing: 'manga.setup.missing',
    downloading: 'manga.helper.pulling',
    verifying: 'manga.setup.verifying',
    extracting: 'manga.setup.extracting'
};

// The helper that gets past Cloudflare runs in Docker, its image is pulled after the program that runs the extensions is downloaded:
// while it is not there the sites protected by Cloudflare do not work, and the rest does, so this is a note and not a screen that stops
// the section. Nothing is shown when the user gave the address of a FlareSolverr of their own.
export function MangaHelperNotice() {
    const t = useTranslator();
    const helper = useMangaStore((state) => {
        return state.status.helper;
    });
    const problem = useMangaStore((state) => {
        return state.status.helperProblem;
    });
    const external = useMangaStore((state) => {
        return state.status.helperExternal;
    });
    const retryInstall = useMangaStore((state) => {
        return state.retryInstall;
    });
    if (external || helper === null) {
        return null;
    }
    if (helper.status === 'ready') {
        return problem?.code === 'start-failed' ? (
            <section className="panel manga__helper" aria-label={t('manga.helper.title')}>
                <span className="section-label">{t('manga.helper.title')}</span>
                <p className="field__warning" role="alert" title={problem.message}>
                    {t('manga.helper.startFailed')}
                </p>
                <p className="field__hint">{t('manga.helper.external')}</p>
            </section>
        ) : null;
    }
    return (
        <section className="panel manga__helper" aria-label={t('manga.helper.title')}>
            <span className="section-label">{t('manga.helper.title')}</span>
            {helper.status === 'error' && helper.error ? (
                <>
                    <p className="field__warning" role="alert" title={helper.error.message}>
                        {t('manga.helper.error')}
                    </p>
                    <p className="field__hint">{t(toolErrorKey(helper.error.code))}</p>
                    <p className="field__hint">{t('manga.helper.external')}</p>
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
                    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(helper.percent)} aria-label={t('manga.helper.title')}>
                        <div className="progress__bar" style={{ width: `${helper.percent}%` }} />
                    </div>
                    <p className="job__meta">{t(PROGRESS_KEYS[helper.status === 'error' ? 'missing' : helper.status], { percent: Math.round(helper.percent) })}</p>
                </>
            )}
        </section>
    );
}
