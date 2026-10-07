import type { SubtitleGenerateRequest, SubtitleGenerateResponse, SubtitleGenerationJob } from '@shared/anime';
import { SubtitleGenerationQueue, type SubtitleGenerationQueueDependencies } from '@main/services/subtitleGenerationQueue';
import { SubtitleJobQueue } from '@main/services/subtitleJobQueue';

const JAPANESE = (episodeId: number): SubtitleGenerateRequest => {
    return { episodeId, audioLanguage: 'Japanese', language: 'Japanese' };
};

const DONE: SubtitleGenerateResponse = {
    ok: true,
    tracks: [{ id: 'generated-Japanese', label: 'Japanese', kind: 'generated' }],
    generated: { id: 'generated-Japanese', label: 'Japanese', kind: 'generated' }
};

interface Pending {
    request: SubtitleGenerateRequest;
    onProgress: (done: number, total: number, extra?: object) => void;
    signal: AbortSignal;
    finish: (response: SubtitleGenerateResponse) => void;
    fail: (error: unknown) => void;
}

function setup(concurrency?: number) {
    const pending: Pending[] = [];
    const updates: SubtitleGenerationJob[] = [];
    const run = vi.fn((request: SubtitleGenerateRequest, onProgress: (done: number, total: number, extra?: object) => void, signal: AbortSignal): Promise<SubtitleGenerateResponse> => {
        return new Promise((resolve, reject) => {
            pending.push({ request, onProgress, signal, finish: resolve, fail: reject });
        });
    });
    const dependencies: SubtitleGenerationQueueDependencies = {
        run,
        onJobUpdate: (job) => {
            updates.push(job);
        },
        concurrency
    };
    return { queue: new SubtitleGenerationQueue(dependencies), pending, updates, run };
}

describe('SubtitleGenerationQueue', () => {
    it('is a queue of jobs, like the one of the translations', () => {
        expect(setup().queue).toBeInstanceOf(SubtitleJobQueue);
        expect(setup().queue.list()).toEqual([]);
    });

    it('queues an episode, starts it and tells each step with the spoken language', async () => {
        const { queue, pending, updates, run } = setup();
        const answer = queue.enqueue(JAPANESE(4));
        expect(run).toHaveBeenCalledTimes(1);
        expect(run.mock.calls[0]?.[0]).toEqual(JAPANESE(4));
        pending[0]?.onProgress(1, 3);
        pending[0]?.finish(DONE);
        expect(await answer).toEqual(DONE);
        expect(queue.list()).toEqual([]);
        expect(updates).toEqual([
            { episodeId: 4, language: 'Japanese', status: 'queued', done: 0, total: 0, reason: null },
            { episodeId: 4, language: 'Japanese', status: 'running', done: 0, total: 0, reason: null },
            { episodeId: 4, language: 'Japanese', status: 'running', done: 1, total: 3, reason: null },
            { episodeId: 4, language: 'Japanese', status: 'done', done: 1, total: 3, reason: null }
        ]);
    });

    it('adds what the job says about itself (the phase, the plan, the bytes) to the job, and keeps it while the numbers change', async () => {
        const { queue, pending, updates } = setup();
        const answer = queue.enqueue(JAPANESE(4));
        pending[0]?.onProgress(0, 1, { phase: 'extracting', plan: 'transcribe' });
        pending[0]?.onProgress(1, 3, { phase: 'sending', plan: 'transcribe', sentBytes: 100, totalBytes: 300 });
        pending[0]?.onProgress(0, 9);
        pending[0]?.finish(DONE);
        await answer;
        expect(updates.slice(2)).toEqual([
            { episodeId: 4, language: 'Japanese', status: 'running', done: 0, total: 1, reason: null, phase: 'extracting', plan: 'transcribe' },
            { episodeId: 4, language: 'Japanese', status: 'running', done: 1, total: 3, reason: null, phase: 'sending', plan: 'transcribe', sentBytes: 100, totalBytes: 300 },
            { episodeId: 4, language: 'Japanese', status: 'running', done: 0, total: 9, reason: null, phase: 'sending', plan: 'transcribe', sentBytes: 100, totalBytes: 300 },
            { episodeId: 4, language: 'Japanese', status: 'done', done: 0, total: 9, reason: null, phase: 'sending', plan: 'transcribe', sentBytes: 100, totalBytes: 300 }
        ]);
    });

    it('does one episode at a time, and starts the next when one ends', async () => {
        const { queue, pending, run } = setup();
        const first = queue.enqueue(JAPANESE(1));
        const second = queue.enqueue(JAPANESE(2));
        expect(run).toHaveBeenCalledTimes(1);
        pending[0]?.finish(DONE);
        await first;
        expect(run).toHaveBeenCalledTimes(2);
        pending[1]?.finish(DONE);
        await second;
        expect(queue.list()).toEqual([]);
    });

    it('says an episode that has a job already is busy', async () => {
        const { queue, run } = setup();
        void queue.enqueue(JAPANESE(1));
        expect(await queue.enqueue({ episodeId: 1, audioLanguage: 'English', language: 'English' })).toEqual({ ok: false, reason: 'busy' });
        expect(run).toHaveBeenCalledTimes(1);
    });

    it.each(['missing', 'no-token', 'no-model', 'no-address', 'no-audio', 'no-speech', 'extract-failed', 'unreadable', 'busy'] as const)('says it failed for "%s", with that reason', async (reason) => {
        const { queue, pending, updates } = setup();
        const answer = queue.enqueue(JAPANESE(1));
        pending[0]?.finish({ ok: false, reason });
        expect(await answer).toEqual({ ok: false, reason });
        expect(updates.at(-1)).toEqual({ episodeId: 1, language: 'Japanese', status: 'error', done: 0, total: 0, reason });
    });

    it('says it failed with what the service said', async () => {
        const { queue, pending, updates } = setup();
        const answer = queue.enqueue(JAPANESE(1));
        pending[0]?.finish({ ok: false, reason: 'failed', error: { code: 'RATE_LIMITED', raw: 'slow' } });
        await answer;
        expect(updates.at(-1)).toEqual({ episodeId: 1, language: 'Japanese', status: 'error', done: 0, total: 0, reason: 'RATE_LIMITED: slow' });
    });

    it('turns what the job throws into a failure', async () => {
        const { queue, pending, updates } = setup();
        const answer = queue.enqueue(JAPANESE(1));
        pending[0]?.fail(new Error('boom'));
        expect(await answer).toEqual({ ok: false, reason: 'failed', error: { code: 'NETWORK', raw: 'boom' } });
        expect(updates.at(-1)?.reason).toBe('NETWORK: boom');
    });

    it('aborts the signal of the one that is running when it is cancelled, and takes the one that is waiting out of the line', async () => {
        const { queue, pending, updates, run } = setup();
        const first = queue.enqueue(JAPANESE(1));
        const second = queue.enqueue(JAPANESE(2));
        queue.cancel(2);
        expect(await second).toEqual({ ok: false, reason: 'cancelled' });
        expect(updates.at(-1)).toEqual({ episodeId: 2, language: 'Japanese', status: 'cancelled', done: 0, total: 0, reason: 'cancelled' });
        queue.cancel(1);
        expect(pending[0]?.signal.aborted).toBe(true);
        pending[0]?.finish({ ok: false, reason: 'cancelled' });
        expect(await first).toEqual({ ok: false, reason: 'cancelled' });
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('cancels all of them when the episode is null', async () => {
        const { queue, pending } = setup();
        const first = queue.enqueue(JAPANESE(1));
        const second = queue.enqueue(JAPANESE(2));
        queue.cancel(null);
        expect(pending[0]?.signal.aborted).toBe(true);
        expect(await second).toEqual({ ok: false, reason: 'cancelled' });
        pending[0]?.finish({ ok: false, reason: 'cancelled' });
        expect(await first).toEqual({ ok: false, reason: 'cancelled' });
        expect(queue.list()).toEqual([]);
    });

    it('does as many at once as the concurrency says', () => {
        const { queue, run } = setup(2);
        void queue.enqueue(JAPANESE(1));
        void queue.enqueue(JAPANESE(2));
        void queue.enqueue(JAPANESE(3));
        expect(run).toHaveBeenCalledTimes(2);
    });
});
