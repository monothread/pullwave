import type { AniError, AniRunResult, AnimeSearchResult } from '@shared/anime';
import type { AniCliUpdateStep } from '@shared/tools';
import type { AniCliService } from './aniCliService';
import { DEFAULT_ANIME_QUALITY } from './aniArgsBuilder';
import { comparableTitle } from './animeSourceMatch';

export const PROBE_QUERY = 'kaiju girl caramelise';
export const PROBE_TITLE = 'KAIJU GIRL CARAMELISE';
export const PROBE_EPISODE = '1';

export type AniProbeService = Pick<AniCliService, 'search' | 'episodes' | 'resolveStream'>;

export class AniProbeError extends Error {
    constructor(
        readonly step: Exclude<AniCliUpdateStep, 'compatibility' | 'download' | 'syntax'>,
        message: string
    ) {
        super(message);
    }
}

function errorText(error: AniError): string {
    return `${error.code}${error.raw.length > 0 ? `: ${error.raw}` : ''}`;
}

function valueOf<T>(result: AniRunResult<T>, step: AniProbeError['step'], what: string): T {
    if (result.status === 'done') {
        return result.value;
    }
    throw new AniProbeError(step, result.status === 'cancelled' ? `${what} was cancelled` : `${what} failed (${errorText(result.error)})`);
}

function probeResult(results: readonly AnimeSearchResult[]): AnimeSearchResult {
    const wanted = comparableTitle(PROBE_TITLE);
    const found = results.find((result) => {
        return comparableTitle(result.title) === wanted && result.unconfirmed !== true;
    });
    if (found === undefined) {
        throw new AniProbeError('search', `The search for "${PROBE_QUERY}" did not list ${PROBE_TITLE} (${results.length} results)`);
    }
    if (found.sourceId === undefined || found.sourceId.length === 0) {
        throw new AniProbeError('search', `The search listed ${PROBE_TITLE} without the id of the source`);
    }
    return found;
}

export async function probeAniCli(service: AniProbeService, onStep: (step: AniProbeError['step']) => void): Promise<void> {
    onStep('search');
    const anime = probeResult(valueOf(await service.search(PROBE_QUERY), 'search', 'The search'));
    onStep('episodes');
    const episodes = valueOf(await service.episodes(PROBE_QUERY, anime.index), 'episodes', 'The list of the episodes');
    if (!episodes.includes(PROBE_EPISODE)) {
        throw new AniProbeError('episodes', `The list of the episodes of ${PROBE_TITLE} has no episode ${PROBE_EPISODE} (${episodes.length} episodes)`);
    }
    onStep('episode');
    const stream = valueOf(
        await service.resolveStream({ query: PROBE_QUERY, index: anime.index, episode: PROBE_EPISODE, quality: DEFAULT_ANIME_QUALITY }),
        'episode',
        'The stream of the episode'
    );
    if (stream.referer === null) {
        throw new AniProbeError('episode', 'The stream of the episode came without the site it expects the request from');
    }
    if (stream.subtitles.length === 0) {
        throw new AniProbeError('episode', 'The stream of the episode came without the list of its subtitles');
    }
}
