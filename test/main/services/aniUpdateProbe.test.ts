import type { AniRunResult, AnimeSearchResult } from '@shared/anime';
import type { ResolvedStream } from '@main/services/aniStream';
import { AniProbeError, PROBE_EPISODE, PROBE_QUERY, PROBE_TITLE, probeAniCli, type AniProbeService } from '@main/services/aniUpdateProbe';

const KAIJU: AnimeSearchResult = { index: 2, title: 'KAIJU GIRL CARAMELISE', sourceId: 'kaiju-girl-caramelise-19901' };
const OTHER: AnimeSearchResult = { index: 1, title: 'Kaiju No. 8', sourceId: 'kaiju-no-8-19200' };
const STREAM: ResolvedStream = {
    url: 'https://hls.example/master.m3u8',
    subtitleUrl: 'https://hls.example/en.vtt',
    referer: 'https://zokoanime.example/',
    subtitles: [{ label: 'English', src: 'https://hls.example/en.vtt' }]
};

function done<T>(value: T): AniRunResult<T> {
    return { status: 'done', value };
}

function failed<T>(raw: string): AniRunResult<T> {
    return { status: 'error', error: { code: 'NETWORK', raw } };
}

interface Probe {
    service: AniProbeService;
    search: ReturnType<typeof vi.fn<AniProbeService['search']>>;
    episodes: ReturnType<typeof vi.fn<AniProbeService['episodes']>>;
    resolveStream: ReturnType<typeof vi.fn<AniProbeService['resolveStream']>>;
    steps: string[];
}

function probe(answers: { search?: AniRunResult<AnimeSearchResult[]>; episodes?: AniRunResult<string[]>; stream?: AniRunResult<ResolvedStream> } = {}): Probe {
    const search = vi.fn<AniProbeService['search']>(async () => {
        return answers.search ?? done([OTHER, KAIJU]);
    });
    const episodes = vi.fn<AniProbeService['episodes']>(async () => {
        return answers.episodes ?? done(['1', '2', '3']);
    });
    const resolveStream = vi.fn<AniProbeService['resolveStream']>(async () => {
        return answers.stream ?? done(STREAM);
    });
    return { service: { search, episodes, resolveStream }, search, episodes, resolveStream, steps: [] };
}

async function run(context: Probe): Promise<AniProbeError | null> {
    try {
        await probeAniCli(context.service, (step) => {
            context.steps.push(step);
        });
        return null;
    } catch (error) {
        return error as AniProbeError;
    }
}

describe('the anime of the probe', () => {
    it('is KAIJU GIRL CARAMELISE, episode 1', () => {
        expect(PROBE_QUERY).toBe('kaiju girl caramelise');
        expect(PROBE_TITLE).toBe('KAIJU GIRL CARAMELISE');
        expect(PROBE_EPISODE).toBe('1');
    });
});

describe('probeAniCli', () => {
    it('searches, lists the episodes of the anime it found, and asks for the stream of episode 1, telling each step', async () => {
        const context = probe();
        expect(await run(context)).toBeNull();
        expect(context.steps).toEqual(['search', 'episodes', 'episode']);
        expect(context.search.mock.calls).toEqual([['kaiju girl caramelise']]);
        expect(context.episodes.mock.calls).toEqual([['kaiju girl caramelise', 2]]);
        expect(context.resolveStream.mock.calls).toEqual([[{ query: 'kaiju girl caramelise', index: 2, episode: '1', quality: 'best' }]]);
    });

    it('finds the anime by its title whatever the case and the signs around it', async () => {
        const context = probe({ search: done([{ index: 4, title: 'Kaiju Girl Caramelise (TV)', sourceId: 'k-1' }]) });
        expect(await run(context)).toBeNull();
        expect(context.episodes.mock.calls).toEqual([['kaiju girl caramelise', 4]]);
    });

    it('stops at the search when it fails, naming the error', async () => {
        const context = probe({ search: failed('curl exit 6') });
        const error = await run(context);
        expect(error).toBeInstanceOf(AniProbeError);
        expect(error).toMatchObject({ step: 'search', message: 'The search failed (NETWORK: curl exit 6)' });
        expect(context.steps).toEqual(['search']);
        expect(context.episodes).not.toHaveBeenCalled();
    });

    it('stops at the search when it was cancelled', async () => {
        expect(await run(probe({ search: { status: 'cancelled' } }))).toMatchObject({ step: 'search', message: 'The search was cancelled' });
    });

    it('names the error without its text when ani-cli gave none', async () => {
        expect(await run(probe({ search: { status: 'error', error: { code: 'UNKNOWN', raw: '' } } }))).toMatchObject({ message: 'The search failed (UNKNOWN)' });
    });

    it('stops at the search when the anime is not among the results', async () => {
        expect(await run(probe({ search: done([OTHER]) }))).toMatchObject({ step: 'search', message: 'The search for "kaiju girl caramelise" did not list KAIJU GIRL CARAMELISE (1 results)' });
    });

    it('stops at the search when ani-cli picked the anime on its own, so its title is only the words searched', async () => {
        const context = probe({ search: done([{ index: 1, title: 'kaiju girl caramelise', unconfirmed: true }]) });
        expect(await run(context)).toMatchObject({ step: 'search', message: 'The search for "kaiju girl caramelise" did not list KAIJU GIRL CARAMELISE (1 results)' });
    });

    it('stops at the search when the anime comes without the id of the source', async () => {
        expect(await run(probe({ search: done([{ index: 1, title: 'KAIJU GIRL CARAMELISE' }]) }))).toMatchObject({ step: 'search', message: 'The search listed KAIJU GIRL CARAMELISE without the id of the source' });
        expect(await run(probe({ search: done([{ index: 1, title: 'KAIJU GIRL CARAMELISE', sourceId: '' }]) }))).toMatchObject({ step: 'search' });
    });

    it('stops at the list of the episodes when it fails, or when it has no episode 1', async () => {
        const failing = probe({ episodes: failed('timed out') });
        expect(await run(failing)).toMatchObject({ step: 'episodes', message: 'The list of the episodes failed (NETWORK: timed out)' });
        expect(failing.steps).toEqual(['search', 'episodes']);
        expect(failing.resolveStream).not.toHaveBeenCalled();
        expect(await run(probe({ episodes: done(['2', '3']) }))).toMatchObject({ step: 'episodes', message: 'The list of the episodes of KAIJU GIRL CARAMELISE has no episode 1 (2 episodes)' });
        expect(await run(probe({ episodes: done([]) }))).toMatchObject({ step: 'episodes', message: 'The list of the episodes of KAIJU GIRL CARAMELISE has no episode 1 (0 episodes)' });
    });

    it('stops at the episode when its stream fails', async () => {
        expect(await run(probe({ stream: failed('Episode not released!') }))).toMatchObject({ step: 'episode', message: 'The stream of the episode failed (NETWORK: Episode not released!)' });
    });

    it('stops at the episode when the stream comes without the site it expects the request from', async () => {
        expect(await run(probe({ stream: done({ ...STREAM, referer: null }) }))).toMatchObject({ step: 'episode', message: 'The stream of the episode came without the site it expects the request from' });
    });

    it('stops at the episode when the stream comes without the list of its subtitles', async () => {
        expect(await run(probe({ stream: done({ ...STREAM, subtitles: [] }) }))).toMatchObject({ step: 'episode', message: 'The stream of the episode came without the list of its subtitles' });
    });
});
