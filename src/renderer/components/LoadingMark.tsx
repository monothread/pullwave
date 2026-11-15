interface LoadingMarkProps {
    label: string;
}

export function LoadingMark({ label }: LoadingMarkProps) {
    return (
        <span className="loading-mark" role="status">
            <span className="loading-mark__ring" aria-hidden="true" />
            <span className="loading-mark__label">{label}</span>
        </span>
    );
}
