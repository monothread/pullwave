import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    buildBreadcrumbs,
    createExplorerMediaHandler,
    ExplorerService,
    parseExplorerMediaUrl,
    validateEntryName
} from '@main/services/explorerService';
import { ExplorerThumbnails, thumbnailCacheKey } from '@main/services/explorerThumbnails';
import { defaultMediaFileSystem } from '@main/services/mediaProtocol';

describe('ExplorerService', () => {
    let workDir: string;
    let mediaDir: string;
    let subDir: string;
    let thumbnails: ExplorerThumbnails;
    let trashItem: ReturnType<typeof vi.fn<(path: string) => Promise<void>>>;
    let openExternal: ReturnType<typeof vi.fn<(path: string) => Promise<string>>>;
    let service: ExplorerService;

    beforeEach(() => {
        workDir = mkdtempSync(join(tmpdir(), 'pullwave-explorer-svc-'));
        mediaDir = join(workDir, 'media');
        subDir = join(mediaDir, 'Clips');
        mkdirSync(subDir, { recursive: true });
        mkdirSync(join(mediaDir, '.hidden-dir'), { recursive: true });
        writeFileSync(join(mediaDir, 'movie.mp4'), 'video-bytes');
        writeFileSync(join(mediaDir, 'song.mp3'), 'audio-bytes');
        writeFileSync(join(mediaDir, '.secret.mp4'), 'hidden-video');
        writeFileSync(join(mediaDir, 'notes.txt'), 'not media');
        writeFileSync(join(mediaDir, 'photo.png'), 'not media');

        thumbnails = new ExplorerThumbnails({
            runFfmpeg: () => {
                return async ({ args }) => {
                    writeFileSync(args.at(-1) ?? '', Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
                    return { code: 0, output: '' };
                };
            },
            cacheDirectory: join(workDir, 'thumbs'),
            previewDirectory: join(workDir, 'preview')
        });
        trashItem = vi.fn(async (target: string) => {
            rmSync(target, { recursive: true, force: true });
        });
        openExternal = vi.fn(async () => {
            return '';
        });
        service = new ExplorerService({
            defaultDirectory: () => {
                return mediaDir;
            },
            roots: () => {
                return [
                    { id: 'downloads', label: 'downloads', path: mediaDir, kind: 'downloads' },
                    { id: 'dup', label: 'dup', path: mediaDir, kind: 'home' },
                    { id: 'missing', label: 'missing', path: join(workDir, 'nope'), kind: 'videos' }
                ];
            },
            chooseFolder: async () => {
                return subDir;
            },
            trashItem,
            openExternal,
            thumbnails
        });
    });

    afterEach(() => {
        thumbnails.dispose();
        rmSync(workDir, { recursive: true, force: true });
    });

    it('validates names, builds breadcrumbs, and parses explorer media URLs', () => {
        expect(validateEntryName('Valid Folder', 'linux')).toBe('Valid Folder');
        expect(validateEntryName('  spaced  ', 'linux')).toBe('spaced');
        expect(validateEntryName('', 'linux')).toBeNull();
        expect(validateEntryName('.', 'linux')).toBeNull();
        expect(validateEntryName('..', 'linux')).toBeNull();
        expect(validateEntryName('a/b', 'linux')).toBeNull();
        expect(validateEntryName('a\\b', 'linux')).toBeNull();
        expect(validateEntryName('bad:name', 'win32')).toBeNull();
        expect(validateEntryName('trailing.', 'win32')).toBeNull();
        expect(validateEntryName('CON', 'win32')).toBeNull();
        expect(validateEntryName('nul.mp4', 'win32')).toBeNull();
        expect(validateEntryName('bad\x7fname', 'linux')).toBeNull();

        const crumbs = buildBreadcrumbs(subDir);
        expect(crumbs.at(-1)).toEqual({ name: 'Clips', path: subDir });
        expect(crumbs.at(-2)).toEqual({ name: 'media', path: mediaDir });

        expect(parseExplorerMediaUrl('pullwave-explorer://media/12')).toEqual({ route: 'media', id: 12 });
        expect(parseExplorerMediaUrl('pullwave-explorer://thumbnail/3')).toEqual({ route: 'thumbnail', id: 3 });
        expect(parseExplorerMediaUrl('pullwave-explorer://preview/4')).toEqual({ route: 'preview', id: 4 });
        expect(parseExplorerMediaUrl('pullwave-explorer://other/1')).toBeNull();
        expect(parseExplorerMediaUrl('http://media/1')).toBeNull();
    });

    it('lists strictly directories, videos and audios, hides dotfiles unless requested, and reports list errors', async () => {
        const listed = await service.list();
        expect(listed.ok).toBe(true);
        if (!listed.ok) {
            return;
        }
        expect(listed.listing.directory).toBe(mediaDir);
        expect(listed.listing.parent).toBe(workDir);
        expect(listed.listing.roots).toEqual([{ id: 'downloads', label: 'downloads', path: mediaDir, kind: 'downloads' }]);
        const names = listed.listing.entries.map((entry) => {
            return entry.name;
        }).sort();
        expect(names).toEqual(['Clips', 'movie.mp4', 'song.mp3']);

        const movie = listed.listing.entries.find((entry) => {
            return entry.name === 'movie.mp4';
        })!;
        const song = listed.listing.entries.find((entry) => {
            return entry.name === 'song.mp3';
        })!;
        expect(movie.kind).toBe('video');
        expect(movie.thumbnailUrl).toMatch(/^pullwave-explorer:\/\/thumbnail\/\d+$/);
        expect(movie.mediaUrl).toMatch(/^pullwave-explorer:\/\/media\/\d+$/);
        expect(song.kind).toBe('audio');
        expect(song.thumbnailUrl).toBeNull();
        expect(song.mediaUrl).toMatch(/^pullwave-explorer:\/\/media\/\d+$/);

        const withHidden = await service.list(mediaDir, true);
        expect(withHidden.ok).toBe(true);
        if (withHidden.ok) {
            expect(
                withHidden.listing.entries.map((entry) => {
                    return entry.name;
                }).sort()
            ).toEqual(['.hidden-dir', '.secret.mp4', 'Clips', 'movie.mp4', 'song.mp3']);
        }

        expect(await service.list(join(workDir, 'does-not-exist'))).toEqual({ ok: false, reason: 'not-found' });
        expect(await service.list(join(mediaDir, 'movie.mp4'))).toEqual({ ok: false, reason: 'not-directory' });
    });

    it('creates folders, renames folders and media safely, moves to trash, and opens external media', async () => {
        expect(await service.createFolder(mediaDir, 'New Folder')).toEqual({ ok: true, path: join(mediaDir, 'New Folder') });
        expect(existsSync(join(mediaDir, 'New Folder'))).toBe(true);
        expect(await service.createFolder(mediaDir, 'New Folder')).toEqual({ ok: false, reason: 'exists' });
        expect(await service.createFolder(mediaDir, 'bad/name')).toEqual({ ok: false, reason: 'invalid-name' });

        expect(await service.rename(join(mediaDir, 'movie.mp4'), 'film.mp4')).toEqual({
            ok: true,
            path: join(mediaDir, 'film.mp4'),
            name: 'film.mp4'
        });
        expect(await service.rename(join(mediaDir, 'film.mp4'), 'film.txt')).toEqual({ ok: false, reason: 'invalid-name' });
        expect(await service.rename(join(mediaDir, 'film.mp4'), 'film.mp3')).toEqual({ ok: false, reason: 'invalid-name' });
        expect(await service.rename(join(mediaDir, 'notes.txt'), 'renamed.txt')).toEqual({ ok: false, reason: 'invalid-name' });
        expect(await service.rename(join(mediaDir, 'New Folder'), 'Clips')).toEqual({ ok: false, reason: 'exists' });
        expect(await service.rename(mediaDir, 'RenamedRoot')).toEqual({ ok: false, reason: 'denied' });
        expect(await service.rename(join(mediaDir, 'New Folder'), 'Archive')).toEqual({
            ok: true,
            path: join(mediaDir, 'Archive'),
            name: 'Archive'
        });

        expect(await service.trash(join(mediaDir, 'notes.txt'))).toEqual({ ok: false, reason: 'denied' });
        expect(await service.trash(mediaDir)).toEqual({ ok: false, reason: 'denied' });
        expect(await service.trash('/')).toEqual({ ok: false, reason: 'denied' });
        expect(await service.trash('relative.mp4')).toEqual({ ok: false, reason: 'not-found' });
        expect(await service.trash(join(mediaDir, 'missing.mp4'))).toEqual({ ok: false, reason: 'not-found' });
        expect(await service.trash(join(mediaDir, 'Archive'))).toEqual({ ok: true });
        expect(trashItem).toHaveBeenCalledWith(join(mediaDir, 'Archive'));

        expect(await service.openExternal(join(mediaDir, 'film.mp4'))).toEqual({ ok: true });
        expect(openExternal).toHaveBeenCalledWith(join(mediaDir, 'film.mp4'));
        expect(await service.openExternal(join(mediaDir, 'notes.txt'))).toEqual({ ok: false, reason: 'not-found' });
        expect(await service.openExternal(subDir)).toEqual({ ok: false, reason: 'not-found' });
        expect(await service.openFolder(subDir)).toEqual({ ok: true });
        expect(openExternal).toHaveBeenCalledWith(subDir);
        expect(await service.openFolder(join(mediaDir, 'film.mp4'))).toEqual({ ok: false, reason: 'not-found' });
        expect(await service.openFolder('relative')).toEqual({ ok: false, reason: 'not-found' });
        expect(await service.chooseFolder()).toBe(subDir);
    });

    it('blocks symlinks pointing to non-media files in list, openExternal, rename, and trash', async () => {
        const fakeVideoLink = join(mediaDir, 'secret.mp4');
        symlinkSync(join(mediaDir, 'notes.txt'), fakeVideoLink);

        const listed = await service.list();
        expect(listed.ok).toBe(true);
        if (listed.ok) {
            expect(
                listed.listing.entries.some((entry) => {
                    return entry.name === 'secret.mp4';
                })
            ).toBe(false);
        }
        expect(await service.openExternal(fakeVideoLink)).toEqual({ ok: false, reason: 'not-found' });
        expect(await service.rename(fakeVideoLink, 'other.mp4')).toEqual({ ok: false, reason: 'denied' });
        expect(await service.trash(fakeVideoLink)).toEqual({ ok: false, reason: 'denied' });
    });

    it('serves media, generated thumbnails, and transcoded previews via the explorer protocol handler', async () => {
        const listed = await service.list();
        expect(listed.ok).toBe(true);
        if (!listed.ok) {
            return;
        }
        const movie = listed.listing.entries.find((entry) => {
            return entry.name === 'movie.mp4';
        })!;
        const handler = createExplorerMediaHandler(service, thumbnails, defaultMediaFileSystem);

        const mediaRes = await handler(new Request(movie.mediaUrl!));
        expect(mediaRes.status).toBe(200);
        expect(mediaRes.headers.get('content-type')).toBe('video/mp4');
        expect(await mediaRes.text()).toBe('video-bytes');

        const thumbRes = await handler(new Request(movie.thumbnailUrl!));
        expect(thumbRes.status).toBe(200);
        expect(thumbRes.headers.get('content-type')).toBe('image/jpeg');

        const preview = await service.preview(movie.token!);
        expect(preview.ok).toBe(true);
        if (preview.ok) {
            const previewRes = await handler(new Request(preview.url));
            expect(previewRes.status).toBe(200);
        }

        const badRes = await handler(new Request('pullwave-explorer://media/99999'));
        expect(badRes.status).toBe(404);

        const thumbFile = join(workDir, 'thumbs', `${thumbnailCacheKey(movie.path, movie.modifiedAt, movie.sizeBytes)}.jpg`);
        expect(existsSync(thumbFile)).toBe(true);
        expect(await service.trash(movie.path)).toEqual({ ok: true });
        expect(existsSync(thumbFile)).toBe(false);
        expect(service.resolveToken(movie.token!)).toBeNull();

        const clipPath = join(subDir, 'nested.mp4');
        writeFileSync(clipPath, 'nested-video');
        const subListed = await service.list(subDir);
        expect(subListed.ok).toBe(true);
        if (subListed.ok) {
            const nested = subListed.listing.entries[0]!;
            const nestedRes = await handler(new Request(nested.thumbnailUrl!));
            expect(nestedRes.status).toBe(200);
            const nestedThumb = join(workDir, 'thumbs', `${thumbnailCacheKey(nested.path, nested.modifiedAt, nested.sizeBytes)}.jpg`);
            expect(existsSync(nestedThumb)).toBe(true);

            expect(await service.rename(subDir, 'ClipsRenamed')).toEqual({
                ok: true,
                path: join(mediaDir, 'ClipsRenamed'),
                name: 'ClipsRenamed'
            });
            expect(existsSync(nestedThumb)).toBe(false);
            expect(service.resolveToken(nested.token!)).toBeNull();
        }
    });
});
