// The pictures of the buttons of the player: characters of the font, each drawn at the size that makes it as big as the biggest (the
// loudspeaker), see `.player__icon--*` in the theme. Hidden from the screen readers: the button says what it does.
export const PLAYER_ICONS = {
    play: '▶',
    pause: '❚❚',
    volume: '🔊',
    mute: '🔇',
    settings: '⚙',
    fullscreen: '⛶'
} as const;

export type PlayerIconName = keyof typeof PLAYER_ICONS;

export function PlayerIcon({ name }: { name: PlayerIconName }) {
    return (
        <span className={`player__icon player__icon--${name}`} aria-hidden="true">
            {PLAYER_ICONS[name]}
        </span>
    );
}
