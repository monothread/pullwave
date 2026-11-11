import type { LanguageCode } from '@shared/types';

// The names of the subtitles of the source come as the source writes them, in English and with noise ("Portuguese (-
// Portuguese(Brazil))", or "Portuguese - Brazilian (SDH)" in other sources). This shows them as the language of the app writes the language
// ("Português (Brasil) · SDH"). Only what is shown changes: the files and the ids of the subtitles keep their names.

const NAME_PATTERN = /^([A-Za-z]+(?: [A-Za-z]+)*)(?:\s*\((.*)\))?$/;
const DASH_PATTERN = /^([A-Za-z]+(?: [A-Za-z]+)*) - (.+)$/;
const LAST_PARENTHESES = /\(([^()]+)\)\s*$/;
const TRAILING_TAG = /\s*\(([A-Za-z]+)\)$/;

// What a subtitle is besides its language: for the deaf and hard of hearing (the sounds are written too), closed captions, or forced (only
// the signs and the lines in another language).
export type SubtitleTag = 'sdh' | 'cc' | 'forced';

const TAGS: Record<string, SubtitleTag> = { sdh: 'sdh', cc: 'cc', forced: 'forced' };

// How each language of the app writes the tags (SDH and CC are written the same in all of them).
const TAG_NAMES: Record<SubtitleTag, Record<LanguageCode | 'source', string>> = {
    sdh: { source: 'SDH', en: 'SDH', pt: 'SDH', es: 'SDH', ja: 'SDH', zh: 'SDH' },
    cc: { source: 'CC', en: 'CC', pt: 'CC', es: 'CC', ja: 'CC', zh: 'CC' },
    forced: { source: 'Forced', en: 'Forced', pt: 'Forçada', es: 'Forzado', ja: '強制', zh: '强制' }
};

// The region (or the way of writing, for Chinese) some sources name with a word instead of a country: "Brazilian", "Latin American",
// "European" (which depends on the language), "Simplified".
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

// The code of each language and of each region by the name English gives it: the names come from the browser, which is asked about
// every two-letter code (and every three-digit code of a region, like 419, Latin America) and the answers are turned around.
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
    // What is written for the region, without the noise around it; empty when there is none.
    region: string;
    tags: SubtitleTag[];
}

// The tags written at the end between parentheses ("(SDH)"), taken out of the name.
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

// "Language - Variant - ...": each part after the language is a tag ("SDH", "Forced") or says the region.
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

// The language, the region and the tags of a name, or null when it is not written as a language with a region between parentheses or after
// a dash.
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

// The code of the region (or of the way of writing) a name gives, by the country or by a word: "Brazil", "Brazilian", "European".
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

// The name without the noise, still in English ("Portuguese (Brazil)", "Portuguese (Brazilian) · SDH"); what could not be read stays as it is.
export function cleanSubtitleName(label: string): string {
    const parsed = parseName(label);
    if (parsed === null) {
        return label;
    }
    const name = parsed.region.length > 0 ? `${parsed.language} (${parsed.region})` : parsed.language;
    return `${name}${tagsText(parsed.tags, 'source')}`;
}

// The name of a subtitle as the language of the app writes it. A language it does not know is shown clean, in English; a name it
// cannot read, as it came.
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

// The names of a list of subtitles. Two that would be written the same are told apart: the second one is shown clean, in English,
// and, if that is the same too, as it came.
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
