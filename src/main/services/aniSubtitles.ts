import type { AnimeSubtitleSetting } from '@shared/anime';
import { SUBTITLE_FALLBACK_LABEL, SUBTITLE_LABEL_OF_LANGUAGE } from '@shared/subtitleTarget';
import type { LanguageCode } from '@shared/types';

export const SUBTITLE_LABELS_VARIABLE = 'PULLWAVE_SUB_LABELS';

// The languages to try, in order. After them ani-cli's own pick (the subtitles the source marks as default) is used, so an
// empty list leaves ani-cli as it is.
export function subtitleLabels(setting: AnimeSubtitleSetting, language: LanguageCode): string[] {
    if (setting === 'default') {
        return [];
    }
    if (setting === 'auto') {
        return [...new Set([SUBTITLE_LABEL_OF_LANGUAGE[language], SUBTITLE_FALLBACK_LABEL])];
    }
    return [setting];
}

// ani-cli saves only the subtitles the source marks as default, and many titles have none marked. This is the line that
// does it, and the function that takes its place: it tries the languages in PULLWAVE_SUB_LABELS (separated by "|") and then
// does what ani-cli did.
const ORIGINAL_SELECTION =
    `    sub_link="$(printf "%s" "$_json" | sed 's|.*"subtitles":\\[||; s|}\\].*||; s|},{|}\\n{|g' | grep -m 1 '"default":true' | sed -nE 's|.*"src":"([^"]*)".*|\\1|p')"`;
const PATCHED_SELECTION = '    sub_link="$(pullwave_pick_subtitle "$_json")"';
const FUNCTION_ANCHOR = 'hianime_m3u8() {';
export const SUBTITLE_PICK_FUNCTION = `# Added by Pullwave: prefers the languages in ${SUBTITLE_LABELS_VARIABLE}, then the subtitles marked as default.
pullwave_pick_subtitle() {
    _subs="$(printf "%s" "$1" | sed 's|.*"subtitles":\\[||; s|}\\].*||; s|},{|}\\n{|g')"
    _pick=""
    _old_ifs="$IFS"
    IFS='|'
    for _label in $${SUBTITLE_LABELS_VARIABLE}; do
        _pick="$(printf "%s\\n" "$_subs" | grep -i -m 1 "\\"label\\":\\"[^\\"]*$_label")"
        [ -n "$_pick" ] && break
    done
    IFS="$_old_ifs"
    [ -n "$_pick" ] || _pick="$(printf "%s\\n" "$_subs" | grep -m 1 '"default":true')"
    printf "%s" "$_pick" | sed -nE 's|.*"src":"([^"]*)".*|\\1|p'
}

`;

// The script with its subtitle selection replaced, or null when this is not a version it knows how to change (it is then
// used as it is, and the subtitles are whatever ani-cli picks).
export function patchSubtitleSelection(source: string): string | null {
    if (!source.includes(ORIGINAL_SELECTION) || !source.includes(`\n${FUNCTION_ANCHOR}`)) {
        return null;
    }
    return source.replace(ORIGINAL_SELECTION, PATCHED_SELECTION).replace(`\n${FUNCTION_ANCHOR}`, `\n${SUBTITLE_PICK_FUNCTION}${FUNCTION_ANCHOR}`);
}

// ani-cli saves one subtitle, but the source lists all the languages it has for the episode. These two changes keep that list
// (where ani-cli reads it) and save every subtitle next to the video (where ani-cli saves the one it picked), so the player can
// offer them all. Each one is "<video name>.subtitle-<language>.vtt" (see subtitleFiles.ts).
const LIST_ANCHOR = '    # quality variants are relative to the master playlist';
const KEEP_LIST_LINE = `    pullwave_all_subs="$(printf "%s" "$_json" | sed 's|.*"subtitles":\\[||; s|}\\].*||; s|},{|}\\n{|g')"`;
// The line of the download that saves the subtitle ani-cli picked: every other one is saved right after it.
const SAVE_ANCHOR = '    [ -n "$sub_link" ] && $curl_exe -sL -A "$agent" -e "$refr" --max-time 10 $cipher_flag "$sub_link" -o "$download_dir/$_name.vtt"\n';
const SAVE_CALL = '    pullwave_save_subtitles "$download_dir/$_name"\n';

// What the code the changes add reads from the script: each has to be set by it (see aniCompatibility.ts).
export const SUBTITLE_SELECTION_NEEDS = ['_json', 'sub_link'] as const;
export const ALL_SUBTITLES_NEEDS = ['_json', 'curl_exe', 'agent', 'refr', 'cipher_flag', 'download_dir', '_name'] as const;
export const SAVE_SUBTITLES_FUNCTION = `# Added by Pullwave: saves every subtitle the source offered for the episode ($1 = path of the video without its extension).
pullwave_save_subtitles() {
    printf "%s\\n" "$pullwave_all_subs" | while IFS= read -r _line; do
        _src="$(printf "%s" "$_line" | sed -nE 's|.*"src":"([^"]*)".*|\\1|p')"
        _label="$(printf "%s" "$_line" | sed -nE 's|.*"label":"([^"]*)".*|\\1|p' | sed 's|[^A-Za-z0-9 ._()-]|_|g; s| *$||')"
        [ -n "$_src" ] && [ -n "$_label" ] && $curl_exe -sL -A "$agent" -e "$refr" --max-time 10 $cipher_flag "$_src" -o "$1.subtitle-$_label.vtt"
    done
    return 0
}

`;

// The script that also saves every subtitle, or null when this is not a version it knows how to change.
export function patchAllSubtitles(source: string): string | null {
    if (!source.includes(`\n${LIST_ANCHOR}`) || !source.includes(SAVE_ANCHOR) || !source.includes(`\n${FUNCTION_ANCHOR}`)) {
        return null;
    }
    return source
        .replace(`\n${LIST_ANCHOR}`, () => {
            return `\n${KEEP_LIST_LINE}\n${LIST_ANCHOR}`;
        })
        .replace(SAVE_ANCHOR, () => {
            return `${SAVE_ANCHOR}${SAVE_CALL}`;
        })
        .replace(`\n${FUNCTION_ANCHOR}`, () => {
            return `\n${SAVE_SUBTITLES_FUNCTION}${FUNCTION_ANCHOR}`;
        });
}
