interface WatchedMarkProps {
    // What the mark says, already translated: WATCHED for an episode, Read for a chapter.
    label: string;
}

// The seal of an episode or a chapter that was already watched or read: a ✓ and the word, in a pill that is seen from across the screen.
// The screen readers get the label once, from the image; the ✓ and the word are the picture of it.
export function WatchedMark({ label }: WatchedMarkProps) {
    return (
        <span className="watched-mark" role="img" aria-label={label} title={label}>
            <span className="watched-mark__check" aria-hidden="true">
                ✓
            </span>
            <span className="watched-mark__label" aria-hidden="true">
                {label}
            </span>
        </span>
    );
}
