import { useState } from 'react';
import { useBackdropStore } from '../store/backdropStore';

// The pictures drawn after a change of the cover: the new one over the one before, which stays under it while the new one fades in.
export function nextLayers(current: readonly string[], url: string | null): string[] {
    if (url === null) {
        return [];
    }
    if (current[current.length - 1] === url) {
        return [...current];
    }
    return [...current.slice(-1), url];
}

// The cover behind the whole screen, blurred.
export function Backdrop() {
    const url = useBackdropStore((state) => {
        return state.url;
    });
    const [shownUrl, setShownUrl] = useState<string | null>(null);
    const [layers, setLayers] = useState<string[]>([]);
    // The layers follow the cover as the screen is drawn (no effect: a change of state during the render).
    if (url !== shownUrl) {
        setShownUrl(url);
        setLayers(nextLayers(layers, url));
    }

    return (
        <div className={`backdrop${layers.length > 0 ? ' backdrop--shown' : ''}`} aria-hidden="true">
            {layers.map((layer) => {
                return <img key={layer} className="backdrop__image" src={layer} alt="" />;
            })}
        </div>
    );
}
