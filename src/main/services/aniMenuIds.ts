// The lists ani-cli hands to its menu have, for each anime, a number, the id the source gives it and its title, but the menu only gets the number
// and the title (`cut -f 1,3`). Two seasons of an anime can have the same title and differ only by the id, so this lets the id through,
// marked with "pwid:" so it is told from the title whatever the id looks like: the lines the app reads become "<number> pwid:<id> <title>".
// Lines that do not have the three columns (the lists of episodes) are left as they are. The `cut` stays in front of the `sed` because it is
// what ends the last line with a new line, which the menu needs to read it.
const ORIGINAL_MENU_LINES = `cut -f 1,3 | tr '\\t' ' ' | menu "$_prompt"`;
const PATCHED_MENU_LINES = `cut -f 1,2,3 | sed -E 's/^([^\\t]*)\\t([^\\t]*)\\t/\\1 pwid:\\2 /' | tr '\\t' ' ' | menu "$_prompt"`;

// The marker in front of the id in a line of the menu.
export const SOURCE_ID_MARKER = 'pwid:';

// The script with the id in the lines of the menu, or null when this is not a version it knows how to change.
export function patchMenuIds(source: string): string | null {
    return source.includes(ORIGINAL_MENU_LINES) ? source.replace(ORIGINAL_MENU_LINES, PATCHED_MENU_LINES) : null;
}
