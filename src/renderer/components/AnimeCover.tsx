import { useEffect, useState } from 'react';
import { useImageReveal } from '../fx/useImageReveal';
import { useTranslator } from '../i18n/useTranslator';
import { coverKey, useAnimeStore } from '../store/animeStore';

interface AnimeCoverProps {
    title: string;
    // The cover when it is already known (null: there is none); left out, it is looked up by the title.
    url?: string | null;
    // Told when the picture of the cover does not load, so whoever shows the cover can look for another one.
    onBroken?: () => void;
}

// The cover of an anime, to tell it apart at a glance. While it is being looked for there is a plain block; when it is not found (or
// could not be asked for, or does not load) the block says so.
export function AnimeCover({ title, url, onBroken }: AnimeCoverProps) {
    const t = useTranslator();
    const loadCover = useAnimeStore((state) => {
        return state.loadCover;
    });
    const found = useAnimeStore((state) => {
        return state.covers[coverKey(title)];
    });
    // The address that failed to load, if any: a cover that does not load is told like one that was not found.
    const [failedUrl, setFailedUrl] = useState<string | null>(null);
    const lookUp = url === undefined;
    const reveal = useImageReveal();

    useEffect(() => {
        if (lookUp) {
            void loadCover(title);
        }
    }, [lookUp, loadCover, title]);

    const source = lookUp ? (found?.status === 'found' ? found.url : null) : url;
    if (typeof source === 'string' && source !== failedUrl) {
        return (
            <img
                className={reveal.className('cover')}
                src={source}
                onLoad={reveal.onLoad}
                alt=""
                loading="lazy"
                width={90}
                height={128}
                onError={() => {
                    setFailedUrl(source);
                    onBroken?.();
                }}
            />
        );
    }
    // Still being looked for: nothing is said yet.
    const settled = lookUp ? found !== undefined : true;
    return <span className="cover cover--none">{settled ? t('anime.cover.none') : ''}</span>;
}
