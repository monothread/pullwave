import type { MangaChapter, MangaDetails } from '@shared/manga';

function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
        // Characters XML 1.0 does not allow at all.
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

// The ComicInfo.xml readers understand: the series, the chapter, the people and the pages.
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
