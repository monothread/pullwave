// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { Drawn } from '@renderer/components/Drawn';

describe('Drawn', () => {
    it('keeps its words in data-text, for the theme to draw, and writes none', () => {
        const { container } = render(<Drawn className="tile__title" text="Naruto" />);
        const span = container.querySelector('span') as HTMLElement;
        expect(span).toHaveClass('drawn', 'tile__title');
        expect(span).toHaveAttribute('data-text', 'Naruto');
        expect(span).toBeEmptyDOMElement();
        expect(screen.queryByText('Naruto')).not.toBeInTheDocument();
    });
});
