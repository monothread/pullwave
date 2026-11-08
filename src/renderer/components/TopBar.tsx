import { BrandWave, useLogoClicks } from '../fx/BrandWave';
import { useTranslator } from '../i18n/useTranslator';
import { BinaryStatus } from './BinaryStatus';
import { DownloadsIndicator } from './DownloadsIndicator';
import { GlobalSearch } from './GlobalSearch';
import { SoundToggle } from './SoundToggle';
import { TopBarClock } from './TopBarClock';

interface TopBarProps {
    menuOpen: boolean;
    onToggleMenu: () => void;
}

// The bar at the top of every screen: the menu, the name, the search, the downloads, the programs and the clock.
export function TopBar({ menuOpen, onToggleMenu }: TopBarProps) {
    const t = useTranslator();
    const onBrandClick = useLogoClicks();
    return (
        <header className="app__header topbar">
            {/* The menu and the name share the start of the bar, as wide as its end, so the search is in the middle of the window. */}
            <div className="topbar__start">
                <button type="button" className="topbar__button topbar__menu" aria-label={t(menuOpen ? 'nav.menu.close' : 'nav.menu.open')} aria-expanded={menuOpen} aria-controls="side-nav" onClick={onToggleMenu}>
                    <span aria-hidden="true">☰</span>
                </button>
                <div className="brand" onClick={onBrandClick}>
                    <BrandWave />
                    <h1 className="logo" data-text="PULLWAVE">
                        PULLWAVE
                    </h1>
                </div>
            </div>
            <GlobalSearch />
            <div className="topbar__end">
                <DownloadsIndicator />
                <SoundToggle />
                <BinaryStatus />
                <TopBarClock />
            </div>
        </header>
    );
}
