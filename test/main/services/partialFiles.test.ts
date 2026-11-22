import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findPartialFiles, removeFiles, type DirectoryEntry } from '@main/services/partialFiles';
import { cleanTempDirs, makeTempDir } from '../../helpers/tempDir';

afterEach(() => {
    cleanTempDirs();
});

function files(...names: string[]): DirectoryEntry[] {
    return names.map((name) => {
        return { name, isFile: true };
    });
}

describe('findPartialFiles', () => {
    const FINAL = join('/dl', 'Video [abc].mp4');

    it('finds the partial file, the resume record and the fragments of the same download', () => {
        const entries = files(
            'Video [abc].mp4.part',
            'Video [abc].mp4.ytdl',
            'Video [abc].mp4.part-Frag12',
            'Video [abc].mp4.part-Frag12.part'
        );
        expect(findPartialFiles(FINAL, () => {return entries})).toEqual([
            join('/dl', 'Video [abc].mp4.part'),
            join('/dl', 'Video [abc].mp4.ytdl'),
            join('/dl', 'Video [abc].mp4.part-Frag12'),
            join('/dl', 'Video [abc].mp4.part-Frag12.part')
        ]);
    });

    it('finds the partial files of the video and audio formats downloaded apart', () => {
        const entries = files('Video [abc].f137.mp4.part', 'Video [abc].f251-drc.webm.part', 'Video [abc].f251-drc.webm.ytdl');
        expect(findPartialFiles(FINAL, () => {return entries})).toEqual([
            join('/dl', 'Video [abc].f137.mp4.part'),
            join('/dl', 'Video [abc].f251-drc.webm.part'),
            join('/dl', 'Video [abc].f251-drc.webm.ytdl')
        ]);
    });

    it('never lists finished files, not even complete per-format ones', () => {
        const entries = files('Video [abc].mp4', 'Video [abc].f137.mp4', 'Video [abc].f251.webm', 'Video [abc].en.vtt', 'Video [abc].mkv');
        expect(findPartialFiles(FINAL, () => {return entries})).toEqual([]);
    });

    it('never lists files of other downloads', () => {
        const entries = files('Other [xyz].mp4.part', 'Video [abcd].mp4.part', 'Video [abc]x.mp4.part', 'Video.mp4.part', 'notes.part');
        expect(findPartialFiles(FINAL, () => {return entries})).toEqual([]);
    });

    it('treats characters of the name that mean something in a pattern as plain text', () => {
        const entries = files('A+B (1) [x.y].mp4.part', 'AxB (1) [x.y].mp4.part', 'A+B (1) [xzy].mp4.part');
        expect(findPartialFiles(join('/dl', 'A+B (1) [x.y].mp4'), () => {return entries})).toEqual([join('/dl', 'A+B (1) [x.y].mp4.part')]);
    });

    it('ignores folders that look like partial files', () => {
        const entries: DirectoryEntry[] = [{ name: 'Video [abc].mp4.part', isFile: false }];
        expect(findPartialFiles(FINAL, () => {return entries})).toEqual([]);
    });

    it('lists the folder of the final file', () => {
        const listDirectory = vi.fn(() => {
            return files();
        });
        findPartialFiles(join('/media', 'videos', 'Video [abc].mp4'), listDirectory);
        expect(listDirectory).toHaveBeenCalledWith(join('/media', 'videos'));
    });

    it('works for a file without an extension', () => {
        expect(findPartialFiles(join('/dl', 'stream'), () => {return files('stream.part', 'stream.f1.mp4.part', 'streams.part')})).toEqual([
            join('/dl', 'stream.part'),
            join('/dl', 'stream.f1.mp4.part')
        ]);
    });

    it('finds nothing for an empty name', () => {
        expect(findPartialFiles('', () => {return files('.part', 'a.part')})).toEqual([]);
    });

    it('reads the real folder by default and gives nothing for a folder that does not exist', () => {
        const dir = makeTempDir();
        mkdirSync(join(dir, 'Video [abc].mp4.part'));
        writeFileSync(join(dir, 'Video [abc].mp4.part-Frag1'), 'x');
        writeFileSync(join(dir, 'Video [abc].f137.mp4.part'), 'x');
        writeFileSync(join(dir, 'Video [abc].mp4'), 'x');
        expect(findPartialFiles(join(dir, 'Video [abc].mp4')).sort()).toEqual(
            [join(dir, 'Video [abc].f137.mp4.part'), join(dir, 'Video [abc].mp4.part-Frag1')].sort()
        );
        expect(findPartialFiles(join(dir, 'missing', 'Video [abc].mp4'))).toEqual([]);
    });
});

describe('removeFiles', () => {
    it('removes every file it is given', () => {
        const remove = vi.fn();
        removeFiles(['/dl/a.part', '/dl/b.part'], remove);
        expect(remove).toHaveBeenCalledTimes(2);
        expect(remove).toHaveBeenNthCalledWith(1, '/dl/a.part');
        expect(remove).toHaveBeenNthCalledWith(2, '/dl/b.part');
    });

    it('keeps going when one file cannot be removed', () => {
        const remove = vi.fn((path: string) => {
            if (path === '/dl/a.part') {
                throw new Error('EBUSY');
            }
        });
        expect(() => {
            removeFiles(['/dl/a.part', '/dl/b.part'], remove);
        }).not.toThrow();
        expect(remove).toHaveBeenCalledTimes(2);
        expect(remove).toHaveBeenLastCalledWith('/dl/b.part');
    });

    it('deletes real files and does not complain about missing ones', () => {
        const dir = makeTempDir();
        const present = join(dir, 'a.part');
        writeFileSync(present, 'x');
        removeFiles([present, join(dir, 'missing.part')]);
        expect(existsSync(present)).toBe(false);
    });
});
