// The section `step` places away from the current one in the list, going round at the ends; the first one when the current one is not listed.
export function sectionAfter<T extends string>(sections: readonly T[], current: T, step: number): T {
    if (sections.length === 0) {
        return current;
    }
    const index = Math.max(sections.indexOf(current), 0);
    const next = (((index + step) % sections.length) + sections.length) % sections.length;
    return sections[next] ?? current;
}
