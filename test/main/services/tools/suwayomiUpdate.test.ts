import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    CHECKSUMS_ASSET,
    checksumOf,
    chosenSuwayomiSpec,
    clearSelectedSuwayomi,
    fetchLatestSuwayomi,
    isVersionTag,
    MAX_ANSWER_BYTES,
    MAX_RELEASE_BYTES,
    readSelectedSuwayomi,
    SUWAYOMI_LATEST_URL,
    UpdateLookupError,
    writeSelectedSuwayomi
} from '@main/services/tools/suwayomiUpdate';
import { SUWAYOMI_VERSION, suwayomiSpec } from '@main/services/tools/suwayomiRelease';
import { cleanTempDirs, makeTempDir } from '../../../helpers/tempDir';

afterEach(() => {
    cleanTempDirs();
});

const HASH = 'c'.repeat(64);
const BASE = 'https://github.com/Suwayomi/Suwayomi-Server/releases/download/v2.6.0';
const LINUX = 'Suwayomi-Server-v2.6.0-linux-x64.tar.gz';

function releaseJson(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
        tag_name: 'v2.6.0',
        assets: [
            { name: LINUX, size: 350_000_000, browser_download_url: `${BASE}/${LINUX}` },
            { name: CHECKSUMS_ASSET, size: 400, browser_download_url: `${BASE}/${CHECKSUMS_ASSET}` }
        ],
        ...overrides
    });
}

// A fetch that answers the release and then its checksums.
function fakeFetch(release: string, checksums = `${HASH}  ${LINUX}\n${'d'.repeat(64)}  other.zip\n`, status = 200) {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const impl = vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, headers: init?.headers as Record<string, string> });
        return Promise.resolve(new Response(url === SUWAYOMI_LATEST_URL ? release : checksums, { status }));
    }) as unknown as typeof fetch;
    return { impl, calls };
}

describe('isVersionTag', () => {
    it.each(['v2.6.0', 'v2.4.2366', 'v10.0.1'])('accepts %s', (tag) => {
        expect(isVersionTag(tag)).toBe(true);
    });

    it.each(['2.6.0', 'v2.6', 'latest', 'v2.6.0-beta', 'v2.6.0/../x', '', 5, null, undefined])('refuses %j', (tag) => {
        expect(isVersionTag(tag)).toBe(false);
    });
});

describe('checksumOf', () => {
    it('finds the checksum of a file in the listing, with one or two spaces or a star before the name', () => {
        expect(checksumOf(`${HASH}  a.zip\n${'d'.repeat(64)} *b.zip\n${'e'.repeat(64)} c.zip`, 'a.zip')).toBe(HASH);
        expect(checksumOf(`${HASH}  a.zip\n${'d'.repeat(64)} *b.zip`, 'b.zip')).toBe('d'.repeat(64));
        expect(checksumOf(`${HASH}  a.zip\r\n${'e'.repeat(64)}  c.zip\r\n`, 'c.zip')).toBe('e'.repeat(64));
    });

    it('gives the checksum in lower case', () => {
        expect(checksumOf(`${'ABCDEF0123456789'.repeat(4)}  a.zip`, 'a.zip')).toBe('abcdef0123456789'.repeat(4));
    });

    it('is null when the file is not listed, the name only looks like it, or the line is not a checksum', () => {
        expect(checksumOf(`${HASH}  a.zip`, 'b.zip')).toBeNull();
        expect(checksumOf(`${HASH}  xa.zip`, 'a.zip')).toBeNull();
        expect(checksumOf(`not-a-hash  a.zip\n${'1'.repeat(10)}  a.zip`, 'a.zip')).toBeNull();
        expect(checksumOf('', 'a.zip')).toBeNull();
    });
});

describe('fetchLatestSuwayomi', () => {
    it('gives the version, the size and the checksum the project publishes for this system', async () => {
        const { impl, calls } = fakeFetch(releaseJson());
        await expect(fetchLatestSuwayomi('linux', 'x64', impl)).resolves.toEqual({ version: 'v2.6.0', sha256: HASH, sizeBytes: 350_000_000 });
        expect(calls.map((call) => {return call.url})).toEqual([SUWAYOMI_LATEST_URL, `${BASE}/${CHECKSUMS_ASSET}`]);
        expect(calls[0]?.headers).toEqual({ Accept: 'application/vnd.github+json', 'User-Agent': 'pullwave' });
    });

    it('is null where the project publishes nothing for the system, without asking for the checksums', async () => {
        const { impl, calls } = fakeFetch(releaseJson());
        await expect(fetchLatestSuwayomi('darwin', 'arm64', impl)).resolves.toBeNull();
        expect(calls).toHaveLength(1);
    });

    it.each([
        ['a version that is not understood', releaseJson({ tag_name: 'nightly' })],
        ['no tag', releaseJson({ tag_name: undefined })],
        ['no program for the system', releaseJson({ assets: [{ name: CHECKSUMS_ASSET, size: 4, browser_download_url: `${BASE}/${CHECKSUMS_ASSET}` }] })],
        ['no checksums', releaseJson({ assets: [{ name: LINUX, size: 350_000_000, browser_download_url: `${BASE}/${LINUX}` }] })],
        ['assets that are not a list', releaseJson({ assets: 'x' })],
        ['a size that is not likely', releaseJson({ assets: [{ name: LINUX, size: MAX_RELEASE_BYTES + 1, browser_download_url: `${BASE}/${LINUX}` }, { name: CHECKSUMS_ASSET, size: 4, browser_download_url: `${BASE}/${CHECKSUMS_ASSET}` }] })],
        ['a size of zero', releaseJson({ assets: [{ name: LINUX, size: 0, browser_download_url: `${BASE}/${LINUX}` }, { name: CHECKSUMS_ASSET, size: 4, browser_download_url: `${BASE}/${CHECKSUMS_ASSET}` }] })],
        ['checksums somewhere else', releaseJson({ assets: [{ name: LINUX, size: 350_000_000, browser_download_url: `${BASE}/${LINUX}` }, { name: CHECKSUMS_ASSET, size: 4, browser_download_url: 'https://evil.example/Checksums.sha256' }] })]
    ])('refuses a release with %s', async (_name, release) => {
        const { impl } = fakeFetch(release);
        await expect(fetchLatestSuwayomi('linux', 'x64', impl)).rejects.toBeInstanceOf(UpdateLookupError);
    });

    it('refuses a release whose checksums do not list the program', async () => {
        const { impl } = fakeFetch(releaseJson(), `${HASH}  something-else.zip\n`);
        await expect(fetchLatestSuwayomi('linux', 'x64', impl)).rejects.toThrow('The checksums do not list the program for this system');
    });

    it('refuses an answer of the server that is not good, or is too big, or does not arrive', async () => {
        await expect(fetchLatestSuwayomi('linux', 'x64', fakeFetch(releaseJson(), '', 500).impl)).rejects.toThrow('The server answered 500');
        await expect(fetchLatestSuwayomi('linux', 'x64', fakeFetch('x'.repeat(MAX_ANSWER_BYTES + 1)).impl)).rejects.toThrow('The answer is too big');
        const failing = vi.fn(() => {
            return Promise.reject(new Error('offline'));
        }) as unknown as typeof fetch;
        await expect(fetchLatestSuwayomi('linux', 'x64', failing)).rejects.toThrow('offline');
    });
});

describe('the release the app runs', () => {
    const release = { version: 'v2.6.0', sha256: HASH, sizeBytes: 350_000_000 };

    it('is kept and read back as a program, with the address built from the version', () => {
        const file = join(makeTempDir(), 'tools', 'suwayomi-selected.json');
        writeSelectedSuwayomi(file, release);
        expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual(release);
        expect(existsSync(`${file}.part`)).toBe(false);
        expect(readSelectedSuwayomi(file, 'linux', 'x64')).toMatchObject({ id: 'suwayomi', version: 'v2.6.0', sha256: HASH, url: `${BASE}/${LINUX}` });
    });

    it('does not keep an address: a file with one has it ignored', () => {
        const file = join(makeTempDir(), 'selected.json');
        writeFileSync(file, JSON.stringify({ ...release, url: 'https://evil.example/x.tar.gz' }));
        expect(readSelectedSuwayomi(file, 'linux', 'x64')?.url).toBe(`${BASE}/${LINUX}`);
    });

    it.each([
        ['not JSON', '{oops'],
        ['a version that is not a tag', JSON.stringify({ ...release, version: '../../x' })],
        ['a checksum that is not one', JSON.stringify({ ...release, sha256: 'abc' })],
        ['a size that is not a number', JSON.stringify({ ...release, sizeBytes: '5' })],
        ['a size of zero', JSON.stringify({ ...release, sizeBytes: 0 })],
        ['a size that is too big', JSON.stringify({ ...release, sizeBytes: MAX_RELEASE_BYTES + 1 })],
        ['nothing', 'null']
    ])('is none when what was kept is %s', (_name, content) => {
        const file = join(makeTempDir(), 'selected.json');
        writeFileSync(file, content);
        expect(readSelectedSuwayomi(file, 'linux', 'x64')).toBeNull();
    });

    it('is none when there is no file, and where there is no program for the system', () => {
        const file = join(makeTempDir(), 'selected.json');
        expect(readSelectedSuwayomi(file, 'linux', 'x64')).toBeNull();
        writeSelectedSuwayomi(file, release);
        expect(readSelectedSuwayomi(file, 'darwin', 'arm64')).toBeNull();
    });

    it('goes away when the app goes back to the version it ships with, and that is not an error when there is none', () => {
        const file = join(makeTempDir(), 'selected.json');
        writeSelectedSuwayomi(file, release);
        clearSelectedSuwayomi(file);
        expect(existsSync(file)).toBe(false);
        expect(() => {
            clearSelectedSuwayomi(file);
        }).not.toThrow();
    });

    it('is the one the user updated to when there is one, otherwise the one the app ships with', () => {
        const file = join(makeTempDir(), 'selected.json');
        expect(chosenSuwayomiSpec(file, 'linux', 'x64')?.version).toBe(SUWAYOMI_VERSION);
        writeSelectedSuwayomi(file, release);
        expect(chosenSuwayomiSpec(file, 'linux', 'x64')?.version).toBe('v2.6.0');
        clearSelectedSuwayomi(file);
        expect(chosenSuwayomiSpec(file, 'linux', 'x64')).toEqual(suwayomiSpec('linux', 'x64'));
        expect(chosenSuwayomiSpec(file, 'darwin', 'arm64')).toBeNull();
    });
});
