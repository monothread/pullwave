import { useEffect } from 'react';
import { useTranslator } from '../i18n/useTranslator';
import { playUiSound } from '../sound/uiSound';
import { useAppStore } from '../store/appStore';
import { useUiPrefsStore } from '../store/uiPrefsStore';
import { burstConfetti } from './confetti';
import { useFxStore } from './fxStore';
import { RUMBLE_DONE, rumbleGamepads } from './gamepadRumble';
import { isKonamiComplete, nextKonamiPosition } from './konami';
import { useButtonRipple } from './useButtonRipple';
import { useCoverTilt } from './useCoverTilt';

function soundsOn(): boolean {
    return useUiPrefsStore.getState().sounds;
}

// What makes the interface play, mounted once at the root: confetti, a chord and a buzz of the gamepad when something finishes, the sound of
// an error, the secret mode of the Konami code, the ripple of the presses and the lean of the tiles.
export function FxLayer() {
    const t = useTranslator();
    const celebrations = useFxStore((state) => {
        return state.celebrations;
    });
    const failures = useFxStore((state) => {
        return state.failures;
    });
    useButtonRipple();
    useCoverTilt();

    useEffect(() => {
        if (celebrations === 0) {
            return;
        }
        burstConfetti();
        rumbleGamepads(RUMBLE_DONE);
        if (soundsOn()) {
            playUiSound('done');
        }
    }, [celebrations]);

    useEffect(() => {
        if (failures > 0 && soundsOn()) {
            playUiSound('error');
        }
    }, [failures]);

    useEffect(() => {
        let position = 0;
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) {
                return;
            }
            position = nextKonamiPosition(position, event.key);
            if (!isKonamiComplete(position)) {
                return;
            }
            position = 0;
            const on = useFxStore.getState().toggleRainbow();
            useFxStore.getState().dance();
            if (on) {
                useAppStore.getState().pushToast(t('fx.konami'));
                burstConfetti({ x: 0.5, y: 0.4 });
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [t]);

    return null;
}
