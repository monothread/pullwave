export const MAX_SERIES_LENGTH = 100;
export const MAX_SEASON = 99;
export const MAX_SEASON_NAME_LENGTH = 60;

export interface SeriesChoice {
    series: string;
    season: number;
    seasonName?: string;
}

const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
const NUMBER = '(\\d{1,2})';
const MARKERS: ReadonlyArray<{ pattern: RegExp; season: (match: RegExpExecArray) => number | null }> = [
    {
        pattern: new RegExp(`[\\s:\\-–]+(?:season|part|cour)\\s*${NUMBER}\\s*$`, 'i'),
        season: (match) => {
            return Number(match[1]);
        }
    },
    {
        pattern: new RegExp(`[\\s:\\-–]+${NUMBER}(?:st|nd|rd|th)\\s+(?:season|part|cour)\\s*$`, 'i'),
        season: (match) => {
            return Number(match[1]);
        }
    },
    {
        pattern: /[\s:\-–]+(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:season|part|cour)\s*$/i,
        season: (match) => {
            return ORDINALS[(match[1] as string).toLowerCase()] ?? null;
        }
    },
    {
        pattern: /[\s:\-–]+final\s+season\s*$/i,
        season: () => {
            return null;
        }
    }
];

export function suggestSeries(title: string): SeriesChoice {
    const cleaned = title.trim();
    for (const marker of MARKERS) {
        const match = marker.pattern.exec(cleaned);
        if (match) {
            const base = cleaned.slice(0, match.index).trim();
            const season = marker.season(match);
            if (base.length > 0 && season !== null && season >= 1 && season <= MAX_SEASON) {
                return { series: base, season };
            }
            if (base.length > 0 && season === null) {
                return { series: base, season: 1 };
            }
        }
    }
    return { series: cleaned, season: 1 };
}

export function foldSeries(name: string): string {
    return name
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

export function sameSeries(first: string, second: string): boolean {
    return foldSeries(first) === foldSeries(second);
}

export function cleanSeriesName(name: string): string | null {
    const cleaned = name.replace(/\s+/g, ' ').trim();
    return cleaned.length > 0 && cleaned.length <= MAX_SERIES_LENGTH ? cleaned : null;
}

export function cleanSeasonName(name: string): string | null | undefined {
    const cleaned = name.replace(/\s+/g, ' ').trim();
    if (cleaned.length === 0) {
        return null;
    }
    return cleaned.length <= MAX_SEASON_NAME_LENGTH ? cleaned : undefined;
}

export function isValidSeason(season: unknown): season is number {
    return typeof season === 'number' && Number.isInteger(season) && season >= 1 && season <= MAX_SEASON;
}
