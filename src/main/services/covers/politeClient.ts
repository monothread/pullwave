export const COVER_ATTEMPTS = 3;
export const MAX_RETRY_WAIT_MS = 90_000;
export const COVER_TIMEOUT_MS = 15000;
const TOO_MANY_REQUESTS_STATUS = 429;
const NOT_FOUND_STATUS = 404;

export class CoverFetchError extends Error {}

export interface PoliteClientOptions {
    service: string;
    intervalMs: number;
    fetchFn?: typeof fetch;
    timeoutMs?: number;
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
    private turns: Promise<void> = Promise.resolve();

    constructor(private readonly options: PoliteClientOptions) {}

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

    private async takeTurn(): Promise<void> {
        const mine = this.turns;
        this.turns = mine.then(() => {
            return this.sleep(this.options.intervalMs);
        });
        await mine;
    }

    private holdTurns(milliseconds: number): void {
        this.turns = this.turns.then(() => {
            return this.sleep(milliseconds);
        });
    }
}

export function readJson(response: Response | null): Promise<unknown> {
    if (response === null) {
        return Promise.resolve(null);
    }
    return response.json().catch(() => {
        return null;
    });
}
