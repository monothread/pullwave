// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { Backdrop, nextLayers } from '@renderer/components/Backdrop';
import { useBackdropStore } from '@renderer/store/backdropStore';

afterEach(() => {
    useBackdropStore.setState({ url: null });
});

describe('nextLayers', () => {
    it.each([
        [[], 'a', ['a']],
        [['a'], 'b', ['a', 'b']],
        [['a', 'b'], 'c', ['b', 'c']],
        [['a', 'b'], 'b', ['a', 'b']],
        [['a', 'b'], null, []],
        [[], null, []]
    ] as Array<[string[], string | null, string[]]>)('goes from %j with %j to %j', (current, url, expected) => {
        expect(nextLayers(current, url)).toEqual(expected);
    });

    it('does not change the list it was given', () => {
        const current = ['a'];
        nextLayers(current, 'b');
        expect(current).toEqual(['a']);
    });
});

function images(): string[] {
    return Array.from(document.querySelectorAll('.backdrop__image')).map((image) => {
        return image.getAttribute('src') ?? '';
    });
}

describe('Backdrop', () => {
    it('is an empty layer hidden from the screen readers while there is no cover', () => {
        render(<Backdrop />);
        const backdrop = document.querySelector('.backdrop') as HTMLElement;
        expect(backdrop).toHaveAttribute('aria-hidden', 'true');
        expect(backdrop).not.toHaveClass('backdrop--shown');
        expect(images()).toEqual([]);
    });

    it('fades the new cover in over the one before, and empties when the cover goes', () => {
        render(<Backdrop />);
        act(() => {
            useBackdropStore.getState().show('https://img/a.jpg');
        });
        expect(document.querySelector('.backdrop')).toHaveClass('backdrop--shown');
        expect(images()).toEqual(['https://img/a.jpg']);
        act(() => {
            useBackdropStore.getState().show('https://img/b.jpg');
        });
        expect(images()).toEqual(['https://img/a.jpg', 'https://img/b.jpg']);
        act(() => {
            useBackdropStore.getState().show('https://img/c.jpg');
        });
        expect(images()).toEqual(['https://img/b.jpg', 'https://img/c.jpg']);
        document.querySelectorAll('.backdrop__image').forEach((image) => {
            expect(image).toHaveAttribute('alt', '');
        });
        act(() => {
            useBackdropStore.getState().clear();
        });
        expect(images()).toEqual([]);
        expect(document.querySelector('.backdrop')).not.toHaveClass('backdrop--shown');
    });
});
