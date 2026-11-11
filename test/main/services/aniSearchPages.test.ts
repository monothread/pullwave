import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_SEARCH_PAGES, ORIGINAL_SEARCH, PATCHED_SEARCH, patchSearchPages, SEARCH_MIN_VARIABLE, SEARCH_MORE_MARKER, SEARCH_PAGES_NEEDS } from '@main/services/aniSearchPages';
import { patchAniCli, patchReport } from '@main/services/aniPatches';
import { cleanTempDirs, makeTempDir } from '../../helpers/tempDir';

afterEach(() => {
    cleanTempDirs();
});

const BUNDLED = join(process.cwd(), 'resources', 'bin', 'ani', 'ani-cli');

describe('the constants', () => {
    it('names the variable the app sets, the line the script prints and the most pages it reads', () => {
        expect(SEARCH_MIN_VARIABLE).toBe('PULLWAVE_SEARCH_MIN');
        expect(SEARCH_MORE_MARKER).toBe('PULLWAVE_SEARCH_MORE');
        expect(MAX_SEARCH_PAGES).toBe(20);
    });
});

describe('patchSearchPages', () => {
    it('replaces the search of the script with the one that goes on to the next pages', () => {
        const source = `before\n${ORIGINAL_SEARCH}\nafter`;
        const patched = patchSearchPages(source) as string;
        expect(patched).toBe(`before\n${PATCHED_SEARCH}\nafter`);
        expect(patched).not.toContain(ORIGINAL_SEARCH);
        expect(patched).toContain('hianime_search_fetch() {');
        expect(patched).toContain('hianime_search_results() {');
        expect(patched).toContain('hianime_search_has_page() {');
        expect(patched).toContain('"${PULLWAVE_SEARCH_MIN:-}"');
        expect(patched).toContain('printf "PULLWAVE_SEARCH_MORE\\n" >&2');
        expect(patched).toContain('[ "$_pw_page" -ge 20 ]');
    });

    it('does not fit a script whose search changed, or one that has none', () => {
        expect(patchSearchPages(ORIGINAL_SEARCH.replace('id="main-sidebar"', 'id="sidebar"'))).toBeNull();
        expect(patchSearchPages(ORIGINAL_SEARCH.replace('hianime_search()', 'hianime_find()'))).toBeNull();
        expect(patchSearchPages('')).toBeNull();
        expect(patchSearchPages('a different script')).toBeNull();
    });

    it('does not fit a script that already has it, so it is not changed twice', () => {
        const patched = patchSearchPages(ORIGINAL_SEARCH) as string;
        expect(patchSearchPages(patched)).toBeNull();
        expect(patchAniCli(patched)).toBeNull();
    });

    it('is part of the changes of the app, and is reported on its own', () => {
        expect(patchReport(ORIGINAL_SEARCH)).toEqual({ subtitleSelection: false, allSubtitles: false, debugReferer: false, menuIds: false, singleResult: false, searchPages: true });
        expect(patchReport('')).toMatchObject({ searchPages: false });
        expect(patchAniCli(ORIGINAL_SEARCH)).toBe(PATCHED_SEARCH);
    });

    it('says what its code reads from the script', () => {
        expect(SEARCH_PAGES_NEEDS).toEqual(['hianime_curl', 'search_api', 'curl_exe', 'die']);
    });

    it('fits the script of ani-cli that comes with the app, when it is there', () => {
        if (existsSync(BUNDLED)) {
            const script = readFileSync(BUNDLED, 'utf-8');
            expect(patchReport(script).searchPages).toBe(true);
            expect(patchSearchPages(script)).toContain('hianime_search_has_page() {');
        }
    });
});

interface Page {
    // The titles of the results of the page, in order.
    titles: string[];
    // The page the pagination links to after this one; null: no link to a next page.
    next: number | null;
    // The sidebar repeats a page link of its own: it must not count as the pagination.
    sidebarLink?: number;
    cloudflare?: boolean;
}

// A page of the source as ani-cli reads it: the results, the pagination and the sidebar that repeats the markup of a result.
function pageHtml(page: Page): string {
    if (page.cloudflare === true) {
        return '<html><head><title>Just a moment...</title></head></html>';
    }
    const results = page.titles
        .map((title) => {
            return `<div class="film-detail">\n<h3 class="film-name">\n<a href="https://hianime.example/${title.toLowerCase().replace(/\W+/g, '-')}" title="${title}">${title}</a></h3></div>`;
        })
        .join('\n');
    const pagination = page.next === null ? '<ul class="pagination">\n<li class="page-item active">1</li>\n</ul>' : `<ul class="pagination">\n<li><a class="page-item" href="https://hianime.example/search?keyword=a&amp;page=${String(page.next)}">next</a></li>\n</ul>`;
    const sidebarLink = page.sidebarLink === undefined ? '' : `<a href="https://hianime.example/top?page=${String(page.sidebarLink)}">more</a>`;
    return `<html><head><title>Browse</title></head><body>\n${results}\n${pagination}\n<div id="main-sidebar">${sidebarLink}\n<div class="film-detail"><h3 class="film-name"><a href="https://hianime.example/side" title="Sidebar">Sidebar</a></h3></div></div></body></html>`;
}

interface Run {
    stdout: string;
    stderr: string;
    status: number | null;
    // The addresses the script asked the source for, in order.
    fetched: string[];
}

// Runs the search functions (the original or the patched ones, as the text of the change has them) with a stand-in for the source: page N is the Nth of `pages` (the address without
// `page=` is the first one), and `die` prints and ends the script as ani-cli does.
function runSearch(script: string, pages: (page: number) => Page, env: Record<string, string> = {}): Run {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'search.sh'), `${script}\n`);
    const log = join(dir, 'log.txt');
    const stand = [
        `search_api='https://hianime.example/search?keyword=%s'`,
        `curl_exe=curl`,
        `die() { printf '%s\\n' "$*" >&2; exit 1; }`,
        `hianime_curl() {`,
        `    printf '%s\\n' "$1" >> '${log}'`,
        `    _n=1`,
        `    case "$1" in *page=*) _n="\${1##*page=}" ;; esac`,
        `    cat "${dir}/page$_n.html"`,
        `}`,
        `. '${join(dir, 'search.sh')}'`,
        `hianime_search "$1"`
    ].join('\n');
    writeFileSync(join(dir, 'stand.sh'), stand);
    for (let number = 1; number <= 30; number += 1) {
        writeFileSync(join(dir, `page${String(number)}.html`), pageHtml(pages(number)));
    }
    const result = spawnSync('sh', [join(dir, 'stand.sh'), 'a'], { env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf-8' });
    const fetched = existsSync(log) ? readFileSync(log, 'utf-8').split('\n').filter(Boolean) : [];
    return { stdout: result.stdout, stderr: result.stderr, status: result.status, fetched };
}

const ADDRESS = 'https://hianime.example/search?keyword=a';

function lines(...titles: string[]): string {
    return titles
        .map((title) => {
            return `${title.toLowerCase().replace(/\W+/g, '-')}\t${title}\n`;
        })
        .join('');
}

describe.skipIf(process.platform === 'win32')('the search of the patched script, run against pages of the source', () => {
    const original = ORIGINAL_SEARCH;
    const patched = PATCHED_SEARCH;
    // Page 1 has two results and a link to page 2, page 2 has two and a link to page 3, page 3 has one and no link to a next page.
    const three = (page: number): Page => {
        if (page === 1) {
            return { titles: ['A One', 'A Two'], next: 2 };
        }
        if (page === 2) {
            return { titles: ['B One', 'B Two'], next: 3 };
        }
        return page === 3 ? { titles: ['C One'], next: null } : { titles: [], next: null };
    };

    it('reads the first page only, as before, when it is not asked for more', () => {
        const run = runSearch(patched, three);
        expect(run.status).toBe(0);
        // Without the variable the output is the one of the original: the last line has no line break after it.
        expect(run.stdout).toBe(lines('A One', 'A Two').replace(/\n$/, ''));
        expect(run.stderr).toBe('');
        expect(run.fetched).toEqual([ADDRESS]);
    });

    it('gives what the original search gives when it is not asked for more, byte for byte', () => {
        const before = runSearch(original, three);
        const after = runSearch(patched, three);
        expect(after.stdout).toBe(before.stdout);
        expect(after.stderr).toBe(before.stderr);
        expect(after.status).toBe(before.status);
        expect(after.fetched).toEqual(before.fetched);
    });

    it('does not take the results of the sidebar', () => {
        const run = runSearch(patched, three, { PULLWAVE_SEARCH_MIN: '1' });
        expect(run.stdout).not.toContain('Sidebar');
    });

    it('stops at the first page when it already has the results asked for, and says there are more', () => {
        const run = runSearch(patched, three, { PULLWAVE_SEARCH_MIN: '2' });
        expect(run.status).toBe(0);
        expect(run.stdout).toBe(lines('A One', 'A Two'));
        expect(run.stderr).toBe('PULLWAVE_SEARCH_MORE\n');
        expect(run.fetched).toEqual([ADDRESS]);
    });

    it('goes on to the next pages until it has the results asked for, as one list in order', () => {
        const run = runSearch(patched, three, { PULLWAVE_SEARCH_MIN: '3' });
        expect(run.status).toBe(0);
        expect(run.stdout).toBe(lines('A One', 'A Two', 'B One', 'B Two'));
        expect(run.stderr).toBe('PULLWAVE_SEARCH_MORE\n');
        expect(run.fetched).toEqual([ADDRESS, `${ADDRESS}&page=2`]);
    });

    it('does not say there are more when the last page it read has no link to a next one', () => {
        const run = runSearch(patched, three, { PULLWAVE_SEARCH_MIN: '5' });
        expect(run.status).toBe(0);
        expect(run.stdout).toBe(lines('A One', 'A Two', 'B One', 'B Two', 'C One'));
        expect(run.stderr).toBe('');
        expect(run.fetched).toEqual([ADDRESS, `${ADDRESS}&page=2`, `${ADDRESS}&page=3`]);
    });

    it('stops when there are fewer results than asked for and no page after the last', () => {
        const run = runSearch(patched, three, { PULLWAVE_SEARCH_MIN: '100' });
        expect(run.stdout).toBe(lines('A One', 'A Two', 'B One', 'B Two', 'C One'));
        expect(run.stderr).toBe('');
        expect(run.fetched).toHaveLength(3);
    });

    it('stops at a page without results even if the pagination still links to another one', () => {
        const run = runSearch(patched, (page) => {
            return page === 1 ? { titles: ['A One'], next: 2 } : { titles: [], next: 3 };
        }, { PULLWAVE_SEARCH_MIN: '10' });
        expect(run.stdout).toBe(lines('A One'));
        expect(run.stderr).toBe('');
        expect(run.fetched).toEqual([ADDRESS, `${ADDRESS}&page=2`]);
    });

    it('prints nothing for a search without results, so the script says there were none', () => {
        const run = runSearch(patched, () => {
            return { titles: [], next: null };
        }, { PULLWAVE_SEARCH_MIN: '1' });
        expect(run.stdout).toBe('');
        expect(run.stderr).toBe('');
        expect(run.status).toBe(0);
        expect(run.fetched).toEqual([ADDRESS]);
    });

    it('does not take a link of the sidebar for the page after the last one', () => {
        const run = runSearch(patched, () => {
            return { titles: ['A One'], next: null, sidebarLink: 2 };
        }, { PULLWAVE_SEARCH_MIN: '5' });
        expect(run.stdout).toBe(lines('A One'));
        expect(run.stderr).toBe('');
        expect(run.fetched).toEqual([ADDRESS]);
    });

    it('never reads more pages than the limit, however many results are asked for and however many pages the source has', () => {
        const run = runSearch(patched, (page) => {
            return { titles: [`Page${String(page)} Result`], next: page + 1 };
        }, { PULLWAVE_SEARCH_MIN: '1000' });
        expect(run.status).toBe(0);
        expect(run.fetched).toHaveLength(MAX_SEARCH_PAGES);
        expect(run.fetched[MAX_SEARCH_PAGES - 1]).toBe(`${ADDRESS}&page=${String(MAX_SEARCH_PAGES)}`);
        expect(run.stdout.split('\n').filter(Boolean)).toHaveLength(MAX_SEARCH_PAGES);
        expect(run.stderr).toBe('PULLWAVE_SEARCH_MORE\n');
    });

    it('ends with the message of ani-cli when the source blocks it, on the first page or on a later one', () => {
        const first = runSearch(patched, () => {
            return { titles: [], next: null, cloudflare: true };
        }, { PULLWAVE_SEARCH_MIN: '3' });
        expect(first.status).toBe(1);
        expect(first.stdout).toBe('');
        expect(first.stderr).toBe('Blocked by cloudflare. Try installing curl-impersonate\n');

        const later = runSearch(patched, (page) => {
            return page === 1 ? { titles: ['A One'], next: 2 } : { titles: [], next: null, cloudflare: true };
        }, { PULLWAVE_SEARCH_MIN: '3' });
        expect(later.status).toBe(1);
        expect(later.stderr).toBe('Blocked by cloudflare. Try installing curl-impersonate\n');
    });

    describe.skipIf(!existsSync(BUNDLED))('in the script that comes with the app', () => {
        it('has the same search function, patched, that these tests run', () => {
            const script = patchSearchPages(readFileSync(BUNDLED, 'utf-8')) as string;
            expect(script).toContain(PATCHED_SEARCH);
            expect(script.indexOf('hianime_search() {')).toBe(script.lastIndexOf('hianime_search() {'));
        });

        it('is a script the shell accepts after the change', () => {
            const dir = makeTempDir();
            const file = join(dir, 'ani-cli');
            writeFileSync(file, patchSearchPages(readFileSync(BUNDLED, 'utf-8')) as string);
            const checked = spawnSync('sh', ['-n', file], { encoding: 'utf-8' });
            expect(checked.stderr).toBe('');
            expect(checked.status).toBe(0);
        });
    });
});
