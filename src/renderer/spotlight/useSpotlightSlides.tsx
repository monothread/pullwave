import { useMemo } from 'react';
import type { Translator } from '@shared/i18n';
import { AnimeCover } from '../components/AnimeCover';
import { MangaCover } from '../components/MangaCover';
import { useTranslator } from '../i18n/useTranslator';
import { coverKey, useAnimeStore, type AnimeCoverState } from '../store/animeStore';
import type { SpotlightSlide } from './Spotlight';
import { runPrimary, showAnimeDetails } from './spotlightActions';
import type { SpotlightItem } from './spotlightData';

function coverUrlOf(covers: Readonly<Record<string, AnimeCoverState>>, title: string): string | null {
    const found = covers[coverKey(title)];
    return found?.status === 'found' ? found.url : null;
}

function newsText(item: SpotlightItem & { reason: 'news' }, t: Translator): string {
    if (item.kind === 'anime') {
        return item.count === 1 ? t('spotlight.newEpisode') : t('spotlight.newEpisodes', { count: item.count });
    }
    return item.count === 1 ? t('spotlight.newChapter') : t('spotlight.newChapters', { count: item.count });
}

// One highlight as the carousel draws it: what it says, its cover and its buttons.
export function toSlide(item: SpotlightItem, t: Translator, covers: Readonly<Record<string, AnimeCoverState>>): SpotlightSlide {
    const primary = (label: string) => {
        return {
            label,
            ariaLabel: `${label}: ${item.title}`,
            onClick: () => {
                runPrimary(item);
            }
        };
    };
    if (item.kind === 'anime') {
        const art = <AnimeCover title={item.coverTitle} />;
        const imageUrl = coverUrlOf(covers, item.coverTitle);
        if (item.reason === 'continue') {
            const details = t('spotlight.details');
            return {
                key: item.key,
                eyebrow: t('home.hero.continueWatching'),
                title: item.title,
                meta: t('home.hero.episode', { episode: item.episode }),
                art,
                imageUrl,
                progress: item.progress,
                primary: primary(t('home.hero.play')),
                secondary: {
                    label: details,
                    ariaLabel: `${details}: ${item.title}`,
                    onClick: () => {
                        showAnimeDetails(item.animeId);
                    }
                }
            };
        }
        return { key: item.key, eyebrow: t('spotlight.news'), title: item.title, meta: newsText(item, t), art, imageUrl, progress: null, primary: primary(t('spotlight.view')) };
    }
    const art = <MangaCover url={item.coverUrl} />;
    if (item.reason === 'continue') {
        const { entry } = item;
        return {
            key: item.key,
            eyebrow: t('home.hero.continueReading'),
            title: item.title,
            // A chapter whose pages are not known yet (the next one, not opened) shows only its name.
            meta: entry.pageCount > 0 ? `${entry.chapterName} · ${t('spotlight.page', { page: entry.page + 1, total: entry.pageCount })}` : entry.chapterName,
            art,
            imageUrl: item.coverUrl,
            progress: item.progress,
            primary: primary(t('spotlight.open'))
        };
    }
    return { key: item.key, eyebrow: t('spotlight.news'), title: item.title, meta: newsText(item, t), art, imageUrl: item.coverUrl, progress: null, primary: primary(t('spotlight.view')) };
}

// The slides of the carousel for these highlights.
export function useSpotlightSlides(items: readonly SpotlightItem[]): SpotlightSlide[] {
    const t = useTranslator();
    const covers = useAnimeStore((state) => {
        return state.covers;
    });
    return useMemo(() => {
        return items.map((item) => {
            return toSlide(item, t, covers);
        });
    }, [items, t, covers]);
}
