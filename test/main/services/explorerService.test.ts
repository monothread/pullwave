import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    buildBreadcrumbs,
    createExplorerMediaHandler,
    ExplorerService,
    parseExplorerMediaUrl,
    parseWindowsHiddenOutput,
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
        writeFileSync(join(mediaDir, '.secret.mp3'), 'hidden-audio');
        writeFileSync(join(mediaDir, '.secret.txt'), 'hidden-non-media');
        writeFileSync(join(mediaDir, '.hidden-dir', 'inside.mp4'), 'inside-hidden-video');
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
        expect(validateEntryName('.hidden', 'linux')).toBe('.hidden');
        expect(validateEntryName('.hidden', 'win32')).toBe('.hidden');
        expect(validateEntryName('a/b', 'linux')).toBeNull();
        expect(validateEntryName('a\\b', 'linux')).toBeNull();
        expect(validateEntryName('bad:name', 'win32')).toBeNull();
        expect(validateEntryName('trailing.', 'win32')).toBeNull();
        expect(validateEntryName('CON', 'win32')).toBeNull();
        expect(validateEntryName('nul.mp4', 'win32')).toBeNull();
        expect(validateEntryName('bad\x7fname', 'linux')).toBeNull();

        const crumbs = buildBreadcrumbs(subDir, mediaDir, 'linux');
        expect(crumbs).toEqual([
            { name: 'media', path: mediaDir },
            { name: 'Clips', path: subDir }
        ]);
        const fallbackCrumbs = buildBreadcrumbs(subDir);
        expect(fallbackCrumbs.at(-1)).toEqual({ name: 'Clips', path: subDir });

        expect(parseExplorerMediaUrl('pullwave-explorer://media/12')).toEqual({ route: 'media', id: 12 });
        expect(parseExplorerMediaUrl('pullwave-explorer://thumbnail/3')).toEqual({ route: 'thumbnail', id: 3 });
        expect(parseExplorerMediaUrl('pullwave-explorer://preview/4')).toEqual({ route: 'preview', id: 4 });
        expect(parseExplorerMediaUrl('pullwave-explorer://other/1')).toBeNull();
        expect(parseExplorerMediaUrl('http://media/1')).toBeNull();
    });

    it('confines listing strictly to the configured downloads folder, hides dotfiles, and reports list errors', async () => {
        const listed = await service.list();
        expect(listed.ok).toBe(true);
        if (!listed.ok) {
            return;
        }
        expect(listed.listing.directory).toBe(mediaDir);
        expect(listed.listing.parent).toBeNull();
        expect(listed.listing.breadcrumbs).toEqual([{ name: 'media', path: mediaDir }]);
        expect(listed.listing.roots).toEqual([{ id: 'downloads', label: 'media', path: mediaDir, kind: 'downloads' }]);
        const names = listed.listing.entries
            .map((entry) => {
                return entry.name;
            })
            .sort();
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

        const subListed = await service.list(subDir);
        expect(subListed.ok).toBe(true);
        if (subListed.ok) {
            expect(subListed.listing.parent).toBe(mediaDir);
            expect(subListed.listing.breadcrumbs).toEqual([
                { name: 'media', path: mediaDir },
                { name: 'Clips', path: subDir }
            ]);
        }

        expect(await service.list(workDir)).toEqual({ ok: false, reason: 'denied' });
        expect(await service.list(join(mediaDir, '.hidden-dir'))).toEqual({ ok: false, reason: 'denied' });
        expect(await service.list(join(mediaDir, 'does-not-exist'))).toEqual({ ok: false, reason: 'not-found' });
        expect(await service.list(join(mediaDir, 'movie.mp4'))).toEqual({ ok: false, reason: 'not-directory' });

        const withHidden = await service.list(mediaDir, true);
        expect(withHidden.ok).toBe(true);
        if (withHidden.ok) {
            expect(
                withHidden.listing.entries
                    .map((entry) => {
                        return entry.name;
                    })
                    .sort()
            ).toEqual(['.hidden-dir', '.secret.mp3', '.secret.mp4', 'Clips', 'movie.mp4', 'song.mp3']);
            const secretVideo = withHidden.listing.entries.find((entry) => {
                return entry.name === '.secret.mp4';
            });
            const secretAudio = withHidden.listing.entries.find((entry) => {
                return entry.name === '.secret.mp3';
            });
            expect(secretVideo?.kind).toBe('video');
            expect(secretVideo?.token).not.toBeNull();
            expect(secretVideo?.thumbnailUrl).toMatch(/^pullwave-explorer:\/\/thumbnail\/\d+$/);
            expect(secretVideo?.mediaUrl).toMatch(/^pullwave-explorer:\/\/media\/\d+$/);
            expect(secretAudio?.kind).toBe('audio');
            expect(secretAudio?.token).not.toBeNull();
            expect(secretAudio?.thumbnailUrl).toBeNull();
            expect(secretAudio?.mediaUrl).toMatch(/^pullwave-explorer:\/\/media\/\d+$/);
            expect(service.resolveToken(secretVideo!.token!)?.path).toBe(join(mediaDir, '.secret.mp4'));
            expect(service.resolveToken(secretAudio!.token!)?.path).toBe(join(mediaDir, '.secret.mp3'));
        }

        const hiddenDirListed = await service.list(join(mediaDir, '.hidden-dir'), true);
        expect(hiddenDirListed.ok).toBe(true);
        if (hiddenDirListed.ok) {
            expect(hiddenDirListed.listing.parent).toBe(mediaDir);
            expect(hiddenDirListed.listing.breadcrumbs).toEqual([
                { name: 'media', path: mediaDir },
                { name: '.hidden-dir', path: join(mediaDir, '.hidden-dir') }
            ]);
            expect(
                hiddenDirListed.listing.entries.map((entry) => {
                    return entry.name;
                })
            ).toEqual(['inside.mp4']);
            const inside = hiddenDirListed.listing.entries[0]!;
            expect(service.resolveToken(inside.token!)?.path).toBe(join(mediaDir, '.hidden-dir', 'inside.mp4'));
        }
        expect(await service.list(workDir, true)).toEqual({ ok: false, reason: 'denied' });
    });

    it('parses Windows hidden attributes output and filters Windows-hidden folders and media when showHidden is false', async () => {
        expect(parseWindowsHiddenOutput('')).toEqual({ targetHidden: false, hiddenNames: new Set() });
        expect(parseWindowsHiddenOutput('{bad')).toEqual({ targetHidden: false, hiddenNames: new Set() });
        expect(parseWindowsHiddenOutput('null')).toEqual({ targetHidden: false, hiddenNames: new Set() });
        expect(parseWindowsHiddenOutput(JSON.stringify({ targetHidden: false, hiddenNames: 'Secret.MP4' }))).toEqual({
            targetHidden: false,
            hiddenNames: new Set(['secret.mp4'])
        });
        expect(parseWindowsHiddenOutput(JSON.stringify({ targetHidden: true, hiddenNames: ['Clips', 'Song.MP3', 42, ''] }))).toEqual({
            targetHidden: true,
            hiddenNames: new Set(['clips', 'song.mp3'])
        });

        const readWindowsHidden = vi.fn(async (directory: string) => {
            if (directory === subDir) {
                return { targetHidden: true, hiddenNames: new Set<string>() };
            }
            return { targetHidden: false, hiddenNames: new Set<string>(['Clips', 'SONG.MP3']) };
        });
        const winService = new ExplorerService({
            defaultDirectory: () => {
                return mediaDir;
            },
            trashItem,
            openExternal,
            thumbnails,
            platform: 'win32',
            readWindowsHidden
        });

        const listed = await winService.list(mediaDir, false);
        expect(readWindowsHidden).toHaveBeenCalledWith(mediaDir, mediaDir);
        expect(listed.ok).toBe(true);
        if (listed.ok) {
            expect(
                listed.listing.entries
                    .map((entry) => {
                        return entry.name;
                    })
                    .sort()
            ).toEqual(['movie.mp4']);
        }

        expect(await winService.list(subDir, false)).toEqual({ ok: false, reason: 'denied' });

        readWindowsHidden.mockClear();
        const listedWithHidden = await winService.list(mediaDir, true);
        expect(readWindowsHidden).not.toHaveBeenCalled();
        expect(listedWithHidden.ok).toBe(true);
        if (listedWithHidden.ok) {
            expect(
                listedWithHidden.listing.entries
                    .map((entry) => {
                        return entry.name;
                    })
                    .sort()
            ).toEqual(['.hidden-dir', '.secret.mp3', '.secret.mp4', 'Clips', 'movie.mp4', 'song.mp3']);
        }

        const listedSubWithHidden = await winService.list(subDir, true);
        expect(readWindowsHidden).not.toHaveBeenCalled();
        expect(listedSubWithHidden.ok).toBe(true);

        const failingReadWindowsHidden = vi.fn(async () => {
            throw new Error('powershell failed');
        });
        const fallbackWinService = new ExplorerService({
            defaultDirectory: () => {
                return mediaDir;
            },
            trashItem,
            openExternal,
            thumbnails,
            platform: 'win32',
            readWindowsHidden: failingReadWindowsHidden
        });
        const fallbackListed = await fallbackWinService.list(mediaDir, false);
        expect(fallbackListed.ok).toBe(true);
        if (fallbackListed.ok) {
            expect(
                fallbackListed.listing.entries
                    .map((entry) => {
                        return entry.name;
                    })
                    .sort()
            ).toEqual(['Clips', 'movie.mp4', 'song.mp3']);
        }

        const winHiddenDir = join(mediaDir, 'WinHidden');
        mkdirSync(winHiddenDir, { recursive: true });
        writeFileSync(join(winHiddenDir, 'inner.mp4'), 'hidden-dir-video');
        const linkToHiddenDir = join(mediaDir, 'PublicLink');
        symlinkSync(winHiddenDir, linkToHiddenDir);
        const linkToHiddenFile = join(mediaDir, 'PublicFileLink.mp4');
        symlinkSync(join(mediaDir, 'song.mp3'), linkToHiddenFile);
        const linkToOtherDirHiddenFile = join(mediaDir, 'CrossLink.mp4');
        symlinkSync(join(winHiddenDir, 'inner.mp4'), linkToOtherDirHiddenFile);
        const rootAlias = join(workDir, 'media-alias');
        symlinkSync(mediaDir, rootAlias);

        const symlinkReadWindowsHidden = vi.fn(async (directory: string) => {
            if (directory === winHiddenDir) {
                return { targetHidden: true, hiddenNames: new Set<string>() };
            }
            if (directory === mediaDir) {
                return { targetHidden: false, hiddenNames: new Set<string>(['WinHidden', 'song.mp3']) };
            }
            return { targetHidden: false, hiddenNames: new Set<string>() };
        });
        const winSymlinkService = new ExplorerService({
            defaultDirectory: () => {
                return rootAlias;
            },
            trashItem,
            openExternal,
            thumbnails,
            platform: 'win32',
            readWindowsHidden: symlinkReadWindowsHidden
        });

        expect(await winSymlinkService.list(join(rootAlias, 'PublicLink'), false)).toEqual({ ok: false, reason: 'denied' });
        const aliasRootListed = await winSymlinkService.list(rootAlias, false);
        expect(aliasRootListed.ok).toBe(true);
        if (aliasRootListed.ok) {
            expect(
                aliasRootListed.listing.entries
                    .map((entry) => {
                        return entry.name;
                    })
                    .sort()
            ).toEqual(['Clips', 'movie.mp4']);
        }
    });

    it('creates folders, renames folders and media inside root, trashes only media and 100% empty folders, and blocks actions outside root', async () => {
        expect(await service.createFolder(mediaDir, 'New Folder')).toEqual({ ok: true, path: join(mediaDir, 'New Folder') });
        expect(existsSync(join(mediaDir, 'New Folder'))).toBe(true);
        expect(await service.createFolder(mediaDir, 'New Folder')).toEqual({ ok: false, reason: 'exists' });
        expect(await service.createFolder(mediaDir, 'bad/name')).toEqual({ ok: false, reason: 'invalid-name' });
        expect(await service.createFolder(mediaDir, '.dotfolder')).toEqual({ ok: true, path: join(mediaDir, '.dotfolder') });
        expect(existsSync(join(mediaDir, '.dotfolder'))).toBe(true);
        expect(await service.trash(join(mediaDir, '.dotfolder'))).toEqual({ ok: true });
        expect(await service.trash(join(mediaDir, '.hidden-dir'))).toEqual({ ok: false, reason: 'not-empty' });
        expect(await service.openFolder(join(mediaDir, '.hidden-dir'))).toEqual({ ok: true });
        expect(await service.openExternal(join(mediaDir, '.secret.mp4'))).toEqual({ ok: true });
        expect(await service.rename(join(mediaDir, '.secret.mp4'), '.renamed.mp4')).toEqual({
            ok: true,
            path: join(mediaDir, '.renamed.mp4'),
            name: '.renamed.mp4'
        });
        expect(await service.rename(join(mediaDir, '.renamed.mp4'), '.mp4')).toEqual({ ok: false, reason: 'invalid-name' });
        expect(await service.trash(join(mediaDir, '.renamed.mp4'))).toEqual({ ok: true });
        expect(await service.createFolder(workDir, 'Outside')).toEqual({ ok: false, reason: 'denied' });

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

        writeFileSync(join(mediaDir, 'Archive', 'document.pdf'), 'important-doc');
        expect(await service.trash(join(mediaDir, 'Archive'))).toEqual({ ok: false, reason: 'not-empty' });
        rmSync(join(mediaDir, 'Archive', 'document.pdf'));

        writeFileSync(join(mediaDir, 'Archive', '.hidden-only.txt'), 'secret');
        expect(await service.trash(join(mediaDir, 'Archive'))).toEqual({ ok: false, reason: 'not-empty' });
        rmSync(join(mediaDir, 'Archive', '.hidden-only.txt'));

        expect(await service.trash(join(mediaDir, 'notes.txt'))).toEqual({ ok: false, reason: 'denied' });
        expect(await service.trash(mediaDir)).toEqual({ ok: false, reason: 'denied' });
        expect(await service.trash(workDir)).toEqual({ ok: false, reason: 'denied' });
        expect(await service.trash('/')).toEqual({ ok: false, reason: 'denied' });
        expect(await service.trash('relative.mp4')).toEqual({ ok: false, reason: 'not-found' });
        expect(await service.trash(join(mediaDir, 'missing.mp4'))).toEqual({ ok: false, reason: 'not-found' });
        expect(await service.trash(join(mediaDir, 'Archive'))).toEqual({ ok: true });
        expect(trashItem).toHaveBeenCalledWith(join(mediaDir, 'Archive'));

        expect(await service.openExternal(join(mediaDir, 'film.mp4'))).toEqual({ ok: true });
        expect(openExternal).toHaveBeenCalledWith(join(mediaDir, 'film.mp4'));
        expect(await service.openExternal(join(mediaDir, 'notes.txt'))).toEqual({ ok: false, reason: 'not-found' });
        expect(await service.openExternal(subDir)).toEqual({ ok: false, reason: 'not-found' });
        expect(await service.openExternal(join(workDir, 'outside.mp4'))).toEqual({ ok: false, reason: 'denied' });
        expect(await service.openFolder(subDir)).toEqual({ ok: true });
        expect(openExternal).toHaveBeenCalledWith(subDir);
        expect(await service.openFolder(workDir)).toEqual({ ok: false, reason: 'denied' });
        expect(await service.openFolder(join(mediaDir, 'film.mp4'))).toEqual({ ok: false, reason: 'not-found' });
        expect(await service.openFolder('relative')).toEqual({ ok: false, reason: 'not-found' });
    });

    it('blocks symlinks pointing to non-media files or outside the configured downloads folder', async () => {
        const fakeVideoLink = join(mediaDir, 'secret.mp4');
        symlinkSync(join(mediaDir, 'notes.txt'), fakeVideoLink);
        const outsideVideo = join(workDir, 'outside.mp4');
        writeFileSync(outsideVideo, 'outside-video');
        const outsideLink = join(mediaDir, 'escape.mp4');
        symlinkSync(outsideVideo, outsideLink);
        const hiddenTargetLink = join(mediaDir, 'hidden-link.mp4');
        symlinkSync(join(mediaDir, '.hidden-dir', 'inside.mp4'), hiddenTargetLink);

        const listed = await service.list();
        expect(listed.ok).toBe(true);
        if (listed.ok) {
            expect(
                listed.listing.entries.some((entry) => {
                    return entry.name === 'secret.mp4' || entry.name === 'escape.mp4' || entry.name === 'hidden-link.mp4';
                })
            ).toBe(false);
        }
        const listedWithHidden = await service.list(mediaDir, true);
        expect(listedWithHidden.ok).toBe(true);
        if (listedWithHidden.ok) {
            expect(
                listedWithHidden.listing.entries.some((entry) => {
                    return entry.name === 'hidden-link.mp4';
                })
            ).toBe(true);
            expect(
                listedWithHidden.listing.entries.some((entry) => {
                    return entry.name === 'secret.mp4' || entry.name === 'escape.mp4';
                })
            ).toBe(false);
        }
        expect(await service.openExternal(fakeVideoLink)).toEqual({ ok: false, reason: 'not-found' });
        expect(await service.openExternal(outsideLink)).toEqual({ ok: false, reason: 'denied' });
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
