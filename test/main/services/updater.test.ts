import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { BinaryResolver } from '@main/services/binaryResolver';
import { applyLanguage } from '@main/services/language';
import {
    BINARY_TIMEOUT_MS,
    compareYtdlpVersions,
    defaultUpdateExec,
    defaultUpdaterDependencies,
    discardOutdatedUpdate,
    MAX_BINARY_BYTES,
    MAX_SIGNATURE_BYTES,
    MAX_TEXT_BYTES,
    parseChecksum,
    resetYtdlp,
    TEXT_TIMEOUT_MS,
    updateYtdlp,
    type UpdaterDependencies
} from '@main/services/updater';
import { cleanTempDirs, makeTempDir } from '../../helpers/tempDir';

afterEach(() => {
    cleanTempDirs();
    vi.unstubAllGlobals();
});

const RELEASE_API = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';
const BASE = 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.09.01';
const BINARY = Buffer.from('#!/bin/sh\necho new\n');
const BINARY_HASH = createHash('sha256').update(BINARY).digest('hex');
const SIGNATURE = Buffer.from('signature of the checksums');
const SUMS_URL = `${BASE}/SHA2-256SUMS`;
const SIGNATURE_URL = `${BASE}/SHA2-256SUMS.sig`;
const REAL_SUMS = readFileSync(resolve(__dirname, '../../fixtures/ytdlp/SHA2-256SUMS'));
const REAL_SIGNATURE = readFileSync(resolve(__dirname, '../../fixtures/ytdlp/SHA2-256SUMS.sig'));

function sumsOf(lines: string): Buffer {
    return Buffer.from(lines);
}

function makeResolver(userBinDir: string, platform: NodeJS.Platform = 'linux'): BinaryResolver {
    return new BinaryResolver({ bundledDir: '/nonexistent-bundled', userBinDir }, () => {
        return false;
    }, platform);
}

// Serves what a release has: the checksums, the signature of the checksums and the binary (what `sums` lists is up to the test).
function makeDeps(overrides: Partial<UpdaterDependencies> = {}, sums: Buffer = sumsOf(`${BINARY_HASH}  yt-dlp_linux\nabc  yt-dlp\n`)): UpdaterDependencies {
    return {
        exec: vi.fn(async () => {
            return { ok: true, output: '2026.08.19\n' };
        }),
        fetchText: vi.fn(async () => {
            return JSON.stringify({ tag_name: '2026.09.01' });
        }),
        fetchBuffer: vi.fn(async (url: string) => {
            if (url === SUMS_URL) {
                return sums;
            }
            if (url === SIGNATURE_URL) {
                return SIGNATURE;
            }
            return BINARY;
        }),
        verifySums: vi.fn(async () => {
            return true;
        }),
        ...overrides
    };
}

describe('updateYtdlp messages in another language', () => {
    afterEach(() => {
        applyLanguage('en', 'en-US');
    });

    it('translates the checksum failure', async () => {
        applyLanguage('es', 'en-US');
        const deps = makeDeps({
            fetchBuffer: vi.fn(async () => {
                return Buffer.from('tampered');
            })
        });
        await expect(updateYtdlp(DEFAULT_SETTINGS, makeResolver(makeTempDir()), deps)).resolves.toEqual({
            ok: false,
            output: 'La verificación del checksum falló. Se descartó la descarga.'
        });
    });

    it('translates the up-to-date message', async () => {
        applyLanguage('pt', 'en-US');
        const deps = makeDeps({
            exec: vi.fn(async () => {
                return { ok: true, output: '2026.09.01\n' };
            })
        });
        await expect(updateYtdlp(DEFAULT_SETTINGS, makeResolver(makeTempDir()), deps)).resolves.toEqual({
            ok: true,
            output: 'O yt-dlp já está atualizado (2026.09.01).'
        });
    });
});

describe('parseChecksum', () => {
    it('finds the hash for a file name, lowercased', () => {
        expect(parseChecksum('AAA  yt-dlp\nBBB  yt-dlp_linux\n', 'yt-dlp_linux')).toBe('bbb');
    });

    it('returns null when the file is not listed', () => {
        expect(parseChecksum('AAA  yt-dlp\n', 'yt-dlp_linux')).toBeNull();
        expect(parseChecksum('', 'yt-dlp_linux')).toBeNull();
    });
});

describe('updateYtdlp with a custom path', () => {
    it('runs -U on the custom binary and returns its result', async () => {
        const deps = makeDeps({
            exec: vi.fn(async () => {
                return { ok: false, output: 'Permission denied' };
            })
        });
        const result = await updateYtdlp({ ...DEFAULT_SETTINGS, ytdlpPath: '/opt/yt-dlp' }, makeResolver(makeTempDir()), deps);
        expect(result).toEqual({ ok: false, output: 'Permission denied' });
        expect(deps.exec).toHaveBeenCalledWith('/opt/yt-dlp', ['-U']);
        expect(deps.fetchText).not.toHaveBeenCalled();
    });
});

describe('updateYtdlp downloading the latest release', () => {
    it('downloads, verifies and installs a newer version into the user folder', async () => {
        const dir = makeTempDir();
        const deps = makeDeps();
        const result = await updateYtdlp(DEFAULT_SETTINGS, makeResolver(dir), deps);
        expect(result).toEqual({ ok: true, output: 'Updated yt-dlp 2026.08.19 → 2026.09.01.' });
        expect(deps.fetchText).toHaveBeenCalledTimes(1);
        expect(deps.fetchText).toHaveBeenCalledWith(RELEASE_API);
        expect(deps.fetchBuffer).toHaveBeenCalledTimes(3);
        expect(deps.fetchBuffer).toHaveBeenNthCalledWith(1, SUMS_URL, MAX_TEXT_BYTES);
        expect(deps.fetchBuffer).toHaveBeenNthCalledWith(2, SIGNATURE_URL, MAX_SIGNATURE_BYTES);
        expect(deps.fetchBuffer).toHaveBeenNthCalledWith(3, `${BASE}/yt-dlp_linux`, MAX_BINARY_BYTES);
        expect(deps.verifySums).toHaveBeenCalledTimes(1);
        expect(deps.verifySums).toHaveBeenCalledWith(sumsOf(`${BINARY_HASH}  yt-dlp_linux\nabc  yt-dlp\n`), SIGNATURE);
        const target = join(dir, 'yt-dlp');
        expect(readFileSync(target)).toEqual(BINARY);
        expect(statSync(target).mode & 0o777).toBe(0o755);
        expect(existsSync(`${target}.tmp`)).toBe(false);
    });

    it('creates the user folder when it does not exist yet', async () => {
        const dir = join(makeTempDir(), 'nested', 'bin');
        await updateYtdlp(DEFAULT_SETTINGS, makeResolver(dir), makeDeps());
        expect(existsSync(join(dir, 'yt-dlp'))).toBe(true);
    });

    it('does nothing when already on the latest version', async () => {
        const dir = makeTempDir();
        const deps = makeDeps({
            exec: vi.fn(async () => {
                return { ok: true, output: '2026.09.01\n' };
            })
        });
        await expect(updateYtdlp(DEFAULT_SETTINGS, makeResolver(dir), deps)).resolves.toEqual({
            ok: true,
            output: 'yt-dlp is already up to date (2026.09.01).'
        });
        expect(deps.fetchBuffer).not.toHaveBeenCalled();
        expect(existsSync(join(dir, 'yt-dlp'))).toBe(false);
    });

    it('reports an unknown current version', async () => {
        const deps = makeDeps({
            // The one in use does not answer; the new one, in its temporary file, does.
            exec: vi.fn(async (file: string) => {
                return file.endsWith('.tmp') ? { ok: true, output: '2026.09.01\n' } : { ok: false, output: 'not found' };
            })
        });
        const result = await updateYtdlp(DEFAULT_SETTINGS, makeResolver(makeTempDir()), deps);
        expect(result).toEqual({ ok: true, output: 'Updated yt-dlp unknown → 2026.09.01.' });
    });

    it('discards the download when the checksum does not match', async () => {
        const dir = makeTempDir();
        const deps = makeDeps({
            fetchBuffer: vi.fn(async (url: string) => {
                if (url === SUMS_URL) {
                    return sumsOf(`${BINARY_HASH}  yt-dlp_linux\n`);
                }
                return url === SIGNATURE_URL ? SIGNATURE : Buffer.from('tampered');
            })
        });
        await expect(updateYtdlp(DEFAULT_SETTINGS, makeResolver(dir), deps)).resolves.toEqual({
            ok: false,
            output: 'Checksum verification failed. The download was discarded.'
        });
        expect(existsSync(join(dir, 'yt-dlp'))).toBe(false);
    });

    it('fails when the checksum for the asset is missing', async () => {
        const deps = makeDeps({}, sumsOf('abc  something-else\n'));
        const result = await updateYtdlp(DEFAULT_SETTINGS, makeResolver(makeTempDir()), deps);
        expect(result.ok).toBe(false);
        expect(result.output).toBe('Checksum verification failed. The download was discarded.');
        expect(deps.fetchBuffer).not.toHaveBeenCalledWith(`${BASE}/yt-dlp_linux`, MAX_BINARY_BYTES);
    });

    it('fails when the latest version cannot be determined', async () => {
        const deps = makeDeps({
            fetchText: vi.fn(async () => {
                return JSON.stringify({});
            })
        });
        await expect(updateYtdlp(DEFAULT_SETTINGS, makeResolver(makeTempDir()), deps)).resolves.toEqual({
            ok: false,
            output: 'Could not determine the latest yt-dlp version.'
        });
    });

    it('returns the error message when a request fails', async () => {
        const deps = makeDeps({
            fetchText: vi.fn(async () => {
                throw new Error('network down');
            })
        });
        await expect(updateYtdlp(DEFAULT_SETTINGS, makeResolver(makeTempDir()), deps)).resolves.toEqual({ ok: false, output: 'network down' });
    });

    it('returns a generic message for non-Error failures', async () => {
        const deps = makeDeps({
            fetchText: vi.fn(async () => {
                throw 'oops';
            })
        });
        await expect(updateYtdlp(DEFAULT_SETTINGS, makeResolver(makeTempDir()), deps)).resolves.toEqual({ ok: false, output: 'Update failed.' });
    });
});

describe('updateYtdlp on other platforms', () => {
    it('downloads yt-dlp.exe, verifies it against its own checksum line and installs it as yt-dlp.exe on Windows', async () => {
        const dir = makeTempDir();
        const deps = makeDeps({}, sumsOf(`deadbeef  yt-dlp_linux\n${BINARY_HASH}  yt-dlp.exe\n`));
        const result = await updateYtdlp(DEFAULT_SETTINGS, makeResolver(dir, 'win32'), deps, 'win32');
        expect(result).toEqual({ ok: true, output: 'Updated yt-dlp 2026.08.19 → 2026.09.01.' });
        expect(deps.fetchBuffer).toHaveBeenCalledWith(`${BASE}/yt-dlp.exe`, MAX_BINARY_BYTES);
        expect(readFileSync(join(dir, 'yt-dlp.exe'))).toEqual(BINARY);
        expect(existsSync(join(dir, 'yt-dlp'))).toBe(false);
    });

    it('refuses the Windows asset when only the Linux checksum matches', async () => {
        const dir = makeTempDir();
        const deps = makeDeps();
        const result = await updateYtdlp(DEFAULT_SETTINGS, makeResolver(dir, 'win32'), deps, 'win32');
        expect(result).toEqual({ ok: false, output: 'Checksum verification failed. The download was discarded.' });
        expect(existsSync(join(dir, 'yt-dlp.exe'))).toBe(false);
    });

    it('reports platforms without a known yt-dlp build', async () => {
        const deps = makeDeps();
        await expect(updateYtdlp(DEFAULT_SETTINGS, makeResolver(makeTempDir()), deps, 'darwin')).resolves.toEqual({
            ok: false,
            output: 'Updating yt-dlp is not supported on darwin.'
        });
        expect(deps.fetchText).not.toHaveBeenCalled();
    });
});

describe('defaultUpdaterDependencies', () => {
    it('fetches text and buffers with a user agent and a time limit', async () => {
        const fetchMock = vi.fn(async () => {
            return new Response('hello', { status: 200 });
        });
        vi.stubGlobal('fetch', fetchMock);
        await expect(defaultUpdaterDependencies.fetchText('https://x.test/a')).resolves.toBe('hello');
        await expect(defaultUpdaterDependencies.fetchBuffer('https://x.test/b', 100)).resolves.toEqual(Buffer.from('hello'));
        expect(fetchMock).toHaveBeenCalledWith('https://x.test/a', { headers: { 'User-Agent': 'pullwave' }, redirect: 'follow', signal: expect.any(AbortSignal) });
        expect(fetchMock).toHaveBeenCalledWith('https://x.test/b', { headers: { 'User-Agent': 'pullwave' }, redirect: 'follow', signal: expect.any(AbortSignal) });
    });

    it('has a time limit of 30 seconds for text and 5 minutes for a binary', () => {
        expect(TEXT_TIMEOUT_MS).toBe(30000);
        expect(BINARY_TIMEOUT_MS).toBe(300000);
        expect(MAX_TEXT_BYTES).toBe(1_000_000);
        expect(MAX_SIGNATURE_BYTES).toBe(65_536);
        expect(MAX_BINARY_BYTES).toBe(200_000_000);
    });

    it('stops waiting for a request that does not answer in time', async () => {
        const controller = new AbortController();
        const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
        vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
            return new Promise<Response>((_resolve, reject) => {
                init.signal?.addEventListener('abort', () => {
                    reject(new Error('aborted'));
                });
            });
        }));
        try {
            const binary = expect(defaultUpdaterDependencies.fetchBuffer('https://x.test/slow', 100)).rejects.toThrow('aborted');
            const text = expect(defaultUpdaterDependencies.fetchText('https://x.test/slow')).rejects.toThrow('aborted');
            expect(timeout).toHaveBeenCalledTimes(2);
            expect(timeout).toHaveBeenNthCalledWith(1, BINARY_TIMEOUT_MS);
            expect(timeout).toHaveBeenNthCalledWith(2, TEXT_TIMEOUT_MS);
            controller.abort();
            await binary;
            await text;
        } finally {
            timeout.mockRestore();
        }
    });

    it('refuses a file that says it is bigger than the limit, without reading it', async () => {
        const body = vi.fn();
        vi.stubGlobal('fetch', vi.fn(async () => {
            return { ok: true, status: 200, headers: new Headers({ 'content-length': '101' }), arrayBuffer: body } as unknown as Response;
        }));
        await expect(defaultUpdaterDependencies.fetchBuffer('https://x.test/big', 100)).rejects.toThrow('The download is larger than expected, so it was discarded.');
        expect(body).not.toHaveBeenCalled();
    });

    it('refuses a file that turns out bigger than the limit, whatever it said', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => {
            return new Response('x'.repeat(101), { status: 200 });
        }));
        await expect(defaultUpdaterDependencies.fetchBuffer('https://x.test/big', 100)).rejects.toThrow('The download is larger than expected, so it was discarded.');
    });

    it('accepts a file that is exactly as big as the limit', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => {
            return new Response('x'.repeat(100), { status: 200, headers: { 'content-length': '100' } });
        }));
        await expect(defaultUpdaterDependencies.fetchBuffer('https://x.test/exact', 100)).resolves.toEqual(Buffer.from('x'.repeat(100)));
    });

    it('rejects on a non-ok response', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => {
            return new Response('nope', { status: 404 });
        }));
        await expect(defaultUpdaterDependencies.fetchText('https://x.test/missing')).rejects.toThrow('Request failed (404) for https://x.test/missing');
    });
});

describe('defaultUpdateExec', () => {
    it('resolves ok with the combined output on success', async () => {
        await expect(defaultUpdateExec(process.execPath, ['-e', 'process.stdout.write("out")'])).resolves.toEqual({ ok: true, output: 'out' });
    });

    it('resolves not ok with stderr on failure', async () => {
        const result = await defaultUpdateExec(process.execPath, ['-e', 'process.stderr.write("bad");process.exit(1)']);
        expect(result.ok).toBe(false);
        expect(result.output).toBe('bad');
    });

    it('resolves not ok with the error message when the binary is missing', async () => {
        const result = await defaultUpdateExec('/nonexistent/binary', []);
        expect(result.ok).toBe(false);
        expect(result.output).toContain('ENOENT');
    });
});

describe('updateYtdlp checking the signature of the release', () => {
    it('does not install anything when the signature is not a good one, and does not even download the binary', async () => {
        const dir = makeTempDir();
        const deps = makeDeps({
            verifySums: vi.fn(async () => {
                return false;
            })
        });
        await expect(updateYtdlp(DEFAULT_SETTINGS, makeResolver(dir), deps)).resolves.toEqual({
            ok: false,
            output: 'The signature of the yt-dlp release could not be verified. The download was discarded.'
        });
        expect(deps.fetchBuffer).toHaveBeenCalledTimes(2);
        expect(deps.fetchBuffer).not.toHaveBeenCalledWith(`${BASE}/yt-dlp_linux`, MAX_BINARY_BYTES);
        expect(existsSync(join(dir, 'yt-dlp'))).toBe(false);
        expect(existsSync(join(dir, 'yt-dlp.tmp'))).toBe(false);
    });

    it('does not trust a release that has no signature', async () => {
        const dir = makeTempDir();
        const deps = makeDeps({
            fetchBuffer: vi.fn(async (url: string) => {
                if (url === SIGNATURE_URL) {
                    throw new Error('Request failed (404)');
                }
                return url === SUMS_URL ? sumsOf(`${BINARY_HASH}  yt-dlp_linux\n`) : BINARY;
            })
        });
        await expect(updateYtdlp(DEFAULT_SETTINGS, makeResolver(dir), deps)).resolves.toEqual({
            ok: false,
            output: 'The signature of the yt-dlp release could not be verified. The download was discarded.'
        });
        expect(deps.verifySums).not.toHaveBeenCalled();
        expect(existsSync(join(dir, 'yt-dlp'))).toBe(false);
    });

    it('checks the signature before it believes a hash of the list', async () => {
        const order: string[] = [];
        const deps = makeDeps({
            verifySums: vi.fn(async () => {
                order.push('verified');
                return true;
            }),
            fetchBuffer: vi.fn(async (url: string) => {
                order.push(url.split('/').at(-1) as string);
                if (url === SUMS_URL) {
                    return sumsOf(`${BINARY_HASH}  yt-dlp_linux\n`);
                }
                return url === SIGNATURE_URL ? SIGNATURE : BINARY;
            })
        });
        await updateYtdlp(DEFAULT_SETTINGS, makeResolver(makeTempDir()), deps);
        expect(order).toEqual(['SHA2-256SUMS', 'SHA2-256SUMS.sig', 'verified', 'yt-dlp_linux']);
    });

    it('accepts the real signature of a release and then goes on to check the hash of the binary', async () => {
        const dir = makeTempDir();
        const deps = makeDeps({
            fetchBuffer: vi.fn(async (url: string) => {
                if (url === SUMS_URL) {
                    return REAL_SUMS;
                }
                return url === SIGNATURE_URL ? REAL_SIGNATURE : BINARY;
            }),
            verifySums: defaultUpdaterDependencies.verifySums
        });
        // The signature is good; the stand-in binary is not the one the real list has the hash of.
        await expect(updateYtdlp(DEFAULT_SETTINGS, makeResolver(dir), deps)).resolves.toEqual({
            ok: false,
            output: 'Checksum verification failed. The download was discarded.'
        });
        expect(deps.fetchBuffer).toHaveBeenCalledWith(`${BASE}/yt-dlp_linux`, MAX_BINARY_BYTES);
        expect(existsSync(join(dir, 'yt-dlp'))).toBe(false);
    });

    it('refuses the real list when one byte of it was changed', async () => {
        const deps = makeDeps({
            fetchBuffer: vi.fn(async (url: string) => {
                if (url === SUMS_URL) {
                    return Buffer.concat([REAL_SUMS, Buffer.from('\n')]);
                }
                return url === SIGNATURE_URL ? REAL_SIGNATURE : BINARY;
            }),
            verifySums: defaultUpdaterDependencies.verifySums
        });
        await expect(updateYtdlp(DEFAULT_SETTINGS, makeResolver(makeTempDir()), deps)).resolves.toEqual({
            ok: false,
            output: 'The signature of the yt-dlp release could not be verified. The download was discarded.'
        });
        expect(deps.fetchBuffer).toHaveBeenCalledTimes(2);
    });

    it('translates the failure of the signature', async () => {
        applyLanguage('pt', 'en-US');
        try {
            const deps = makeDeps({
                verifySums: vi.fn(async () => {
                    return false;
                })
            });
            await expect(updateYtdlp(DEFAULT_SETTINGS, makeResolver(makeTempDir()), deps)).resolves.toEqual({
                ok: false,
                output: 'Não foi possível verificar a assinatura da versão do yt-dlp. O download foi descartado.'
            });
        } finally {
            applyLanguage('en', 'en-US');
        }
    });
});

describe('updateYtdlp trying the new binary before it replaces the one in use', () => {
    it('keeps the one in use, and leaves no file behind, when the new one does not run', async () => {
        const dir = makeTempDir();
        writeFileSync(join(dir, 'yt-dlp'), 'the one in use');
        const deps = makeDeps({
            exec: vi.fn(async (file: string) => {
                return file.endsWith('.tmp') ? { ok: false, output: 'Exec format error' } : { ok: true, output: '2026.08.19\n' };
            })
        });
        await expect(updateYtdlp(DEFAULT_SETTINGS, makeResolver(dir), deps)).resolves.toEqual({
            ok: false,
            output: 'The new yt-dlp does not run, so it was not installed. The one in use was kept.'
        });
        expect(readFileSync(join(dir, 'yt-dlp'), 'utf-8')).toBe('the one in use');
        expect(existsSync(join(dir, 'yt-dlp.tmp'))).toBe(false);
    });

    it('does not install a new one that runs but says nothing', async () => {
        const dir = makeTempDir();
        const deps = makeDeps({
            exec: vi.fn(async (file: string) => {
                return file.endsWith('.tmp') ? { ok: true, output: '' } : { ok: true, output: '2026.08.19\n' };
            })
        });
        const result = await updateYtdlp(DEFAULT_SETTINGS, makeResolver(dir), deps);
        expect(result.ok).toBe(false);
        expect(existsSync(join(dir, 'yt-dlp'))).toBe(false);
    });

    it('runs the new one with --version, from its temporary file, and installs it only after that', async () => {
        const dir = makeTempDir();
        const calls: Array<{ file: string; args: string[]; installed: boolean }> = [];
        const deps = makeDeps({
            exec: vi.fn(async (file: string, args: string[]) => {
                calls.push({ file, args, installed: existsSync(join(dir, 'yt-dlp')) });
                return { ok: true, output: file.endsWith('.tmp') ? '2026.09.01\n' : '2026.08.19\n' };
            })
        });
        await updateYtdlp(DEFAULT_SETTINGS, makeResolver(dir), deps);
        // The one in use is asked first (by the name the system finds it by, as nothing is saved yet), then the new one.
        expect(calls).toEqual([
            { file: 'yt-dlp', args: ['--version'], installed: false },
            { file: `${join(dir, 'yt-dlp')}.tmp`, args: ['--version'], installed: false }
        ]);
        expect(existsSync(join(dir, 'yt-dlp'))).toBe(true);
    });

    it('translates the failure of the new binary', async () => {
        applyLanguage('es', 'en-US');
        try {
            const deps = makeDeps({
                exec: vi.fn(async (file: string) => {
                    return file.endsWith('.tmp') ? { ok: false, output: 'bad' } : { ok: true, output: '2026.08.19\n' };
                })
            });
            await expect(updateYtdlp(DEFAULT_SETTINGS, makeResolver(makeTempDir()), deps)).resolves.toEqual({
                ok: false,
                output: 'El nuevo yt-dlp no se ejecuta, así que no se instaló. Se mantuvo el que estaba en uso.'
            });
        } finally {
            applyLanguage('en', 'en-US');
        }
    });
});

describe('compareYtdlpVersions', () => {
    it.each([
        ['2026.09.01', '2026.08.19', 1],
        ['2026.08.19', '2026.09.01', -1],
        ['2027.01.01', '2026.12.31', 1],
        ['2026.08.19', '2026.08.19', 0],
        ['2026.08.19.1', '2026.08.19', 1],
        ['2026.08.19', '2026.08.19.2', -1],
        ['2026.08.19.10', '2026.08.19.9', 1]
    ])('compares %s with %s as %s', (first, second, sign) => {
        expect(Math.sign(compareYtdlpVersions(first, second) as number)).toBe(sign);
    });

    it('reads a version with spaces around it and with an ending after the numbers', () => {
        expect(compareYtdlpVersions(' 2026.09.01\n', '2026.08.19')).toBeGreaterThan(0);
        expect(compareYtdlpVersions('2026.09.01-nightly', '2026.09.01')).toBe(0);
    });

    it.each([['unknown', '2026.08.19'], ['2026.08.19', ''], ['2026.8.19', '2026.08.19'], ['v2026.08.19', '2026.08.19']])('cannot compare %j with %j', (first, second) => {
        expect(compareYtdlpVersions(first, second)).toBeNull();
    });
});

describe('the yt-dlp an update saved', () => {
    function placeBinaries(options: { bundled?: boolean; updated?: boolean }): { resolver: BinaryResolver; bundledDir: string; userBinDir: string } {
        const root = makeTempDir();
        const bundledDir = join(root, 'bundled');
        const userBinDir = join(root, 'user');
        mkdirSync(bundledDir, { recursive: true });
        mkdirSync(userBinDir, { recursive: true });
        if (options.bundled) {
            writeFileSync(join(bundledDir, 'yt-dlp'), 'bundled');
        }
        if (options.updated) {
            writeFileSync(join(userBinDir, 'yt-dlp'), 'updated');
        }
        return { resolver: new BinaryResolver({ bundledDir, userBinDir }, undefined, 'linux'), bundledDir, userBinDir };
    }

    function versions(bundled: string | null, updated: string | null): UpdaterDependencies['exec'] {
        return vi.fn(async (file: string) => {
            const version = file.includes('bundled') ? bundled : updated;
            return version === null ? { ok: false, output: 'cannot run' } : { ok: true, output: `${version}\n` };
        });
    }

    describe('discardOutdatedUpdate', () => {
        it('deletes the saved one when the one that ships with the app is newer, so the bundled one is used again', async () => {
            const { resolver, userBinDir } = placeBinaries({ bundled: true, updated: true });
            expect(resolver.ytdlp(DEFAULT_SETTINGS).source).toBe('updated');

            await expect(discardOutdatedUpdate(DEFAULT_SETTINGS, resolver, { exec: versions('2026.09.01', '2026.08.19') })).resolves.toBe(true);

            expect(existsSync(join(userBinDir, 'yt-dlp'))).toBe(false);
            expect(resolver.ytdlp(DEFAULT_SETTINGS).source).toBe('bundled');
        });

        it('keeps the saved one when it is newer than the bundled one, or the same', async () => {
            for (const [bundled, updated] of [['2026.08.19', '2026.09.01'], ['2026.09.01', '2026.09.01'], ['2026.09.01', '2026.09.01.1']]) {
                const { resolver, userBinDir } = placeBinaries({ bundled: true, updated: true });
                await expect(discardOutdatedUpdate(DEFAULT_SETTINGS, resolver, { exec: versions(bundled as string, updated as string) })).resolves.toBe(false);
                expect(existsSync(join(userBinDir, 'yt-dlp'))).toBe(true);
            }
        });

        it('deletes the saved one when it no longer runs and the bundled one does', async () => {
            const { resolver, userBinDir } = placeBinaries({ bundled: true, updated: true });
            await expect(discardOutdatedUpdate(DEFAULT_SETTINGS, resolver, { exec: versions('2026.09.01', null) })).resolves.toBe(true);
            expect(existsSync(join(userBinDir, 'yt-dlp'))).toBe(false);
        });

        it('keeps the saved one when the bundled one does not run either, because there is nothing better to go back to', async () => {
            const { resolver, userBinDir } = placeBinaries({ bundled: true, updated: true });
            await expect(discardOutdatedUpdate(DEFAULT_SETTINGS, resolver, { exec: versions(null, null) })).resolves.toBe(false);
            expect(existsSync(join(userBinDir, 'yt-dlp'))).toBe(true);
        });

        it('keeps the saved one when the versions cannot be compared', async () => {
            const { resolver, userBinDir } = placeBinaries({ bundled: true, updated: true });
            await expect(discardOutdatedUpdate(DEFAULT_SETTINGS, resolver, { exec: versions('nightly', '2026.08.19') })).resolves.toBe(false);
            expect(existsSync(join(userBinDir, 'yt-dlp'))).toBe(true);
        });

        it('does not run anything when there is no saved one, or no bundled one', async () => {
            for (const options of [{ bundled: true }, { updated: true }, {}]) {
                const { resolver } = placeBinaries(options);
                const exec = versions('2026.09.01', '2026.08.19');
                await expect(discardOutdatedUpdate(DEFAULT_SETTINGS, resolver, { exec })).resolves.toBe(false);
                expect(exec).not.toHaveBeenCalled();
            }
        });

        it('leaves alone a yt-dlp the user chose in the settings, and runs nothing', async () => {
            const { resolver, userBinDir } = placeBinaries({ bundled: true, updated: true });
            const exec = versions('2026.09.01', '2026.08.19');
            await expect(discardOutdatedUpdate({ ...DEFAULT_SETTINGS, ytdlpPath: '/opt/yt-dlp' }, resolver, { exec })).resolves.toBe(false);
            expect(exec).not.toHaveBeenCalled();
            expect(existsSync(join(userBinDir, 'yt-dlp'))).toBe(true);
        });

        it('asks each one for its version with --version', async () => {
            const { resolver, bundledDir, userBinDir } = placeBinaries({ bundled: true, updated: true });
            const exec = versions('2026.09.01', '2026.09.01');
            await discardOutdatedUpdate(DEFAULT_SETTINGS, resolver, { exec });
            expect(exec).toHaveBeenNthCalledWith(1, join(bundledDir, 'yt-dlp'), ['--version']);
            expect(exec).toHaveBeenNthCalledWith(2, join(userBinDir, 'yt-dlp'), ['--version']);
        });
    });

    describe('resetYtdlp', () => {
        it('deletes the saved one, and the bundled one is the one in use again', () => {
            const { resolver, userBinDir } = placeBinaries({ bundled: true, updated: true });
            expect(resetYtdlp(resolver)).toEqual({ ok: true, output: 'Using the yt-dlp that ships with the app again.' });
            expect(existsSync(join(userBinDir, 'yt-dlp'))).toBe(false);
            expect(resolver.ytdlp(DEFAULT_SETTINGS).source).toBe('bundled');
        });

        it('says so when there is no saved one, and touches nothing', () => {
            const { resolver, bundledDir } = placeBinaries({ bundled: true });
            expect(resetYtdlp(resolver)).toEqual({ ok: false, output: 'There is no updated yt-dlp to remove: the one that ships with the app is already in use.' });
            expect(readFileSync(join(bundledDir, 'yt-dlp'), 'utf-8')).toBe('bundled');
        });

        it('translates its messages', () => {
            applyLanguage('pt', 'en-US');
            try {
                expect(resetYtdlp(placeBinaries({ bundled: true, updated: true }).resolver).output).toBe('Voltou a usar o yt-dlp que acompanha o app.');
                expect(resetYtdlp(placeBinaries({ bundled: true }).resolver).output).toBe('Não há yt-dlp atualizado para remover: o que acompanha o app já está em uso.');
            } finally {
                applyLanguage('en', 'en-US');
            }
        });
    });
});
