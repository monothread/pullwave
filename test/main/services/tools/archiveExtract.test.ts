import { existsSync, lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as tar from 'tar';
import { ZipFile } from 'yazl';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { ArchiveError, extractArchive, isExcluded, safeTarget, stripPath } from '@main/services/tools/archiveExtract';
import { cleanTempDirs, makeTempDir } from '../../../helpers/tempDir';
import { craftZip } from '../../../helpers/craftZip';

afterEach(() => {
    cleanTempDirs();
});

async function makeTarGz(root: string, files: Record<string, string>, executables: string[] = []): Promise<string> {
    const source = join(root, 'source');
    Object.entries(files).forEach(([path, content]) => {
        const full = join(source, path);
        mkdirSync(join(full, '..'), { recursive: true });
        writeFileSync(full, content, { mode: executables.includes(path) ? 0o755 : 0o644 });
    });
    const archive = join(root, 'archive.tar.gz');
    await tar.c({ gzip: true, file: archive, cwd: source }, ['top']);
    return archive;
}

async function makeZip(root: string, files: Record<string, string>): Promise<string> {
    const zip = new ZipFile();
    Object.entries(files).forEach(([path, content]) => {
        zip.addBuffer(Buffer.from(content), path, { mode: path.endsWith('.sh') ? 0o100755 : 0o100644 });
    });
    zip.end();
    const archive = join(root, 'archive.zip');
    await pipeline(zip.outputStream, createWriteStream(archive));
    return archive;
}

describe('stripPath', () => {
    it('drops the leading folders', () => {
        expect(stripPath('top/bin/app', 1)).toBe('bin/app');
        expect(stripPath('top/sub/bin/app', 2)).toBe('bin/app');
        expect(stripPath('./top/bin/app', 1)).toBe('bin/app');
        expect(stripPath('top\\bin\\app', 1)).toBe('bin/app');
    });

    it('is null when only the leading folders are left', () => {
        expect(stripPath('top/', 1)).toBeNull();
        expect(stripPath('top', 1)).toBeNull();
        expect(stripPath('', 0)).toBeNull();
    });
});

describe('isExcluded', () => {
    it('is true for the folder and what is in it', () => {
        expect(isExcluded('electron', ['electron'])).toBe(true);
        expect(isExcluded('electron/a/b', ['electron'])).toBe(true);
    });

    it('is false for a name that only starts the same way', () => {
        expect(isExcluded('electronics/a', ['electron'])).toBe(false);
        expect(isExcluded('bin/electron', ['electron'])).toBe(false);
        expect(isExcluded('bin/a', [])).toBe(false);
    });
});

describe('safeTarget', () => {
    it('resolves inside the destination', () => {
        expect(safeTarget('/dest', 'a/b')).toBe('/dest/a/b');
    });

    it('refuses a path that goes out or an absolute one', () => {
        expect(() => {
            return safeTarget('/dest', '../evil');
        }).toThrow(ArchiveError);
        expect(() => {
            return safeTarget('/dest', 'a/../../evil');
        }).toThrow('The archive has a path outside its folder');
        expect(() => {
            return safeTarget('/dest', '/etc/passwd');
        }).toThrow(ArchiveError);
    });

    it('refuses a sibling whose name starts like the destination', () => {
        expect(() => {
            return safeTarget('/dest', '../dest-evil/x');
        }).toThrow(ArchiveError);
    });
});

describe('extractArchive tar.gz', () => {
    it('unpacks without the leading folder and without the excluded folders, keeping executables runnable', async () => {
        const root = makeTempDir();
        const archive = await makeTarGz(
            root,
            { 'top/bin/app.jar': 'jar', 'top/jre/bin/java': 'java', 'top/electron/big.bin': 'big', 'top/electron/sub/x': 'x', 'top/readme.txt': 'hi' },
            ['top/jre/bin/java']
        );
        const destination = join(root, 'out');
        await extractArchive('tar.gz', archive, { destination, stripComponents: 1, exclude: ['electron'] });
        expect(readFileSync(join(destination, 'bin', 'app.jar'), 'utf-8')).toBe('jar');
        expect(readFileSync(join(destination, 'jre', 'bin', 'java'), 'utf-8')).toBe('java');
        expect(readFileSync(join(destination, 'readme.txt'), 'utf-8')).toBe('hi');
        expect(existsSync(join(destination, 'electron'))).toBe(false);
        expect(statSync(join(destination, 'jre', 'bin', 'java')).mode & 0o111).not.toBe(0);
        expect(existsSync(join(destination, 'top'))).toBe(false);
    });

    it('does not write outside the destination for a path that goes up', async () => {
        const root = makeTempDir();
        const source = join(root, 'source');
        mkdirSync(source, { recursive: true });
        writeFileSync(join(root, 'evil.txt'), 'evil');
        writeFileSync(join(source, 'ok.txt'), 'ok');
        const archive = join(root, 'bad.tar.gz');
        await tar.c({ gzip: true, file: archive, cwd: source, preservePaths: true }, ['ok.txt', '../evil.txt']);
        const destination = join(root, 'deep', 'out');
        await extractArchive('tar.gz', archive, { destination, stripComponents: 0, exclude: [] });
        expect(readFileSync(join(destination, 'ok.txt'), 'utf-8')).toBe('ok');
        expect(existsSync(join(root, 'deep', 'evil.txt'))).toBe(false);
        expect(existsSync(join(destination, 'evil.txt'))).toBe(false);
        expect(readFileSync(join(root, 'evil.txt'), 'utf-8')).toBe('evil');
    });

    it('fails for a file that is not an archive', async () => {
        const root = makeTempDir();
        const file = join(root, 'not.tar.gz');
        writeFileSync(file, 'plain text');
        await expect(extractArchive('tar.gz', file, { destination: join(root, 'out'), stripComponents: 1, exclude: [] })).rejects.toThrow();
    });
});

describe('extractArchive zip', () => {
    it('unpacks without the leading folder and without the excluded folders, keeping executables runnable', async () => {
        const root = makeTempDir();
        const archive = await makeZip(root, { 'top/bin/app.jar': 'jar', 'top/run.sh': 'run', 'top/electron/big.bin': 'big', 'top/electron/sub/x': 'x', 'top/readme.txt': 'hi' });
        const destination = join(root, 'out');
        await extractArchive('zip', archive, { destination, stripComponents: 1, exclude: ['electron'] });
        expect(readFileSync(join(destination, 'bin', 'app.jar'), 'utf-8')).toBe('jar');
        expect(readFileSync(join(destination, 'readme.txt'), 'utf-8')).toBe('hi');
        expect(existsSync(join(destination, 'electron'))).toBe(false);
        expect(statSync(join(destination, 'run.sh')).mode & 0o111).not.toBe(0);
        expect(statSync(join(destination, 'readme.txt')).mode & 0o111).toBe(0);
    });

    it('makes the folders the archive lists', async () => {
        const root = makeTempDir();
        const archive = join(root, 'dirs.zip');
        writeFileSync(archive, craftZip([{ name: 'top/', mode: 0o040755 }, { name: 'top/empty/', mode: 0o040755 }, { name: 'top/a.txt', data: 'a' }]));
        const destination = join(root, 'out');
        await extractArchive('zip', archive, { destination, stripComponents: 1, exclude: [] });
        expect(statSync(join(destination, 'empty')).isDirectory()).toBe(true);
        expect(readFileSync(join(destination, 'a.txt'), 'utf-8')).toBe('a');
    });

    // The reader of ZIP files refuses these names itself; safeTarget is the second guard, tested above.
    it('refuses an archive with a path that goes out of the folder, and writes nothing outside', async () => {
        const root = makeTempDir();
        const archive = join(root, 'evil.zip');
        writeFileSync(archive, craftZip([{ name: 'top/ok.txt', data: 'ok' }, { name: 'top/../../evil.txt', data: 'evil' }]));
        const destination = join(root, 'deep', 'out');
        await expect(extractArchive('zip', archive, { destination, stripComponents: 1, exclude: [] })).rejects.toThrow(/outside its folder|invalid relative path/);
        expect(existsSync(join(root, 'evil.txt'))).toBe(false);
        expect(existsSync(join(root, 'deep', 'evil.txt'))).toBe(false);
    });

    it('does not unpack a link', async () => {
        const root = makeTempDir();
        const archive = join(root, 'link.zip');
        writeFileSync(archive, craftZip([{ name: 'top/real.txt', data: 'real' }, { name: 'top/link', data: '/etc/passwd', mode: 0o120777 }]));
        const destination = join(root, 'out');
        await extractArchive('zip', archive, { destination, stripComponents: 1, exclude: [] });
        expect(readFileSync(join(destination, 'real.txt'), 'utf-8')).toBe('real');
        expect(() => {
            return lstatSync(join(destination, 'link'));
        }).toThrow();
    });

    it('fails for a file that is not an archive', async () => {
        const root = makeTempDir();
        const file = join(root, 'not.zip');
        writeFileSync(file, 'plain text');
        await expect(extractArchive('zip', file, { destination: join(root, 'out'), stripComponents: 1, exclude: [] })).rejects.toThrow();
    });
});
