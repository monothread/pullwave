import { useMemo, useState } from 'react';
import type { MessageKey } from '@shared/i18n';
import type { HomeSection } from '@shared/types';
import { SectionIcon, type SectionIconName } from '../components/SectionIcon';
import { SECTION_TABS } from '../components/SideNav';
import { useTranslator } from '../i18n/useTranslator';
import { animeNews, mangaNews } from '../spotlight/spotlightData';
import { useAnimeStore } from '../store/animeStore';
import { useAppStore } from '../store/appStore';
import { useMangaStore } from '../store/mangaStore';
import { openAnime, openManga, pasteLink, showCut } from './homeActions';
import { activeDownloads } from './homeData';

interface CardAction {
    label: MessageKey;
    onClick: () => void;
}

export interface SectionCardModel {
    section: HomeSection;
    title: MessageKey;
    picture: SectionIconName;
    // What goes on in the section, a line each.
    lines: string[];
    // Whether something calls for attention (a download going on, something new): the card lights up.
    busy: boolean;
    actions: CardAction[];
}

function isSection(id: string): id is HomeSection {
    return id === 'downloads' || id === 'anime' || id === 'manga';
}

// The sections in the order of the menu on the left (top to bottom is left to right here), without the ones that do not exist here.
export function sectionOrder(animeSupported: boolean, mangaSupported: boolean): HomeSection[] {
    return SECTION_TABS.map((tab) => {
        return tab.id;
    })
        .filter(isSection)
        .filter((section) => {
            return (section !== 'anime' || animeSupported) && (section !== 'manga' || mangaSupported);
        });
}

// The first button of the block of the anime: the updates of the library, or the search while the library is empty.
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

// The first button of the block of the manga: the updates of the library; while the library is empty, the browse when an extension gives a
// source, else the extensions to install one.
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

// The three big blocks under the highlights of the home screen, one per section in the order of the menu, with what goes on in it and its
// quick actions.
export function SectionCards() {
    const t = useTranslator();
    const [openedAt] = useState(() => {
        return Date.now();
    });
    const videoJobs = useAppStore((state) => {
        return state.jobs;
    });
    const animeSupported = useAnimeStore((state) => {
        return state.status.supported;
    });
    const animeLibrary = useAnimeStore((state) => {
        return state.library;
    });
    const animeJobs = useAnimeStore((state) => {
        return state.jobs;
    });
    const mangaSupported = useMangaStore((state) => {
        return state.status.supported;
    });
    const mangaLibrary = useMangaStore((state) => {
        return state.library;
    });
    const mangaJobs = useMangaStore((state) => {
        return state.jobs;
    });
    // Whether an extension gives a source to browse (known once the sources were read).
    const hasSources = useMangaStore((state) => {
        return state.browse.sourcesStatus === 'ready' && state.browse.sources.length > 0;
    });
    const cards = useMemo(() => {
        const active = activeDownloads(videoJobs, animeJobs, mangaJobs);
        const count = (kind: 'video' | 'anime' | 'manga', status?: 'running' | 'queued'): number => {
            return active.filter((item) => {
                return item.kind === kind && (status === undefined || item.status === status);
            }).length;
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
    }, [t, openedAt, videoJobs, animeSupported, animeLibrary, animeJobs, mangaSupported, mangaLibrary, mangaJobs, hasSources]);

    return (
        <ul className="section-cards" aria-label={t('home.cards')}>
            {cards.map((card) => {
                return <SectionCard key={card.section} card={card} />;
            })}
        </ul>
    );
}
