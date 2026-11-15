export function parseAniCliVersion(source: string): string | null {
    return /^version_number="([^"]+)"$/m.exec(source)?.[1] ?? null;
}

export function compareVersions(first: string, second: string): number {
    const left = first.split('.').map(Number);
    const right = second.split('.').map(Number);
    for (let position = 0; position < Math.max(left.length, right.length); position += 1) {
        const difference = (Number.isFinite(left[position]) ? (left[position] ?? 0) : 0) - (Number.isFinite(right[position]) ? (right[position] ?? 0) : 0);
        if (difference !== 0) {
            return difference;
        }
    }
    return 0;
}
