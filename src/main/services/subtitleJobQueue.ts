import type { SubtitleTranslationStatus } from '@shared/anime';
import type { LlmError } from '@shared/llm';

// Tells how far the job is, and, optionally, more that the screen shows about it (the phase it is in, for example): it is added to the job.
export type SubtitleJobProgress = (done: number, total: number, extra?: object) => void;

export interface SubtitleJobRequest {
    episodeId: number;
    language: string;
}

// What a job answers with: it worked, or it did not and says why (`failed` comes with what the provider said).
export type SubtitleJobResponse = { ok: true } | { ok: false; reason: string; error?: LlmError };

export interface SubtitleJob<Language extends string> {
    episodeId: number;
    language: Language;
    status: SubtitleTranslationStatus;
    done: number;
    total: number;
    reason: string | null;
}

export interface SubtitleJobQueueDependencies<Request extends SubtitleJobRequest, Response extends SubtitleJobResponse> {
    // Does one job; reports the steps it has done and stops when the signal is aborted.
    run: (request: Request, onProgress: SubtitleJobProgress, signal: AbortSignal) => Promise<Response>;
    onJobUpdate: (job: SubtitleJob<Request['language']>) => void;
    // How many episodes are worked on at once; one by default, since the providers limit how fast they answer.
    concurrency?: number;
}

interface Entry<Request extends SubtitleJobRequest, Response extends SubtitleJobResponse> {
    request: Request;
    job: SubtitleJob<Request['language']>;
    controller: AbortController;
    resolve: (response: Response) => void;
}

function reasonOf(response: SubtitleJobResponse): string | null {
    if (response.ok) {
        return null;
    }
    return response.reason === 'failed' && response.error ? `${response.error.code}: ${response.error.raw}` : response.reason;
}

function statusOf(response: SubtitleJobResponse): SubtitleTranslationStatus {
    if (response.ok) {
        return 'done';
    }
    return response.reason === 'cancelled' ? 'cancelled' : 'error';
}

// The episodes whose subtitle is waiting to be worked on or being worked on, one after the other. An episode has one job at a time; the
// ones that ended are forgotten (the screen learns about them through the updates). The answers for `busy` and `cancelled` are the same
// in every kind of job, which is why the response types of the jobs have to have them.
export class SubtitleJobQueue<Request extends SubtitleJobRequest, Response extends SubtitleJobResponse> {
    private readonly entries = new Map<number, Entry<Request, Response>>();
    private readonly waiting: number[] = [];
    private running = 0;

    constructor(private readonly deps: SubtitleJobQueueDependencies<Request, Response>) {}

    list(): Array<SubtitleJob<Request['language']>> {
        return [...this.entries.values()].map((entry) => {
            return entry.job;
        });
    }

    // Queues the job; the answer comes when it ends. An episode that has a job already is `busy`.
    enqueue(request: Request): Promise<Response> {
        if (this.entries.has(request.episodeId)) {
            return Promise.resolve({ ok: false, reason: 'busy' } as Response);
        }
        return new Promise((resolve) => {
            const job: SubtitleJob<Request['language']> = { episodeId: request.episodeId, language: request.language, status: 'queued', done: 0, total: 0, reason: null };
            this.entries.set(request.episodeId, { request, job, controller: new AbortController(), resolve });
            this.waiting.push(request.episodeId);
            this.deps.onJobUpdate(job);
            this.pump();
        });
    }

    // Cancels the job of an episode (or all of them): the one that is waiting never starts and the one that is running stops.
    cancel(episodeId: number | null): void {
        const ids = episodeId === null ? [...this.entries.keys()] : [episodeId];
        ids.forEach((id) => {
            const entry = this.entries.get(id);
            if (!entry) {
                return;
            }
            entry.controller.abort();
            const position = this.waiting.indexOf(id);
            if (position !== -1) {
                this.waiting.splice(position, 1);
                this.finish(entry, { ok: false, reason: 'cancelled' } as Response);
            }
        });
    }

    private pump(): void {
        const limit = this.deps.concurrency ?? 1;
        while (this.running < limit && this.waiting.length > 0) {
            const id = this.waiting.shift() as number;
            const entry = this.entries.get(id) as Entry<Request, Response>;
            this.running += 1;
            void this.start(entry);
        }
    }

    private async start(entry: Entry<Request, Response>): Promise<void> {
        this.update(entry, { status: 'running' });
        let response: Response;
        try {
            response = await this.deps.run(
                entry.request,
                (done, total, extra) => {
                    this.update(entry, { done, total, ...extra });
                },
                entry.controller.signal
            );
        } catch (error) {
            response = { ok: false, reason: 'failed', error: { code: 'NETWORK', raw: error instanceof Error ? error.message : String(error) } } as Response;
        }
        this.running -= 1;
        this.finish(entry, response);
        this.pump();
    }

    private update(entry: Entry<Request, Response>, change: Partial<SubtitleJob<Request['language']>>): void {
        entry.job = { ...entry.job, ...change };
        this.deps.onJobUpdate(entry.job);
    }

    private finish(entry: Entry<Request, Response>, response: Response): void {
        this.entries.delete(entry.request.episodeId);
        this.update(entry, { status: statusOf(response), reason: reasonOf(response) });
        entry.resolve(response);
    }
}
