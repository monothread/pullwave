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
