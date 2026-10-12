import { useState } from 'react';
import { useSteadyFlag } from '../hooks/useSteadyFlag';
import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';
import { checksForSource, sourceScope } from './mangaText';

// A check that goes by faster than this is not worth a notice, and one that is on stays a moment after it ends, so it does not flicker.
export const CLOUDFLARE_SHOW_AFTER_MS = 1500;
export const CLOUDFLARE_HIDE_AFTER_MS = 1000;

// Says that a check of Cloudflare is going on for the source the user is in, and for which site: the helper solves it in a browser, which can
// take up to a minute, and without this the screen only says it is loading. Only for the source that is open (the one being browsed, or the
// one of the manga that is open or being read), and only once it has taken a while.
export function MangaCloudflareNotice() {
    const t = useTranslator();
    const checks = useMangaStore((state) => {
        return state.cloudflare;
    });
    const library = useMangaStore((state) => {
        return state.library;
    });
    const view = useMangaStore((state) => {
        return state.view;
    });
    const browse = useMangaStore((state) => {
        return state.browse;
    });
    const sourceSettings = useMangaStore((state) => {
        return state.sourceSettings;
    });
    const selection = useMangaStore((state) => {
        return state.selection;
    });
    const selectionRefresh = useMangaStore((state) => {
        return state.selectionRefresh;
    });
    const reader = useMangaStore((state) => {
        return state.reader;
    });
    const scope = sourceScope({ view, browse, sourceSettings, selection, selectionRefresh, reader });
    const mine = checksForSource(checks, scope, library, selection?.details?.url ?? null);
    const hosts = [
        ...new Set(
            mine
                .map((check) => {
                    return check.host;
                })
                .filter((host) => {
                    return host.length > 0;
                })
        )
    ].join(', ');
    // What the notice says stays while it fades, even when there is nothing left to say it about.
    const [said, setSaid] = useState('');
    if (mine.length > 0 && said !== hosts) {
        setSaid(hosts);
    }
    const shown = useSteadyFlag(mine.length > 0, CLOUDFLARE_SHOW_AFTER_MS, CLOUDFLARE_HIDE_AFTER_MS);
    if (!shown) {
        return null;
    }
    return (
        <section className="panel manga__cloudflare" role="status" aria-live="polite" data-testid="manga-cloudflare">
            <p className="job__meta">{said.length > 0 ? t('manga.cloudflare.working', { hosts: said }) : t('manga.cloudflare.workingAny')}</p>
            <div className="progress progress--cloudflare" role="progressbar" aria-label={t('manga.cloudflare.workingAny')}>
                <div className="progress__bar" />
            </div>
        </section>
    );
}
