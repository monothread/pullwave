import { useEffect } from 'react';
import { arrowsAreOwned } from '../navigation/spatialNavigation';
import { focusField, globalSearchField, isDoubleFind, isFindShortcut, localSearchField } from '../navigation/searchShortcuts';

// Ctrl+F goes to the search of the screen (the cursor is in it, with what it holds selected); on a screen with none it goes to the search of
// the top bar. Ctrl+F again right after goes to the search of the top bar, whatever the screen. The player and the reader have no search and keep
// their keys; a window that is open keeps the focus inside it. Holding the keys down does nothing more than the first press.
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
