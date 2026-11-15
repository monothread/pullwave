interface WatchedMarkProps {
    label: string;
}

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
