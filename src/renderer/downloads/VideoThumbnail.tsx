import { useState } from 'react';
import { SectionIcon } from '../components/SectionIcon';

interface VideoThumbnailProps {
    // The address the app serves the picture at (pullwave-thumb://…).
    src: string;
}

// The picture of a video being downloaded, as the app fetched it. A picture that cannot be shown (it left the memory of the app) gives way
// to the picture of the section, as a download without a picture has.
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
