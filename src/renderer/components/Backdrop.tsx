import { useState } from 'react';
import { useBackdropStore } from '../store/backdropStore';

export function nextLayers(current: readonly string[], url: string | null): string[] {
    if (url === null) {
        return [];
    }
    if (current[current.length - 1] === url) {
        return [...current];
    }
    return [...current.slice(-1), url];
}

export function Backdrop() {
    const url = useBackdropStore((state) => {
        return state.url;
    });
    const [shownUrl, setShownUrl] = useState<string | null>(null);
    const [layers, setLayers] = useState<string[]>([]);
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
