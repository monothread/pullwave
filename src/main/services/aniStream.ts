import { sanitizeQuery } from './aniArgsBuilder';

export interface ResolvedStream {
    url: string;
    subtitleUrl: string | null;
    // The site the stream expects the request to come from.
    referer: string | null;
    // Every subtitle the source offers (empty when this copy of ani-cli does not report them): the one ani-cli picked is among them.
    subtitles: SourceSubtitle[];
}

// With the "debug" player ani-cli prints the address of the episode instead of playing it, but not the referer the host of
// the stream wants. This adds it (as "Referer:") so the app can ask for the stream the way ani-cli would.
// The selected link is the address of one picture (a variant of the master playlist), which has no sound when the source gives the audio as
// tracks of their own. When the audio patch kept the master (aniAudio.ts), the master is printed instead: the player reads it and plays the
// picture with its audio. A script without that patch has no such variable and prints the selected link as before.
const ORIGINAL_DEBUG_OUTPUT =
    'debug) printf "All links:\\n%s\\nSelected link:\\n%s\\nSubtitles:\\n%s\\n" "$links" "$video_link" "$sub_link" ;;';
const SUBTITLE_LIST_MARKER = 'Subtitle list:';
// After the referer it also prints every subtitle the source offers (kept by the patch of aniSubtitles.ts; empty when that patch
// did not apply).
const PATCHED_DEBUG_OUTPUT = `debug) printf "All links:\\n%s\\nSelected link:\\n%s\\nSubtitles:\\n%s\\nReferer:\\n%s\\n${SUBTITLE_LIST_MARKER}\\n%s\\n" "$links" "\${pullwave_audio_master:-$video_link}" "$sub_link" "$refr" "\${pullwave_all_subs:-}" ;;`;

// The script with its debug output extended, or null when this is not a version it knows how to change.
export function patchDebugReferer(source: string): string | null {
    return source.includes(ORIGINAL_DEBUG_OUTPUT) ? source.replace(ORIGINAL_DEBUG_OUTPUT, PATCHED_DEBUG_OUTPUT) : null;
}

// A subtitle the source offers for an episode.
export interface SourceSubtitle {
    label: string;
    src: string;
}

// The subtitles of an episode and the site the source expects the request for them to come from.
export interface ResolvedSubtitles {
    referer: string | null;
    subtitles: SourceSubtitle[];
}

function fieldOf(line: string, name: string): string | null {
    const found = new RegExp(`"${name}":"([^"]*)"`).exec(line);
    return found?.[1] ?? null;
}

// Reads the subtitles the debug player printed after "Subtitle list:", one per line as the source wrote them. A line without a
// label, or with an address that is not http(s), is left out.
export function parseSubtitleList(output: string): ResolvedSubtitles {
    const lines = output
        .split('\n')
        .map((line) => {
            return line.trim();
        })
        .filter((line) => {
            return line.length > 0;
        });
    const marker = lines.indexOf(SUBTITLE_LIST_MARKER);
    const subtitles = (marker === -1 ? [] : lines.slice(marker + 1)).flatMap((line) => {
        const label = fieldOf(line, 'label');
        const src = fieldOf(line, 'src')?.replace(/\\\//g, '/') ?? null;
        return label !== null && label.length > 0 && src !== null && /^https?:\/\//.test(src) ? [{ label, src }] : [];
    });
    return { referer: valueAfter(lines, 'Referer:'), subtitles };
}

export function buildStreamArgs(query: string, index: number, episode: string, quality: string): string[] {
    return ['-S', String(index), '-e', episode, '-q', quality, sanitizeQuery(query)];
}

function valueAfter(lines: readonly string[], marker: string): string | null {
    const position = lines.indexOf(marker);
    const next = position === -1 ? undefined : lines[position + 1];
    return next !== undefined && /^https?:\/\//.test(next) ? next : null;
}

// Reads what the debug player printed. Empty values are not printed as blank lines (the runner drops those), so a marker
// followed by another marker means it had no value.
export function parseStreamOutput(output: string): ResolvedStream | null {
    const lines = output
        .split('\n')
        .map((line) => {
            return line.trim();
        })
        .filter((line) => {
            return line.length > 0;
        });
    const url = valueAfter(lines, 'Selected link:');
    if (url === null) {
        return null;
    }
    return { url, subtitleUrl: valueAfter(lines, 'Subtitles:'), referer: valueAfter(lines, 'Referer:'), subtitles: parseSubtitleList(output).subtitles };
}
