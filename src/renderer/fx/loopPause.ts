export const OFFSCREEN_ATTRIBUTE = 'data-offscreen';

const pausedHere = new WeakSet<Animation>();
let windowMinimized = false;

function isLoop(animation: Animation): boolean {
    return animation.effect?.getTiming().iterations === Infinity;
}

function targetOf(animation: Animation): Element | null {
    const effect = animation.effect;
    return effect !== null && 'target' in effect ? (effect as KeyframeEffect).target : null;
}

function mustWait(animation: Animation): boolean {
    if (windowMinimized) {
        return true;
    }
    return targetOf(animation)?.closest(`[${OFFSCREEN_ATTRIBUTE}]`) != null;
}

function loopsOf(root: Document | Element): Animation[] {
    if (typeof root.getAnimations !== 'function') {
        return [];
    }
    const animations = root instanceof Element ? root.getAnimations({ subtree: true }) : root.getAnimations();
    return animations.filter(isLoop);
}

export function settleLoops(root: Document | Element = document): void {
    loopsOf(root).forEach((animation) => {
        if (mustWait(animation)) {
            if (animation.playState === 'running') {
                animation.pause();
                pausedHere.add(animation);
            }
            return;
        }
        if (pausedHere.has(animation)) {
            pausedHere.delete(animation);
            animation.play();
        }
    });
}

function onAnimationStart(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) {
        return;
    }
    if (windowMinimized) {
        settleLoops(document);
        return;
    }
    const card = target.closest(`[${OFFSCREEN_ATTRIBUTE}]`);
    if (card !== null) {
        settleLoops(card);
    }
}

export function watchNewAnimations(root: Document = document): () => void {
    root.addEventListener('animationstart', onAnimationStart, true);
    return () => {
        root.removeEventListener('animationstart', onAnimationStart, true);
    };
}

export function setWindowMinimized(minimized: boolean): void {
    windowMinimized = minimized;
    settleLoops(document);
}

export function isWindowMinimized(): boolean {
    return windowMinimized;
}
