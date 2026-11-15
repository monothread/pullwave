import { keyedRefresh } from '@renderer/store/keyedRefresh';

interface Pending {
    key: string;
    resolve: () => void;
    reject: (error: Error) => void;
}

function setup() {
    const pending: Pending[] = [];
    const run = vi.fn((key: string) => {
        return new Promise<void>((resolve, reject) => {
            pending.push({ key, resolve, reject });
        });
    });
    return { refresh: keyedRefresh(run), run, pending };
}

async function settled(): Promise<void> {
    await new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

describe('keyedRefresh', () => {
    it('runs a key at once when it is not running', () => {
        const { refresh, run } = setup();
        void refresh('a');
        expect(run).toHaveBeenCalledTimes(1);
        expect(run).toHaveBeenCalledWith('a');
    });

    it('runs different keys side by side', () => {
        const { refresh, run } = setup();
        void refresh('a');
        void refresh('b');
        expect(run.mock.calls).toEqual([['a'], ['b']]);
    });

    it('runs a key once more after it, however many times it was asked for while it ran', async () => {
        const { refresh, run, pending } = setup();
        void refresh('a');
        void refresh('a');
        void refresh('a');
        void refresh('a');
        expect(run).toHaveBeenCalledTimes(1);
        pending[0]?.resolve();
        await settled();
        expect(run.mock.calls).toEqual([['a'], ['a']]);
        pending[1]?.resolve();
        await settled();
        expect(run).toHaveBeenCalledTimes(2);
    });

    it('runs again only the key that was asked for while it ran, not one that runs beside it', async () => {
        const { refresh, run, pending } = setup();
        void refresh('a');
        void refresh('b');
        void refresh('a');
        pending[0]?.resolve();
        pending[1]?.resolve();
        await settled();
        expect(run.mock.calls).toEqual([['a'], ['b'], ['a']]);
    });

    it('runs once more for a request that comes during the run made again', async () => {
        const { refresh, run, pending } = setup();
        void refresh('a');
        void refresh('a');
        pending[0]?.resolve();
        await settled();
        expect(run).toHaveBeenCalledTimes(2);
        void refresh('a');
        pending[1]?.resolve();
        await settled();
        expect(run).toHaveBeenCalledTimes(3);
        pending[2]?.resolve();
        await settled();
        expect(run).toHaveBeenCalledTimes(3);
    });

    it('does not run again when nothing was asked for while it ran', async () => {
        const { refresh, run, pending } = setup();
        void refresh('a');
        pending[0]?.resolve();
        await settled();
        expect(run).toHaveBeenCalledTimes(1);
        void refresh('a');
        expect(run).toHaveBeenCalledTimes(2);
    });

    it('settles every caller only once the last run asked for is over', async () => {
        const { refresh, pending } = setup();
        const order: string[] = [];
        void refresh('a').then(() => {
            order.push('first');
        });
        void refresh('a').then(() => {
            order.push('second');
        });
        pending[0]?.resolve();
        await settled();
        expect(order).toEqual([]);
        pending[1]?.resolve();
        await settled();
        expect(order).toEqual(['first', 'second']);
    });

    it('goes on after a run that failed: the failure is not passed on and the key can run again', async () => {
        const { refresh, run, pending } = setup();
        const done = refresh('a');
        void refresh('a');
        pending[0]?.reject(new Error('gone'));
        await settled();
        expect(run).toHaveBeenCalledTimes(2);
        pending[1]?.resolve();
        await expect(done).resolves.toBeUndefined();
        void refresh('a');
        expect(run).toHaveBeenCalledTimes(3);
    });

    it('goes on after the run made again failed', async () => {
        const { refresh, run, pending } = setup();
        const done = refresh('a');
        void refresh('a');
        pending[0]?.resolve();
        await settled();
        pending[1]?.reject(new Error('gone again'));
        await expect(done).resolves.toBeUndefined();
        void refresh('a');
        expect(run).toHaveBeenCalledTimes(3);
    });
});
