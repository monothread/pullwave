import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimePanel } from './components/AnimePanel';
import { Backdrop } from './components/Backdrop';
import { DownloadsPanel } from './components/DownloadsPanel';
import { MangaPanel } from './components/MangaPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { SECTION_TABS, SideNav } from './components/SideNav';
import { Toast } from './components/Toast';
import { FocusHalo } from './fx/FocusHalo';
import { FxLayer } from './fx/FxLayer';
import { revealTheme, trackPointerForReveal } from './fx/themeReveal';
import { useSectionAccent } from './fx/useSectionAccent';
import { TopBar } from './components/TopBar';
import { UpdateBanner } from './components/UpdateBanner';
import { HomePanel } from './home/HomePanel';
import { useGamepadNavigation, type GamepadSections } from './hooks/useGamepadNavigation';
import { useMouseNavigation } from './hooks/useMouseNavigation';
import { useMainSectionShortcuts } from './hooks/useMainSectionShortcuts';
import { useSearchShortcuts } from './hooks/useSearchShortcuts';
import { useSectionTabShortcuts } from './hooks/useSectionTabShortcuts';
import { useSpatialNavigation } from './hooks/useSpatialNavigation';
import { useUiSounds } from './hooks/useUiSounds';
import { useWindowMinimized } from './hooks/useWindowMinimized';
import { withViewTransition } from './navigation/viewTransition';
import { playUiSound } from './sound/uiSound';
import { useUiPrefsStore } from './store/uiPrefsStore';
import { sectionAfter } from './navigation/sections';
import { useAppLanguage, useLanguageCatalog, useTranslator } from './i18n/useTranslator';
import { useAnimeStore } from './store/animeStore';
import { useMangaStore } from './store/mangaStore';
import { useProgramsStore } from './store/programsStore';
import { useAppStore, type Tab } from './store/appStore';
import { useBackdropStore } from './store/backdropStore';
import { applyPerformanceMode, rememberPerformanceMode } from './theme/performanceMode';
import { applyTheme, DARK_SCHEME_QUERY, rememberTheme, systemPrefersDark } from './theme/resolveTheme';
import { resolveThemeChoice } from '@shared/themeChoice';
import type { ThemeChoice, ThemeName } from '@shared/types';

export function App() {
    const t = useTranslator();
    const language = useAppLanguage();
    useLanguageCatalog();
    useMouseNavigation();
    useSpatialNavigation();
    useUiSounds();
    useWindowMinimized();
    useSearchShortcuts();
    useSectionTabShortcuts();
    useMainSectionShortcuts();
    const tab = useAppStore((state) => {
        return state.tab;
    });
    const setTab = useAppStore((state) => {
        return state.setTab;
    });
    const init = useAppStore((state) => {
        return state.init;
    });
    const ready = useAppStore((state) => {
        return state.binaries !== null;
    });
    const initAnime = useAnimeStore((state) => {
        return state.init;
    });
    const animeSupported = useAnimeStore((state) => {
        return state.status.supported;
    });
    const initManga = useMangaStore((state) => {
        return state.init;
    });
    const initPrograms = useProgramsStore((state) => {
        return state.init;
    });
    const mangaSupported = useMangaStore((state) => {
        return state.status.supported;
    });
    const visibleTabs = useMemo(() => {
        return SECTION_TABS.filter((item) => {
            return (item.id !== 'anime' || animeSupported) && (item.id !== 'manga' || mangaSupported);
        });
    }, [animeSupported, mangaSupported]);
    const gamepadSections = useMemo<GamepadSections>(() => {
        const ids = visibleTabs.map((item) => {
            return item.id;
        });
        return {
            previous: () => {
                setTab(sectionAfter(ids, useAppStore.getState().tab, -1));
            },
            next: () => {
                setTab(sectionAfter(ids, useAppStore.getState().tab, 1));
            }
        };
    }, [visibleTabs, setTab]);
    useGamepadNavigation(gamepadSections);
    const [menuOpen, setMenuOpen] = useState(false);
    const toggleMenu = useCallback(() => {
        if (!menuOpen && useUiPrefsStore.getState().sounds) {
            playUiSound('open');
        }
        setMenuOpen(!menuOpen);
    }, [menuOpen]);
    const goToSection = useCallback(
        (next: Tab) => {
            withViewTransition(() => {
                setTab(next);
            });
        },
        [setTab]
    );
    const closeMenu = useCallback(() => {
        setMenuOpen(false);
    }, []);
    const clearBackdrop = useBackdropStore((state) => {
        return state.clear;
    });
    useLayoutEffect(() => {
        clearBackdrop();
    }, [tab, clearBackdrop]);

    const themeMode = useAppStore((state) => {
        return state.settings.themeMode;
    });
    const themeFamily = useAppStore((state) => {
        return state.settings.themeFamily;
    });
    const performanceMode = useAppStore((state) => {
        return state.settings.performanceMode;
    });

    const settingsLoaded = useAppStore((state) => {
        return state.settingsLoaded;
    });

    useSectionAccent(tab);
    useEffect(() => {
        if (performanceMode) {
            return undefined;
        }
        return trackPointerForReveal();
    }, [performanceMode]);

    useLayoutEffect(() => {
        if (!settingsLoaded) {
            return;
        }
        applyPerformanceMode(performanceMode);
        rememberPerformanceMode(performanceMode);
    }, [performanceMode, settingsLoaded]);

    const shownTheme = useRef<ThemeName | null>(null);

    useEffect(() => {
        if (!settingsLoaded) {
            return undefined;
        }
        const choice: ThemeChoice = { themeMode, themeFamily };
        if (shownTheme.current === null) {
            shownTheme.current = applyTheme(choice);
        } else {
            const next = resolveThemeChoice(choice, systemPrefersDark());
            if (shownTheme.current !== next) {
                revealTheme(() => {
                    applyTheme(choice);
                });
            }
            shownTheme.current = next;
        }
        rememberTheme(choice);
        if (themeMode !== 'device' || typeof window.matchMedia !== 'function') {
            return undefined;
        }
        const query = window.matchMedia(DARK_SCHEME_QUERY);
        const follow = (): void => {
            shownTheme.current = applyTheme(choice);
        };
        query.addEventListener('change', follow);
        return () => {
            query.removeEventListener('change', follow);
        };
    }, [themeMode, themeFamily, settingsLoaded]);

    useEffect(() => {
        document.documentElement.lang = language;
    }, [language]);

    useEffect(() => {
        let dispose: (() => void) | null = null;
        let cancelled = false;
        void Promise.all([init(), initAnime(), initManga(), initPrograms()]).then(([unsubscribeApp, unsubscribeAnime, unsubscribeManga, unsubscribePrograms]) => {
            const unsubscribe = (): void => {
                unsubscribeApp();
                unsubscribeAnime();
                unsubscribeManga();
                unsubscribePrograms();
            };
            if (cancelled) {
                unsubscribe();
                return;
            }
            dispose = unsubscribe;
            if (!useAnimeStore.getState().status.supported && useAppStore.getState().tab === 'anime') {
                setTab('home');
            }
            if (!useMangaStore.getState().status.supported && useAppStore.getState().tab === 'manga') {
                setTab('home');
            }
        });
        return () => {
            cancelled = true;
            dispose?.();
        };
    }, [init, initAnime, initManga, initPrograms, setTab]);

    return (
        <div className={`app${menuOpen ? ' app--menu-open' : ''}`}>
            <Backdrop />
            <TopBar menuOpen={menuOpen} onToggleMenu={toggleMenu} />
            <UpdateBanner />
            <SideNav tabs={visibleTabs} active={tab} open={menuOpen} onSelect={goToSection} onClose={closeMenu} />
            <main className="app__main" data-section={tab}>
                {!ready && <p className="empty">{t('app.booting')}</p>}
                {ready && tab === 'home' && <HomePanel />}
                {ready && tab === 'downloads' && <DownloadsPanel />}
                {ready && tab === 'anime' && animeSupported && <AnimePanel />}
                {ready && tab === 'manga' && mangaSupported && <MangaPanel />}
                {ready && tab === 'settings' && <SettingsPanel scope="global" />}
            </main>
            <Toast />
            <FocusHalo />
            <FxLayer />
        </div>
    );
}
