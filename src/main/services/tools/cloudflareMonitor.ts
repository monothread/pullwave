import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { MangaCloudflareActivity } from '@shared/manga';

// How long a request to FlareSolverr may take in all (it solves a challenge in a browser; the server asks for 60 s by default).
export const MONITOR_REQUEST_TIMEOUT_MS = 180_000;
const MAX_BODY_BYTES = 1024 * 1024;

export interface CloudflareMonitorDependencies {
    // The address of the FlareSolverr behind it (it is started if it does not run).
    target: () => Promise<string>;
    // Told every time the checks that are going on change.
    onChange: (active: MangaCloudflareActivity[]) => void;
    fetchImpl?: typeof fetch;
    now?: () => number;
}

function hostOf(body: string): string {
    try {
        const url = (JSON.parse(body) as { url?: unknown }).url;
        return typeof url === 'string' ? new URL(url).hostname : '';
    } catch {
        return '';
    }
}

async function readBody(request: IncomingMessage): Promise<string | null> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of request) {
        total += (chunk as Buffer).length;
        if (total > MAX_BODY_BYTES) {
            return null;
        }
        chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString('utf-8');
}

// Stands between the manga server and FlareSolverr: it passes every request on and the answer back as it is, and knows which checks of
// Cloudflare are going on and for which site, so the screen can say so (a check can take a minute, and nothing else shows it).
export class CloudflareMonitor {
    private server: Server | null = null;
    private starting: Promise<string> | null = null;
    private readonly active = new Map<number, MangaCloudflareActivity>();
    private nextId = 1;

    constructor(private readonly deps: CloudflareMonitorDependencies) {}

    // The address of the monitor, listening on this machine only (started once).
    start(): Promise<string> {
        this.starting ??= this.listen();
        return this.starting;
    }

    async stop(): Promise<void> {
        const server = this.server;
        this.server = null;
        this.starting = null;
        this.active.clear();
        if (server !== null) {
            await new Promise<void>((resolve) => {
                server.close(() => {
                    resolve();
                });
                server.closeAllConnections();
            });
        }
    }

    private listen(): Promise<string> {
        return new Promise((resolve, reject) => {
            const server = createServer((request, response) => {
                void this.handle(request, response);
            });
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => {
                this.server = server;
                resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
            });
        });
    }

    private publish(): void {
        this.deps.onChange([...this.active.values()]);
    }

    private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
        const body = await readBody(request);
        if (body === null) {
            response.writeHead(413, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ status: 'error', message: 'The request is too large' }));
            return;
        }
        const id = this.nextId;
        this.nextId += 1;
        // Only what asks FlareSolverr to fetch a page is a check (the rest, like asking whether it is ready, is not).
        const isCheck = request.method === 'POST' && (request.url ?? '').startsWith('/v1');
        if (isCheck) {
            this.active.set(id, { id, host: hostOf(body), startedAt: (this.deps.now ?? Date.now)() });
            this.publish();
        }
        try {
            const target = await this.deps.target();
            const answer = await (this.deps.fetchImpl ?? fetch)(`${target}${request.url ?? '/'}`, {
                method: request.method,
                headers: request.headers['content-type'] === undefined ? undefined : { 'Content-Type': request.headers['content-type'] },
                body: request.method === 'GET' || request.method === 'HEAD' ? undefined : body,
                signal: AbortSignal.timeout(MONITOR_REQUEST_TIMEOUT_MS)
            });
            const text = await answer.text();
            response.writeHead(answer.status, { 'Content-Type': answer.headers.get('content-type') ?? 'application/json' });
            response.end(text);
        } catch (error) {
            response.writeHead(502, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ status: 'error', message: error instanceof Error ? error.message : String(error) }));
        } finally {
            if (this.active.delete(id)) {
                this.publish();
            }
        }
    }
}
