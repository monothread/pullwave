export const PLAYER_ICONS = {
    play: '▶',
    pause: '❚❚',
    volume: '🔊',
    'volume-low': '🔉',
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
