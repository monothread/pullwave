import type { ReactNode } from 'react';

interface RowLinkProps {
    label: string;
    onClick: () => void;
    expanded?: boolean;
    title?: string;
    children: ReactNode;
}

export function RowLink({ label, onClick, expanded, title, children }: RowLinkProps) {
    return (
        <button type="button" className="row-link" aria-label={label} aria-expanded={expanded} title={title} onClick={onClick}>
            <span className="row-link__text">{children}</span>
        </button>
    );
}
