import { createHash } from 'node:crypto';
import {
    ANICLI_COMMIT_API,
    checksumOf,
    DENO_RELEASE_API,
    latestAniCli,
    latestDeno,
    latestFfmpeg,
    latestYtdlp,
    LookupError,
    looksLikeAniCli,
    MAX_SIZES,
    singleChecksum,
    unfitPatches,
    YTDLP_RELEASE_API,
    type LatestDependencies
} from '@main/services/tools/programLatest';
import { FFMPEG_RELEASE_API } from '@main/services/tools/programSpecs';
import { ALL_SUBTITLES_PART, aniCliScript, aniCliScriptWithout, DEBUG_PART, SELECTION_PART } from '../../../helpers/aniCliScripts';

const SHA = 'cd'.repeat(32);
const OTHER_SHA = 'ef'.repeat(32);

function release(tag: string | null, assets: Array<{ name: string; size: number }>): string {
    return JSON.stringify({ tag_name: tag, assets });
}

interface Calls {
    texts: string[];
    buffers: Array<[string, number]>;
    sizes: string[];
    verified: Array<[string, string]>;
}

// Answers by address; an address that is not in the table fails like a request that does not go through.
function deps(table: Record<string, string | Buffer | number>, options: { signatureGood?: boolean } = {}): { deps: LatestDependencies; calls: Calls } {
    const calls: Calls = { texts: [], buffers: [], sizes: [], verified: [] };
    const answer = (url: string): string | Buffer | number => {
        const found = table[url];
        if (found === undefined) {
            throw new Error(`Request failed (404) for ${url}`);
        }
        return found;
    };
    return {
        calls,
        deps: {
            fetchText: (url) => {
                calls.texts.push(url);
                try {
                    return Promise.resolve(String(answer(url)));
                } catch (error) {
                    return Promise.reject(error);
                }
            },
            fetchBuffer: (url, maxBytes) => {
                calls.buffers.push([url, maxBytes]);
                try {
                    return Promise.resolve(Buffer.from(answer(url) as string | Buffer));
                } catch (error) {
                    return Promise.reject(error);
                }
            },
            fetchSize: (url) => {
                calls.sizes.push(url);
                try {
                    return Promise.resolve(Number(answer(url)));
                } catch (error) {
                    return Promise.reject(error);
                }
            },
            verifySums: (sums, signature) => {
                calls.verified.push([sums.toString('utf-8'), signature.toString('utf-8')]);
                return Promise.resolve(options.signatureGood ?? true);
            }
        }
    };
}

async function failure(promise: Promise<unknown>): Promise<LookupError> {
    try {
        await promise;
    } catch (error) {
        expect(error).toBeInstanceOf(LookupError);
        return error as LookupError;
    }
    throw new Error('It did not fail');
}

describe('checksumOf', () => {
    const LIST = [`${SHA}  yt-dlp_linux`, `${OTHER_SHA.toUpperCase()} *yt-dlp.exe`, 'not a line', ''].join('\n');

    it('gives the hash of the file, in lower case, for both ways a list is written', () => {
        expect(checksumOf(LIST, 'yt-dlp_linux')).toBe(SHA);
        expect(checksumOf(LIST, 'yt-dlp.exe')).toBe(OTHER_SHA);
    });

    it('is null for a file that is not in the list, or that only has a part of a name in it', () => {
        expect(checksumOf(LIST, 'yt-dlp')).toBeNull();
        expect(checksumOf(LIST, 'yt-dlp_linux.zip')).toBeNull();
        expect(checksumOf('', 'x')).toBeNull();
    });

    it('does not take a hash that is not 64 digits', () => {
        expect(checksumOf(`${'a'.repeat(63)}  file`, 'file')).toBeNull();
        expect(checksumOf(`${'g'.repeat(64)}  file`, 'file')).toBeNull();
    });
});

describe('singleChecksum', () => {
    it('finds the hash in a file of one checksum, whatever its shape', () => {
        expect(singleChecksum(SHA)).toBe(SHA);
        expect(singleChecksum(`${SHA.toUpperCase()}  deno.zip\n`)).toBe(SHA);
        expect(singleChecksum(`\nAlgorithm : SHA256\nHash      : ${SHA.toUpperCase()}\nPath      : C:\\a\\deno.zip\n`)).toBe(SHA);
    });

    it('is null when there is none', () => {
        expect(singleChecksum('')).toBeNull();
        expect(singleChecksum('<html>not found</html>')).toBeNull();
        expect(singleChecksum('a'.repeat(63))).toBeNull();
    });
});

describe('latestYtdlp', () => {
    const SUMS = `${SHA}  yt-dlp_linux\n${OTHER_SHA}  yt-dlp.exe\n`;
    const BASE = 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.09.01';

    function table(extra: Record<string, string | Buffer | number> = {}): Record<string, string | Buffer | number> {
        return {
            [YTDLP_RELEASE_API]: release('2026.09.01', [
                { name: 'yt-dlp_linux', size: 41_000_000 },
                { name: 'yt-dlp.exe', size: 18_000_000 }
            ]),
            [`${BASE}/SHA2-256SUMS`]: SUMS,
            [`${BASE}/SHA2-256SUMS.sig`]: 'signature',
            ...extra
        };
    }

    it('makes the spec of the latest release, with the checksum of the file of the system', async () => {
        const { deps: dependencies, calls } = deps(table());
        await expect(latestYtdlp('linux', dependencies)).resolves.toEqual({
            id: 'ytdlp',
            version: '2026.09.01',
            url: `${BASE}/yt-dlp_linux`,
            sha256: SHA,
            sizeBytes: 41_000_000,
            format: 'raw',
            stripComponents: 0,
            exclude: [],
            executables: ['yt-dlp'],
            entry: 'yt-dlp'
        });
        await expect(latestYtdlp('win32', dependencies)).resolves.toMatchObject({ url: `${BASE}/yt-dlp.exe`, sha256: OTHER_SHA, sizeBytes: 18_000_000, entry: 'yt-dlp.exe' });
        expect(calls.verified[0]).toEqual([SUMS, 'signature']);
        expect(calls.buffers).toContainEqual([`${BASE}/SHA2-256SUMS`, 1_000_000]);
        expect(calls.buffers).toContainEqual([`${BASE}/SHA2-256SUMS.sig`, 65_536]);
    });

    it('does not trust a list of checksums that is not signed by the project', async () => {
        const { deps: dependencies } = deps(table(), { signatureGood: false });
        const error = await failure(latestYtdlp('linux', dependencies));
        expect(error.reason).toBe('signature');
    });

    it('does not trust a release without a signature', async () => {
        const entries = table();
        delete entries[`${BASE}/SHA2-256SUMS.sig`];
        const error = await failure(latestYtdlp('linux', deps(entries).deps));
        expect(error.reason).toBe('signature');
    });

    it('says the checksum is missing when the list does not have the file', async () => {
        const error = await failure(latestYtdlp('linux', deps(table({ [`${BASE}/SHA2-256SUMS`]: `${SHA}  something-else\n` })).deps));
        expect(error.reason).toBe('checksum');
    });

    it.each([[null], ['latest'], ['2026.9.1'], ['../2026.09.01'], ['v2026.09.01']])('refuses a release whose tag is %j', async (tag) => {
        const error = await failure(latestYtdlp('linux', deps({ [YTDLP_RELEASE_API]: release(tag, [{ name: 'yt-dlp_linux', size: 1000 }]) }).deps));
        expect(error.reason).toBe('no-release');
    });

    it.each([[0], [-5], [MAX_SIZES.ytdlp + 1], [Number.NaN]])('refuses a file of size %j', async (size) => {
        const error = await failure(latestYtdlp('linux', deps({ [YTDLP_RELEASE_API]: release('2026.09.01', [{ name: 'yt-dlp_linux', size }]) }).deps));
        expect(error.reason).toBe('no-release');
    });

    it('says there is no release when it has no file for the system', async () => {
        const error = await failure(latestYtdlp('win32', deps({ [YTDLP_RELEASE_API]: release('2026.09.01', [{ name: 'yt-dlp_linux', size: 1000 }]) }).deps));
        expect(error.reason).toBe('no-release');
    });

    it('says the answer is not a release when it is not JSON, or not an object', async () => {
        expect((await failure(latestYtdlp('linux', deps({ [YTDLP_RELEASE_API]: '<html>' }).deps))).reason).toBe('invalid');
        expect((await failure(latestYtdlp('linux', deps({ [YTDLP_RELEASE_API]: '[1]' }).deps))).reason).toBe('invalid');
        expect((await failure(latestYtdlp('linux', deps({ [YTDLP_RELEASE_API]: 'null' }).deps))).reason).toBe('invalid');
    });

    it('passes on the failure of the network as it is', async () => {
        await expect(latestYtdlp('linux', deps({}).deps)).rejects.toThrow('Request failed (404)');
    });

    it('ignores the files of the release that have no name or no size', async () => {
        const text = JSON.stringify({ tag_name: '2026.09.01', assets: [{ name: 5 }, null, { name: 'yt-dlp_linux', size: '41' }, { name: 'yt-dlp_linux', size: 41_000_000 }] });
        const spec = await latestYtdlp('linux', deps(table({ [YTDLP_RELEASE_API]: text })).deps);
        expect(spec.sizeBytes).toBe(41_000_000);
    });
});

describe('latestDeno', () => {
    const BASE = 'https://github.com/denoland/deno/releases/download/v2.10.0';
    const LINUX = 'deno-x86_64-unknown-linux-gnu.zip';
    const WINDOWS = 'deno-x86_64-pc-windows-msvc.zip';

    function table(extra: Record<string, string | Buffer | number> = {}): Record<string, string | Buffer | number> {
        return {
            [DENO_RELEASE_API]: release('v2.10.0', [
                { name: LINUX, size: 42_000_000 },
                { name: `${LINUX}.sha256sum`, size: 100 },
                { name: WINDOWS, size: 43_000_000 },
                { name: `${WINDOWS}.sha256sum`, size: 177 }
            ]),
            [`${BASE}/${LINUX}.sha256sum`]: `${SHA}  ${LINUX}\n`,
            [`${BASE}/${WINDOWS}.sha256sum`]: `\nAlgorithm : SHA256\nHash      : ${OTHER_SHA.toUpperCase()}\nPath      : C:\\a\\${WINDOWS}\n`,
            ...extra
        };
    }

    it('makes the spec of the latest release for each system, with the checksum the project publishes', async () => {
        const { deps: dependencies } = deps(table());
        await expect(latestDeno('linux', dependencies)).resolves.toEqual({
            id: 'deno',
            version: 'v2.10.0',
            url: `${BASE}/${LINUX}`,
            sha256: SHA,
            sizeBytes: 42_000_000,
            format: 'zip',
            stripComponents: 0,
            exclude: [],
            executables: ['deno'],
            entry: 'deno'
        });
        await expect(latestDeno('win32', dependencies)).resolves.toMatchObject({ url: `${BASE}/${WINDOWS}`, sha256: OTHER_SHA, sizeBytes: 43_000_000, entry: 'deno.exe' });
    });

    it('says the checksum is missing when the release does not publish it, or the file has none in it', async () => {
        const without = release('v2.10.0', [{ name: LINUX, size: 42_000_000 }]);
        expect((await failure(latestDeno('linux', deps(table({ [DENO_RELEASE_API]: without })).deps))).reason).toBe('checksum');
        expect((await failure(latestDeno('linux', deps(table({ [`${BASE}/${LINUX}.sha256sum`]: 'nothing here' })).deps))).reason).toBe('checksum');
    });

    it.each([[null], ['2.10.0'], ['v2.10'], ['v2.10.0-rc.1']])('refuses a release whose tag is %j', async (tag) => {
        const error = await failure(latestDeno('linux', deps(table({ [DENO_RELEASE_API]: release(tag, [{ name: LINUX, size: 1000 }]) })).deps));
        expect(error.reason).toBe('no-release');
    });

    it('refuses a file that is too big', async () => {
        const huge = release('v2.10.0', [{ name: LINUX, size: MAX_SIZES.deno + 1 }, { name: `${LINUX}.sha256sum`, size: 100 }]);
        expect((await failure(latestDeno('linux', deps(table({ [DENO_RELEASE_API]: huge })).deps))).reason).toBe('no-release');
    });
});

describe('latestFfmpeg', () => {
    const BASE = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest';
    const WIN90 = 'ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip';
    const WIN81 = 'ffmpeg-n8.1-latest-win64-gpl-shared-8.1.zip';
    const N90 = 'ffmpeg-n9.0-latest-linux64-gpl-shared-9.0.tar.xz';
    const N81 = 'ffmpeg-n8.1-latest-linux64-gpl-shared-8.1.tar.xz';
    const N100 = 'ffmpeg-n10.0-latest-linux64-gpl-shared-10.0.tar.xz';

    function table(extra: Record<string, string | Buffer | number> = {}): Record<string, string | Buffer | number> {
        return {
            [FFMPEG_RELEASE_API]: release(null, [
                { name: 'ffmpeg-master-latest-linux64-gpl-shared.tar.xz', size: 70_000_000 },
                { name: N81, size: 71_000_000 },
                { name: N90, size: 69_000_000 },
                { name: WIN81, size: 90_000_000 },
                { name: WIN90, size: 86_000_000 },
                { name: 'ffmpeg-master-latest-win64-gpl-shared.zip', size: 88_000_000 },
                { name: 'ffmpeg-n9.0-latest-linux64-lgpl-shared-9.0.tar.xz', size: 60_000_000 },
                { name: 'checksums.sha256', size: 5000 }
            ]),
            [`${BASE}/checksums.sha256`]: `${OTHER_SHA}  ${N81}\n${SHA}  ${N90}\n${'12'.repeat(32)}  ${N100}\n${OTHER_SHA}  ${WIN81}\n${SHA}  ${WIN90}\n`,
            ...extra
        };
    }

    it('takes the newest numbered branch of the GPL shared build of BtbN on Linux, with its checksum', async () => {
        await expect(latestFfmpeg('linux', deps(table()).deps)).resolves.toEqual({
            id: 'ffmpeg',
            version: `latest-${SHA.slice(0, 12)}`,
            url: `${BASE}/${N90}`,
            sha256: SHA,
            sizeBytes: 69_000_000,
            format: 'tar.xz',
            stripComponents: 1,
            exclude: ['include'],
            executables: ['bin/ffmpeg', 'bin/ffprobe'],
            entry: 'bin/ffmpeg'
        });
    });

    it('compares the branches as numbers, so 10.0 is newer than 9.0', async () => {
        const assets = release(null, [{ name: N90, size: 69_000_000 }, { name: N100, size: 72_000_000 }, { name: N81, size: 71_000_000 }]);
        const spec = await latestFfmpeg('linux', deps(table({ [FFMPEG_RELEASE_API]: assets })).deps);
        expect(spec.url).toBe(`${BASE}/${N100}`);
        expect(spec.sha256).toBe('12'.repeat(32));
    });

    it('takes the newest numbered branch of the win64 GPL shared build of BtbN on Windows, with its checksum', async () => {
        await expect(latestFfmpeg('win32', deps(table()).deps)).resolves.toEqual({
            id: 'ffmpeg',
            version: `latest-${SHA.slice(0, 12)}`,
            url: `${BASE}/${WIN90}`,
            sha256: SHA,
            sizeBytes: 86_000_000,
            format: 'zip',
            stripComponents: 1,
            exclude: [],
            executables: ['bin/ffmpeg.exe', 'bin/ffprobe.exe'],
            entry: 'bin/ffmpeg.exe'
        });
    });

    it('says there is no build when the release has none for the system', async () => {
        const none = release(null, [{ name: 'ffmpeg-master-latest-linux64-gpl-shared.tar.xz', size: 70_000_000 }]);
        expect((await failure(latestFfmpeg('linux', deps(table({ [FFMPEG_RELEASE_API]: none })).deps))).reason).toBe('no-release');
    });

    it('says the checksum is missing when the list does not have the build', async () => {
        expect((await failure(latestFfmpeg('linux', deps(table({ [`${BASE}/checksums.sha256`]: `${SHA}  other.tar.xz\n` })).deps))).reason).toBe('checksum');
        expect((await failure(latestFfmpeg('win32', deps(table({ [`${BASE}/checksums.sha256`]: `${SHA}  other.zip\n` })).deps))).reason).toBe('checksum');
    });

    it('refuses a build that is too big', async () => {
        const huge = release(null, [{ name: N90, size: MAX_SIZES.ffmpeg + 1 }]);
        expect((await failure(latestFfmpeg('linux', deps(table({ [FFMPEG_RELEASE_API]: huge })).deps))).reason).toBe('no-release');
        const hugeWindows = release(null, [{ name: WIN90, size: MAX_SIZES.ffmpeg + 1 }]);
        expect((await failure(latestFfmpeg('win32', deps(table({ [FFMPEG_RELEASE_API]: hugeWindows })).deps))).reason).toBe('no-release');
    });

    it('passes on the failure of the network as it is', async () => {
        await expect(latestFfmpeg('linux', deps({}).deps)).rejects.toThrow('Request failed (404)');
        await expect(latestFfmpeg('win32', deps({}).deps)).rejects.toThrow('Request failed (404)');
    });
});

describe('the scripts of ani-cli', () => {
    it('look like ani-cli when they start as a shell script and say their version', () => {
        expect(looksLikeAniCli(aniCliScript('5.2.0'))).toBe(true);
    });

    it('do not when they are something else, have no version, or are too big', () => {
        expect(looksLikeAniCli('<html>')).toBe(false);
        expect(looksLikeAniCli('#!/bin/sh\necho hi')).toBe(false);
        expect(looksLikeAniCli(`#!/bin/bash\nversion_number="5.2.0"`)).toBe(false);
        expect(looksLikeAniCli(aniCliScript('5.2.0', 'x'.repeat(MAX_SIZES.anicli)))).toBe(false);
    });

    it('say which changes of the app do not fit them', () => {
        expect(unfitPatches(aniCliScript('5.2.0'))).toEqual([]);
        // The change that saves every subtitle builds on the one that chooses them, so without that one neither fits.
        expect(unfitPatches(aniCliScriptWithout('5.2.0', SELECTION_PART))).toEqual(['subtitleSelection', 'allSubtitles']);
        expect(unfitPatches(aniCliScriptWithout('5.2.0', ALL_SUBTITLES_PART, DEBUG_PART)).sort()).toEqual(['allSubtitles', 'debugReferer']);
    });
});

describe('latestAniCli', () => {
    const COMMIT = 'a'.repeat(40);
    const RAW = `https://raw.githubusercontent.com/pystardust/ani-cli/${COMMIT}/ani-cli`;

    function table(script: string, extra: Record<string, string | Buffer | number> = {}): Record<string, string | Buffer | number> {
        return { [ANICLI_COMMIT_API]: JSON.stringify({ sha: COMMIT }), [RAW]: script, ...extra };
    }

    it('makes the spec of the script at the head of the master branch, with the checksum of the file as it came', async () => {
        const text = aniCliScript('5.2.0');
        const { deps: dependencies, calls } = deps(table(text));
        await expect(latestAniCli(dependencies)).resolves.toEqual({
            spec: {
                id: 'anicli',
                version: COMMIT,
                url: RAW,
                sha256: createHash('sha256').update(text).digest('hex'),
                sizeBytes: Buffer.byteLength(text),
                format: 'raw',
                stripComponents: 0,
                exclude: [],
                executables: ['ani-cli'],
                entry: 'ani-cli'
            },
            version: '5.2.0',
            unfit: []
        });
        expect(calls.buffers).toEqual([[RAW, 500_000]]);
    });

    it('hashes the bytes that came, not the text they were turned into', async () => {
        const bytes = Buffer.concat([Buffer.from(aniCliScript('5.2.0')), Buffer.from([0xff, 0xfe, 0x0a])]);
        const result = await latestAniCli(deps(table('', { [RAW]: bytes })).deps);
        expect(result.spec.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
        expect(result.spec.sizeBytes).toBe(bytes.length);
    });

    it('tells the changes that do not fit but are not essential, and still gives the script', async () => {
        const result = await latestAniCli(deps(table(aniCliScriptWithout('5.2.0', SELECTION_PART))).deps);
        expect(result.unfit).toEqual(['subtitleSelection', 'allSubtitles']);
        expect(result.version).toBe('5.2.0');
    });

    it('refuses a script the essential change of the app does not fit, with the name of the change', async () => {
        const error = await failure(latestAniCli(deps(table(aniCliScriptWithout('5.2.0', DEBUG_PART))).deps));
        expect(error.reason).toBe('patches');
        expect(error.patches).toEqual(['debugReferer']);
    });

    it('refuses a file that is not ani-cli', async () => {
        expect((await failure(latestAniCli(deps(table('<html>not found</html>')).deps))).reason).toBe('invalid');
    });

    it.each([['not json'], [JSON.stringify({})], [JSON.stringify({ sha: 'master' })], [JSON.stringify({ sha: 'A'.repeat(40) })], [JSON.stringify({ sha: 5 })]])('refuses the answer %s for the commit', async (answer) => {
        const error = await failure(latestAniCli(deps({ [ANICLI_COMMIT_API]: answer }).deps));
        expect(['invalid', 'no-release']).toContain(error.reason);
    });

    it('passes on the failure of the network as it is', async () => {
        await expect(latestAniCli(deps({}).deps)).rejects.toThrow('Request failed (404)');
        await expect(latestAniCli(deps({ [ANICLI_COMMIT_API]: JSON.stringify({ sha: COMMIT }) }).deps)).rejects.toThrow('Request failed (404)');
    });
});
