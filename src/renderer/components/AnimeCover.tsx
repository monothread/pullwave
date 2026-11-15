import { useEffect, useState } from 'react';
import { useImageReveal } from '../fx/useImageReveal';
import { useTranslator } from '../i18n/useTranslator';
import { coverKey, useAnimeStore } from '../store/animeStore';

interface AnimeCoverProps {
    title: string;
    url?: string | null;
    onBroken?: () => void;
}

export function AnimeCover({ title, url, onBroken }: AnimeCoverProps) {
    const t = useTranslator();
    const loadCover = useAnimeStore((state) => {
        return state.loadCover;
    });
    const found = useAnimeStore((state) => {
        return state.covers[coverKey(title)];
    });
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
    const settled = lookUp ? found !== undefined : true;
    return <span className="cover cover--none">{settled ? t('anime.cover.none') : ''}</span>;
}
