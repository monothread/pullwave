import { sanitizeQuery } from './aniArgsBuilder';

export interface ResolvedStream {
    url: string;
    subtitleUrl: string | null;
    referer: string | null;
    subtitles: SourceSubtitle[];
}

const ORIGINAL_DEBUG_OUTPUT =
    'debug) printf "All links:\\n%s\\nSelected link:\\n%s\\nAudio:\\n%s\\nSubtitles:\\n%s\\n" "$links" "$video_link" "$audio_link" "$sub_link" ;;';
const SUBTITLE_LIST_MARKER = 'Subtitle list:';
const PATCHED_DEBUG_OUTPUT = `debug)
            [ -n "$audio_link" ] && video_link="$_m3u8_master"
            printf "All links:\\n%s\\nSelected link:\\n%s\\nAudio:\\n%s\\nSubtitles:\\n%s\\nReferer:\\n%s\\n${SUBTITLE_LIST_MARKER}\\n%s\\n" "$links" "$video_link" "$audio_link" "$sub_link" "$refr" "\${pullwave_all_subs:-}"
            ;;`;

export const DEBUG_REFERER_NEEDS = ['links', 'video_link', 'audio_link', 'sub_link', 'refr', '_m3u8_master'] as const;

export function patchDebugReferer(source: string): string | null {
    return source.includes(ORIGINAL_DEBUG_OUTPUT) ? source.replace(ORIGINAL_DEBUG_OUTPUT, PATCHED_DEBUG_OUTPUT) : null;
}

export interface SourceSubtitle {
    label: string;
    src: string;
}

export interface ResolvedSubtitles {
    referer: string | null;
    subtitles: SourceSubtitle[];
}

function fieldOf(line: string, name: string): string | null {
    const found = new RegExp(`"${name}":"([^"]*)"`).exec(line);
    return found?.[1] ?? null;
}

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
