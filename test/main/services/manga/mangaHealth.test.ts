import type { MangaHelperProblem, MangaServerStatus } from '@shared/manga';
import type { ToolSpec, ToolState } from '@shared/tools';
import { MangaService, PROBE_TIMEOUT_MS, probeHelper, type HelperControl, type MangaServiceDependencies, type ServerControl } from '@main/services/manga/mangaService';
import { SuwayomiApiError, type SuwayomiClient } from '@main/services/manga/suwayomiClient';
import { suwayomiSpec } from '@main/services/tools/suwayomiRelease';

const SPEC: ToolSpec = suwayomiSpec('linux', 'x64')!;
const HELPER_URL = 'http://127.0.0.1:8191';

function helperState(status: ToolState['status'], message: string | null = null): ToolState {
    return { id: 'flaresolverr', status, version: 'v3.5.2', bytesDone: 0, bytesTotal: 0, percent: 0, error: message === null ? null : { code: 'DOWNLOAD_FAILED', message } };
}

interface HelperOptions {
    state?: ToolState;
    status?: MangaServerStatus;
    failure?: MangaHelperProblem | null;
    baseUrl?: string | null;
    ensureRunning?: () => Promise<string>;
}

function makeHelper(options: HelperOptions = {}): HelperControl {
    return {
        prepare: vi.fn(),
        remove: vi.fn(),
        stop: vi.fn(),
        state: options.state ?? helperState('ready'),
        status: options.status ?? 'stopped',
        failure: options.failure ?? null,
        baseUrl: options.baseUrl ?? null,
        version: 'v3.5.2',
        ensureRunning: options.ensureRunning ?? vi.fn(() => {
            return Promise.resolve(HELPER_URL);
        })
    };
}

function setup(options: { ready?: boolean; status?: MangaServerStatus; error?: string | null; version?: () => Promise<string>; helper?: HelperControl | null; externalHelper?: string; helperEnabled?: boolean; externalBaseUrl?: string | null } = {}) {
    const serverVersion = vi.fn(options.version ?? (() => {
        return Promise.resolve('v2.4.2366');
    }));
    const server: ServerControl = {
        ensureRunning: vi.fn(),
        stop: vi.fn(),
        status: options.status ?? 'running',
        error: options.error ?? null,
        baseUrl: null
    };
    const deps: MangaServiceDependencies = {
        spec: SPEC,
        tool: {
            isReady: vi.fn(() => {
                return options.ready ?? true;
            }),
            install: vi.fn(),
            stateOf: vi.fn()
        },
        server,
        client: () => {
            return { serverVersion } as unknown as SuwayomiClient;
        },
        helper: options.helper ?? null,
        externalHelper: () => {
            return options.externalHelper ?? null;
        },
        helperEnabled: () => {
            return options.helperEnabled ?? true;
        },
        externalBaseUrl: options.externalBaseUrl ?? null
    };
    return { service: new MangaService(deps), serverVersion };
}

function answer(body: unknown, status = 200): Response {
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('probeHelper', () => {
    it('asks the address and gives the version it reports', async () => {
        const fetchMock = vi.fn(() => {
            return Promise.resolve(answer({ msg: 'FlareSolverr is ready!', version: '3.9.9' }));
        });
        vi.stubGlobal('fetch', fetchMock);
        await expect(probeHelper(HELPER_URL, true, 'v3.5.2')).resolves.toEqual({ state: 'healthy', version: '3.9.9', message: null, external: true });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(`${HELPER_URL}/`, { signal: expect.any(AbortSignal) });
        expect(PROBE_TIMEOUT_MS).toBe(4000);
    });

    it('keeps the version it was given when the answer does not say one', async () => {
        vi.stubGlobal('fetch', vi.fn(() => {
            return Promise.resolve(answer({ msg: 'ok' }));
        }));
        await expect(probeHelper(HELPER_URL, false, 'v3.5.2')).resolves.toEqual({ state: 'healthy', version: 'v3.5.2', message: null, external: false });
    });

    it('is healthy with no version when the answer is not JSON and none was given', async () => {
        vi.stubGlobal('fetch', vi.fn(() => {
            return Promise.resolve(answer('<html></html>'));
        }));
        await expect(probeHelper(HELPER_URL, true)).resolves.toEqual({ state: 'healthy', version: null, message: null, external: true });
    });

    it('cuts a version that is far too long', async () => {
        vi.stubGlobal('fetch', vi.fn(() => {
            return Promise.resolve(answer({ version: 'v'.repeat(100) }));
        }));
        expect((await probeHelper(HELPER_URL, false)).version).toBe('v'.repeat(40));
    });

    it('is unhealthy when it answers with an error status', async () => {
        vi.stubGlobal('fetch', vi.fn(() => {
            return Promise.resolve(answer('no', 503));
        }));
        await expect(probeHelper(HELPER_URL, false, 'v3.5.2')).resolves.toEqual({ state: 'unhealthy', version: 'v3.5.2', message: 'It answered 503', external: false });
    });

    it('is unhealthy with the reason when it cannot be reached', async () => {
        vi.stubGlobal('fetch', vi.fn(() => {
            return Promise.reject(new Error('connect ECONNREFUSED'));
        }));
        await expect(probeHelper(HELPER_URL, true)).resolves.toEqual({ state: 'unhealthy', version: null, message: 'connect ECONNREFUSED', external: true });
        vi.stubGlobal('fetch', vi.fn(() => {
            return Promise.reject('plain');
        }));
        expect((await probeHelper(HELPER_URL, true)).message).toBe('plain');
    });
});

describe('MangaService health of the server', () => {
    it('is healthy with the version it answers', async () => {
        const { service, serverVersion } = setup();
        await expect(service.health(false)).resolves.toEqual({ server: { state: 'healthy', version: 'v2.4.2366', message: null, external: false }, helper: null });
        expect(serverVersion).toHaveBeenCalledTimes(1);
    });

    it('is not installed when the program is not there, without asking it anything', async () => {
        const { service, serverVersion } = setup({ ready: false });
        expect((await service.health(true)).server).toEqual({ state: 'not-installed', version: null, message: null, external: false });
        expect(serverVersion).not.toHaveBeenCalled();
    });

    it('is starting while it starts', async () => {
        const { service, serverVersion } = setup({ status: 'starting' });
        expect((await service.health(true)).server.state).toBe('starting');
        expect(serverVersion).not.toHaveBeenCalled();
    });

    it('is stopped when it is, unless the user asks to check, which starts it through the question', async () => {
        const { service, serverVersion } = setup({ status: 'stopped' });
        expect((await service.health(false)).server).toEqual({ state: 'stopped', version: null, message: null, external: false });
        expect(serverVersion).not.toHaveBeenCalled();
        expect((await service.health(true)).server.state).toBe('healthy');
        expect(serverVersion).toHaveBeenCalledTimes(1);
    });

    it('is unhealthy with the reason it stopped when it failed, and tries again when asked to check', async () => {
        const { service, serverVersion } = setup({ status: 'error', error: 'It did not start' });
        expect((await service.health(false)).server).toEqual({ state: 'unhealthy', version: null, message: 'It did not start', external: false });
        expect(serverVersion).not.toHaveBeenCalled();
        expect((await service.health(true)).server.state).toBe('healthy');
    });

    it('is unhealthy when it does not answer', async () => {
        const { service } = setup({
            version: () => {
                return Promise.reject(new SuwayomiApiError('SERVER_UNAVAILABLE', 'The server did not answer'));
            }
        });
        expect((await service.health(false)).server).toEqual({ state: 'unhealthy', version: null, message: 'The server did not answer', external: false });
        const other = setup({
            version: () => {
                return Promise.reject(new Error('boom'));
            }
        });
        expect((await other.service.health(false)).server.message).toBe('boom');
    });

    it('asks a server that is already running without checking the program or its state', async () => {
        const { service, serverVersion } = setup({ externalBaseUrl: 'http://127.0.0.1:9', ready: false, status: 'stopped' });
        expect((await service.health(false)).server).toEqual({ state: 'healthy', version: 'v2.4.2366', message: null, external: false });
        expect(serverVersion).toHaveBeenCalledTimes(1);
    });
});

describe('MangaService health of the helper', () => {
    it('is nothing where the app has none, or the user did not install it', async () => {
        expect((await setup().service.health(true)).helper).toBeNull();
        expect((await setup({ helper: makeHelper(), helperEnabled: false }).service.health(true)).helper).toBeNull();
    });

    it('checks the address of the one the user runs, and none of the app', async () => {
        const fetchMock = vi.fn(() => {
            return Promise.resolve(answer({ version: '3.9.9' }));
        });
        vi.stubGlobal('fetch', fetchMock);
        const helper = makeHelper();
        const { service } = setup({ helper, externalHelper: 'http://10.0.0.5:8191' });
        expect((await service.health(true)).helper).toEqual({ state: 'healthy', version: '3.9.9', message: null, external: true });
        expect(fetchMock).toHaveBeenCalledWith('http://10.0.0.5:8191/', { signal: expect.any(AbortSignal) });
        expect(helper.ensureRunning).not.toHaveBeenCalled();
    });

    it('is unhealthy with the problem that was found', async () => {
        const failure: MangaHelperProblem = { code: 'no-docker', message: 'Docker is not installed' };
        const { service } = setup({ helper: makeHelper({ failure }) });
        expect((await service.health(true)).helper).toEqual({ state: 'unhealthy', version: 'v3.5.2', message: 'Docker is not installed', external: false });
    });

    it('looks again at the problem when the user asks to check, and does not when it only looks', async () => {
        const failure: MangaHelperProblem = { code: 'no-docker', message: 'Docker is not installed' };
        const helper = makeHelper({ failure });
        const { service } = setup({ helper });
        await service.health(false);
        expect(helper.prepare).not.toHaveBeenCalled();
        await service.health(true);
        expect(helper.prepare).toHaveBeenCalledTimes(1);
    });

    it('starts the helper after the problem is gone when the user asks to check', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() => {
                return Promise.resolve(answer({ version: '3.5.2' }));
            })
        );
        let broken = true;
        const helper = makeHelper({ failure: { code: 'start-failed', message: 'port in use' } });
        Object.defineProperty(helper, 'failure', {
            get: () => {
                return broken ? { code: 'start-failed', message: 'port in use' } : null;
            }
        });
        (helper.prepare as ReturnType<typeof vi.fn>).mockImplementation(() => {
            broken = false;
            return Promise.resolve(helperState('ready'));
        });
        const { service } = setup({ helper });
        expect((await service.health(true)).helper).toEqual({ state: 'healthy', version: '3.5.2', message: null, external: false });
        expect(helper.prepare).toHaveBeenCalledTimes(1);
        expect(helper.ensureRunning).toHaveBeenCalledTimes(1);
    });

    it('looks again when the install had failed, and says what is wrong if it still is', async () => {
        const helper = makeHelper({ state: helperState('error', 'manifest unknown') });
        const { service } = setup({ helper });
        expect((await service.health(true)).helper).toEqual({ state: 'unhealthy', version: 'v3.5.2', message: 'manifest unknown', external: false });
        expect(helper.prepare).toHaveBeenCalledTimes(1);
    });

    it('is starting while the image is being had', async () => {
        for (const status of ['downloading', 'verifying', 'extracting'] as const) {
            const { service } = setup({ helper: makeHelper({ state: helperState(status) }) });
            expect((await service.health(true)).helper?.state).toBe('starting');
        }
    });

    it('is not installed when it is missing, and unhealthy with the reason when the install failed', async () => {
        expect((await setup({ helper: makeHelper({ state: helperState('missing') }) }).service.health(true)).helper).toEqual({ state: 'not-installed', version: 'v3.5.2', message: null, external: false });
        expect((await setup({ helper: makeHelper({ state: helperState('error', 'manifest unknown') }) }).service.health(true)).helper).toEqual({ state: 'unhealthy', version: 'v3.5.2', message: 'manifest unknown', external: false });
    });

    it('is starting while it starts', async () => {
        const helper = makeHelper({ status: 'starting' });
        expect((await setup({ helper }).service.health(true)).helper?.state).toBe('starting');
        expect(helper.ensureRunning).not.toHaveBeenCalled();
    });

    it('asks the one that runs, with its version', async () => {
        const fetchMock = vi.fn(() => {
            return Promise.resolve(answer({ msg: 'ok' }));
        });
        vi.stubGlobal('fetch', fetchMock);
        const helper = makeHelper({ status: 'running', baseUrl: HELPER_URL });
        expect((await setup({ helper }).service.health(false)).helper).toEqual({ state: 'healthy', version: 'v3.5.2', message: null, external: false });
        expect(fetchMock).toHaveBeenCalledWith(`${HELPER_URL}/`, { signal: expect.any(AbortSignal) });
        expect(helper.ensureRunning).not.toHaveBeenCalled();
    });

    it('is stopped when it is, and starts it only when the user asks to check', async () => {
        const fetchMock = vi.fn(() => {
            return Promise.resolve(answer({ version: '3.5.2' }));
        });
        vi.stubGlobal('fetch', fetchMock);
        const helper = makeHelper({ status: 'stopped' });
        const { service } = setup({ helper });
        expect((await service.health(false)).helper).toEqual({ state: 'stopped', version: 'v3.5.2', message: null, external: false });
        expect(helper.ensureRunning).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
        expect((await service.health(true)).helper).toEqual({ state: 'healthy', version: '3.5.2', message: null, external: false });
        expect(helper.ensureRunning).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(`${HELPER_URL}/`, { signal: expect.any(AbortSignal) });
    });

    it('is unhealthy with the reason when it cannot be started', async () => {
        const helper = makeHelper({
            ensureRunning: () => {
                return Promise.reject(new Error('port in use'));
            }
        });
        expect((await setup({ helper }).service.health(true)).helper).toEqual({ state: 'unhealthy', version: 'v3.5.2', message: 'port in use', external: false });
        const plain = makeHelper({
            ensureRunning: () => {
                return Promise.reject('plain');
            }
        });
        expect((await setup({ helper: plain }).service.health(true)).helper?.message).toBe('plain');
    });
});
