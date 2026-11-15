import { useState } from 'react';
import { SectionIcon } from '../components/SectionIcon';

interface VideoThumbnailProps {
    src: string;
}

export function VideoThumbnail({ src }: VideoThumbnailProps) {
    const [failed, setFailed] = useState(false);
    if (failed) {
        return (
            <span className="tile__generated">
                <SectionIcon name="downloads" />
            </span>
        );
    }
    return (
        <img
            className="cover download-hero__thumbnail"
            src={src}
            alt=""
            draggable={false}
            onError={() => {
                setFailed(true);
            }}
        />
    );
}
