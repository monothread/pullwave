import {
    CBZ_EXTENSION,
    chapterFolderName,
    chapterLabel,
    chapterOutputPath,
    chapterWorkDirectory,
    formatChapterNumber,
    formatOfPath,
    isCompletePage,
    mangaDirectory,
    mangaFolderName,
    numberedPath,
    pageFileName,
    uniquePath
} from '@main/services/manga/mangaFiles';

describe('pageFileName', () => {
    it('pads to three digits and starts at 001', () => {
        expect(pageFileName(0, 10)).toBe('001');
        expect(pageFileName(9, 10)).toBe('010');
    });

    it('widens for chapters with more than 999 pages', () => {
        expect(pageFileName(0, 1000)).toBe('0001');
        expect(pageFileName(999, 1000)).toBe('1000');
    });

    it('keeps the names in reading order when sorted as text', () => {
        const names = [10, 2, 1].map((index) => {
            return pageFileName(index, 120);
        });
        expect([...names].sort()).toEqual(['002', '003', '011']);
    });

    it('treats an unknown page count as one page', () => {
        expect(pageFileName(0, 0)).toBe('001');
    });
});

describe('chapterLabel', () => {
    it('uses the number when the source gave one', () => {
        expect(chapterLabel({ name: 'The start', number: 12.5 })).toBe('Chapter 12.5');
    });

    it('uses the name when there is no number', () => {
        expect(chapterLabel({ name: 'Special', number: null })).toBe('Special');
    });

    it('falls back to "Chapter" when there is neither', () => {
        expect(chapterLabel({ name: '  ', number: null })).toBe('Chapter');
    });

    it('formats a whole number without decimals', () => {
        expect(formatChapterNumber(3)).toBe('3');
        expect(formatChapterNumber(3.5)).toBe('3.5');
    });
});

describe('folder and file names', () => {
    it('removes characters a file system does not accept', () => {
        expect(mangaFolderName('Re:Zero / Starting?', 'linux')).toBe('Re_Zero _ Starting_');
    });

    it('avoids names Windows keeps and trailing dots on Windows', () => {
        expect(mangaFolderName('CON', 'win32')).toBe('_CON');
        expect(mangaFolderName('Title...', 'win32')).toBe('Title');
    });

    it('names an untitled manga "manga"', () => {
        expect(mangaFolderName('   ', 'linux')).toBe('manga');
    });

    it('names a chapter folder after its label', () => {
        expect(chapterFolderName({ name: 'x', number: 4 }, 'linux')).toBe('Chapter 4');
    });

    it('joins the manga folder under the base directory with the separator of the platform', () => {
        expect(mangaDirectory('/home/me/Manga', 'One Piece', 'linux')).toBe('/home/me/Manga/One Piece');
        expect(mangaDirectory('C:\\Manga', 'One Piece', 'win32')).toBe('C:\\Manga\\One Piece');
    });
});

describe('chapterOutputPath', () => {
    const chapter = { name: 'x', number: 7 };

    it('is a .cbz file for the cbz format', () => {
        expect(CBZ_EXTENSION).toBe('.cbz');
        expect(chapterOutputPath('/m/One Piece', chapter, 'cbz', 'linux')).toBe('/m/One Piece/Chapter 7.cbz');
    });

    it('is a folder for the folder format', () => {
        expect(chapterOutputPath('/m/One Piece', chapter, 'folder', 'linux')).toBe('/m/One Piece/Chapter 7');
    });
});

describe('uniquePath', () => {
    it('keeps the path when nothing is there', () => {
        expect(uniquePath('/m/a.cbz', () => {
            return false;
        }, 'linux')).toBe('/m/a.cbz');
    });

    it('adds (2) before the extension when the path is taken', () => {
        const taken = new Set(['/m/a.cbz']);
        expect(uniquePath('/m/a.cbz', (path) => {
            return taken.has(path);
        }, 'linux')).toBe('/m/a (2).cbz');
    });

    it('goes on to the next free number', () => {
        const taken = new Set(['/m/a.cbz', '/m/a (2).cbz', '/m/a (3).cbz']);
        expect(uniquePath('/m/a.cbz', (path) => {
            return taken.has(path);
        }, 'linux')).toBe('/m/a (4).cbz');
    });

    it('numbers a folder (no extension) at the end', () => {
        const taken = new Set(['/m/Chapter 1']);
        expect(uniquePath('/m/Chapter 1', (path) => {
            return taken.has(path);
        }, 'linux')).toBe('/m/Chapter 1 (2)');
    });
});

describe('numberedPath', () => {
    it('is the path itself for the first attempt (and anything below it)', () => {
        expect(numberedPath('/m/a.cbz', 1, 'linux')).toBe('/m/a.cbz');
        expect(numberedPath('/m/a.cbz', 0, 'linux')).toBe('/m/a.cbz');
    });

    it('puts the number before the extension, or at the end of a folder', () => {
        expect(numberedPath('/m/a.cbz', 2, 'linux')).toBe('/m/a (2).cbz');
        expect(numberedPath('/m/a.cbz', 13, 'linux')).toBe('/m/a (13).cbz');
        expect(numberedPath('/m/Chapter 1', 3, 'linux')).toBe('/m/Chapter 1 (3)');
    });

    it('follows the rules of Windows paths', () => {
        expect(numberedPath('C:\\m\\a.cbz', 2, 'win32')).toBe('C:\\m\\a (2).cbz');
    });
});

describe('formatOfPath', () => {
    it('is a CBZ for a path that ends in .cbz, whatever its case', () => {
        expect(formatOfPath('/m/Chapter 1.cbz')).toBe('cbz');
        expect(formatOfPath('/m/Chapter 1 (2).CBZ')).toBe('cbz');
    });

    it('is a folder for any other path', () => {
        expect(formatOfPath('/m/Chapter 1')).toBe('folder');
        expect(formatOfPath('/m/Chapter 1.cbz.part')).toBe('folder');
    });
});

describe('isCompletePage', () => {
    it('takes a page that has its final name', () => {
        expect(isCompletePage('001.jpg')).toBe(true);
        expect(isCompletePage('012.webp')).toBe(true);
    });

    it('leaves out a page that is half written and the ComicInfo', () => {
        expect(isCompletePage('003.tmp')).toBe(false);
        expect(isCompletePage('ComicInfo.xml')).toBe(false);
    });
});

describe('chapterWorkDirectory', () => {
    it('sits beside the final place', () => {
        expect(chapterWorkDirectory('/m/One Piece/Chapter 7.cbz')).toBe('/m/One Piece/Chapter 7.cbz.part');
    });
});
