import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The covers of the anime come from AniList and, when it has none, from the posters of Kitsu: the window only shows the pictures of the
// hosts its policy lets through, so both policies (the one of the page and the one the main process sets) must name them.
const ROOT = resolve(__dirname, '../..');
const POLICIES = [
    ['the page', 'src/renderer/index.html'],
    ['the main process', 'src/main/index.ts']
] as const;

function imageSources(path: string): string[] {
    const source = readFileSync(resolve(ROOT, path), 'utf8');
    const directive = /img-src ([^;"`]+)/.exec(source);
    return directive === null ? [] : (directive[1] ?? '').trim().split(/\s+/);
}

describe.each(POLICIES)('the content security policy of %s', (_name, path) => {
    it('lets the covers of AniList and the posters of Kitsu be shown', () => {
        const sources = imageSources(path);
        expect(sources).toContain('https://*.anilist.co');
        expect(sources).toContain('https://media.kitsu.app');
    });

    it('keeps the pictures that come from this machine, and nothing open to every host', () => {
        const sources = imageSources(path);
        expect(sources).toContain("'self'");
        expect(sources).toContain('data:');
        expect(sources).toContain('http://127.0.0.1:*');
        expect(sources).not.toContain('*');
        expect(sources).not.toContain('https:');
    });
});

describe('the two content security policies', () => {
    it('allow the same remote hosts for pictures', () => {
        const remote = POLICIES.map(([, path]) => {
            return imageSources(path).filter((source) => {
                return source.startsWith('https://');
            });
        });
        expect(remote[0]).toEqual(remote[1]);
        expect(remote[0]).toEqual(['https://*.anilist.co', 'https://media.kitsu.app']);
    });
});
