export const DONE_LINGER_MS = 5000;

export interface DoneLinger<Key> {
    schedule: (key: Key, leave: () => void) => void;
    cancel: (key: Key) => void;
}

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
