import { RESULTS_PER_SOURCE, SEARCH_CONCURRENCY, runLimited, searchableSources } from '@renderer/components/mangaSearchSources';
import { makeSource } from '../../helpers/mangaFixtures';

const SOURCES = [
    makeSource({ id: '1', name: 'Zeta Scans', lang: 'pt' }),
    makeSource({ id: '2', name: 'alpha scans', lang: 'en' }),
    makeSource({ id: '3', name: 'Mixed Site', lang: 'all' }),
    makeSource({ id: '4', name: 'Beta Scans', lang: 'en', contentWarning: 'NSFW' }),
    makeSource({ id: '5', name: 'Alpha Scans', lang: 'pt' })
];

function ids(sources: ReturnType<typeof searchableSources>): string[] {
    return sources.map((source) => {
        return source.id;
    });
}

describe('the limits of a search', () => {
    it('shows twelve results of each source and asks two sources at a time', () => {
        expect(RESULTS_PER_SOURCE).toBe(12);
        expect(SEARCH_CONCURRENCY).toBe(2);
    });
});

describe('searchableSources', () => {
    it('lists the sources of every language by name, then by language, when no language is chosen', () => {
        expect(ids(searchableSources(SOURCES, 'all-languages', false))).toEqual(['2', '5', '3', '1']);
    });

    it('keeps only the sources of the language', () => {
        expect(ids(searchableSources(SOURCES, 'pt', false))).toEqual(['5', '1']);
        expect(ids(searchableSources(SOURCES, 'all', false))).toEqual(['3']);
    });

    it('leaves out the sources for adults unless they are asked for', () => {
        expect(ids(searchableSources(SOURCES, 'en', false))).toEqual(['2']);
        expect(ids(searchableSources(SOURCES, 'en', true))).toEqual(['2', '4']);
    });

    it('takes a language that no listed source has for all of them', () => {
        expect(ids(searchableSources(SOURCES, 'ja', false))).toEqual(['2', '5', '3', '1']);
        expect(ids(searchableSources([SOURCES[3]!], 'en', false))).toEqual([]);
    });

    it('gives nothing without sources, and does not change the list it is given', () => {
        expect(searchableSources([], 'en', true)).toEqual([]);
        const copy = [...SOURCES];
        searchableSources(SOURCES, 'all-languages', true);
        expect(SOURCES).toEqual(copy);
    });
});

describe('runLimited', () => {
    function deferred(): { promise: Promise<void>; resolve: () => void } {
        let resolve: () => void = () => {
            return undefined;
        };
        const promise = new Promise<void>((done) => {
            resolve = done;
        });
        return { promise, resolve };
    }

    it('starts the limit at once, and the next as soon as one is over, in the order of the items', async () => {
        const gates = [deferred(), deferred(), deferred(), deferred()];
        const started: number[] = [];
        const whole = runLimited([0, 1, 2, 3], 2, async (item) => {
            started.push(item);
            await gates[item]!.promise;
        });
        await Promise.resolve();
        expect(started).toEqual([0, 1]);
        gates[1]!.resolve();
        await vi.waitFor(() => {
            expect(started).toEqual([0, 1, 2]);
        });
        gates[0]!.resolve();
        await vi.waitFor(() => {
            expect(started).toEqual([0, 1, 2, 3]);
        });
        gates[2]!.resolve();
        gates[3]!.resolve();
        await whole;
    });

    it('never has more than the limit going on, and does every item once', async () => {
        let going = 0;
        let most = 0;
        const done: number[] = [];
        await runLimited([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
            going += 1;
            most = Math.max(most, going);
            await new Promise((resolve) => {
                setTimeout(resolve, 1);
            });
            going -= 1;
            done.push(item);
        });
        expect(most).toBe(3);
        expect([...done].sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    it('does fewer at a time when there are fewer items than the limit, and nothing for no items', async () => {
        let going = 0;
        let most = 0;
        await runLimited([1, 2], 5, async () => {
            going += 1;
            most = Math.max(most, going);
            await Promise.resolve();
            going -= 1;
        });
        expect(most).toBe(2);
        const task = vi.fn(async () => {
            return undefined;
        });
        await runLimited([], 2, task);
        expect(task).not.toHaveBeenCalled();
    });
});
