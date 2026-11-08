import { useEffect } from 'react';
import type { Tab } from '../store/appStore';

// The section on <html>, so the colour of the aurora follows the section the user is in (see bp-fun.css).
export function useSectionAccent(tab: Tab): void {
    useEffect(() => {
        document.documentElement.dataset.section = tab;
        return () => {
            delete document.documentElement.dataset.section;
        };
    }, [tab]);
}
