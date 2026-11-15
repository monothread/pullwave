import { useMemo, useState } from 'react';
import type { MessageKey } from '@shared/i18n';
import type { HomeSection } from '@shared/types';
import { SectionIcon, type SectionIconName } from '../components/SectionIcon';
import { SECTION_TABS } from '../components/SideNav';
import { useTranslator } from '../i18n/useTranslator';
import { animeNews, mangaNews } from '../spotlight/spotlightData';
import { useAnimeStore } from '../store/animeStore';
import { useMangaStore } from '../store/mangaStore';
import { openAnime, openManga, pasteLink, showCut } from './homeActions';
import { activeTotal } from './homeData';
import { useActiveCounts } from '../hooks/useActiveCounts';
import { useShownLibrary } from '../hooks/useShownManga';

interface CardAction {
    label: MessageKey;
    onClick: () => void;
}

export interface SectionCardModel {
    section: HomeSection;
    title: MessageKey;
    picture: SectionIconName;
    lines: string[];
    busy: boolean;
    actions: CardAction[];
}

function isSection(id: string): id is HomeSection {
    return id === 'downloads' || id === 'anime' || id === 'manga';
}

export function sectionOrder(animeSupported: boolean, mangaSupported: boolean): HomeSection[] {
    return SECTION_TABS.map((tab) => {
        return tab.id;
    })
        .filter(isSection)
        .filter((section) => {
            return (section !== 'anime' || animeSupported) && (section !== 'manga' || mangaSupported);
        });
}

export function animeFirstAction(libraryEmpty: boolean): CardAction {
    if (libraryEmpty) {
        return {
            label: 'anime.nav.search',
            onClick: () => {
                openAnime('search');
            }
        };
    }
    return {
        label: 'anime.nav.updates',
        onClick: () => {
            openAnime('updates');
        }
    };
}

export function mangaFirstAction(libraryEmpty: boolean, hasSources: boolean): CardAction {
    if (!libraryEmpty) {
        return {
            label: 'manga.nav.updates',
            onClick: () => {
                openManga('updates');
            }
        };
    }
    if (hasSources) {
        return {
            label: 'manga.nav.browse',
            onClick: () => {
                openManga('browse');
            }
        };
    }
    return {
        label: 'manga.nav.extensions',
        onClick: () => {
            openManga('extensions');
        }
    };
}

function SectionCard({ card }: { card: SectionCardModel }) {
    const t = useTranslator();
    const section = t(card.title);
    return (
        <li className={`section-card section-card--${card.section}${card.busy ? ' section-card--busy' : ''}`}>
            <h3 className="section-card__title">
                <SectionIcon name={card.picture} />
                <span>{section}</span>
            </h3>
            <ul className="section-card__lines">
                {card.lines.map((line) => {
                    return <li key={line}>{line}</li>;
                })}
            </ul>
            <div className="section-card__actions">
                {card.actions.map((action, index) => {
                    const label = t(action.label);
                    return (
                        <button key={action.label} type="button" className={`btn${index === 0 ? ' btn--primary' : ''}`} aria-label={t('home.card.open', { action: label, section })} onClick={action.onClick}>
                            {label}
                        </button>
                    );
                })}
            </div>
        </li>
    );
}

export function SectionCards() {
    const t = useTranslator();
    const [openedAt] = useState(() => {
        return Date.now();
    });
    const active = useActiveCounts();
    const animeSupported = useAnimeStore((state) => {
        return state.status.supported;
    });
    const animeLibrary = useAnimeStore((state) => {
        return state.library;
    });
    const mangaSupported = useMangaStore((state) => {
        return state.status.supported;
    });
    const mangaLibrary = useShownLibrary();
    const hasSources = useMangaStore((state) => {
        return state.browse.sourcesStatus === 'ready' && state.browse.sources.length > 0;
    });
    const cards = useMemo(() => {
        const count = (kind: 'video' | 'anime' | 'manga', status?: 'running' | 'queued'): number => {
            return status === undefined ? activeTotal(active[kind]) : active[kind][status];
        };
        const newsLine = (news: number): string => {
            return news > 0 ? t('home.card.news', { count: news }) : t('home.card.noNews');
        };
        const downloadsLine = (kind: 'anime' | 'manga'): string[] => {
            const going = count(kind);
            return going > 0 ? [t('home.card.downloading', { count: going })] : [];
        };
        const animeNewsCount = animeNews(animeLibrary, openedAt).count;
        const mangaNewsCount = mangaNews(mangaLibrary, openedAt).count;
        const running = count('video', 'running');
        const waiting = count('video', 'queued');
        const models: Record<HomeSection, SectionCardModel> = {
            downloads: {
                section: 'downloads',
                title: 'tab.downloads',
                picture: 'downloads',
                lines: running + waiting === 0 ? [t('home.card.idle')] : [t('home.card.downloading', { count: running }), t('home.card.waiting', { count: waiting })],
                busy: running + waiting > 0,
                actions: [
                    { label: 'home.card.paste', onClick: pasteLink },
                    { label: 'downloads.nav.cut', onClick: showCut }
                ]
            },
            anime: {
                section: 'anime',
                title: 'tab.anime',
                picture: 'anime',
                lines: [newsLine(animeNewsCount), ...downloadsLine('anime')],
                busy: animeNewsCount > 0 || count('anime') > 0,
                actions: [
                    animeFirstAction(animeLibrary.length === 0),
                    {
                        label: 'home.card.library',
                        onClick: () => {
                            openAnime('library');
                        }
                    }
                ]
            },
            manga: {
                section: 'manga',
                title: 'tab.manga',
                picture: 'manga',
                lines: [newsLine(mangaNewsCount), ...downloadsLine('manga')],
                busy: mangaNewsCount > 0 || count('manga') > 0,
                actions: [
                    mangaFirstAction(mangaLibrary.length === 0, hasSources),
                    {
                        label: 'home.card.library',
                        onClick: () => {
                            openManga('library');
                        }
                    }
                ]
            }
        };
        return sectionOrder(animeSupported, mangaSupported).map((section) => {
            return models[section];
        });
    }, [t, openedAt, active, animeSupported, animeLibrary, mangaSupported, mangaLibrary, hasSources]);

    return (
        <ul className="section-cards" aria-label={t('home.cards')}>
            {cards.map((card) => {
                return <SectionCard key={card.section} card={card} />;
            })}
        </ul>
    );
}
