import { useEffect, useState, type RefObject } from 'react';

export const CONTROLS_IDLE_MS = 3000;

export function useFullscreenIdle(video: RefObject<HTMLVideoElement | null>): boolean {
    const [hidden, setHidden] = useState(false);

    useEffect(() => {
        const stage = video.current?.parentElement;
        if (!stage) {
            return undefined;
        }
        let timer: ReturnType<typeof setTimeout> | null = null;
        const clearTimer = (): void => {
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
        };
        const onMouseMove = (): void => {
            clearTimer();
            setHidden(false);
            timer = setTimeout(() => {
                timer = null;
                setHidden(true);
            }, CONTROLS_IDLE_MS);
        };
        const onFullscreenChange = (): void => {
            if (document.fullscreenElement === stage) {
                stage.addEventListener('mousemove', onMouseMove);
                onMouseMove();
            } else {
                stage.removeEventListener('mousemove', onMouseMove);
                clearTimer();
                setHidden(false);
            }
        };
        document.addEventListener('fullscreenchange', onFullscreenChange);
        onFullscreenChange();
        return () => {
            document.removeEventListener('fullscreenchange', onFullscreenChange);
            stage.removeEventListener('mousemove', onMouseMove);
            clearTimer();
        };
    }, [video]);

    return hidden;
}
