// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { NotFound } from '@renderer/components/NotFound';
import { expectNotFound } from '../../helpers/notFound';

describe('NotFound', () => {
    it('says what found nothing in words, with the lens drawn for the eye only, on a screen by default', () => {
        const { container } = render(<NotFound text="// NOTHING FOUND." />);
        expectNotFound(screen.getByText('// NOTHING FOUND.'), 'screen');
        const lens = container.querySelector('.not-found__lens svg') as SVGElement;
        expect(lens.getAttribute('viewBox')).toBe('0 0 64 64');
        expect(lens.querySelector('circle.not-found__glass')?.getAttribute('r')).toBe('20');
        expect(lens.querySelector('.not-found__cross')?.getAttribute('d')).toBe('M20 20 L34 34 M34 20 L20 34');
        expect(lens.querySelector('line.not-found__handle')?.getAttribute('x2')).toBe('58');
        expect(container.querySelector('.not-found__burst')).not.toBeNull();
    });

    it.each(['screen', 'small', 'tiny'] as const)('is drawn at the size asked for (%s)', (size) => {
        render(<NotFound text="Nothing matches." size={size} />);
        expectNotFound(screen.getByText('Nothing matches.'), size);
    });

    it('gives the screen readers only the words', () => {
        render(<NotFound text="Nothing found." />);
        expect(screen.getByTestId('not-found').textContent).toBe('Nothing found.');
    });
});
