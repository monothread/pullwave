// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LibraryCard, type LibraryCardProps } from '@renderer/library/LibraryCard';
import { installMockApi } from '../../helpers/mockApi';

beforeEach(() => {
    installMockApi();
});

function renderCard(overrides: Partial<LibraryCardProps> = {}) {
    const onOpen = vi.fn();
    const props: LibraryCardProps = {
        cover: <img className="cover" alt="" src="cover.png" />,
        title: 'One Piece',
        openLabel: 'Open: One Piece',
        onOpen,
        ...overrides
    };
    render(
        <ul>
            <LibraryCard {...props} />
        </ul>
    );
    return { onOpen };
}

describe('LibraryCard', () => {
    it('is a list item with the classes every card of the grids has, and nothing else when it is given no extras', () => {
        renderCard();

        const card = screen.getByRole('listitem');
        expect(card.tagName).toBe('LI');
        expect(card.className).toBe('job job--done series cover-card row--link');
        expect(card).not.toHaveAttribute('data-testid');
        expect(card).not.toHaveAttribute('aria-label');
    });

    it('can be an article with its own name, and takes the classes and the test id it is given after its own', () => {
        render(<LibraryCard as="article" className="library__card" testId="the-card" ariaLabel="One Piece" cover={<span className="cover" />} title="One Piece" openLabel="Open: One Piece" onOpen={vi.fn()} />);

        const card = screen.getByTestId('the-card');
        expect(card.tagName).toBe('ARTICLE');
        expect(card.className).toBe('job job--done series cover-card row--link library__card');
        expect(card).toHaveAttribute('aria-label', 'One Piece');
    });

    it('puts the cover first, then the body with the head and the footer, in this order', () => {
        renderCard();

        const card = screen.getByRole('listitem');
        expect(card.children).toHaveLength(2);
        expect(card.firstElementChild).toHaveClass('cover');
        expect(card.firstElementChild).toHaveAttribute('src', 'cover.png');
        const body = card.lastElementChild as HTMLElement;
        expect(body).toHaveClass('cover-card__body');
        expect(body.children).toHaveLength(2);
        expect(body.firstElementChild).toHaveClass('job__head');
        expect(body.lastElementChild).toHaveClass('cover-card__footer');
    });

    it('names the title as the button that opens the card, with the title as its tooltip, and opens it once per click', async () => {
        const user = userEvent.setup();
        const { onOpen } = renderCard();

        const open = screen.getByRole('button', { name: 'Open: One Piece' });
        expect(open).toHaveClass('row-link');
        expect(open).toHaveAttribute('title', 'One Piece');
        expect(open).toHaveTextContent('One Piece');
        expect(screen.getByRole('heading', { level: 3 })).toHaveClass('series__title');
        expect(onOpen).not.toHaveBeenCalled();
        await user.click(open);
        expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it('puts what is said about the card in the head, after the title', () => {
        renderCard({ meta: <span className="history__meta">12 / 30 downloaded</span> });

        const head = screen.getByRole('listitem').querySelector('.job__head') as HTMLElement;
        expect(head.children).toHaveLength(2);
        expect(head.firstElementChild).toHaveClass('series__title');
        expect(head.lastElementChild).toHaveClass('history__meta');
        expect(head.lastElementChild).toHaveTextContent('12 / 30 downloaded');
    });

    it('has no meta, no badges and no actions when it is given none', () => {
        renderCard();

        const card = screen.getByRole('listitem');
        expect((card.querySelector('.job__head') as HTMLElement).children).toHaveLength(1);
        expect((card.querySelector('.cover-card__footer') as HTMLElement).children).toHaveLength(0);
        expect(card.querySelector('.job__badges')).toBeNull();
        expect(card.querySelector('.job__actions')).toBeNull();
    });

    it('puts the badges and then the actions in the footer', () => {
        renderCard({
            badges: (
                <>
                    <span className="badge">AUTOMATIC</span>
                    <span className="badge badge--done">Downloaded</span>
                </>
            ),
            actions: <button type="button">REMOVE</button>
        });

        const footer = screen.getByRole('listitem').querySelector('.cover-card__footer') as HTMLElement;
        expect(footer.children).toHaveLength(2);
        const badges = footer.firstElementChild as HTMLElement;
        expect(badges).toHaveClass('job__badges');
        expect(
            Array.from(badges.children).map((badge) => {
                return [badge.textContent, badge.className];
            })
        ).toEqual([
            ['AUTOMATIC', 'badge'],
            ['Downloaded', 'badge badge--done']
        ]);
        const actions = footer.lastElementChild as HTMLElement;
        expect(actions).toHaveClass('job__actions', 'library__footer');
        expect(within(actions).getByRole('button', { name: 'REMOVE' })).toBeInTheDocument();
    });

    it('keeps the actions without a row of badges, and the badges without a row of actions', () => {
        const { unmount } = render(<LibraryCard cover={<span className="cover" />} title="A" openLabel="Open: A" onOpen={vi.fn()} actions={<button type="button">REMOVE</button>} />);
        let footer = document.querySelector('.cover-card__footer') as HTMLElement;
        expect(footer.querySelector('.job__badges')).toBeNull();
        expect(footer.querySelector('.job__actions')).not.toBeNull();
        unmount();

        render(<LibraryCard cover={<span className="cover" />} title="A" openLabel="Open: A" onOpen={vi.fn()} badges={<span className="badge">NEW</span>} />);
        footer = document.querySelector('.cover-card__footer') as HTMLElement;
        expect(footer.querySelector('.job__badges')).not.toBeNull();
        expect(footer.querySelector('.job__actions')).toBeNull();
    });
});
