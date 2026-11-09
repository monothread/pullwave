import type { ReactNode } from 'react';
import { RowLink } from '../components/RowLink';

export interface LibraryCardProps {
    // The element of the card: a list item inside a list, or an article inside a plain grid.
    as?: 'li' | 'article';
    // The classes of the card beyond the ones every card has.
    className?: string;
    testId?: string;
    ariaLabel?: string;
    // The cover, which is the first thing in the card (the grid shows the card as its cover with the rest under it).
    cover: ReactNode;
    title: string;
    // What the title says to the screen readers: it is the button that opens the card.
    openLabel: string;
    onOpen: () => void;
    // What goes next to the title, under it: the progress, or what the line of a list was about.
    meta?: ReactNode;
    // The badges at the bottom of the card; left out, there is no row of badges.
    badges?: ReactNode;
    // What can be done to what the card stands for, under the badges; left out, there is no row of buttons.
    actions?: ReactNode;
}

// The card of the grids of covers, the same in the libraries, the updates and the history of the manga and of the anime: the cover, the name
// (the way into what the card stands for), what is said about it, the badges and what can be done to it.
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
