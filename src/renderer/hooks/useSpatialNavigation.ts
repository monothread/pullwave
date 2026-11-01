import { useEffect } from 'react';
import { directionOfKey, moveFocus, shouldMoveFocus } from '../navigation/spatialNavigation';

// The arrow keys move the focus between the controls of the screen, like the directional pad of a console, while a control has it. A field
// keeps its arrows, and so do the player and the reader.
export function useSpatialNavigation(): void {
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent): void => {
            const active = document.activeElement;
            if (!shouldMoveFocus(event, active)) {
                return;
            }
            const direction = directionOfKey(event.key);
            if (direction !== null && moveFocus(active, direction)) {
                event.preventDefault();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
        };
    }, []);
}
