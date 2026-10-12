import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clearSelectedFlareSolverr, FLARESOLVERR_LATEST_URL, fetchLatestFlareSolverr, readSelectedFlareSolverr, writeSelectedFlareSolverr } from '@main/services/tools/flaresolverrUpdate';
import { UpdateLookupError } from '@main/services/tools/suwayomiUpdate';
import { cleanTempDirs, makeTempDir } from '../../../helpers/tempDir';

afterEach(() => {
    cleanTempDirs();
});

function fakeFetch(body: string, status = 200) {
    return vi.fn(() => {
        return Promise.resolve(new Response(body, { status }));
    }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe('fetchLatestFlareSolverr', () => {
    it('gives the tag of the latest release, which is also the tag of its image', async () => {
        const impl = fakeFetch(JSON.stringify({ tag_name: 'v3.6.1' }));
        await expect(fetchLatestFlareSolverr(impl)).resolves.toBe('v3.6.1');
        expect((impl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(FLARESOLVERR_LATEST_URL);
    });

    it.each([[JSON.stringify({ tag_name: 'latest' })], [JSON.stringify({ tag_name: 'v3.6.1; rm -rf' })], [JSON.stringify({})], [JSON.stringify({ tag_name: 5 })], [JSON.stringify(null)]])('refuses the answer %s', async (body) => {
        await expect(fetchLatestFlareSolverr(fakeFetch(body))).rejects.toBeInstanceOf(UpdateLookupError);
    });

    it('refuses an answer that is not good', async () => {
        await expect(fetchLatestFlareSolverr(fakeFetch('{}', 403))).rejects.toThrow('The server answered 403');
    });
});

describe('the version of FlareSolverr the app runs', () => {
    it('is kept and read back', () => {
        const file = join(makeTempDir(), 'tools', 'flaresolverr-selected.json');
        writeSelectedFlareSolverr(file, 'v3.6.1');
        expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({ version: 'v3.6.1' });
        expect(existsSync(`${file}.part`)).toBe(false);
        expect(readSelectedFlareSolverr(file)).toBe('v3.6.1');
    });

    it.each([['{oops'], [JSON.stringify({ version: 'latest' })], [JSON.stringify({ version: 5 })], [JSON.stringify({})], ['null']])('is none when what was kept is %s', (content) => {
        const file = join(makeTempDir(), 'selected.json');
        writeFileSync(file, content);
        expect(readSelectedFlareSolverr(file)).toBeNull();
    });

    it('is none when there is no file, and goes away when it is cleared', () => {
        const file = join(makeTempDir(), 'selected.json');
        expect(readSelectedFlareSolverr(file)).toBeNull();
        writeSelectedFlareSolverr(file, 'v3.6.1');
        clearSelectedFlareSolverr(file);
        expect(existsSync(file)).toBe(false);
        expect(() => {
            clearSelectedFlareSolverr(file);
        }).not.toThrow();
    });
});
