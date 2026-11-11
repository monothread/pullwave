import { ORIGINAL_SEARCH } from '@main/services/aniSearchPages';

// Scripts that look like ani-cli to the changes of Pullwave (see aniPatches.ts) and to the checks of an update (see aniCompatibility.ts): each
// constant is the part of the script one change or one check looks for.
export const SELECTION_LINE = `    sub_link="$(printf "%s" "$_json" | sed 's|.*"subtitles":\\[||; s|}\\].*||; s|},{|}\\n{|g' | grep -m 1 '"default":true' | sed -nE 's|.*"src":"([^"]*)".*|\\1|p')"`;
export const SELECTION_PART = ['hianime_m3u8() {', '    _json="$(hianime_curl x)"', SELECTION_LINE, '}'].join('\n');
export const LIST_LINE = '    # quality variants are relative to the master playlist';
export const SUBTITLE_SAVE_LINE = '    [ -n "$sub_link" ] && $curl_exe -sL -A "$agent" -e "$refr" --max-time 10 $cipher_flag "$sub_link" -o "$download_dir/$_name.vtt"';
export const YTDLP_LINE =
    '    [ -z "$audio_link" ] && command -v "yt-dlp" >/dev/null && yt-dlp --referer "$refr" "$1" --no-skip-unavailable-fragments --fragment-retries infinite -N 16 -P "$download_dir" -P "temp:$tmp_dir" -o "$_name.mp4" $3 && return 0';
export const FFMPEG_LINE =
    '    ffmpeg -extension_picky 0 -referer "$refr" -loglevel error -stats -i "$1" ${audio_link:+-extension_picky 0 -referer "$refr" -i "$audio_link"} -c copy "$download_dir/$_name.mp4" $3';
export const ALL_SUBTITLES_PART = [LIST_LINE, 'download() {', '    _name="$(printf "%s" "$2")"', SUBTITLE_SAVE_LINE, YTDLP_LINE, FFMPEG_LINE, '}'].join('\n');
export const MENU_PART = `    _line=$(printf "%s" "$_stdin" | cut -f 1,3 | tr '\\t' ' ' | menu "$_prompt" "$_multi_flag" "$menu_extra_flags" | cut -d " " -f 1)`;
export const SINGLE_RESULT_PART = '    [ "$_line_count" -eq 1 ] && printf "%s" "$_stdin" | cut -f 2,3 && return 0';
export const SEARCH_PART = ORIGINAL_SEARCH;
export const DEBUG_PART =
    '        debug) printf "All links:\\n%s\\nSelected link:\\n%s\\nAudio:\\n%s\\nSubtitles:\\n%s\\n" "$links" "$video_link" "$audio_link" "$sub_link" ;;';
// What the code the changes add reads from the script (see the `needs` of each change in aniPatches.ts), set the way ani-cli sets it.
export const NEEDS_PART = [
    'menu() {',
    '    true',
    '}',
    'nth() {',
    '    true',
    '}',
    'die() {',
    '    exit 1',
    '}',
    'hianime_curl() {',
    '    true',
    '}',
    '    _m3u8_master="$(printf x)"',
    '    links="$(printf x)"',
    '    audio_link="$(printf x)"',
    '        video_link="$(printf x)"',
    'search_api="${base_api}/search?keyword=%s"',
    'agent="Mozilla/5.0"',
    '        cipher_flag="--ciphers x"',
    'refr="https://example.org/"',
    'curl_exe=$(dep_ch_failover "curl") || die "Program curl not found"'
].join('\n');
export const PROVIDER_LINE = 'base_api="https://hianime.at"';
// What the app hands ani-cli and reads from it: the variables of the environment, the options, the menus, the messages.
export const ENVIRONMENT_PART = [
    'mode="${ANI_CLI_MODE:-sub}"',
    'download_dir="${ANI_CLI_DOWNLOAD_DIR:-.}"',
    'tmp_dir="${ANI_CLI_TMP_DIR:-.}"',
    'log_episode="${ANI_CLI_LOG:-1}"',
    'player_function="${ANI_CLI_PLAYER:-mpv}"',
    'menu_program="${ANI_CLI_MENU:-fzf}"',
    'hist_dir="${ANI_CLI_HIST_DIR:-$HOME/.local/state/ani-cli}"'
].join('\n');
export const OPTIONS_PART = [
    'while [ $# -gt 0 ]; do',
    '    case "$1" in',
    '        -q | --quality)',
    '            shift ;;',
    '        -S | --select-nth)',
    '            shift ;;',
    '        -d | --download)',
    '            shift ;;',
    '        -e | --episode | -r | --range)',
    '            shift ;;',
    '    esac',
    'done'
].join('\n');
export const PROMPTS_PART = ['result=$(printf x | nth "Select anime: ")', 'ep_no=$(printf x | nth "Select episode: ")'].join('\n');
export const MESSAGES_PART = ['die "No results found!"', 'die "Episode not released!"', 'die "Blocked by cloudflare."'].join('\n');

// A script every change of Pullwave fits and every check of an update accepts, with the version it says; `extra` tells two scripts of the
// same version apart.
export function aniCliScript(version: string, extra = ''): string {
    return [
        '#!/bin/sh',
        `version_number="${version}"`,
        PROVIDER_LINE,
        NEEDS_PART,
        ENVIRONMENT_PART,
        SELECTION_PART,
        ALL_SUBTITLES_PART,
        DEBUG_PART,
        MENU_PART,
        SINGLE_RESULT_PART,
        SEARCH_PART,
        OPTIONS_PART,
        PROMPTS_PART,
        MESSAGES_PART,
        extra
    ].join('\n');
}

// The same without some of its parts (whole parts, or single lines of them), as a script that ani-cli changed under them would be.
export function aniCliScriptWithout(version: string, ...parts: string[]): string {
    return parts.reduce((text, part) => {
        return text.replace(part, '# changed upstream');
    }, aniCliScript(version));
}
