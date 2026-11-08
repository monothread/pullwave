// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { FlipText } from '@renderer/fx/FlipText';

describe('FlipText', () => {
    it('draws every character in its own element and reads like the plain text', () => {
        const { container } = render(<time>{<FlipText text="12:34 PM" />}</time>);
        const chars = Array.from(container.querySelectorAll('.flip__char'));
        expect(chars.map((char) => { return char.textContent; })).toEqual(['1', '2', ':', '3', '4', ' ', 'P', 'M']);
        expect(container.textContent).toBe('12:34 PM');
    });

    it('draws nothing for an empty text', () => {
        const { container } = render(<FlipText text="" />);
        expect(container.querySelectorAll('.flip__char')).toHaveLength(0);
    });

    it('keeps the elements of the characters that did not change and makes new ones for those that did', () => {
        const { container, rerender } = render(<FlipText text="12:34" />);
        const before = Array.from(container.querySelectorAll('.flip__char'));
        rerender(<FlipText text="12:35" />);
        const after = Array.from(container.querySelectorAll('.flip__char'));
        expect(after.slice(0, 4)).toEqual(before.slice(0, 4));
        expect(after[4]).not.toBe(before[4]);
        expect(after[4]?.textContent).toBe('5');
    });
});
