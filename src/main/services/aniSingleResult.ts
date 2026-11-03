// ani-cli picks a search result by itself, without asking, when the source gives only one (`nth` returns the lone line before it reaches the
// menu). The title of that result is never printed, so all the app sees is the list of its episodes, and it cannot tell which anime the source
// picked for the words searched. This lets the menu show the list of the anime even when it has a single line, so the title that is
// shown is the one of the anime the episodes belong to. The lists of episodes are left as they are.
const ORIGINAL_SHORTCUT = '[ "$_line_count" -eq 1 ] && printf "%s" "$_stdin" | cut -f 2,3 && return 0';
const PATCHED_SHORTCUT = '[ "$_line_count" -eq 1 ] && [ "$1" != "Select anime: " ] && printf "%s" "$_stdin" | cut -f 2,3 && return 0';

// The script with the lone result shown in the menu, or null when this is not a version it knows how to change.
export function patchSingleResult(source: string): string | null {
    return source.includes(ORIGINAL_SHORTCUT) ? source.replace(ORIGINAL_SHORTCUT, PATCHED_SHORTCUT) : null;
}
