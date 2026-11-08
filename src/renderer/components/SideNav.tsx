import { useEffect, useRef } from 'react';
import type { MessageKey } from '@shared/i18n';
import { useTranslator } from '../i18n/useTranslator';
import type { Tab } from '../store/appStore';
import { SectionIcon, type SectionIconName } from './SectionIcon';
import { TabButton } from './TabButton';

export interface SectionTab {
    id: Tab;
    label: MessageKey;
    // The picture shown before the label.
    picture: SectionIconName;
}

export const SECTION_TABS: readonly SectionTab[] = [
    { id: 'home', label: 'tab.home', picture: 'home' },
    { id: 'downloads', label: 'tab.downloads', picture: 'downloads' },
    { id: 'anime', label: 'tab.anime', picture: 'anime' },
    { id: 'manga', label: 'tab.manga', picture: 'manga' },
    { id: 'settings', label: 'tab.settings', picture: 'settings' }
];

interface SideNavProps {
    tabs: readonly SectionTab[];
    active: Tab;
    // The menu is open: the rail of pictures widens and shows the names.
    open: boolean;
    onSelect: (tab: Tab) => void;
    onClose: () => void;
}

// The menu of the sections on the left, as on a console: a rail of pictures that is always there and that widens over the screen with
// the names when it is opened (☰ in the top bar). Esc or a choice closes it.
export function SideNav({ tabs, active, open, onSelect, onClose }: SideNavProps) {
    const t = useTranslator();
    const navRef = useRef<HTMLElement>(null);

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        navRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                onClose();
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open, onClose]);

    return (
        <>
            <nav ref={navRef} id="side-nav" className={`tabs tabs--main sidenav${open ? ' sidenav--open' : ''}`} aria-label={t('nav.sections')}>
                {tabs.map((item) => {
                    return (
                        <TabButton
                            key={item.id}
                            label={t(item.label)}
                            decoration={<SectionIcon name={item.picture} />}
                            active={active === item.id}
                            sectionId={item.id}
                            pillId="nav-pill"
                            onClick={() => {
                                onSelect(item.id);
                                onClose();
                            }}
                        />
                    );
                })}
            </nav>
            {open && <div className="sidenav__scrim" aria-hidden="true" onClick={onClose} />}
        </>
    );
}
