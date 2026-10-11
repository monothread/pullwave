import { useState } from 'react';

interface MangaCoverProps {
    url: string | null;
}

// The cover of a manga, served by the manga server. When there is none, or it does not load, there is a plain block.
export function MangaCover({ url }: MangaCoverProps) {
    // The address that failed to load, if any: a cover that does not load is shown like one that is not there.
    const [failedUrl, setFailedUrl] = useState<string | null>(null);
    if (url !== null && url !== failedUrl) {
        return (
            <img
                className="cover"
                src={url}
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
