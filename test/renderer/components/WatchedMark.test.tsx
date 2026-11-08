// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { WatchedMark } from '@renderer/components/WatchedMark';

describe('WatchedMark', () => {
    it('is one image for the screen readers, named by its label, with a tooltip of the same words', () => {
        render(<WatchedMark label="WATCHED" />);
        const mark = screen.getByRole('img', { name: 'WATCHED' });
        expect(mark).toHaveClass('watched-mark');
        expect(mark).toHaveAttribute('aria-label', 'WATCHED');
        expect(mark).toHaveAttribute('title', 'WATCHED');
        expect(screen.getAllByRole('img')).toHaveLength(1);
    });

    it('draws a ✓ and the word, both hidden from the screen readers so the label is read once', () => {
        const { container } = render(<WatchedMark label="Read" />);
        const check = container.querySelector('.watched-mark__check') as HTMLElement;
        const label = container.querySelector('.watched-mark__label') as HTMLElement;
        expect(check).toHaveTextContent('✓');
        expect(check).toHaveAttribute('aria-hidden', 'true');
        expect(label).toHaveTextContent('Read');
        expect(label).toHaveAttribute('aria-hidden', 'true');
        expect(container.querySelector('.watched-mark')).toHaveTextContent('✓Read');
        expect(container.querySelectorAll('.watched-mark > *')).toHaveLength(2);
    });

    it('says whatever label it is given', () => {
        render(<WatchedMark label="視聴済み" />);
        expect(screen.getByRole('img', { name: '視聴済み' })).toHaveAttribute('title', '視聴済み');
        expect(screen.getByRole('img', { name: '視聴済み' })).toHaveTextContent('✓視聴済み');
    });
});
