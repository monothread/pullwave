import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { MangaCloudflareActivity } from '@shared/manga';
import { CloudflareMonitor } from '@main/services/tools/cloudflareMonitor';

interface Received {
    method: string;
    url: string;
    contentType: string | undefined;
    body: string;
}

// A stand-in FlareSolverr: it answers like the real one, after the delay it is given, and keeps what it received.
class FakeFlareSolverr {
    readonly received: Received[] = [];
    delayMs = 0;
    status = 200;
    reply = '{"status":"ok","solution":{"status":200,"response":"<html>page</html>"}}';
    private server: Server | null = null;

    get url(): string {
        return `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
    }

    async start(): Promise<void> {
        this.server = createServer((request, response) => {
            const chunks: Buffer[] = [];
            request.on('data', (chunk: Buffer) => {
                chunks.push(chunk);
            });
            request.on('end', () => {
                this.received.push({ method: request.method ?? '', url: request.url ?? '', contentType: request.headers['content-type'], body: Buffer.concat(chunks).toString('utf-8') });
                setTimeout(() => {
                    response.writeHead(this.status, { 'Content-Type': 'application/json' });
                    response.end(this.reply);
                }, this.delayMs);
            });
        });
        await new Promise<void>((resolve) => {
            this.server!.listen(0, '127.0.0.1', resolve);
        });
    }

    async stop(): Promise<void> {
        await new Promise<void>((resolve) => {
            this.server?.close(() => {
                resolve();
            });
            this.server?.closeAllConnections();
        });
    }
}

let flare: FakeFlareSolverr;
let monitor: CloudflareMonitor;
let changes: MangaCloudflareActivity[][];

beforeEach(async () => {
    flare = new FakeFlareSolverr();
    await flare.start();
    changes = [];
    monitor = new CloudflareMonitor({
        target: () => {
            return Promise.resolve(flare.url);
        },
        onChange: (active) => {
            changes.push(active);
        },
        now: () => {
            return 1000;
        }
    });
});

afterEach(async () => {
    await monitor.stop();
    await flare.stop();
});

async function post(address: string, path: string, body: unknown): Promise<Response> {
    return fetch(`${address}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

describe('CloudflareMonitor', () => {
    it('listens on this machine only, once', async () => {
        const first = await monitor.start();
        const second = await monitor.start();
        expect(first).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
        expect(second).toBe(first);
    });

    it('passes a request to FlareSolverr and its answer back as they are', async () => {
        const address = await monitor.start();
        const response = await post(address, '/v1', { cmd: 'request.get', url: 'https://manganato.com/page', maxTimeout: 60000 });
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('application/json');
        expect(await response.text()).toBe('{"status":"ok","solution":{"status":200,"response":"<html>page</html>"}}');
        expect(flare.received).toEqual([
            { method: 'POST', url: '/v1', contentType: 'application/json', body: JSON.stringify({ cmd: 'request.get', url: 'https://manganato.com/page', maxTimeout: 60000 }) }
        ]);
    });

    it('says which site a check is for while it goes on, and that none is left when it ends', async () => {
        flare.delayMs = 150;
        const address = await monitor.start();
        const pending = post(address, '/v1', { cmd: 'request.get', url: 'https://manganato.com/page' });
        await vi.waitFor(() => {
            expect(changes).toHaveLength(1);
        });
        expect(changes[0]).toEqual([{ id: 1, host: 'manganato.com', startedAt: 1000 }]);
        await pending;
        await vi.waitFor(() => {
            expect(changes).toHaveLength(2);
        });
        expect(changes[1]).toEqual([]);
    });

    it('knows about several checks at once', async () => {
        flare.delayMs = 200;
        const address = await monitor.start();
        const first = post(address, '/v1', { cmd: 'request.get', url: 'https://a.example/x' });
        const second = post(address, '/v1', { cmd: 'request.get', url: 'https://b.example/y' });
        await vi.waitFor(() => {
            expect(changes.at(-1)).toHaveLength(2);
        });
        expect(
            changes.at(-1)?.map((check) => {
                return check.host;
            })
        ).toEqual(['a.example', 'b.example']);
        await Promise.all([first, second]);
        await vi.waitFor(() => {
            expect(changes.at(-1)).toEqual([]);
        });
    });

    it('does not take a request that is not a check (asking whether it is ready) for one', async () => {
        const address = await monitor.start();
        const response = await fetch(`${address}/`);
        expect(response.status).toBe(200);
        expect(flare.received[0]).toMatchObject({ method: 'GET', url: '/', body: '' });
        expect(changes).toEqual([]);
    });

    it('passes on an answer that is an error, with its status', async () => {
        flare.status = 500;
        flare.reply = '{"status":"error","message":"Error solving the challenge. Timeout after 60.0 seconds."}';
        const address = await monitor.start();
        const response = await post(address, '/v1', { cmd: 'request.get', url: 'https://manganato.com/' });
        expect(response.status).toBe(500);
        expect(await response.text()).toBe(flare.reply);
        await vi.waitFor(() => {
            expect(changes.at(-1)).toEqual([]);
        });
    });

    it('answers with an error, and says no check is left, when FlareSolverr cannot be reached', async () => {
        const broken = new CloudflareMonitor({
            target: () => {
                return Promise.reject(new Error('FlareSolverr did not become ready in time'));
            },
            onChange: (active) => {
                changes.push(active);
            }
        });
        const address = await broken.start();
        const response = await post(address, '/v1', { cmd: 'request.get', url: 'https://manganato.com/' });
        expect(response.status).toBe(502);
        expect(await response.json()).toEqual({ status: 'error', message: 'FlareSolverr did not become ready in time' });
        expect(changes.map((active) => {
            return active.length;
        })).toEqual([1, 0]);
        await broken.stop();
    });

    it('does not know the site of a request that does not name one', async () => {
        flare.delayMs = 100;
        const address = await monitor.start();
        const pending = post(address, '/v1', { cmd: 'sessions.list' });
        await vi.waitFor(() => {
            expect(changes).toHaveLength(1);
        });
        expect(changes[0]?.[0]?.host).toBe('');
        await pending;
    });

    it('does not take a body that is not JSON, or a url that is not an address, for a site', async () => {
        flare.delayMs = 50;
        const address = await monitor.start();
        const first = fetch(`${address}/v1`, { method: 'POST', body: 'not json' });
        await vi.waitFor(() => {
            expect(changes).toHaveLength(1);
        });
        expect(changes[0]?.[0]?.host).toBe('');
        await first;
        const second = post(address, '/v1', { cmd: 'request.get', url: 'not an address' });
        await vi.waitFor(() => {
            expect(changes.length).toBeGreaterThanOrEqual(3);
        });
        expect(changes[2]?.[0]?.host).toBe('');
        await second;
    });

    it('refuses a body that is too large without asking FlareSolverr', async () => {
        const address = await monitor.start();
        const response = await fetch(`${address}/v1`, { method: 'POST', body: 'x'.repeat(1024 * 1024 + 10) });
        expect(response.status).toBe(413);
        expect(await response.json()).toEqual({ status: 'error', message: 'The request is too large' });
        expect(flare.received).toEqual([]);
        expect(changes).toEqual([]);
    });

    it('stops listening and forgets the checks that were going on', async () => {
        const address = await monitor.start();
        await monitor.stop();
        await expect(fetch(`${address}/`)).rejects.toThrow();
        await monitor.stop();
    });

    it('can be started again after it was stopped', async () => {
        await monitor.start();
        await monitor.stop();
        const address = await monitor.start();
        expect((await fetch(`${address}/`)).status).toBe(200);
    });
});
