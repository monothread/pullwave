import type { MangaChapter, MangaDetails } from '@shared/manga';
import { MAX_LOCAL_PAGES } from './localPages';

const STRICT_CHAPTER_NUMBER = /^\d+(?:\.\d+)?$/;
const STRICT_NON_NEGATIVE_INT = /^\d+$/;

function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

function element(name: string, value: string | number | null): string {
    if (value === null || String(value).trim().length === 0) {
        return '';
    }
    return `  <${name}>${escapeXml(String(value))}</${name}>\n`;
}

export interface ComicInfoInput {
    seriesTitle: string;
    chapter: Pick<MangaChapter, 'name' | 'number' | 'scanlator'>;
    details: Pick<MangaDetails, 'author' | 'artist' | 'description' | 'genres'> | null;
    pageCount: number;
}

export interface ParsedComicInfo {
    title: string | null;
    series: string | null;
    number: number | null;
    description: string | null;
    author: string | null;
    artist: string | null;
    scanlator: string | null;
    genres: string[];
    pageCount: number | null;
}

function decodeNumericEntity(_match: string, hex: string | undefined, dec: string | undefined): string {
    const code = hex !== undefined ? Number.parseInt(hex, 16) : Number.parseInt(dec ?? '', 10);
    if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) {
        return '';
    }
    try {
        return String.fromCodePoint(code);
    } catch {
        return '';
    }
}

function unescapeXml(value: string): string {
    return value
        .replace(/&#x([0-9a-fA-F]+);|&#(\d+);/g, decodeNumericEntity)
        .replace(/&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<')
        .replace(/&amp;/g, '&');
}

function stripXmlComments(xml: string): string {
    return xml.replace(/<!--[\s\S]*?-->/g, '');
}

function readXmlElement(xml: string, tag: string): string | null {
    const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`);
    const match = pattern.exec(xml);
    if (match === null || match[1] === undefined) {
        return null;
    }
    const raw = match[1].trim();
    const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(raw);
    const value = (cdata !== null && cdata[1] !== undefined ? cdata[1] : unescapeXml(raw)).trim();
    return value.length > 0 ? value : null;
}

export function parseComicInfo(xml: string): ParsedComicInfo | null {
    const cleaned = stripXmlComments(xml);
    if (!cleaned.includes('<ComicInfo')) {
        return null;
    }
    const rawNumber = readXmlElement(cleaned, 'Number');
    const parsedNumber = rawNumber !== null && STRICT_CHAPTER_NUMBER.test(rawNumber) ? Number(rawNumber) : Number.NaN;
    const rawPageCount = readXmlElement(cleaned, 'PageCount');
    const parsedPageCount = rawPageCount !== null && STRICT_NON_NEGATIVE_INT.test(rawPageCount) ? Number(rawPageCount) : Number.NaN;
    const rawGenre = readXmlElement(cleaned, 'Genre');
    const genres = rawGenre === null
        ? []
        : rawGenre
              .split(',')
              .map((genre) => {
                  return genre.trim();
              })
              .filter((genre) => {
                  return genre.length > 0;
              })
              .slice(0, 100);
    return {
        title: readXmlElement(cleaned, 'Title'),
        series: readXmlElement(cleaned, 'Series'),
        number: Number.isFinite(parsedNumber) ? parsedNumber : null,
        description: readXmlElement(cleaned, 'Summary'),
        author: readXmlElement(cleaned, 'Writer'),
        artist: readXmlElement(cleaned, 'Penciller'),
        scanlator: readXmlElement(cleaned, 'Translator'),
        genres,
        pageCount: Number.isInteger(parsedPageCount) && parsedPageCount >= 0 && parsedPageCount <= MAX_LOCAL_PAGES ? parsedPageCount : null
    };
}

export function buildComicInfo(input: ComicInfoInput): string {
    const { seriesTitle, chapter, details, pageCount } = input;
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n' +
        '<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">\n' +
        element('Title', chapter.name) +
        element('Series', seriesTitle) +
        element('Number', chapter.number) +
        element('Summary', details?.description ?? null) +
        element('Writer', details?.author ?? null) +
        element('Penciller', details?.artist ?? null) +
        element('Translator', chapter.scanlator) +
        element('Genre', details !== null && details.genres.length > 0 ? details.genres.join(', ') : null) +
        element('PageCount', pageCount) +
        element('Manga', 'YesAndRightToLeft') +
        '</ComicInfo>\n'
    );
}
