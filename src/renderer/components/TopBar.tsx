import { useTranslator } from '../i18n/useTranslator';
import { BinaryStatus } from './BinaryStatus';
import { DownloadsIndicator } from './DownloadsIndicator';
import { GlobalSearch } from './GlobalSearch';
import { SoundToggle } from './SoundToggle';
import { TopBarClock } from './TopBarClock';

// The bars beside the name of the app, which rise and fall like a sound wave.
const BRAND_WAVE_BARS = 5;

function BrandWave() {
    return (
        <span className="brand__wave" aria-hidden="true">
            {Array.from({ length: BRAND_WAVE_BARS }, (_, index) => {
                return <span key={index} className="brand__bar" />;
            })}
        </span>
    );
}

interface TopBarProps {
    menuOpen: boolean;
    onToggleMenu: () => void;
}

// The bar at the top of every screen: the menu, the name, the search, the downloads, the programs and the clock.
export function TopBar({ menuOpen, onToggleMenu }: TopBarProps) {
    const t = useTranslator();
    return (
        <header className="app__header topbar">
            <button type="button" className="topbar__button topbar__menu" aria-label={t(menuOpen ? 'nav.menu.close' : 'nav.menu.open')} aria-expanded={menuOpen} aria-controls="side-nav" onClick={onToggleMenu}>
                <span aria-hidden="true">☰</span>
            </button>
            <div className="brand">
                <BrandWave />
                <h1 className="logo" data-text="PULLWAVE">
                    PULLWAVE
                </h1>
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
