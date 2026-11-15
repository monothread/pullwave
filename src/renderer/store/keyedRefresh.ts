// Runs a refresh of one key (a manga, an anime) at most once at a time: a request that comes while that key is being refreshed does not start
// another run but makes one more after it (however many come meanwhile), so the last state is always fetched and no two runs of the same key
// overlap. Different keys run side by side.
export type KeyedRefresh<K> = (key: K) => Promise<void>;

export function keyedRefresh<K>(run: (key: K) => Promise<void>): KeyedRefresh<K> {
    const running = new Map<K, Promise<void>>();
    const again = new Set<K>();

    const start = (key: K): Promise<void> => {
        const current = run(key)
            .catch(() => {
                return undefined;
            })
            .then(() => {
                running.delete(key);
                if (again.delete(key)) {
                    return start(key);
                }
                return undefined;
            });
        running.set(key, current);
        return current;
    };

    return (key: K) => {
        const current = running.get(key);
        if (current !== undefined) {
            again.add(key);
            return current;
        }
        return start(key);
    };
}
