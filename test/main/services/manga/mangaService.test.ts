import type { MangaStatusInfo } from '@shared/manga';
import type { ToolSpec, ToolState } from '@shared/tools';
import { MangaService, toMangaError, type HelperControl, type MangaServiceDependencies, type ServerControl, type ToolControl } from '@main/services/manga/mangaService';
import { SuwayomiApiError, type SuwayomiClient } from '@main/services/manga/suwayomiClient';
import { suwayomiSpec } from '@main/services/tools/suwayomiRelease';

const SPEC: ToolSpec = suwayomiSpec('linux', 'x64')!;
const BASE = 'http://127.0.0.1:4321';
const READY: ToolState = { id: 'suwayomi', status: 'ready', version: SPEC.version, bytesDone: 0, bytesTotal: 0, percent: 100, error: null };
const MISSING: ToolState = { ...READY, status: 'missing', percent: 0 };

function setup(overrides: Partial<MangaServiceDependencies> & { ready?: boolean } = {}) {
    const calls: string[] = [];
    const tool: ToolControl = {
        isReady: vi.fn(() => {
            return overrides.ready ?? true;
        }),
        install: vi.fn(() => {
            return Promise.resolve(READY);
        }),
        stateOf: vi.fn(() => {
            return overrides.ready === false ? MISSING : READY;
        })
    };
    const server: ServerControl & { ensureRunning: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> } = {
        ensureRunning: vi.fn(() => {
            return Promise.resolve(BASE);
        }),
        stop: vi.fn(() => {
            return Promise.resolve();
        }),
        status: 'stopped',
        error: null,
        baseUrl: null
    };
    const client = {
        stores: vi.fn(() => {
            calls.push('stores');
            return Promise.resolve([{ indexUrl: 'https://a/i.json', name: 'A' }]);
        }),
        addStore: vi.fn((indexUrl: string) => {
            calls.push(`addStore ${indexUrl}`);
            return Promise.resolve({ indexUrl, name: 'A' });
        }),
        removeStore: vi.fn(() => {
            calls.push('removeStore');
            return Promise.resolve();
        }),
        refreshExtensions: vi.fn(() => {
            calls.push('refreshExtensions');
            return Promise.resolve([]);
        }),
        extensions: vi.fn(() => {
            calls.push('extensions');
            return Promise.resolve([]);
        }),
        changeExtension: vi.fn(() => {
            calls.push('changeExtension');
            return Promise.resolve();
        }),
        updateExtensions: vi.fn(() => {
            calls.push('updateExtensions');
            return Promise.resolve();
        }),
        sources: vi.fn(() => {
            calls.push('sources');
            return Promise.resolve([]);
        }),
        sourcePreferences: vi.fn(() => {
            calls.push('sourcePreferences');
            return Promise.resolve([{ position: 0, type: 'text', key: 'k', title: 'k', summary: '', enabled: true, value: 'v' }]);
        }),
        sourceFilters: vi.fn(() => {
            calls.push('sourceFilters');
            return Promise.resolve([{ type: 'checkbox', name: 'x', value: false }]);
        }),
        setSourcePreference: vi.fn(() => {
            calls.push('setSourcePreference');
            return Promise.resolve([]);
        }),
        list: vi.fn(() => {
            calls.push('list');
            return Promise.resolve({ items: [], hasNextPage: false });
        }),
        mangaWithChapters: vi.fn(() => {
            calls.push('details');
            return Promise.resolve({ details: {}, chapters: [] });
        }),
        setFlareSolverr: vi.fn(() => {
            calls.push('setFlareSolverr');
            return Promise.resolve();
        }),
        chapterPages: vi.fn(() => {
            calls.push('pages');
            return Promise.resolve(['p']);
        })
    };
    const service = new MangaService({
        spec: SPEC,
        tool,
        server,
        client: () => {
            return client as unknown as SuwayomiClient;
        },
        ...overrides
    });
    return { service, tool, server, client, calls };
}

describe('MangaService status', () => {
    it('says what the program and the server are doing', () => {
        const { service } = setup();
        expect(service.status()).toEqual<MangaStatusInfo>({ supported: true, tool: READY, helper: null, helperProblem: null, helperExternal: false, server: 'stopped', serverError: null });
        expect(service.supported).toBe(true);
    });

    it('says the program is missing before it is downloaded', () => {
        expect(setup({ ready: false }).service.status().tool).toEqual(MISSING);
    });

    it('is not supported where there is no program for the system', () => {
        const { service } = setup({ spec: null });
        expect(service.status()).toEqual({ supported: false, tool: null, helper: null, helperProblem: null, helperExternal: false, server: 'stopped', serverError: null });
        expect(service.supported).toBe(false);
    });

    it('is running with nothing to download when a server is given', () => {
        const { service } = setup({ externalBaseUrl: 'http://127.0.0.1:9999', spec: null });
        expect(service.status()).toEqual({ supported: true, tool: null, helper: null, helperProblem: null, helperExternal: false, server: 'running', serverError: null });
        expect(service.supported).toBe(true);
        expect(service.baseUrl).toBe('http://127.0.0.1:9999');
    });

    it('gives the address of the server only once it runs', () => {
        const { service, server } = setup();
        expect(service.baseUrl).toBeNull();
        Object.assign(server, { baseUrl: BASE });
        expect(service.baseUrl).toBe(BASE);
    });
});

describe('MangaService helper for Cloudflare', () => {
    const HELPER_READY: ToolState = { ...READY, id: 'flaresolverr', version: 'v3.5.2' };

    function makeHelper(overrides: Partial<HelperControl> = {}): HelperControl & { prepare: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> } {
        return {
            state: HELPER_READY,
            status: 'stopped',
            failure: null,
            prepare: vi.fn(() => {
                return Promise.resolve(HELPER_READY);
            }),
            stop: vi.fn(() => {
                return Promise.resolve();
            }),
            remove: vi.fn(() => {
                return Promise.resolve();
            }),
            ...overrides
        } as HelperControl & { prepare: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
    }

    it('says what the helper is doing besides the program', () => {
        const pulling: ToolState = { ...HELPER_READY, status: 'downloading', percent: 40 };
        const { service } = setup({ helper: makeHelper({ state: pulling }) });
        expect(service.status()).toEqual<MangaStatusInfo>({ supported: true, tool: READY, helper: pulling, helperProblem: null, helperExternal: false, server: 'stopped', serverError: null });
    });

    it('says why the helper cannot be used', () => {
        const failure = { code: 'no-docker', message: 'Cannot connect to the Docker daemon' } as const;
        const { service } = setup({ helper: makeHelper({ failure }) });
        expect(service.status().helperProblem).toEqual(failure);
    });

    it('says the user gave a FlareSolverr of their own, and shows nothing of the helper of the app then', () => {
        const failure = { code: 'no-docker', message: 'no' } as const;
        const { service } = setup({ helper: makeHelper({ failure }), externalHelper: () => {return 'http://192.168.0.5:8191'} });
        expect(service.status()).toMatchObject({ helper: null, helperProblem: null, helperExternal: true });
    });

    it('shows nothing of the helper, and prepares none, until the user installed it', async () => {
        const helper = makeHelper();
        const { service } = setup({ helper, helperEnabled: () => {return false} });
        expect(service.status()).toMatchObject({ helper: null, helperProblem: null, helperExternal: false });
        await service.install();
        expect(helper.prepare).not.toHaveBeenCalled();
    });

    it('prepares the helper when the app opens once the user installed it', async () => {
        const helper = makeHelper();
        const { service } = setup({ helper, helperEnabled: () => {return true} });
        expect(service.status().helper).toEqual(HELPER_READY);
        await service.install();
        expect(helper.prepare).toHaveBeenCalledTimes(1);
    });

    it('installs the helper on request, and tells the server that runs to use it', async () => {
        const helper = makeHelper();
        const { service, client, server } = setup({ helper, helperUrl: () => {return Promise.resolve('http://127.0.0.1:8191')} });
        Object.assign(server, { status: 'running' });
        await service.installHelper();
        expect(helper.prepare).toHaveBeenCalledTimes(1);
        expect(client.setFlareSolverr).toHaveBeenCalledWith('http://127.0.0.1:8191');
    });

    it('removes the helper on request, and tells the server that runs to stop using it', async () => {
        const helper = makeHelper();
        const { service, client, server } = setup({ helper, helperUrl: () => {return Promise.resolve(null)} });
        Object.assign(server, { status: 'running' });
        await service.removeHelper();
        expect(helper.remove).toHaveBeenCalledTimes(1);
        expect(client.setFlareSolverr).toHaveBeenCalledWith(null);
    });

    it('installs and removes nothing where there is no helper', async () => {
        const { service, client } = setup();
        await expect(service.installHelper()).resolves.toBeUndefined();
        await expect(service.removeHelper()).resolves.toBeUndefined();
        expect(client.setFlareSolverr).not.toHaveBeenCalled();
    });

    it('treats an empty address as none', () => {
        const { service } = setup({ helper: makeHelper(), externalHelper: () => {return ''} });
        expect(service.status()).toMatchObject({ helper: HELPER_READY, helperExternal: false });
    });

    it('downloads the program first and then prepares the helper, and answers with the state of the program', async () => {
        const helper = makeHelper();
        const { service, tool } = setup({ helper, ready: false });
        const order: string[] = [];
        (tool.install as ReturnType<typeof vi.fn>).mockImplementation(() => {
            order.push('program');
            return Promise.resolve(READY);
        });
        helper.prepare.mockImplementation(() => {
            order.push('helper');
            return Promise.resolve(HELPER_READY);
        });
        await expect(service.install()).resolves.toEqual(READY);
        expect(order).toEqual(['program', 'helper']);
    });

    it('prepares no helper where there is none, when the user has their own, or when a server is given', async () => {
        const without = setup();
        await expect(without.service.install()).resolves.toEqual(READY);
        const helper = makeHelper();
        const own = setup({ helper, externalHelper: () => {return 'http://192.168.0.5:8191'} });
        await own.service.install();
        expect(helper.prepare).not.toHaveBeenCalled();
        const external = setup({ helper, externalBaseUrl: 'http://127.0.0.1:9999' });
        await expect(external.service.install()).resolves.toBeNull();
        expect(helper.prepare).not.toHaveBeenCalled();
    });

    describe('a server that started before the helper was ready', () => {
        function withHelper(url: string | null | Error, running: boolean) {
            const context = setup({
                helper: makeHelper(),
                helperUrl: () => {
                    return url instanceof Error ? Promise.reject(url) : Promise.resolve(url);
                }
            });
            Object.assign(context.server, { status: running ? 'running' : 'stopped' });
            return context;
        }

        it('is told to use the helper as soon as it is ready', async () => {
            const { service, client } = withHelper('http://127.0.0.1:8191', true);
            await service.install();
            expect(client.setFlareSolverr).toHaveBeenCalledTimes(1);
            expect(client.setFlareSolverr).toHaveBeenCalledWith('http://127.0.0.1:8191');
        });

        it('is not touched when it is not running: it reads the helper from its settings when it starts', async () => {
            const { service, client } = withHelper('http://127.0.0.1:8191', false);
            await service.install();
            expect(client.setFlareSolverr).not.toHaveBeenCalled();
        });

        it('is told to stop using a helper when there is none to use', async () => {
            const { service, client } = withHelper(null, true);
            await service.install();
            expect(client.setFlareSolverr).toHaveBeenCalledTimes(1);
            expect(client.setFlareSolverr).toHaveBeenCalledWith(null);
        });

        it('is told again when the address of the helper changes', async () => {
            const { service, client } = withHelper('http://127.0.0.1:9000', true);
            await service.applyHelper();
            expect(client.setFlareSolverr).toHaveBeenCalledWith('http://127.0.0.1:9000');
        });

        it('is left as it is, and the install still answers, when the helper cannot be started or the server refuses', async () => {
            const failing = withHelper(new Error('FlareSolverr did not become ready in time'), true);
            await expect(failing.service.install()).resolves.toEqual(READY);
            expect(failing.client.setFlareSolverr).not.toHaveBeenCalled();
            const refusing = withHelper('http://127.0.0.1:8191', true);
            refusing.client.setFlareSolverr.mockRejectedValueOnce(new SuwayomiApiError('API_ERROR', 'no'));
            await expect(refusing.service.install()).resolves.toEqual(READY);
        });

        it('does nothing when the service has no way to start a helper', async () => {
            const { service, client, server } = setup({ helper: makeHelper() });
            Object.assign(server, { status: 'running' });
            await service.install();
            expect(client.setFlareSolverr).not.toHaveBeenCalled();
        });
    });

    it('has processes to end while the server or the container is up, and not otherwise', () => {
        const idle = setup({ helper: makeHelper() });
        expect(idle.service.hasProcessesToEnd).toBe(false);
        Object.assign(idle.server, { status: 'starting' });
        expect(idle.service.hasProcessesToEnd).toBe(true);
        const container = setup({ helper: makeHelper({ status: 'running' }) });
        expect(container.service.hasProcessesToEnd).toBe(true);
        expect(setup().service.hasProcessesToEnd).toBe(false);
    });

    it('ends the helper with the server', async () => {
        const helper = makeHelper();
        const { service, server } = setup({ helper });
        await service.shutdown();
        expect(server.stop).toHaveBeenCalledTimes(1);
        expect(helper.stop).toHaveBeenCalledTimes(1);
    });
});

describe('MangaService install and server', () => {
    it('downloads the program', async () => {
        const { service, tool } = setup({ ready: false });
        await expect(service.install()).resolves.toEqual(READY);
        expect(tool.install).toHaveBeenCalledWith(SPEC);
    });

    it('downloads nothing where there is no program or a server is given', async () => {
        const first = setup({ spec: null });
        await expect(first.service.install()).resolves.toBeNull();
        const second = setup({ externalBaseUrl: 'http://127.0.0.1:9999' });
        await expect(second.service.install()).resolves.toBeNull();
        expect(first.tool.install).not.toHaveBeenCalled();
        expect(second.tool.install).not.toHaveBeenCalled();
    });

    it('starts the server when it is asked for and the program is there', async () => {
        const { service, server } = setup();
        await expect(service.requireServer()).resolves.toBe(BASE);
        expect(server.ensureRunning).toHaveBeenCalledTimes(1);
    });

    it('fails before the program is downloaded, without starting anything', async () => {
        const { service, server } = setup({ ready: false });
        await expect(service.requireServer()).rejects.toThrow('The manga server is not installed yet');
        expect(server.ensureRunning).not.toHaveBeenCalled();
    });

    it('fails where there is no program for the system', async () => {
        await expect(setup({ spec: null }).service.requireServer()).rejects.toThrow('The manga section is not available on this system');
    });

    it('answers with the server it is given and starts nothing', async () => {
        const { service, server } = setup({ externalBaseUrl: 'http://127.0.0.1:9999', ready: false });
        await expect(service.requireServer()).resolves.toBe('http://127.0.0.1:9999');
        expect(server.ensureRunning).not.toHaveBeenCalled();
    });

    it('warms the server up without waiting, and without failing when it cannot', async () => {
        const started = setup();
        started.service.warmUp();
        expect(started.server.ensureRunning).toHaveBeenCalledTimes(1);
        const missing = setup({ ready: false });
        expect(() => {
            missing.service.warmUp();
        }).not.toThrow();
        await Promise.resolve();
    });

    it('stops the server', async () => {
        const { service, server } = setup();
        await service.shutdown();
        expect(server.stop).toHaveBeenCalledTimes(1);
    });
});

describe('MangaService operations', () => {
    it('answers with the value of the client', async () => {
        const { service, client, calls } = setup();
        await expect(service.stores()).resolves.toEqual({ ok: true, value: [{ indexUrl: 'https://a/i.json', name: 'A' }] });
        await expect(service.addStore('https://b/i.json')).resolves.toEqual({ ok: true, value: { indexUrl: 'https://b/i.json', name: 'A' } });
        await expect(service.removeStore('https://b/i.json')).resolves.toEqual({ ok: true, value: null });
        await expect(service.extensions(false)).resolves.toEqual({ ok: true, value: [] });
        await expect(service.extensions(true)).resolves.toEqual({ ok: true, value: [] });
        await expect(service.changeExtension('eu.kanade.x', 'install')).resolves.toEqual({ ok: true, value: null });
        await expect(service.sources()).resolves.toEqual({ ok: true, value: [] });
        await expect(service.sourcePreferences('123')).resolves.toEqual({ ok: true, value: [{ position: 0, type: 'text', key: 'k', title: 'k', summary: '', enabled: true, value: 'v' }] });
        await expect(service.sourceFilters('123')).resolves.toEqual({ ok: true, value: [{ type: 'checkbox', name: 'x', value: false }] });
        await expect(service.setSourcePreference({ sourceId: '123', position: 0, type: 'text', value: 'x' })).resolves.toEqual({ ok: true, value: [] });
        await expect(service.list({ sourceId: '1', kind: 'popular', page: 1, query: '' })).resolves.toEqual({ ok: true, value: { items: [], hasNextPage: false } });
        await expect(service.details(7)).resolves.toMatchObject({ ok: true });
        expect(calls).toEqual(['stores', 'addStore https://b/i.json', 'removeStore', 'extensions', 'refreshExtensions', 'changeExtension', 'sources', 'sourcePreferences', 'sourceFilters', 'setSourcePreference', 'list', 'details']);
        expect(client.sourcePreferences).toHaveBeenCalledWith('123');
        expect(client.sourceFilters).toHaveBeenCalledWith('123');
        expect(client.setSourcePreference).toHaveBeenCalledWith({ sourceId: '123', position: 0, type: 'text', value: 'x' });
        expect(client.removeStore).toHaveBeenCalledWith('https://b/i.json');
        expect(client.changeExtension).toHaveBeenCalledWith('eu.kanade.x', 'install');
        expect(client.list).toHaveBeenCalledWith({ sourceId: '1', kind: 'popular', page: 1, query: '' });
        expect(client.mangaWithChapters).toHaveBeenCalledWith(7);
    });

    it('turns a failure of the client into an answer', async () => {
        const { service, client } = setup();
        client.sources.mockRejectedValueOnce(new SuwayomiApiError('API_ERROR', 'Source not found'));
        client.setSourcePreference.mockRejectedValueOnce(new SuwayomiApiError('API_ERROR', 'no such source'));
        client.stores.mockRejectedValueOnce(new Error('boom'));
        await expect(service.sources()).resolves.toEqual({ ok: false, error: { code: 'API_ERROR', message: 'Source not found' } });
        await expect(service.stores()).resolves.toEqual({ ok: false, error: { code: 'UNKNOWN', message: 'boom' } });
        await expect(service.setSourcePreference({ sourceId: '1', position: 0, type: 'text', value: 'x' })).resolves.toEqual({ ok: false, error: { code: 'API_ERROR', message: 'no such source' } });
    });

    it('gives the pages of a chapter and lets a failure pass for the download to handle', async () => {
        const { service, client } = setup();
        await expect(service.pagesOf(11)).resolves.toEqual(['p']);
        expect(client.chapterPages).toHaveBeenCalledWith(11);
        client.chapterPages.mockRejectedValueOnce(new SuwayomiApiError('SERVER_UNAVAILABLE', 'down'));
        await expect(service.pagesOf(11)).rejects.toMatchObject({ code: 'SERVER_UNAVAILABLE' });
    });
});

describe('toMangaError', () => {
    it('keeps the code of an error of the server', () => {
        expect(toMangaError(new SuwayomiApiError('REQUEST_FAILED', 'x'))).toEqual({ code: 'REQUEST_FAILED', message: 'x' });
    });

    it('turns anything else into an unknown error', () => {
        expect(toMangaError(new Error('e'))).toEqual({ code: 'UNKNOWN', message: 'e' });
        expect(toMangaError('text')).toEqual({ code: 'UNKNOWN', message: 'text' });
    });
});

describe('MangaService update of every extension', () => {
    function withExtensions(extensions: Array<{ pkgName: string; isInstalled: boolean; hasUpdate: boolean }>) {
        const context = setup();
        context.client.extensions.mockImplementation(() => {
            return Promise.resolve(extensions as never);
        });
        return context;
    }

    it('updates, in one request, the installed extensions that have an update, and answers with how many', async () => {
        const { service, client } = withExtensions([
            { pkgName: 'a', isInstalled: true, hasUpdate: true },
            { pkgName: 'b', isInstalled: true, hasUpdate: false },
            { pkgName: 'c', isInstalled: false, hasUpdate: true },
            { pkgName: 'd', isInstalled: true, hasUpdate: true }
        ]);
        await expect(service.updateAllExtensions()).resolves.toEqual({ ok: true, value: 2 });
        expect(client.updateExtensions).toHaveBeenCalledTimes(1);
        expect(client.updateExtensions).toHaveBeenCalledWith(['a', 'd']);
    });

    it('asks for nothing when no extension has an update', async () => {
        const { service, client } = withExtensions([{ pkgName: 'a', isInstalled: true, hasUpdate: false }]);
        await expect(service.updateAllExtensions()).resolves.toEqual({ ok: true, value: 0 });
        expect(client.updateExtensions).not.toHaveBeenCalled();
    });

    it('answers with the failure of the server', async () => {
        const { service, client } = withExtensions([{ pkgName: 'a', isInstalled: true, hasUpdate: true }]);
        client.updateExtensions.mockRejectedValue(new SuwayomiApiError('API_ERROR', 'boom'));
        await expect(service.updateAllExtensions()).resolves.toEqual({ ok: false, error: { code: 'API_ERROR', message: 'boom' } });
    });
});
