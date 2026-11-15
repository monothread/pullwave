const EPISODE_PATTERN = /^\d+(\.\d+)?$/;
const QUALITY_PATTERN = /^(best|worst|\d{3,4}p?)$/i;
const QUERY_FORBIDDEN = /[^\p{L}\p{N} '.:!,-]/gu;

export const DEFAULT_ANIME_QUALITY = 'best';

export interface AniDownloadRequest {
    query: string;
    index: number;
    episode: string;
    quality: string;
}

export function sanitizeQuery(query: string): string {
    return query
        .replace(QUERY_FORBIDDEN, ' ')
        .split(/\s+/)
        .map((word) => {
            return word.replace(/^-+/, '');
        })
        .filter((word) => {
            return word.length > 0;
        })
        .join(' ');
}

export function isValidEpisode(episode: string): boolean {
    return EPISODE_PATTERN.test(episode);
}

export function isValidQuality(quality: string): boolean {
    return QUALITY_PATTERN.test(quality);
}

export function isValidIndex(index: number): boolean {
    return Number.isInteger(index) && index >= 1;
}

export function buildSearchArgs(query: string): string[] {
    return [sanitizeQuery(query)];
}

export function buildEpisodesArgs(query: string, index: number): string[] {
    return ['-S', String(index), sanitizeQuery(query)];
}

export function buildDownloadArgs(request: AniDownloadRequest): string[] {
    return ['-d', '-S', String(request.index), '-e', request.episode, '-q', request.quality, sanitizeQuery(request.query)];
}

export function validateDownloadRequest(request: AniDownloadRequest): string | null {
    if (sanitizeQuery(request.query).length === 0) {
        return 'The anime name is empty.';
    }
    if (!isValidIndex(request.index)) {
        return `Invalid result position: ${request.index}`;
    }
    if (!isValidEpisode(request.episode)) {
        return `Invalid episode: ${request.episode}`;
    }
    if (!isValidQuality(request.quality)) {
        return `Invalid quality: ${request.quality}`;
    }
    return null;
}
