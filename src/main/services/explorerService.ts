import { lstat, mkdir, readdir, realpath, rename, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, parse, resolve, sep } from 'node:path';
import {
    EXPLORER_MEDIA_SCHEME,
    type ExplorerBreadcrumb,
    type ExplorerCreateFolderResponse,
    type ExplorerEntry,
    type ExplorerListFailure,
    type ExplorerListResponse,
    type ExplorerMediaRoute,
    type ExplorerOpenExternalResponse,
    type ExplorerOpenFolderResponse,
    type ExplorerPreviewResponse,
    type ExplorerRenameResponse,
    type ExplorerRoot,
    type ExplorerRootKind,
    type ExplorerTrashFailure,
    type ExplorerTrashResponse,
    type ExplorerWriteFailure
} from '@shared/explorer';
import { mediaKindOfExtension } from '@shared/mediaExtensions';
import { createConcurrencyLimit } from './concurrencyLimit';
import { explorerMediaUrl, type ExplorerThumbnails } from './explorerThumbnails';
import { serveFile, type MediaFileSystem } from './mediaProtocol';

const BASE_MAX_TOKENS = 4000;
const STAT_CONCURRENCY = 16;
const WINDOWS_FORBIDDEN = /[<>:"/\\|?*]/;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;
const POSIX_FORBIDDEN = /\//;

export interface ExplorerRootCandidate {
    id: string;
    label: string;
    path: string;
    kind: ExplorerRootKind;
}

export interface ExplorerServiceDependencies {
    defaultDirectory: () => string;
    roots: () => ExplorerRootCandidate[];
    chooseFolder: (currentDir?: string) => Promise<string | null>;
    trashItem: (path: string) => Promise<void>;
    openExternal: (path: string) => Promise<string>;
    thumbnails: ExplorerThumbnails;
    platform?: NodeJS.Platform;
    exists?: (path: string) => boolean | Promise<boolean>;
}

function errorCodeOf(error: unknown): string {
    return typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
}

function mapListError(error: unknown): ExplorerListFailure {
    const code = errorCodeOf(error);
    if (code === 'ENOENT') {
        return 'not-found';
    }
    if (code === 'EACCES' || code === 'EPERM') {
        return 'denied';
    }
    if (code === 'ENOTDIR') {
        return 'not-directory';
    }
    return 'failed';
}

function mapWriteError(error: unknown): ExplorerWriteFailure {
    const code = errorCodeOf(error);
    if (code === 'EEXIST') {
        return 'exists';
    }
    if (code === 'ENOENT') {
        return 'not-found';
    }
    if (code === 'EACCES' || code === 'EPERM') {
        return 'denied';
    }
    return 'failed';
}

function mapTrashError(error: unknown): ExplorerTrashFailure {
    const code = errorCodeOf(error);
    if (code === 'ENOENT') {
        return 'not-found';
    }
    if (code === 'EACCES' || code === 'EPERM') {
        return 'denied';
    }
    return 'failed';
}

function isCaseInsensitive(platform: NodeJS.Platform): boolean {
    return platform === 'win32' || platform === 'darwin';
}

function pathKeyOf(path: string, platform: NodeJS.Platform): string {
    return isCaseInsensitive(platform) ? path.toLowerCase() : path;
}

async function defaultPathExists(path: string): Promise<boolean> {
    try {
        await lstat(path);
        return true;
    } catch {
        return false;
    }
}

export function validateEntryName(rawName: string, platform: NodeJS.Platform = process.platform): string | null {
    if (typeof rawName !== 'string') {
        return null;
    }
    const name = rawName.trim();
    if (name.length === 0 || name === '.' || name === '..') {
        return null;
    }
    for (let index = 0; index < name.length; index += 1) {
        const code = name.charCodeAt(index);
        if (code < 32 || code === 127) {
            return null;
        }
    }
    if (platform === 'win32') {
        if (WINDOWS_FORBIDDEN.test(name) || /[. ]$/.test(name) || WINDOWS_RESERVED_NAME.test(name)) {
            return null;
        }
        return name;
    }
    if (POSIX_FORBIDDEN.test(name) || name.includes('\\')) {
        return null;
    }
    return name;
}

export function buildBreadcrumbs(directory: string): ExplorerBreadcrumb[] {
    const normalized = resolve(directory);
    const { root } = parse(normalized);
    const rest = normalized.slice(root.length);
    const parts = rest.split(/[\\/]+/).filter((part) => {
        return part.length > 0;
    });
    const crumbs: ExplorerBreadcrumb[] = [{ name: root, path: root }];
    let current = root;
    for (const part of parts) {
        current = current.endsWith(sep) ? `${current}${part}` : `${current}${sep}${part}`;
        crumbs.push({ name: part, path: current });
    }
    return crumbs;
}

export function parseExplorerMediaUrl(url: string): { route: ExplorerMediaRoute; id: number } | null {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    const match = /^\/(\d+)$/.exec(parsed.pathname);
    if (parsed.protocol !== `${EXPLORER_MEDIA_SCHEME}:` || match === null) {
        return null;
    }
    if (parsed.hostname !== 'media' && parsed.hostname !== 'preview' && parsed.hostname !== 'thumbnail') {
        return null;
    }
    return { route: parsed.hostname, id: Number(match[1]) };
}

export class ExplorerService {
    private readonly tokens = new Map<number, ExplorerEntry>();
    private readonly tokenByPathKey = new Map<string, number>();
    private nextToken = 1;
    private currentDirectory = '';
    private listSeq = 0;
    private readonly statLimit = createConcurrencyLimit(STAT_CONCURRENCY);

    constructor(private readonly deps: ExplorerServiceDependencies) {}

    resolveToken(token: number): ExplorerEntry | null {
        return this.tokens.get(token) ?? null;
    }

    cancelPreview(): void {
        this.deps.thumbnails.cancelPreview();
    }

    async list(directory?: string, showHidden = false): Promise<ExplorerListResponse> {
        const hasRequested = typeof directory === 'string' && directory.trim().length > 0;
        if (hasRequested && !isAbsolute(directory)) {
            return { ok: false, reason: 'not-found' };
        }
        const requested = hasRequested ? directory : this.deps.defaultDirectory();
        if (!isAbsolute(requested)) {
            return { ok: false, reason: 'not-found' };
        }
        const target = resolve(requested);
        this.listSeq += 1;
        const seq = this.listSeq;
        let dirStat;
        try {
            dirStat = await stat(target);
        } catch (error) {
            return { ok: false, reason: mapListError(error) };
        }
        if (!dirStat.isDirectory()) {
            return { ok: false, reason: 'not-directory' };
        }
        let dirents;
        try {
            dirents = await readdir(target, { withFileTypes: true });
        } catch (error) {
            return { ok: false, reason: mapListError(error) };
        }
        if (seq === this.listSeq && this.currentDirectory !== target) {
            this.deps.thumbnails.cancelPending();
            this.currentDirectory = target;
        }
        const platform = this.deps.platform ?? process.platform;
        const visibleDirents = dirents.filter((dirent) => {
            return showHidden || !dirent.name.startsWith('.');
        });
        const built = await Promise.all(
            visibleDirents.map((dirent) => {
                return this.statLimit(async (): Promise<ExplorerEntry | null> => {
                    const fullPath = join(target, dirent.name);
                    let resolvedPath = fullPath;
                    let info;
                    if (dirent.isSymbolicLink()) {
                        resolvedPath = await realpath(fullPath).catch(() => {
                            return '';
                        });
                        if (resolvedPath.length === 0) {
                            return null;
                        }
                        info = await stat(resolvedPath).catch(() => {
                            return null;
                        });
                    } else if (dirent.isDirectory() || dirent.isFile()) {
                        info = await stat(fullPath).catch(() => {
                            return null;
                        });
                    } else {
                        return null;
                    }
                    if (info === null) {
                        return null;
                    }
                    if (info.isDirectory()) {
                        return {
                            path: fullPath,
                            name: dirent.name,
                            kind: 'directory',
                            extension: '',
                            sizeBytes: 0,
                            modifiedAt: info.mtimeMs,
                            token: null,
                            thumbnailUrl: null,
                            mediaUrl: null
                        };
                    }
                    if (!info.isFile()) {
                        return null;
                    }
                    const extension = extname(dirent.name).toLowerCase();
                    const mediaKind = mediaKindOfExtension(extension);
                    if (mediaKind === null) {
                        return null;
                    }
                    if (dirent.isSymbolicLink() && mediaKindOfExtension(extname(resolvedPath)) === null) {
                        return null;
                    }
                    const entry: ExplorerEntry = {
                        path: fullPath,
                        name: dirent.name,
                        kind: mediaKind,
                        extension,
                        sizeBytes: info.size,
                        modifiedAt: info.mtimeMs,
                        token: null,
                        thumbnailUrl: null,
                        mediaUrl: null
                    };
                    return entry;
                });
            })
        );
        const entries: ExplorerEntry[] = [];
        const maxTokens = Math.max(BASE_MAX_TOKENS, built.length * 2);
        for (const item of built) {
            if (item === null) {
                continue;
            }
            if (item.kind !== 'directory') {
                const token = this.registerEntry(item, platform, maxTokens);
                item.token = token;
                item.thumbnailUrl = item.kind === 'video' ? explorerMediaUrl('thumbnail', token) : null;
                item.mediaUrl = explorerMediaUrl('media', token);
            }
            entries.push(item);
        }
        const parentCandidate = dirname(target);
        const parent = parentCandidate === target ? null : parentCandidate;
        return {
            ok: true,
            listing: {
                directory: target,
                parent,
                breadcrumbs: buildBreadcrumbs(target),
                entries,
                roots: await this.availableRoots(platform)
            }
        };
    }

    async chooseFolder(): Promise<string | null> {
        return this.deps.chooseFolder(this.currentDirectory || this.deps.defaultDirectory());
    }

    async openFolder(directory: string): Promise<ExplorerOpenFolderResponse> {
        if (typeof directory !== 'string' || directory.trim().length === 0 || !isAbsolute(directory)) {
            return { ok: false, reason: 'not-found' };
        }
        const resolvedTarget = resolve(directory);
        let info;
        try {
            info = await stat(resolvedTarget);
        } catch {
            return { ok: false, reason: 'not-found' };
        }
        if (!info.isDirectory()) {
            return { ok: false, reason: 'not-found' };
        }
        const message = await this.deps.openExternal(resolvedTarget);
        return message === '' ? { ok: true } : { ok: false, reason: 'failed' };
    }

    async createFolder(parentDir: string, rawName: string): Promise<ExplorerCreateFolderResponse> {
        const platform = this.deps.platform ?? process.platform;
        const name = validateEntryName(rawName, platform);
        if (name === null || typeof parentDir !== 'string' || parentDir.trim().length === 0 || !isAbsolute(parentDir)) {
            return { ok: false, reason: 'invalid-name' };
        }
        const target = join(resolve(parentDir), name);
        try {
            await mkdir(target);
            return { ok: true, path: target };
        } catch (error) {
            return { ok: false, reason: mapWriteError(error) };
        }
    }

    async rename(targetPath: string, rawName: string): Promise<ExplorerRenameResponse> {
        const platform = this.deps.platform ?? process.platform;
        const name = validateEntryName(rawName, platform);
        if (name === null || typeof targetPath !== 'string' || targetPath.trim().length === 0 || !isAbsolute(targetPath)) {
            return { ok: false, reason: 'invalid-name' };
        }
        const resolvedTarget = resolve(targetPath);
        if (dirname(resolvedTarget) === resolvedTarget || this.isProtectedRoot(resolvedTarget, platform)) {
            return { ok: false, reason: 'denied' };
        }
        let info;
        try {
            info = await lstat(resolvedTarget);
        } catch (error) {
            return { ok: false, reason: mapWriteError(error) };
        }
        if (info.isSymbolicLink()) {
            return { ok: false, reason: 'denied' };
        }
        if (info.isFile()) {
            const currentKind = mediaKindOfExtension(extname(resolvedTarget));
            const nextKind = mediaKindOfExtension(extname(name));
            if (currentKind === null || nextKind !== currentKind) {
                return { ok: false, reason: 'invalid-name' };
            }
        } else if (!info.isDirectory()) {
            return { ok: false, reason: 'not-found' };
        }
        const destination = join(dirname(resolvedTarget), name);
        if (destination === resolvedTarget) {
            return { ok: true, path: destination, name };
        }
        const caseOnly = isCaseInsensitive(platform) && destination.toLowerCase() === resolvedTarget.toLowerCase();
        if (!caseOnly && (await this.pathExists(destination))) {
            return { ok: false, reason: 'exists' };
        }
        try {
            await rename(resolvedTarget, destination);
            this.removeTokenForPath(resolvedTarget, platform);
            return { ok: true, path: destination, name };
        } catch (error) {
            return { ok: false, reason: mapWriteError(error) };
        }
    }

    async trash(targetPath: string): Promise<ExplorerTrashResponse> {
        if (typeof targetPath !== 'string' || targetPath.trim().length === 0 || !isAbsolute(targetPath)) {
            return { ok: false, reason: 'not-found' };
        }
        const platform = this.deps.platform ?? process.platform;
        const resolvedTarget = resolve(targetPath);
        if (dirname(resolvedTarget) === resolvedTarget || this.isProtectedRoot(resolvedTarget, platform)) {
            return { ok: false, reason: 'denied' };
        }
        let info;
        try {
            info = await lstat(resolvedTarget);
        } catch (error) {
            return { ok: false, reason: mapTrashError(error) };
        }
        if (info.isSymbolicLink()) {
            return { ok: false, reason: 'denied' };
        }
        const isAllowed = info.isDirectory() || (info.isFile() && mediaKindOfExtension(extname(resolvedTarget)) !== null);
        if (!isAllowed) {
            return { ok: false, reason: 'denied' };
        }
        try {
            await this.deps.trashItem(resolvedTarget);
            this.removeTokenForPath(resolvedTarget, platform);
            return { ok: true };
        } catch (error) {
            return { ok: false, reason: mapTrashError(error) };
        }
    }

    async openExternal(targetPath: string): Promise<ExplorerOpenExternalResponse> {
        if (typeof targetPath !== 'string' || targetPath.trim().length === 0 || !isAbsolute(targetPath)) {
            return { ok: false, reason: 'not-found' };
        }
        const resolvedTarget = resolve(targetPath);
        let linkInfo;
        try {
            linkInfo = await lstat(resolvedTarget);
        } catch {
            return { ok: false, reason: 'not-found' };
        }
        let targetToOpen = resolvedTarget;
        let fileInfo = linkInfo;
        if (linkInfo.isSymbolicLink()) {
            try {
                targetToOpen = await realpath(resolvedTarget);
                fileInfo = await stat(targetToOpen);
            } catch {
                return { ok: false, reason: 'not-found' };
            }
        }
        if (
            !fileInfo.isFile() ||
            mediaKindOfExtension(extname(resolvedTarget)) === null ||
            mediaKindOfExtension(extname(targetToOpen)) === null
        ) {
            return { ok: false, reason: 'not-found' };
        }
        const message = await this.deps.openExternal(targetToOpen);
        return message === '' ? { ok: true } : { ok: false, reason: 'failed' };
    }

    async preview(token: number): Promise<ExplorerPreviewResponse> {
        const entry = this.resolveToken(token);
        if (entry === null) {
            return { ok: false, reason: 'not-found' };
        }
        return this.deps.thumbnails.preview(entry);
    }

    private isProtectedRoot(resolvedTarget: string, platform: NodeJS.Platform): boolean {
        const targetKey = pathKeyOf(resolvedTarget, platform);
        return this.deps.roots().some((candidate) => {
            if (candidate.path.trim().length === 0) {
                return false;
            }
            return pathKeyOf(resolve(candidate.path), platform) === targetKey;
        });
    }

    private async pathExists(path: string): Promise<boolean> {
        if (this.deps.exists !== undefined) {
            return await this.deps.exists(path);
        }
        return defaultPathExists(path);
    }

    private registerEntry(entry: ExplorerEntry, platform: NodeJS.Platform, maxTokens: number): number {
        const key = pathKeyOf(entry.path, platform);
        const existingToken = this.tokenByPathKey.get(key);
        if (existingToken !== undefined) {
            const existing = this.tokens.get(existingToken);
            if (existing !== undefined && existing.modifiedAt === entry.modifiedAt && existing.sizeBytes === entry.sizeBytes) {
                this.tokens.delete(existingToken);
                this.tokens.set(existingToken, entry);
                return existingToken;
            }
            this.tokens.delete(existingToken);
        }
        const token = this.nextToken;
        this.nextToken += 1;
        this.tokens.set(token, entry);
        this.tokenByPathKey.set(key, token);
        while (this.tokens.size > maxTokens) {
            const oldest = this.tokens.keys().next().value;
            if (oldest === undefined) {
                break;
            }
            const oldEntry = this.tokens.get(oldest);
            this.tokens.delete(oldest);
            if (oldEntry !== undefined) {
                const oldKey = pathKeyOf(oldEntry.path, platform);
                if (this.tokenByPathKey.get(oldKey) === oldest) {
                    this.tokenByPathKey.delete(oldKey);
                }
            }
        }
        return token;
    }

    private removeTokenForPath(path: string, platform: NodeJS.Platform): void {
        const key = pathKeyOf(path, platform);
        const token = this.tokenByPathKey.get(key);
        if (token !== undefined) {
            this.tokenByPathKey.delete(key);
            this.tokens.delete(token);
        }
    }

    private async availableRoots(platform: NodeJS.Platform): Promise<ExplorerRoot[]> {
        const candidates: ExplorerRootCandidate[] = [...this.deps.roots()];
        if (platform === 'win32') {
            for (let code = 65; code <= 90; code += 1) {
                const letter = String.fromCharCode(code);
                candidates.push({ id: `drive-${letter.toLowerCase()}`, label: `${letter}:`, path: `${letter}:\\`, kind: 'drive' });
            }
        }
        const unique: Array<{ candidate: ExplorerRootCandidate; normalized: string }> = [];
        const seen = new Set<string>();
        for (const candidate of candidates) {
            if (candidate.path.trim().length === 0) {
                continue;
            }
            const normalized = resolve(candidate.path);
            const key = pathKeyOf(normalized, platform);
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            unique.push({ candidate, normalized });
        }
        const checked = await Promise.all(
            unique.map(async ({ candidate, normalized }) => {
                const present = await this.pathExists(normalized);
                return present ? { id: candidate.id, label: candidate.label, path: normalized, kind: candidate.kind } : null;
            })
        );
        return checked.filter((item): item is ExplorerRoot => {
            return item !== null;
        });
    }
}

export function createExplorerMediaHandler(
    explorer: Pick<ExplorerService, 'resolveToken'>,
    thumbnails: Pick<ExplorerThumbnails, 'thumbnail' | 'resolvePreview'>,
    files: MediaFileSystem
): (request: Request) => Promise<Response> {
    return async (request) => {
        const address = parseExplorerMediaUrl(request.url);
        if (address === null) {
            return serveFile(request, null, files);
        }
        if (address.route === 'preview') {
            return serveFile(request, thumbnails.resolvePreview(address.id), files);
        }
        const entry = explorer.resolveToken(address.id);
        if (entry === null) {
            return serveFile(request, null, files);
        }
        if (address.route === 'media') {
            return serveFile(request, entry.path, files);
        }
        const thumbnailPath = await thumbnails.thumbnail(entry);
        return serveFile(request, thumbnailPath, files);
    };
}
