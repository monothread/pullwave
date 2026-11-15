export interface HlsSegment {
    sequence: number;
    url: string;
    durationSeconds: number;
}

export interface HlsPlaylist {
    targetDurationSeconds: number;
    initUrl: string | null;
    segments: HlsSegment[];
    ended: boolean;
}

export class HlsUnsupportedError extends Error {}

const DEFAULT_TARGET_DURATION_SECONDS = 6;

function attribute(line: string, name: string): string | null {
    const match = new RegExp(`(?:^|[:,])${name}=("([^"]*)"|[^,]*)`).exec(line);
    if (match === null) {
        return null;
    }
    return match[2] ?? match[1] ?? null;
}

function absolute(reference: string, base: string): string {
    return new URL(reference, base).toString();
}

function numberAfter(line: string, prefix: string): number | null {
    const value = Number.parseFloat(line.slice(prefix.length));
    return Number.isFinite(value) ? value : null;
}

export function parseHlsPlaylist(text: string, playlistUrl: string): HlsPlaylist {
    const lines = text
        .split(/\r\n|\r|\n/)
        .map((line) => {
            return line.trim();
        })
        .filter((line) => {
            return line.length > 0;
        });
    if (lines[0] !== '#EXTM3U') {
        throw new HlsUnsupportedError('The playlist is not an HLS playlist');
    }
    let targetDuration = DEFAULT_TARGET_DURATION_SECONDS;
    let mediaSequence = 0;
    let initUrl: string | null = null;
    let ended = false;
    let pendingDuration: number | null = null;
    const segments: HlsSegment[] = [];
    for (const line of lines) {
        if (line.startsWith('#EXT-X-STREAM-INF') || line.startsWith('#EXT-X-I-FRAME-STREAM-INF')) {
            throw new HlsUnsupportedError('The playlist lists other playlists, not segments');
        }
        if (line.startsWith('#EXT-X-KEY') || line.startsWith('#EXT-X-SESSION-KEY')) {
            const method = attribute(line, 'METHOD');
            if (method !== null && method !== 'NONE') {
                throw new HlsUnsupportedError('The segments are encrypted');
            }
        } else if (line.startsWith('#EXT-X-BYTERANGE')) {
            throw new HlsUnsupportedError('The segments are byte ranges');
        } else if (line.startsWith('#EXT-X-TARGETDURATION:')) {
            targetDuration = numberAfter(line, '#EXT-X-TARGETDURATION:') ?? targetDuration;
        } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
            mediaSequence = numberAfter(line, '#EXT-X-MEDIA-SEQUENCE:') ?? 0;
        } else if (line.startsWith('#EXT-X-MAP:')) {
            if (attribute(line, 'BYTERANGE') !== null) {
                throw new HlsUnsupportedError('The initialization segment is a byte range');
            }
            const uri = attribute(line, 'URI');
            initUrl = uri === null ? null : absolute(uri, playlistUrl);
        } else if (line.startsWith('#EXTINF:')) {
            pendingDuration = numberAfter(line, '#EXTINF:');
        } else if (line === '#EXT-X-ENDLIST') {
            ended = true;
        } else if (!line.startsWith('#')) {
            segments.push({ sequence: mediaSequence + segments.length, url: absolute(line, playlistUrl), durationSeconds: pendingDuration ?? targetDuration });
            pendingDuration = null;
        }
    }
    return { targetDurationSeconds: targetDuration, initUrl, segments, ended };
}
