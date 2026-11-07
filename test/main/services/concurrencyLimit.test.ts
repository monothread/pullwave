import { createConcurrencyLimit } from '@main/services/concurrencyLimit';

interface Gate {
    promise: Promise<void>;
    open: () => void;
}

function makeGate(): Gate {
    let open: () => void = () => {
        return undefined;
    };
    const promise = new Promise<void>((resolve) => {
        open = resolve;
    });
    return { promise, open };
}

async function flush(): Promise<void> {
    await new Promise<void>((resolve) => {
        setImmediate(resolve);
    });
}

describe('createConcurrencyLimit', () => {
    it('returns what the task returns', async () => {
        const limit = createConcurrencyLimit(2);
        await expect(
            limit(async () => {
                return 'done';
            })
        ).resolves.toBe('done');
    });

    it('never runs more tasks at once than the limit, and runs all of them', async () => {
        const limit = createConcurrencyLimit(3);
        let running = 0;
        let highest = 0;
        const finished: number[] = [];
        const results = await Promise.all(
            Array.from({ length: 12 }, (_unused, index) => {
                return limit(async () => {
                    running += 1;
                    highest = Math.max(highest, running);
                    await flush();
                    running -= 1;
                    finished.push(index);
                    return index * 2;
                });
            })
        );
        expect(highest).toBe(3);
        expect(running).toBe(0);
        expect(results).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]);
        expect(finished.sort((first, second) => {
            return first - second;
        })).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    });

    it('starts the waiting tasks in the order they were asked for', async () => {
        const limit = createConcurrencyLimit(1);
        const gate = makeGate();
        const started: string[] = [];
        const first = limit(async () => {
            started.push('first');
            await gate.promise;
        });
        const second = limit(async () => {
            started.push('second');
        });
        const third = limit(async () => {
            started.push('third');
        });
        await flush();
        expect(started).toEqual(['first']);
        gate.open();
        await Promise.all([first, second, third]);
        expect(started).toEqual(['first', 'second', 'third']);
    });

    it('does not start a task while all the places are taken', async () => {
        const limit = createConcurrencyLimit(2);
        const gate = makeGate();
        const started: number[] = [];
        const tasks = [1, 2, 3].map((id) => {
            return limit(async () => {
                started.push(id);
                await gate.promise;
            });
        });
        await flush();
        expect(started).toEqual([1, 2]);
        gate.open();
        await Promise.all(tasks);
        expect(started).toEqual([1, 2, 3]);
    });

    it('gives the place of a task that fails to the next one, and passes the failure on', async () => {
        const limit = createConcurrencyLimit(1);
        const failing = limit(async () => {
            throw new Error('boom');
        });
        const next = limit(async () => {
            return 'next';
        });
        await expect(failing).rejects.toThrow('boom');
        await expect(next).resolves.toBe('next');
    });

    it('frees the places when all the tasks end, so a later task starts at once', async () => {
        const limit = createConcurrencyLimit(1);
        await limit(async () => {
            return undefined;
        });
        const gate = makeGate();
        const started: string[] = [];
        const later = limit(async () => {
            started.push('later');
            await gate.promise;
        });
        await flush();
        expect(started).toEqual(['later']);
        gate.open();
        await later;
    });

    it.each([[0], [-4], [0.4]])('runs one task at a time for the limit %d', async (value) => {
        const limit = createConcurrencyLimit(value);
        let running = 0;
        let highest = 0;
        await Promise.all(
            [1, 2, 3].map(() => {
                return limit(async () => {
                    running += 1;
                    highest = Math.max(highest, running);
                    await flush();
                    running -= 1;
                });
            })
        );
        expect(highest).toBe(1);
    });
});
