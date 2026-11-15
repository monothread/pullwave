import { useEffect } from 'react';
import type { Tab } from '../store/appStore';

export function useSectionAccent(tab: Tab): void {
    useEffect(() => {
        document.documentElement.dataset.section = tab;
        return () => {
            delete document.documentElement.dataset.section;
        };
    }, [tab]);
}
