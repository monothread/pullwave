// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { PLAYER_ICONS, PlayerIcon, type PlayerIconName } from '@renderer/components/PlayerIcon';

describe('PLAYER_ICONS', () => {
    it('has the character of each button of the player', () => {
        expect(PLAYER_ICONS).toEqual({ play: '▶', pause: '❚❚', volume: '🔊', mute: '🔇', settings: '⚙', fullscreen: '⛶' });
    });
});

describe('PlayerIcon', () => {
    it.each(Object.keys(PLAYER_ICONS) as PlayerIconName[])('draws the %s icon with the class of its size, hidden from the screen readers', (name) => {
        const { container } = render(<PlayerIcon name={name} />);
        const icon = container.firstElementChild as HTMLElement;
        expect(icon.tagName).toBe('SPAN');
        expect(icon).toHaveClass('player__icon', `player__icon--${name}`);
        expect(icon.className).toBe(`player__icon player__icon--${name}`);
        expect(icon).toHaveAttribute('aria-hidden', 'true');
        expect(icon).toHaveTextContent(PLAYER_ICONS[name]);
    });
});
