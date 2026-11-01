import { useTranslator } from '../i18n/useTranslator';
import { useUiPrefsStore } from '../store/uiPrefsStore';

// The button of the top bar that turns the sounds of the navigation on and off.
export function SoundToggle() {
    const t = useTranslator();
    const sounds = useUiPrefsStore((state) => {
        return state.sounds;
    });
    const toggleSounds = useUiPrefsStore((state) => {
        return state.toggleSounds;
    });
    return (
        <button type="button" className="topbar__button sound-toggle" aria-pressed={sounds} aria-label={t(sounds ? 'sound.on' : 'sound.off')} title={t(sounds ? 'sound.on' : 'sound.off')} onClick={toggleSounds}>
            <span aria-hidden="true">{sounds ? '🔊︎' : '🔇︎'}</span>
        </button>
    );
}
