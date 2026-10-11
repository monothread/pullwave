import { buildComicInfo } from '@main/services/manga/comicInfo';

describe('buildComicInfo', () => {
    it('describes the series, the chapter, the people and the pages', () => {
        const xml = buildComicInfo({
            seriesTitle: 'One Piece',
            chapter: { name: 'Romance Dawn', number: 1, scanlator: 'Group A' },
            details: { author: 'Oda', artist: 'Oda E.', description: 'Pirates', genres: ['Action', 'Adventure'] },
            pageCount: 52
        });
        expect(xml).toBe(
            '<?xml version="1.0" encoding="utf-8"?>\n' +
                '<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">\n' +
                '  <Title>Romance Dawn</Title>\n' +
                '  <Series>One Piece</Series>\n' +
                '  <Number>1</Number>\n' +
                '  <Summary>Pirates</Summary>\n' +
                '  <Writer>Oda</Writer>\n' +
                '  <Penciller>Oda E.</Penciller>\n' +
                '  <Translator>Group A</Translator>\n' +
                '  <Genre>Action, Adventure</Genre>\n' +
                '  <PageCount>52</PageCount>\n' +
                '  <Manga>YesAndRightToLeft</Manga>\n' +
                '</ComicInfo>\n'
        );
    });

    it('leaves out what is not known', () => {
        const xml = buildComicInfo({ seriesTitle: 'X', chapter: { name: '', number: null, scanlator: null }, details: null, pageCount: 3 });
        expect(xml).not.toContain('<Title>');
        expect(xml).not.toContain('<Number>');
        expect(xml).not.toContain('<Writer>');
        expect(xml).not.toContain('<Genre>');
        expect(xml).toContain('  <Series>X</Series>\n');
        expect(xml).toContain('  <PageCount>3</PageCount>\n');
    });

    it('escapes markup in the text', () => {
        const xml = buildComicInfo({
            seriesTitle: 'A & B <C> "D" \'E\'',
            chapter: { name: 'x', number: 1, scanlator: null },
            details: null,
            pageCount: 1
        });
        expect(xml).toContain('<Series>A &amp; B &lt;C&gt; &quot;D&quot; &apos;E&apos;</Series>');
    });

    it('drops characters XML does not allow', () => {
        const xml = buildComicInfo({ seriesTitle: 'A\u0000B\u0008C', chapter: { name: 'x', number: 1, scanlator: null }, details: null, pageCount: 1 });
        expect(xml).toContain('<Series>ABC</Series>');
    });
});
