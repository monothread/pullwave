// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { HomeWelcome } from '@renderer/home/HomeWelcome';

describe('HomeWelcome', () => {
    it('welcomes with a title and a hint, and has no button: the ways into the sections are the blocks under it', () => {
        render(<HomeWelcome />);
        const welcome = screen.getByRole('region', { name: 'WELCOME TO PULLWAVE' });
        expect(welcome).toHaveClass('hero', 'hero--welcome');
        expect(within(welcome).getByRole('heading', { level: 2, name: 'WELCOME TO PULLWAVE' })).toHaveClass('hero__title');
        expect(within(welcome).getByText('Paste a link, find an anime or open a manga: what you watch, read and download shows up here.')).toHaveClass('hero__hint');
        expect(within(welcome).queryByRole('button')).not.toBeInTheDocument();
        expect(welcome.querySelector('.hero__actions')).toBeNull();
    });
});
