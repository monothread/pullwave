import type { ReactNode } from 'react';
import { RowLink } from '../components/RowLink';

export interface LibraryCardProps {
    as?: 'li' | 'article';
    className?: string;
    testId?: string;
    ariaLabel?: string;
    cover: ReactNode;
    title: string;
    openLabel: string;
    onOpen: () => void;
    meta?: ReactNode;
    badges?: ReactNode;
    actions?: ReactNode;
}

export function LibraryCard({ as: Wrapper = 'li', className, testId, ariaLabel, cover, title, openLabel, onOpen, meta, badges, actions }: LibraryCardProps) {
    return (
        <Wrapper className={`job job--done series cover-card row--link${className === undefined ? '' : ` ${className}`}`} data-testid={testId} aria-label={ariaLabel}>
            {cover}
            <div className="cover-card__body">
                <header className="job__head">
                    <h3 className="series__title">
                        <RowLink label={openLabel} title={title} onClick={onOpen}>
                            {title}
                        </RowLink>
                    </h3>
                    {meta}
                </header>
                <div className="cover-card__footer">
                    {badges !== undefined && <span className="job__badges">{badges}</span>}
                    {actions !== undefined && <div className="job__actions library__footer">{actions}</div>}
                </div>
            </div>
        </Wrapper>
    );
}
