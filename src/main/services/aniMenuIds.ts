const ORIGINAL_MENU_LINES = `cut -f 1,3 | tr '\\t' ' ' | menu "$_prompt"`;
const PATCHED_MENU_LINES = `cut -f 1,2,3 | sed -E 's/^([^\\t]*)\\t([^\\t]*)\\t/\\1 pwid:\\2 /' | tr '\\t' ' ' | menu "$_prompt"`;

export const SOURCE_ID_MARKER = 'pwid:';

export function patchMenuIds(source: string): string | null {
    return source.includes(ORIGINAL_MENU_LINES) ? source.replace(ORIGINAL_MENU_LINES, PATCHED_MENU_LINES) : null;
}
