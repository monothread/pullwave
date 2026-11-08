// The section `step` places away from the current one in the list, going round at the ends; the first one when the current one is not listed.
export function sectionAfter<T extends string>(sections: readonly T[], current: T, step: number): T {
    if (sections.length === 0) {
        return current;
    }
    const index = Math.max(sections.indexOf(current), 0);
    const next = (((index + step) % sections.length) + sections.length) % sections.length;
    return sections[next] ?? current;
}

// The section `step` places away from the current one in the list, going round at the ends; the first one when the current one is not in the
// list (the settings of the whole app, for example, which are not one of the sections that are walked through).
export function mainSectionAfter<T extends string>(sections: readonly T[], current: string, step: number): T | null {
    const first = sections[0];
    if (first === undefined) {
        return null;
    }
    const index = sections.indexOf(current as T);
    if (index < 0) {
        return first;
    }
    return sections[(((index + step) % sections.length) + sections.length) % sections.length] ?? first;
}

