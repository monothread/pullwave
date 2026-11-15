import type { LanguageCode } from '@shared/types';

const NAME_PATTERN = /^([A-Za-z]+(?: [A-Za-z]+)*)(?:\s*\((.*)\))?$/;
const DASH_PATTERN = /^([A-Za-z]+(?: [A-Za-z]+)*) - (.+)$/;
const LAST_PARENTHESES = /\(([^()]+)\)\s*$/;
const TRAILING_TAG = /\s*\(([A-Za-z]+)\)$/;

export type SubtitleTag = 'sdh' | 'cc' | 'forced';

const TAGS: Record<string, SubtitleTag> = { sdh: 'sdh', cc: 'cc', forced: 'forced' };

const TAG_NAMES: Record<SubtitleTag, Record<LanguageCode | 'source', string>> = {
    sdh: { source: 'SDH', en: 'SDH', pt: 'SDH', es: 'SDH', ja: 'SDH', zh: 'SDH' },
    cc: { source: 'CC', en: 'CC', pt: 'CC', es: 'CC', ja: 'CC', zh: 'CC' },
    forced: { source: 'Forced', en: 'Forced', pt: 'Forçada', es: 'Forzado', ja: '強制', zh: '强制' }
};

const REGION_WORDS: Record<string, string> = {
    brazilian: 'BR',
    'latin american': '419',
    'latin america': '419',
    castilian: 'ES',
    mexican: 'MX',
    canadian: 'CA',
    simplified: 'Hans',
    traditional: 'Hant'
};

const EUROPEAN_REGIONS: Record<string, string> = { portuguese: 'PT', spanish: 'ES', french: 'FR', english: 'GB' };

interface CodesByEnglishName {
    languages: Map<string, string>;
    regions: Map<string, string>;
}

let codesCache: CodesByEnglishName | null = null;

function codesByEnglishName(): CodesByEnglishName {
    if (codesCache !== null) {
        return codesCache;
    }
    const languageNames = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' });
    const regionNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
    const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
    const pairs = letters.flatMap((first) => {
        return letters.map((second) => {
            return `${first}${second}`;
        });
    });
    const languages = new Map<string, string>();
    pairs.forEach((code) => {
        const name = languageNames.of(code);
        if (name !== undefined && !languages.has(name.toLowerCase())) {
            languages.set(name.toLowerCase(), code);
        }
    });
    const regions = new Map<string, string>();
    const regionCodes = [
        ...pairs.map((code) => {
            return code.toUpperCase();
        }),
        ...Array.from({ length: 999 }, (_unused, number) => {
            return String(number + 1).padStart(3, '0');
        })
    ];
    regionCodes.forEach((code) => {
        let name: string | undefined;
        try {
            name = regionNames.of(code);
        } catch {
            name = undefined;
        }
        if (name !== undefined && !regions.has(name.toLowerCase())) {
            regions.set(name.toLowerCase(), code);
        }
    });
    codesCache = { languages, regions };
    return codesCache;
}

interface ParsedName {
    language: string;
    region: string;
    tags: SubtitleTag[];
}

function takeTrailingTags(label: string): { rest: string; tags: SubtitleTag[] } {
    let rest = label;
    const tags: SubtitleTag[] = [];
    for (let found = TRAILING_TAG.exec(rest); found !== null; found = TRAILING_TAG.exec(rest)) {
        const tag = TAGS[(found[1] as string).toLowerCase()];
        if (tag === undefined) {
            break;
        }
        tags.unshift(tag);
        rest = rest.slice(0, found.index);
    }
    return { rest, tags };
}

function withoutRepeatedLanguage(language: string, region: string): string {
    return region.toLowerCase() === language.toLowerCase() ? '' : region;
}

function parseDashName(text: string, tags: SubtitleTag[]): ParsedName | null {
    const found = DASH_PATTERN.exec(text);
    if (found === null) {
        return null;
    }
    const language = found[1] as string;
    const regionParts: string[] = [];
    const partTags: SubtitleTag[] = [];
    (found[2] as string).split(' - ').forEach((part) => {
        const tag = TAGS[part.trim().toLowerCase()];
        if (tag === undefined) {
            regionParts.push(part.trim());
        } else {
            partTags.push(tag);
        }
    });
    return { language, region: withoutRepeatedLanguage(language, regionParts.join(' - ')), tags: [...partTags, ...tags] };
}

function parseName(label: string): ParsedName | null {
    const { rest, tags } = takeTrailingTags(label.trim());
    const dashed = parseDashName(rest, tags);
    if (dashed !== null) {
        return dashed;
    }
    const found = NAME_PATTERN.exec(rest);
    if (found === null) {
        return null;
    }
    const language = found[1] as string;
    const inner = (found[2] ?? '').trim();
    const nested = LAST_PARENTHESES.exec(inner);
    const region = (nested ? (nested[1] as string) : inner.replace(/^-\s*/, '')).trim();
    return { language, region: withoutRepeatedLanguage(language, region), tags };
}

function tagsText(tags: readonly SubtitleTag[], language: LanguageCode | 'source'): string {
    return tags
        .map((tag) => {
            return ` · ${TAG_NAMES[tag][language]}`;
        })
        .join('');
}

function regionCodeOf(parsed: ParsedName, codes: CodesByEnglishName): string | undefined {
    const region = parsed.region.toLowerCase();
    if (region === 'european') {
        return EUROPEAN_REGIONS[parsed.language.toLowerCase()];
    }
    return REGION_WORDS[region] ?? codes.regions.get(region);
}

function withCapital(text: string, language: LanguageCode): string {
    return text.length === 0 ? text : `${text.charAt(0).toLocaleUpperCase(language)}${text.slice(1)}`;
}

export function cleanSubtitleName(label: string): string {
    const parsed = parseName(label);
    if (parsed === null) {
        return label;
    }
    const name = parsed.region.length > 0 ? `${parsed.language} (${parsed.region})` : parsed.language;
    return `${name}${tagsText(parsed.tags, 'source')}`;
}

export function subtitleDisplayName(label: string, language: LanguageCode): string {
    const parsed = parseName(label);
    if (parsed === null) {
        return label;
    }
    try {
        const codes = codesByEnglishName();
        const languageCode = codes.languages.get(parsed.language.toLowerCase());
        if (languageCode === undefined) {
            return cleanSubtitleName(label);
        }
        const names = new Intl.DisplayNames([language], { type: 'language', languageDisplay: 'standard' });
        const tags = tagsText(parsed.tags, language);
        const regionCode = parsed.region.length > 0 ? regionCodeOf(parsed, codes) : undefined;
        if (regionCode !== undefined) {
            const named = names.of(`${languageCode}-${regionCode}`);
            return named === undefined ? cleanSubtitleName(label) : `${withCapital(named, language)}${tags}`;
        }
        const base = withCapital(names.of(languageCode) ?? parsed.language, language);
        return `${parsed.region.length > 0 ? `${base} (${parsed.region})` : base}${tags}`;
    } catch {
        return cleanSubtitleName(label);
    }
}

export function subtitleDisplayNames(labels: readonly string[], language: LanguageCode): string[] {
    const taken = new Set<string>();
    return labels.map((label) => {
        const candidates = [subtitleDisplayName(label, language), cleanSubtitleName(label), label];
        const chosen =
            candidates.find((candidate) => {
                return !taken.has(candidate);
            }) ?? label;
        taken.add(chosen);
        return chosen;
    });
}
