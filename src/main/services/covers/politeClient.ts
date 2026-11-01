// The requests to a service of covers (AniList, Kitsu, Jikan, MangaDex): one after the other, an interval apart, and when the service
// refuses (429) the requests wait as long as it asks for before the same one is made again.

export const COVER_ATTEMPTS = 3;
export const MAX_RETRY_WAIT_MS = 90_000;
export const COVER_TIMEOUT_MS = 15000;
const TOO_MANY_REQUESTS_STATUS = 429;
const NOT_FOUND_STATUS = 404;

// The cover could not be asked for (the service was not reached or refused): unlike a title that has none, this is not remembered.
export class CoverFetchError extends Error {}

export interface PoliteClientOptions {
    // The name of the service, for the messages of the failures.
    service: string;
    intervalMs: number;
    fetchFn?: typeof fetch;
    timeoutMs?: number;
    // How the client waits (the tests make it instant).
    sleep?: (milliseconds: number) => Promise<void>;
}

function wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export class PoliteClient {
    // The requests take turns: each one is let go once the one before it and the interval have passed.
    private turns: Promise<void> = Promise.resolve();

    constructor(private readonly options: PoliteClientOptions) {}

    // The answer of the service; null when it does not know what was asked for (404). A failure to reach it, or an error it answers with,
    // rejects with a CoverFetchError.
    async request(url: string, init: RequestInit = {}): Promise<Response | null> {
        for (let attempt = 1; attempt <= COVER_ATTEMPTS; attempt += 1) {
            await this.takeTurn();
            const response = await this.send(url, init);
            if (response.status === TOO_MANY_REQUESTS_STATUS && attempt < COVER_ATTEMPTS) {
                this.holdTurns(Math.min(Number(response.headers.get('retry-after')) * 1000 || this.options.intervalMs, MAX_RETRY_WAIT_MS));
                continue;
            }
            if (response.status === NOT_FOUND_STATUS) {
                return null;
            }
            if (!response.ok) {
                throw new CoverFetchError(`${this.options.service} answered with status ${response.status}.`);
            }
            return response;
        }
        throw new CoverFetchError(`${this.options.service} did not answer.`);
    }

    private async send(url: string, init: RequestInit): Promise<Response> {
        try {
            return await (this.options.fetchFn ?? fetch)(url, { ...init, signal: AbortSignal.timeout(this.options.timeoutMs ?? COVER_TIMEOUT_MS) });
        } catch (error) {
            throw new CoverFetchError(`${this.options.service} could not be reached: ${describe(error)}`);
        }
    }

    private sleep(milliseconds: number): Promise<void> {
        return (this.options.sleep ?? wait)(milliseconds);
    }

    // Waits for the turn of a request; the next one is let go an interval after this one.
    private async takeTurn(): Promise<void> {
        const mine = this.turns;
        this.turns = mine.then(() => {
            return this.sleep(this.options.intervalMs);
        });
        await mine;
    }

    // Everything after this one waits too: the service asked to be left alone for a while.
    private holdTurns(milliseconds: number): void {
        this.turns = this.turns.then(() => {
            return this.sleep(milliseconds);
        });
    }
}

// The body of an answer as JSON; null when it cannot be read.
export function readJson(response: Response | null): Promise<unknown> {
    if (response === null) {
        return Promise.resolve(null);
    }
    return response.json().catch(() => {
        return null;
    });
}
