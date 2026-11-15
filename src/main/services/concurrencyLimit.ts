export type ConcurrencyLimit = <Result>(task: () => Promise<Result>) => Promise<Result>;

export function createConcurrencyLimit(limit: number): ConcurrencyLimit {
    const places = Math.max(1, Math.floor(limit));
    const waiting: Array<() => void> = [];
    let running = 0;

    return async <Result>(task: () => Promise<Result>): Promise<Result> => {
        if (running >= places) {
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
