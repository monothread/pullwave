import type { SubtitleTranslateRequest, SubtitleTranslateResponse, SubtitleTranslationJob } from '@shared/anime';
import { SubtitleTranslationQueue, type SubtitleTranslationQueueDependencies } from '@main/services/subtitleTranslationQueue';

const SPANISH = (episodeId: number): SubtitleTranslateRequest => {
    return { episodeId, trackId: null, language: 'Spanish' };
};

const DONE: SubtitleTranslateResponse = {
    ok: true,
    tracks: [{ id: 'translated-Spanish', label: 'Spanish', kind: 'translated' }],
    translated: { id: 'translated-Spanish', label: 'Spanish', kind: 'translated' }
};

interface Pending {
    request: SubtitleTranslateRequest;
    onProgress: (done: number, total: number) => void;
    signal: AbortSignal;
    finish: (response: SubtitleTranslateResponse) => void;
    fail: (error: unknown) => void;
}

// A queue whose translations end when the test says so.
function setup(concurrency?: number) {
    const pending: Pending[] = [];
    const updates: SubtitleTranslationJob[] = [];
    const run = vi.fn((request: SubtitleTranslateRequest, onProgress: (done: number, total: number) => void, signal: AbortSignal): Promise<SubtitleTranslateResponse> => {
        return new Promise((resolve, reject) => {
            pending.push({ request, onProgress, signal, finish: resolve, fail: reject });
        });
    });
    const dependencies: SubtitleTranslationQueueDependencies = {
        run,
        onJobUpdate: (job) => {
            updates.push(job);
        },
        concurrency
    };
    return { queue: new SubtitleTranslationQueue(dependencies), pending, updates, run };
}

describe('SubtitleTranslationQueue', () => {
    it('is empty at first', () => {
        expect(setup().queue.list()).toEqual([]);
    });

    it('queues an episode, starts it and tells each step', async () => {
        const { queue, pending, updates, run } = setup();
        const answer = queue.enqueue(SPANISH(4));
        expect(run).toHaveBeenCalledTimes(1);
        expect(run.mock.calls[0]?.[0]).toEqual(SPANISH(4));
        expect(typeof run.mock.calls[0]?.[1]).toBe('function');
        expect(run.mock.calls[0]?.[2]).toBe(pending[0]?.signal);
        expect(queue.list()).toEqual([{ episodeId: 4, language: 'Spanish', status: 'running', done: 0, total: 0, reason: null }]);
        pending[0]?.onProgress(3, 10);
        expect(queue.list()).toEqual([{ episodeId: 4, language: 'Spanish', status: 'running', done: 3, total: 10, reason: null }]);
        pending[0]?.finish(DONE);
        expect(await answer).toEqual(DONE);
        expect(queue.list()).toEqual([]);
        expect(updates).toEqual([
            { episodeId: 4, language: 'Spanish', status: 'queued', done: 0, total: 0, reason: null },
            { episodeId: 4, language: 'Spanish', status: 'running', done: 0, total: 0, reason: null },
            { episodeId: 4, language: 'Spanish', status: 'running', done: 3, total: 10, reason: null },
            { episodeId: 4, language: 'Spanish', status: 'done', done: 3, total: 10, reason: null }
        ]);
    });

    it('does one episode at a time by default, and starts the next when one ends', async () => {
        const { queue, pending, run } = setup();
        const first = queue.enqueue(SPANISH(1));
        const second = queue.enqueue(SPANISH(2));
        expect(run).toHaveBeenCalledTimes(1);
        expect(queue.list().map((job) => {
            return [job.episodeId, job.status];
        })).toEqual([[1, 'running'], [2, 'queued']]);
        pending[0]?.finish(DONE);
        await first;
        expect(run).toHaveBeenCalledTimes(2);
        expect(run.mock.calls[1]?.[0]).toEqual(SPANISH(2));
        pending[1]?.finish(DONE);
        await second;
        expect(queue.list()).toEqual([]);
    });

    it('does as many at once as the concurrency says', () => {
        const { queue, run } = setup(2);
        void queue.enqueue(SPANISH(1));
        void queue.enqueue(SPANISH(2));
        void queue.enqueue(SPANISH(3));
        expect(run).toHaveBeenCalledTimes(2);
        expect(queue.list().map((job) => {
            return job.status;
        })).toEqual(['running', 'running', 'queued']);
    });

    it('says an episode that is being translated is busy, without queueing it again', async () => {
        const { queue, run, updates } = setup();
        void queue.enqueue(SPANISH(1));
        expect(await queue.enqueue({ episodeId: 1, trackId: 'subtitle-French', language: 'German' })).toEqual({ ok: false, reason: 'busy' });
        expect(run).toHaveBeenCalledTimes(1);
        expect(queue.list()).toHaveLength(1);
        expect(updates.filter((job) => {
            return job.language === 'German';
        })).toEqual([]);
    });

    it('takes the episode again once its translation ended', async () => {
        const { queue, pending, run } = setup();
        const first = queue.enqueue(SPANISH(1));
        pending[0]?.finish(DONE);
        await first;
        void queue.enqueue(SPANISH(1));
        expect(run).toHaveBeenCalledTimes(2);
    });

    describe('how an episode ends', () => {
        it('says it failed, with what the provider said', async () => {
            const { queue, pending, updates } = setup();
            const answer = queue.enqueue(SPANISH(1));
            const failed: SubtitleTranslateResponse = { ok: false, reason: 'failed', error: { code: 'INVALID_TOKEN', raw: 'bad key' } };
            pending[0]?.finish(failed);
            expect(await answer).toEqual(failed);
            expect(updates.at(-1)).toEqual({ episodeId: 1, language: 'Spanish', status: 'error', done: 0, total: 0, reason: 'INVALID_TOKEN: bad key' });
        });

        it.each(['missing', 'no-source', 'no-token', 'no-model', 'no-address', 'unreadable', 'too-large', 'empty', 'busy'] as const)('says it failed for "%s", with that reason', async (reason) => {
            const { queue, pending, updates } = setup();
            const answer = queue.enqueue(SPANISH(1));
            pending[0]?.finish({ ok: false, reason });
            expect(await answer).toEqual({ ok: false, reason });
            expect(updates.at(-1)).toEqual({ episodeId: 1, language: 'Spanish', status: 'error', done: 0, total: 0, reason });
        });

        it('says it was cancelled when the translation answers that it was', async () => {
            const { queue, pending, updates } = setup();
            const answer = queue.enqueue(SPANISH(1));
            pending[0]?.finish({ ok: false, reason: 'cancelled' });
            expect(await answer).toEqual({ ok: false, reason: 'cancelled' });
            expect(updates.at(-1)).toEqual({ episodeId: 1, language: 'Spanish', status: 'cancelled', done: 0, total: 0, reason: 'cancelled' });
        });

        it('turns what the translation throws into a failure and goes on with the next one', async () => {
            const { queue, pending, updates, run } = setup();
            const first = queue.enqueue(SPANISH(1));
            const second = queue.enqueue(SPANISH(2));
            pending[0]?.fail(new Error('boom'));
            expect(await first).toEqual({ ok: false, reason: 'failed', error: { code: 'NETWORK', raw: 'boom' } });
            expect(updates.find((job) => {
                return job.episodeId === 1 && job.status === 'error';
            })).toEqual({ episodeId: 1, language: 'Spanish', status: 'error', done: 0, total: 0, reason: 'NETWORK: boom' });
            expect(run).toHaveBeenCalledTimes(2);
            pending[1]?.finish(DONE);
            expect(await second).toEqual(DONE);
        });

        it('turns what is thrown that is not an error into a failure too', async () => {
            const { queue, pending } = setup();
            const answer = queue.enqueue(SPANISH(1));
            pending[0]?.fail('a text');
            expect(await answer).toEqual({ ok: false, reason: 'failed', error: { code: 'NETWORK', raw: 'a text' } });
        });
    });

    describe('cancelling', () => {
        it('aborts the signal of the one that is running, which then ends by itself', async () => {
            const { queue, pending } = setup();
            const answer = queue.enqueue(SPANISH(1));
            expect(pending[0]?.signal.aborted).toBe(false);
            queue.cancel(1);
            expect(pending[0]?.signal.aborted).toBe(true);
            expect(queue.list()).toHaveLength(1);
            pending[0]?.finish({ ok: false, reason: 'cancelled' });
            expect(await answer).toEqual({ ok: false, reason: 'cancelled' });
        });

        it('takes the one that is waiting out of the line without ever starting it', async () => {
            const { queue, pending, updates, run } = setup();
            void queue.enqueue(SPANISH(1));
            const second = queue.enqueue(SPANISH(2));
            queue.cancel(2);
            expect(await second).toEqual({ ok: false, reason: 'cancelled' });
            expect(updates.at(-1)).toEqual({ episodeId: 2, language: 'Spanish', status: 'cancelled', done: 0, total: 0, reason: 'cancelled' });
            expect(queue.list().map((job) => {
                return job.episodeId;
            })).toEqual([1]);
            pending[0]?.finish(DONE);
            await Promise.resolve();
            expect(run).toHaveBeenCalledTimes(1);
        });

        it('cancels all of them when the episode is null', async () => {
            const { queue, pending } = setup();
            const first = queue.enqueue(SPANISH(1));
            const second = queue.enqueue(SPANISH(2));
            const third = queue.enqueue(SPANISH(3));
            queue.cancel(null);
            expect(pending[0]?.signal.aborted).toBe(true);
            expect(await second).toEqual({ ok: false, reason: 'cancelled' });
            expect(await third).toEqual({ ok: false, reason: 'cancelled' });
            pending[0]?.finish({ ok: false, reason: 'cancelled' });
            expect(await first).toEqual({ ok: false, reason: 'cancelled' });
            expect(queue.list()).toEqual([]);
        });

        it('does nothing for an episode that is not in the queue', () => {
            const { queue, updates } = setup();
            queue.cancel(9);
            queue.cancel(null);
            expect(updates).toEqual([]);
        });

        it('lets the episode be queued again after it was cancelled', async () => {
            const { queue, run } = setup(2);
            void queue.enqueue(SPANISH(1));
            void queue.enqueue(SPANISH(2));
            void queue.enqueue(SPANISH(3));
            queue.cancel(3);
            void queue.enqueue(SPANISH(3));
            expect(queue.list().map((job) => {
                return job.episodeId;
            })).toEqual([1, 2, 3]);
            expect(run).toHaveBeenCalledTimes(2);
        });
    });
});
