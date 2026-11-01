// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { LoadingMark } from '@renderer/components/LoadingMark';
import { readStylesheet, styleOf, mediaStyleOf } from '../../helpers/cssRules';

describe('LoadingMark', () => {
    it('says what takes a while, as a status for a screen reader, with a ring beside it', () => {
        const { container } = render(<LoadingMark label="Reading the file…" />);
        expect(screen.getByRole('status')).toHaveTextContent('Reading the file…');
        expect(screen.getByRole('status')).toHaveClass('loading-mark');
        const ring = container.querySelector('.loading-mark__ring');
        expect(ring).toHaveAttribute('aria-hidden', 'true');
        expect(ring?.parentElement).toBe(screen.getByRole('status'));
        expect(screen.getByText('Reading the file…')).toHaveClass('loading-mark__label');
    });

    it('takes the words it is given', () => {
        render(<LoadingMark label="CANCELLING…" />);
        expect(screen.getByRole('status')).toHaveTextContent('CANCELLING…');
    });
});

describe('the style of the LoadingMark', () => {
    const sheet = readStylesheet('cyberpunk.css');

    it('turns the ring with the style sheet, in a layer of its own, so it keeps moving while the app is busy', () => {
        const ring = styleOf(sheet, '.loading-mark__ring');
        expect(ring['animation']).toBe('player-spin 0.9s linear infinite');
        expect(ring['will-change']).toBe('transform');
        expect(ring['border-radius']).toBe('50%');
        expect(sheet.atRules.some((block) => { return block.prelude === '@keyframes player-spin'; })).toBe(true);
    });

    it('turns it slowly, and does not stop it, when the system asks for less motion', () => {
        expect(mediaStyleOf(sheet, '(prefers-reduced-motion: reduce)', '.loading-mark__ring')['animation-duration']).toBe('3s');
    });

    it('does not use the code to move it', () => {
        const source = readFileSync(resolve(__dirname, '../../../src/renderer/components/LoadingMark.tsx'), 'utf-8');
        expect(source).not.toMatch(/useEffect|useState|setInterval|setTimeout|requestAnimationFrame/);
    });
});
