import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';

// Says that a check of Cloudflare is going on, and for which site: the helper solves it in a browser, which can take up to a minute,
// and without this the screen only says it is loading.
export function MangaCloudflareNotice() {
    const t = useTranslator();
    const active = useMangaStore((state) => {
        return state.cloudflare;
    });
    if (active.length === 0) {
        return null;
    }
    const hosts = [
        ...new Set(
            active
                .map((check) => {
                    return check.host;
                })
                .filter((host) => {
                    return host.length > 0;
                })
        )
    ].join(', ');
    return (
        <section className="panel manga__cloudflare" role="status" aria-live="polite" data-testid="manga-cloudflare">
            <p className="job__meta">{hosts.length > 0 ? t('manga.cloudflare.working', { hosts }) : t('manga.cloudflare.workingAny')}</p>
            <div className="progress progress--cloudflare" role="progressbar" aria-label={t('manga.cloudflare.workingAny')}>
                <div className="progress__bar" />
            </div>
        </section>
    );
}
