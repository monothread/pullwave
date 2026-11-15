export const KONAMI_SEQUENCE: readonly string[] = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

export const LOGO_CLICKS = 5;
export const LOGO_CLICK_WINDOW_MS = 1500;

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

export function isLogoFlurry(times: readonly number[], now: number): boolean {
    const recent = times.filter((time) => {
        return now - time <= LOGO_CLICK_WINDOW_MS;
    });
    return recent.length >= LOGO_CLICKS;
}
