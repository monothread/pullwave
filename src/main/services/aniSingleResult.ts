const ORIGINAL_SHORTCUT = '[ "$_line_count" -eq 1 ] && printf "%s" "$_stdin" | cut -f 2,3 && return 0';
const PATCHED_SHORTCUT = '[ "$_line_count" -eq 1 ] && [ "$1" != "Select anime: " ] && printf "%s" "$_stdin" | cut -f 2,3 && return 0';

export function patchSingleResult(source: string): string | null {
    return source.includes(ORIGINAL_SHORTCUT) ? source.replace(ORIGINAL_SHORTCUT, PATCHED_SHORTCUT) : null;
}
