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
import { withViewTransition } from './navigation/viewTransition';
import { playUiSound } from './sound/uiSound';
import { useUiPrefsStore } from './store/uiPrefsStore';
import { sectionAfter } from './navigation/sections';
import { useAppLanguage, useTranslator } from './i18n/useTranslator';
import { useAnimeStore } from './store/animeStore';
import { useMangaStore } from './store/mangaStore';
import { useProgramsStore } from './store/programsStore';
import { useAppStore, type Tab } from './store/appStore';
import { useBackdropStore } from './store/backdropStore';
import { applyTheme, DARK_SCHEME_QUERY, rememberTheme } from './theme/resolveTheme';

export function App() {
    const t = useTranslator();
    const language = useAppLanguage();
    useMouseNavigation();
    useSpatialNavigation();
    useUiSounds();
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
    // The anime section only exists on Linux; elsewhere its tab is left out.
    const animeSupported = useAnimeStore((state) => {
        return state.status.supported;
    });
    const initManga = useMangaStore((state) => {
        return state.init;
    });
    const initPrograms = useProgramsStore((state) => {
        return state.init;
    });
    // The manga section only exists on Linux and Windows (64 bits); elsewhere its tab is left out too.
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
    // A section chosen in the menu slides in.
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
    // The cover behind the screen belongs to the screen it was chosen on. Cleared before the effects of the new screen run (a layout effect
    // runs before every passive one): a screen that shows a cover as it opens, such as the page of a manga the user comes back to, keeps it.
    useLayoutEffect(() => {
        clearBackdrop();
    }, [tab, clearBackdrop]);

    const theme = useAppStore((state) => {
        return state.settings.theme;
    });

    const settingsLoaded = useAppStore((state) => {
        return state.settingsLoaded;
    });

    useSectionAccent(tab);
    useEffect(() => {
        return trackPointerForReveal();
    }, []);

    // The theme the screen shows now: a change after the first one opens as a circle from where the user chose it.
    const shownTheme = useRef<string | null>(null);

    // Until the settings arrive the theme is the default one, which must neither replace the remembered theme that main.tsx already
    // applied nor be remembered in its place.
    useEffect(() => {
        if (!settingsLoaded) {
            return undefined;
        }
        if (shownTheme.current === null) {
            applyTheme(theme);
        } else if (shownTheme.current !== theme) {
            revealTheme(() => {
                applyTheme(theme);
            });
        }
        shownTheme.current = theme;
        rememberTheme(theme);
        if (theme !== 'device' || typeof window.matchMedia !== 'function') {
            return undefined;
        }
        const query = window.matchMedia(DARK_SCHEME_QUERY);
        const follow = (): void => {
            applyTheme('device');
        };
        query.addEventListener('change', follow);
        return () => {
            query.removeEventListener('change', follow);
        };
    }, [theme, settingsLoaded]);

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
