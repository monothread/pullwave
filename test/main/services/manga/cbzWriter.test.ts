import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeCbz } from '@main/services/manga/cbzWriter';
import { cleanTempDirs, makeTempDir } from '../../../helpers/tempDir';
import { readZipEntries } from '../../../helpers/zipEntries';

afterEach(() => {
    cleanTempDirs();
});

describe('writeCbz', () => {
    it('stores the pages in the order given, then the extra files, and nothing else', async () => {
        const dir = makeTempDir();
        writeFileSync(join(dir, 'a.jpg'), Buffer.from([1, 2, 3]));
        writeFileSync(join(dir, 'b.png'), Buffer.from([4, 5]));
        const output = join(dir, 'Chapter 1.cbz');
        await writeCbz(
            output,
            [
                { name: '001.jpg', path: join(dir, 'a.jpg') },
                { name: '002.png', path: join(dir, 'b.png') }
            ],
            [{ name: 'ComicInfo.xml', content: '<ComicInfo/>' }]
        );
        const entries = readZipEntries(readFileSync(output));
        expect(
            entries.map((entry) => {
                return { name: entry.name, method: entry.method, data: [...entry.data] };
            })
        ).toEqual([
            { name: '001.jpg', method: 0, data: [1, 2, 3] },
            { name: '002.png', method: 0, data: [4, 5] },
            { name: 'ComicInfo.xml', method: 8, data: [...Buffer.from('<ComicInfo/>')] }
        ]);
        expect(existsSync(`${output}.tmp`)).toBe(false);
    });

    it('writes the same bytes for the same pages', async () => {
        const dir = makeTempDir();
        writeFileSync(join(dir, 'a.jpg'), Buffer.from([1, 2, 3]));
        const first = join(dir, 'one.cbz');
        const second = join(dir, 'two.cbz');
        const entries = [{ name: '001.jpg', path: join(dir, 'a.jpg') }];
        await writeCbz(first, entries);
        await writeCbz(second, entries);
        expect(readFileSync(first).equals(readFileSync(second))).toBe(true);
    });

    it('writes an empty archive when there is nothing to put in it', async () => {
        const dir = makeTempDir();
        const output = join(dir, 'empty.cbz');
        await writeCbz(output, []);
        expect(readZipEntries(readFileSync(output))).toEqual([]);
    });

    it('leaves nothing behind when a page cannot be read', async () => {
        const dir = makeTempDir();
        const output = join(dir, 'broken.cbz');
        await expect(writeCbz(output, [{ name: '001.jpg', path: join(dir, 'missing.jpg') }])).rejects.toThrow();
        expect(existsSync(output)).toBe(false);
        expect(existsSync(`${output}.tmp`)).toBe(false);
    });

    it('removes the temporary file when the final rename fails', async () => {
        const dir = makeTempDir();
        writeFileSync(join(dir, 'a.jpg'), Buffer.from([1]));
        const output = join(dir, 'x.cbz');
        const remove = vi.fn();
        const rename = vi.fn(() => {
            throw new Error('rename failed');
        });
        await expect(writeCbz(output, [{ name: '001.jpg', path: join(dir, 'a.jpg') }], [], { rename, remove })).rejects.toThrow('rename failed');
        expect(rename).toHaveBeenCalledWith(`${output}.tmp`, output);
        expect(remove).toHaveBeenCalledWith(`${output}.tmp`);
    });
});
