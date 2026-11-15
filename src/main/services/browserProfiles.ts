export interface FirefoxProfileEntry {
    name: string;
    path: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseChromiumProfileNames(localStateText: string | null): Record<string, string> {
    if (localStateText === null) {
        return {};
    }
    try {
        const parsed: unknown = JSON.parse(localStateText);
        const cache = isRecord(parsed) && isRecord(parsed.profile) ? parsed.profile.info_cache : null;
        if (!isRecord(cache)) {
            return {};
        }
        return Object.fromEntries(
            Object.entries(cache).flatMap(([id, info]) => {
                return isRecord(info) && typeof info.name === 'string' && info.name.length > 0 ? [[id, info.name]] : [];
            })
        );
    } catch {
        return {};
    }
}

export function parseFirefoxProfiles(iniText: string | null): FirefoxProfileEntry[] {
    if (iniText === null) {
        return [];
    }
    const entries: FirefoxProfileEntry[] = [];
    let current: Record<string, string> | null = null;
    const closeSection = (): void => {
        if (current && current.path && current.isrelative !== '0') {
            entries.push({ name: current.name ?? current.path, path: current.path });
        }
    };
    iniText.split(/\r?\n/).forEach((rawLine) => {
        const line = rawLine.trim();
        const section = /^\[(.+)\]$/.exec(line);
        if (section) {
            closeSection();
            current = /^Profile\d+$/i.test(section[1] ?? '') ? {} : null;
            return;
        }
        const separator = line.indexOf('=');
        if (current && separator > 0) {
            current[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
        }
    });
    closeSection();
    return entries;
}
