import {
    MAX_SUBTITLE_BYTES,
    type AniError,
    type AniRunResult,
    type AnimeEpisodeRecord,
    type AnimeRecord,
    type AnimeSearchResult,
    type AnimeSubtitleCheckResponse
} from '@shared/anime';
import type { AniStreamOptions } from './aniCliService';
import type { ResolvedSubtitles, SourceSubtitle } from './aniStream';
import { defaultSubtitleFileSystem, listSubtitleFiles, sourceLabelKey, sourceLabelOf, sourceSubtitlePath, toWebVtt, type SubtitleFileSystem } from './subtitleFiles';

export interface SubtitleCheckDependencies {
    // The subtitles the source offers for an episode.
    resolveSubtitles: (request: AniStreamOptions) => Promise<AniRunResult<ResolvedSubtitles>>;
    // Looks for an anime by name, for the ones whose place in the search is not known.
    search: (query: string) => Promise<AniRunResult<AnimeSearchResult[]>>;
    // The quality of the settings, which ani-cli needs to pick a stream.
    quality: () => string;
    // The text at an address, asked for with the site the source expects; null when it could not be had.
    fetchText: (url: string, referer: string | null) => Promise<string | null>;
    files?: SubtitleFileSystem;
}

function failed(error: AniError): AnimeSubtitleCheckResponse {
    return { ok: false, reason: 'failed', error };
}

// The position of the anime in the search: the one that is kept, or, for an anime found on the disk, the one of the result with
// the same title.
async function positionOf(anime: AnimeRecord, dependencies: SubtitleCheckDependencies): Promise<number | AniError> {
    if (anime.searchIndex >= 1) {
        return anime.searchIndex;
    }
    const found = await dependencies.search(anime.query);
    if (found.status === 'error') {
        return found.error;
    }
    const match = found.status === 'done' ? found.value.find((result) => {
        return result.title === anime.title;
    }) : undefined;
    return match?.index ?? { code: 'NO_RESULTS', raw: 'The anime was not found in the search.' };
}

// The subtitles of the source that the episode does not have, once for each language.
function missingSubtitles(offered: readonly SourceSubtitle[], haveKeys: ReadonlySet<string>): SourceSubtitle[] {
    const seen = new Set(haveKeys);
    return offered.filter((subtitle) => {
        const key = sourceLabelKey(subtitle.label);
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

// Asks the source which subtitles it offers for a downloaded episode and saves, next to the video, the ones it does not have yet.
export async function checkSubtitles(
    anime: AnimeRecord,
    episode: AnimeEpisodeRecord,
    dependencies: SubtitleCheckDependencies
): Promise<AnimeSubtitleCheckResponse> {
    const videoPath = episode.filePath;
    if (episode.status !== 'done' || videoPath === null) {
        return { ok: false, reason: 'missing' };
    }
    const files = dependencies.files ?? defaultSubtitleFileSystem;
    const position = await positionOf(anime, dependencies);
    if (typeof position !== 'number') {
        return failed(position);
    }
    const resolved = await dependencies.resolveSubtitles({
        query: anime.query,
        index: position,
        episode: episode.number,
        quality: dependencies.quality()
    });
    if (resolved.status === 'error') {
        return failed(resolved.error);
    }
    if (resolved.status === 'cancelled') {
        return failed({ code: 'UNKNOWN', raw: 'The request was cancelled.' });
    }
    // What the episode has, whichever way it came (the one ani-cli picked is the same text as one of the source's: it counts under
    // that one's name).
    const haveKeys = new Set(
        listSubtitleFiles(videoPath, files)
            .filter((file) => {
                return file.track.kind !== 'imported';
            })
            .map((file) => {
                return sourceLabelKey(file.track.label);
            })
    );
    const missing = missingSubtitles(resolved.value.subtitles, haveKeys);
    const added: string[] = [];
    for (const subtitle of missing) {
        const text = await dependencies.fetchText(subtitle.src, resolved.value.referer);
        const vtt = text === null || text.length > MAX_SUBTITLE_BYTES ? null : toWebVtt(text);
        if (vtt !== null) {
            files.write(sourceSubtitlePath(videoPath, subtitle.label), vtt);
            added.push(sourceLabelOf(subtitle.label));
        }
    }
    if (missing.length > 0 && added.length === 0) {
        return failed({ code: 'NETWORK', raw: 'The subtitles could not be downloaded.' });
    }
    return {
        ok: true,
        added,
        tracks: listSubtitleFiles(videoPath, files).map((file) => {
            return file.track;
        })
    };
}
