import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
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

describe('extractArchive of a .tar.xz', () => {
    it('asks the tar of the system to unpack it without the leading folders, in the destination', async () => {
        const root = makeTempDir();
        const destination = join(root, 'out');
        const run = vi.fn(async () => {
            mkdirSync(join(destination, 'bin'), { recursive: true });
        });
        await extractArchive('tar.xz', join(root, 'a.tar.xz'), { destination, stripComponents: 1, exclude: [] }, run, 'linux');
        expect(run).toHaveBeenCalledTimes(1);
        expect(run).toHaveBeenCalledWith('tar', ['-xJf', join(root, 'a.tar.xz'), '-C', destination, '--strip-components=1']);
    });

    it('uses the tar of Windows itself on Windows, not the first one in the PATH', async () => {
        const root = makeTempDir();
        const run = vi.fn(async () => {return undefined});
        await extractArchive('tar.xz', join(root, 'a.tar.xz'), { destination: join(root, 'out'), stripComponents: 0, exclude: [] }, run, 'win32');
        const command = (run.mock.calls[0] as unknown as [string, string[]])[0];
        expect(command.replace(/\\/g, '/')).toMatch(/\/System32\/tar\.exe$/);
        expect((run.mock.calls[0] as unknown as [string, string[]])[1]).toContain('--strip-components=0');
    });

    it('takes away the folders that are not needed after it unpacks', async () => {
        const root = makeTempDir();
        const destination = join(root, 'out');
        const run = vi.fn(async () => {
            mkdirSync(join(destination, 'bin'), { recursive: true });
            mkdirSync(join(destination, 'include', 'sub'), { recursive: true });
            mkdirSync(join(destination, 'doc'), { recursive: true });
            writeFileSync(join(destination, 'bin', 'ffmpeg'), 'x');
            writeFileSync(join(destination, 'include', 'sub', 'h.h'), 'x');
        });
        await extractArchive('tar.xz', join(root, 'a.tar.xz'), { destination, stripComponents: 1, exclude: ['include', 'doc'] }, run, 'linux');
        expect(existsSync(join(destination, 'bin', 'ffmpeg'))).toBe(true);
        expect(existsSync(join(destination, 'include'))).toBe(false);
        expect(existsSync(join(destination, 'doc'))).toBe(false);
    });

    it('does not remove anything outside the destination for an exclude that would leave it', async () => {
        const root = makeTempDir();
        const destination = join(root, 'out');
        writeFileSync(join(root, 'keep.txt'), 'x');
        await expect(extractArchive('tar.xz', join(root, 'a.tar.xz'), { destination, stripComponents: 0, exclude: ['../keep.txt'] }, async () => {return undefined}, 'linux')).rejects.toBeInstanceOf(ArchiveError);
        expect(existsSync(join(root, 'keep.txt'))).toBe(true);
    });

    it('passes on the failure of tar', async () => {
        const root = makeTempDir();
        const run = vi.fn(async () => {
            throw new ArchiveError('tar could not unpack the file');
        });
        await expect(extractArchive('tar.xz', join(root, 'a.tar.xz'), { destination: join(root, 'out'), stripComponents: 0, exclude: [] }, run, 'linux')).rejects.toThrow('tar could not unpack the file');
    });

    it('fails with an ArchiveError, not with something else, when the archive is not there', async () => {
        const root = makeTempDir();
        await expect(extractArchive('tar.xz', join(root, 'a.tar.xz'), { destination: join(root, 'out'), stripComponents: 0, exclude: [] }, undefined, 'linux').then(() => {return 'ok'})).rejects.toBeInstanceOf(ArchiveError);
    });

    const xzThere = spawnSync('xz', ['--version']).status === 0 && spawnSync('tar', ['--version']).status === 0;

    it.runIf(xzThere)('unpacks a real .tar.xz with its links, with no leading folder and without the excluded one', async () => {
        const root = makeTempDir();
        const source = join(root, 'source', 'top');
        mkdirSync(join(source, 'bin'), { recursive: true });
        mkdirSync(join(source, 'lib'), { recursive: true });
        mkdirSync(join(source, 'doc'), { recursive: true });
        writeFileSync(join(source, 'bin', 'ffmpeg'), 'binary', { mode: 0o755 });
        writeFileSync(join(source, 'lib', 'libx.so.1'), 'library');
        symlinkSync('libx.so.1', join(source, 'lib', 'libx.so'));
        writeFileSync(join(source, 'doc', 'readme'), 'doc');
        const archive = join(root, 'a.tar.xz');
        expect(spawnSync('tar', ['-cJf', archive, '-C', join(root, 'source'), 'top']).status).toBe(0);
        const destination = join(root, 'out');
        await extractArchive('tar.xz', archive, { destination, stripComponents: 1, exclude: ['doc'] });
        expect(readFileSync(join(destination, 'bin', 'ffmpeg'), 'utf-8')).toBe('binary');
        expect(statSync(join(destination, 'bin', 'ffmpeg')).mode & 0o111).not.toBe(0);
        expect(lstatSync(join(destination, 'lib', 'libx.so')).isSymbolicLink()).toBe(true);
        expect(readFileSync(join(destination, 'lib', 'libx.so'), 'utf-8')).toBe('library');
        expect(existsSync(join(destination, 'doc'))).toBe(false);
        expect(existsSync(join(destination, 'top'))).toBe(false);
    });

    it.runIf(xzThere)('fails, with the reason, for a file that is not a .tar.xz', async () => {
        const root = makeTempDir();
        writeFileSync(join(root, 'bad.tar.xz'), 'not an archive');
        await expect(extractArchive('tar.xz', join(root, 'bad.tar.xz'), { destination: join(root, 'out'), stripComponents: 0, exclude: [] })).rejects.toThrow(/tar could not unpack the file/);
    });
});

describe('extractArchive of a file that is not packed', () => {
    it('has nothing to unpack: the installer puts the file in its place itself', async () => {
        const root = makeTempDir();
        await expect(extractArchive('raw', join(root, 'x'), { destination: join(root, 'out'), stripComponents: 0, exclude: [] })).rejects.toBeInstanceOf(ArchiveError);
    });
});
