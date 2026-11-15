// Pauses the animations that loop forever (the pulses of the bars, the glows, the aurora...) while nothing of them can be seen: every one
// while the window is minimized, and those of a card while the card is out of sight. Only the looping ones: an animation that plays once (the
// stamp of a download that ended, the flash of its bar, the drain of a notice, the countdown of the check of a live stream) runs on as it
// always did, so it ends as it would have and stays in step with the timers that go with it. A looping one goes on, when it can be seen again,
// from where it waited: nothing that is seen changes.
//
// It is done through the animations themselves and not through a stylesheet: a stylesheet cannot tell a looping animation from one that
// plays once. Measured with three chapters running on a list of 60, the animations of the cards out of sight kept the window busy at every
// frame; and a minimized window, which Chromium does not tell the page about on Linux, cost as much as one on the screen.

// The attribute of a card while it is out of sight.
export const OFFSCREEN_ATTRIBUTE = 'data-offscreen';

// The animations this module paused, the only ones it plays again (an animation paused by anything else is left as it is).
const pausedHere = new WeakSet<Animation>();
let windowMinimized = false;

function isLoop(animation: Animation): boolean {
    return animation.effect?.getTiming().iterations === Infinity;
}

// The element an animation runs on (the host of a pseudo-element); null for an animation that is not on an element.
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

// The looping animations of the page, or of an element and what is inside it (its pseudo-elements too).
function loopsOf(root: Document | Element): Animation[] {
    if (typeof root.getAnimations !== 'function') {
        return [];
    }
    const animations = root instanceof Element ? root.getAnimations({ subtree: true }) : root.getAnimations();
    return animations.filter(isLoop);
}

// Pauses the looping animations of the page (or of an element) that cannot be seen, and plays again the ones it paused that can.
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

// An animation that starts while the window is minimized, or on a card out of sight (a waiting chapter that starts, the banner of the next
// download), waits at once too. The whole page, or the whole card, is settled, not only the element that started: `animationstart` comes
// once the delay of an animation is over, so siblings with staggered delays (the arrows of the auto scroll of the reader) would each wait
// at the same point of their round and come back in step; settled together they keep their offsets.
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

// Watches the animations that start in the page; the function returned stops watching.
export function watchNewAnimations(root: Document = document): () => void {
    root.addEventListener('animationstart', onAnimationStart, true);
    return () => {
        root.removeEventListener('animationstart', onAnimationStart, true);
    };
}

// The window was minimized or came back.
export function setWindowMinimized(minimized: boolean): void {
    windowMinimized = minimized;
    settleLoops(document);
}

export function isWindowMinimized(): boolean {
    return windowMinimized;
}
