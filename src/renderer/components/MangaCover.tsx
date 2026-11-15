import { useState } from 'react';
import { useImageReveal } from '../fx/useImageReveal';

interface MangaCoverProps {
    url: string | null;
}

export function MangaCover({ url }: MangaCoverProps) {
    const [failedUrl, setFailedUrl] = useState<string | null>(null);
    const reveal = useImageReveal();
    if (url !== null && url !== failedUrl) {
        return (
            <img
                className={reveal.className('cover')}
                src={url}
                onLoad={reveal.onLoad}
                alt=""
                loading="lazy"
                width={90}
                height={128}
                onError={() => {
                    setFailedUrl(url);
                }}
            />
        );
    }
    return <span className="cover cover--none" />;
}
