interface LoadingMarkProps {
    // What is going on, in words: it is what a screen reader says, and what the user reads beside the mark.
    label: string;
}

// A turning ring and the words for what takes a while, so the user knows the app did not freeze. The ring is turned by the style sheet (not
// by the code), so it keeps moving while the rest of the app is busy.
export function LoadingMark({ label }: LoadingMarkProps) {
    return (
        <span className="loading-mark" role="status">
            <span className="loading-mark__ring" aria-hidden="true" />
            <span className="loading-mark__label">{label}</span>
        </span>
    );
}
