// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { ListMore } from '@renderer/components/ListMore';

describe('ListMore', () => {
    it('draws nothing once the whole list is drawn', () => {
        const endRef = vi.fn();
        const { container } = render(<ListMore hasMore={false} endRef={endRef} />);
        expect(container).toBeEmptyDOMElement();
        expect(endRef).not.toHaveBeenCalled();
    });

    it('is a hidden box, given to the ref, while some of the list is not drawn', () => {
        const endRef = vi.fn();
        render(<ListMore hasMore endRef={endRef} />);
        const end = screen.getByTestId('list-more');
        expect(end.tagName).toBe('DIV');
        expect(end).toHaveClass('list-more');
        expect(end).toHaveAttribute('aria-hidden', 'true');
        expect(endRef).toHaveBeenCalledWith(end);
    });

    it('is an item of the list when it is asked to be one', () => {
        const endRef = vi.fn();
        render(
            <ul>
                <ListMore hasMore endRef={endRef} as="li" />
            </ul>
        );
        const end = screen.getByTestId('list-more');
        expect(end.tagName).toBe('LI');
        expect(end).toHaveClass('list-more');
        expect(endRef).toHaveBeenCalledWith(end);
    });
});
