export function sectionAfter<T extends string>(sections: readonly T[], current: T, step: number): T {
    if (sections.length === 0) {
        return current;
    }
    const index = Math.max(sections.indexOf(current), 0);
    const next = (((index + step) % sections.length) + sections.length) % sections.length;
    return sections[next] ?? current;
}

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

