// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';
import { MangaCover } from '@renderer/components/MangaCover';

describe('MangaCover', () => {
    it('shows the cover from the address', () => {
        const { container } = render(<MangaCover url="http://127.0.0.1:4321/api/v1/manga/7/thumbnail" />);
        const image = container.querySelector('img.cover');
        expect(image).toHaveAttribute('src', 'http://127.0.0.1:4321/api/v1/manga/7/thumbnail');
        expect(image).toHaveAttribute('alt', '');
        expect(image).toHaveAttribute('loading', 'lazy');
        expect(image).toHaveAttribute('width', '90');
        expect(image).toHaveAttribute('height', '128');
    });

    it('shows a plain block when there is no cover', () => {
        const { container } = render(<MangaCover url={null} />);
        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('span.cover.cover--none')).not.toBeNull();
    });

    it('shows the plain block when the cover does not load, and tries again for another address', () => {
        const { container, rerender } = render(<MangaCover url="http://127.0.0.1:1/a.jpg" />);
        fireEvent.error(container.querySelector('img')!);
        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('span.cover--none')).not.toBeNull();
        rerender(<MangaCover url="http://127.0.0.1:2/b.jpg" />);
        expect(container.querySelector('img')).toHaveAttribute('src', 'http://127.0.0.1:2/b.jpg');
    });
});
