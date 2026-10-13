// Scripts that look like ani-cli to the changes of Pullwave (see aniPatches.ts): each constant is the part of the script one change looks for.
export const SELECTION_LINE = `    sub_link="$(printf "%s" "$_json" | sed 's|.*"subtitles":\\[||; s|}\\].*||; s|},{|}\\n{|g' | grep -m 1 '"default":true' | sed -nE 's|.*"src":"([^"]*)".*|\\1|p')"`;
export const SELECTION_PART = ['hianime_m3u8() {', SELECTION_LINE, '}'].join('\n');
export const LIST_LINE = '    # quality variants are relative to the master playlist';
export const ALL_SUBTITLES_PART = [LIST_LINE, '    command -v "yt-dlp" >/dev/null && yt-dlp --referer "$refr" "$1" -o x'].join('\n');
export const DEBUG_PART = '        debug) printf "All links:\\n%s\\nSelected link:\\n%s\\nSubtitles:\\n%s\\n" "$links" "$video_link" "$sub_link" ;;';

// A script every change of Pullwave fits, with the version it says; `extra` tells two scripts of the same version apart.
export function aniCliScript(version: string, extra = ''): string {
    return `#!/bin/sh\nversion_number="${version}"\n${SELECTION_PART}\n${ALL_SUBTITLES_PART}\n${DEBUG_PART}\n${extra}`;
}

// The same without the parts the changes look for, as a script that ani-cli changed under them would be.
export function aniCliScriptWithout(version: string, ...parts: string[]): string {
    return parts.reduce((text, part) => {
        return text.replace(part, '# changed upstream');
    }, aniCliScript(version));
}
