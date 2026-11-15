import { useEffect } from 'react';
import { directionOfKey, moveFocus, shouldMoveFocus } from '../navigation/spatialNavigation';

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
