// The Konami code: ↑ ↑ ↓ ↓ ← → ← → B A. It turns on the secret mode of the wave of the name.
export const KONAMI_SEQUENCE: readonly string[] = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

// How many clicks on the name make the wave dance, and how close in time they have to be.
export const LOGO_CLICKS = 5;
export const LOGO_CLICK_WINDOW_MS = 1500;

// The position in the code after a key: it goes on when the key is the next one, starts again from the first when it is the first, and is lost otherwise.
export function nextKonamiPosition(position: number, key: string): number {
    const normal = key.length === 1 ? key.toLowerCase() : key;
    if (normal === KONAMI_SEQUENCE[position]) {
        return position + 1;
    }
    return normal === KONAMI_SEQUENCE[0] ? 1 : 0;
}

export function isKonamiComplete(position: number): boolean {
    return position >= KONAMI_SEQUENCE.length;
}

// Whether the last clicks (their times) hold enough close ones to count as a dance.
export function isLogoFlurry(times: readonly number[], now: number): boolean {
    const recent = times.filter((time) => {
        return now - time <= LOGO_CLICK_WINDOW_MS;
    });
    return recent.length >= LOGO_CLICKS;
}
