export function Drawn({ className, text }: { className: string; text: string }) {
    return <span className={`drawn ${className}`} data-text={text} />;
}
