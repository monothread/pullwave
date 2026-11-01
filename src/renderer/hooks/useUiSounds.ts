import { useEffect } from 'react';
import { isNavigable } from '../navigation/spatialNavigation';
import { playUiSound, type UiSound } from '../sound/uiSound';
import { useUiPrefsStore } from '../store/uiPrefsStore';
import { MOUSE_BACK_BUTTON } from './useMouseNavigation';

// A focus that follows a press of the mouse is not a move of the navigation: it makes no sound of its own.
export const POINTER_FOCUS_MS = 400;
// Two moves closer than this make one sound (holding an arrow down).
export const MOVE_SOUND_GAP_MS = 60;

const PRESSABLE_SELECTOR = 'button, [role="button"], a[href], summary, [role="option"]';

// The sounds of the navigation, while they are on: a tick when the focus moves to a control with the keyboard or a gamepad, a press when a
// control is clicked, and a falling sound to go back (Esc, the back button of the mouse).
export function useUiSounds(): void {
    useEffect(() => {
        let lastPointer = 0;
        let lastMove = 0;
        const play = (sound: UiSound): void => {
            if (useUiPrefsStore.getState().sounds) {
                playUiSound(sound);
            }
        };
        const onPointerDown = (): void => {
            lastPointer = Date.now();
        };
        const onFocusIn = (event: FocusEvent): void => {
            const now = Date.now();
            if (!isNavigable(event.target as Element | null) || now - lastPointer < POINTER_FOCUS_MS || now - lastMove < MOVE_SOUND_GAP_MS) {
                return;
            }
            lastMove = now;
            play('move');
        };
        const onClick = (event: MouseEvent): void => {
            if (event.target instanceof Element && event.target.closest(PRESSABLE_SELECTOR) !== null) {
                play('select');
            }
        };
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                play('back');
            }
        };
        const onMouseUp = (event: MouseEvent): void => {
            if (event.button === MOUSE_BACK_BUTTON) {
                play('back');
            }
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('focusin', onFocusIn);
        document.addEventListener('click', onClick, true);
        document.addEventListener('keydown', onKeyDown);
        window.addEventListener('mouseup', onMouseUp);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('focusin', onFocusIn);
            document.removeEventListener('click', onClick, true);
            document.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, []);
}
