import { useEffect } from 'react';
import { arrowsAreOwned } from '../navigation/spatialNavigation';
import { focusField, globalSearchField, isDoubleFind, isFindShortcut, localSearchField } from '../navigation/searchShortcuts';

export function useSearchShortcuts(): void {
    useEffect(() => {
        let lastFind = 0;
        const onKeyDown = (event: KeyboardEvent): void => {
            if (!isFindShortcut(event) || arrowsAreOwned()) {
                return;
            }
            event.preventDefault();
            if (event.repeat) {
                return;
            }
            const now = Date.now();
            const twice = isDoubleFind(lastFind, now);
            lastFind = twice ? 0 : now;
            const target = twice ? globalSearchField() : (localSearchField() ?? globalSearchField());
            if (target !== null) {
                focusField(target);
            }
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => {
            window.removeEventListener('keydown', onKeyDown, true);
        };
    }, []);
}
