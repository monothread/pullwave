// Runs a task at once only while fewer than `limit` of the tasks given to the same limiter are running; the others wait their turn, in the
// order they came. A task that fails gives its place to the next one, and the failure goes to whoever asked for it.
export type ConcurrencyLimit = <Result>(task: () => Promise<Result>) => Promise<Result>;

export function createConcurrencyLimit(limit: number): ConcurrencyLimit {
    const places = Math.max(1, Math.floor(limit));
    const waiting: Array<() => void> = [];
    let running = 0;

    return async <Result>(task: () => Promise<Result>): Promise<Result> => {
        if (running >= places) {
            // The place of the task that finishes is handed over as it is, so `running` never goes above the limit.
            await new Promise<void>((resolve) => {
                waiting.push(resolve);
            });
        } else {
            running += 1;
        }
        try {
            return await task();
        } finally {
            const next = waiting.shift();
            if (next) {
                next();
            } else {
                running -= 1;
            }
        }
    };
}
