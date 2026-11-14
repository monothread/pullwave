// How long a download that is complete stays on the screen of the downloads, green, before it leaves (the history keeps the videos and the
// library the episodes).
export const DONE_LINGER_MS = 5000;

export interface DoneLinger<Key> {
    // Runs `leave` once the download stayed its time; a download given again starts its time again.
    schedule: (key: Key, leave: () => void) => void;
    // The download changed (tried again, removed): it no longer leaves by itself.
    cancel: (key: Key) => void;
}

// The timers of the downloads that are complete and stay for a moment, one per download.
export function createDoneLinger<Key>(): DoneLinger<Key> {
    const timers = new Map<Key, ReturnType<typeof setTimeout>>();
    const cancel = (key: Key): void => {
        const timer = timers.get(key);
        if (timer !== undefined) {
            clearTimeout(timer);
            timers.delete(key);
        }
    };
    return {
        schedule: (key, leave) => {
            cancel(key);
            timers.set(
                key,
                setTimeout(() => {
                    timers.delete(key);
                    leave();
                }, DONE_LINGER_MS)
            );
        },
        cancel
    };
}
