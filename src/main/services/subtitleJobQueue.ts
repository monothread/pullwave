import type { SubtitleTranslationStatus } from '@shared/anime';
import type { LlmError } from '@shared/llm';

export type SubtitleJobProgress = (done: number, total: number, extra?: object) => void;

export interface SubtitleJobRequest {
    episodeId: number;
    language: string;
}

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
    run: (request: Request, onProgress: SubtitleJobProgress, signal: AbortSignal) => Promise<Response>;
    onJobUpdate: (job: SubtitleJob<Request['language']>) => void;
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
    if (response.reason === 'exists') {
        return 'skipped';
    }
    return response.reason === 'cancelled' ? 'cancelled' : 'error';
}

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
