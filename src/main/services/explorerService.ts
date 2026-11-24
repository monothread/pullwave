import { execFile } from 'node:child_process';
import { lstat, mkdir, readdir, realpath, rename, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, parse, resolve, sep } from 'node:path';
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
const WINDOWS_HIDDEN_TIMEOUT_MS = 5000;
const WINDOWS_HIDDEN_MAX_BUFFER = 4 * 1024 * 1024;
const WINDOWS_FORBIDDEN = /[<>:"/\\|?*]/;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;
const POSIX_FORBIDDEN = /\//;
const WINDOWS_HIDDEN_SCRIPT = [
    '$h = [System.IO.FileAttributes]::Hidden',
    "$root = [System.IO.Path]::GetFullPath($env:PULLWAVE_EXPLORER_ROOT).TrimEnd('\\', '/')",
    "$dir = [System.IO.Path]::GetFullPath($env:PULLWAVE_EXPLORER_DIR).TrimEnd('\\', '/')",
    '$targetHidden = $false',
    '$cur = $dir',
    'while ($cur.Length -gt $root.Length) {',
    '    try { if (([System.IO.File]::GetAttributes($cur) -band $h) -ne 0) { $targetHidden = $true; break } } catch {}',
    '    $parent = [System.IO.Path]::GetDirectoryName($cur)',
    '    if ([string]::IsNullOrEmpty($parent) -or $parent -eq $cur) { break }',
    "    $cur = $parent.TrimEnd('\\', '/')",
    '}',
    '$names = @()',
    'if (-not $targetHidden) {',
    '    try { $names = @([System.IO.DirectoryInfo]::new($env:PULLWAVE_EXPLORER_DIR).EnumerateFileSystemInfos() | Where-Object { ($_.Attributes -band $h) -ne 0 } | ForEach-Object { $_.Name }) } catch {}',
    '}',
    '$json = @{ targetHidden = $targetHidden; hiddenNames = $names } | ConvertTo-Json -Compress',
    '$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)',
    '[Console]::OpenStandardOutput().Write($bytes, 0, $bytes.Length)'
].join('\n');

export interface ExplorerHiddenSnapshot {
    targetHidden: boolean;
    hiddenNames: ReadonlySet<string>;
}

const EMPTY_HIDDEN_SNAPSHOT: ExplorerHiddenSnapshot = {
    targetHidden: false,
    hiddenNames: new Set<string>()
};

export interface ExplorerServiceDependencies {
    defaultDirectory: () => string;
    trashItem: (path: string) => Promise<void>;
    openExternal: (path: string) => Promise<string>;
    thumbnails: ExplorerThumbnails;
    platform?: NodeJS.Platform;
    exists?: (path: string) => boolean | Promise<boolean>;
    readWindowsHidden?: (directory: string, root: string) => Promise<ExplorerHiddenSnapshot>;
}

export function parseWindowsHiddenOutput(raw: string): ExplorerHiddenSnapshot {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
        return EMPTY_HIDDEN_SNAPSHOT;
    }
    try {
        const parsed: unknown = JSON.parse(trimmed);
        if (typeof parsed !== 'object' || parsed === null) {
            return EMPTY_HIDDEN_SNAPSHOT;
        }
        const record = parsed as Record<string, unknown>;
        const targetHidden = record['targetHidden'] === true;
        const rawNames = record['hiddenNames'];
        const hiddenNames = new Set<string>();
        if (typeof rawNames === 'string' && rawNames.length > 0) {
            hiddenNames.add(rawNames.toLowerCase());
        } else if (Array.isArray(rawNames)) {
            for (const entry of rawNames) {
                if (typeof entry === 'string' && entry.length > 0) {
                    hiddenNames.add(entry.toLowerCase());
                }
            }
        }
        return { targetHidden, hiddenNames };
    } catch {
        return EMPTY_HIDDEN_SNAPSHOT;
    }
}

function defaultReadWindowsHidden(directory: string, root: string): Promise<ExplorerHiddenSnapshot> {
    return new Promise((resolvePromise) => {
        execFile(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_HIDDEN_SCRIPT],
            {
                encoding: 'utf-8',
                timeout: WINDOWS_HIDDEN_TIMEOUT_MS,
                maxBuffer: WINDOWS_HIDDEN_MAX_BUFFER,
                windowsHide: true,
                env: {
                    ...process.env,
                    PULLWAVE_EXPLORER_DIR: directory,
                    PULLWAVE_EXPLORER_ROOT: root
                }
            },
            (error, stdout) => {
                if (error !== null || typeof stdout !== 'string') {
                    resolvePromise(EMPTY_HIDDEN_SNAPSHOT);
                    return;
                }
                resolvePromise(parseWindowsHiddenOutput(stdout));
            }
        );
    });
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

export function isWithinRoot(candidatePath: string, rootPath: string, platform: NodeJS.Platform = process.platform): boolean {
    const candidate = resolve(candidatePath);
    const root = resolve(rootPath);
    const candidateKey = pathKeyOf(candidate, platform);
    const rootKey = pathKeyOf(root, platform);
    if (candidateKey === rootKey) {
        return true;
    }
    const prefix = rootKey.endsWith(sep) ? rootKey : `${rootKey}${sep}`;
    return candidateKey.startsWith(prefix);
}

function hasHiddenRelativeSegment(candidatePath: string, rootPath: string): boolean {
    const candidate = resolve(candidatePath);
    const root = resolve(rootPath);
    if (candidate.length <= root.length) {
        return false;
    }
    const rest = candidate.slice(root.length);
    return rest.split(/[\\/]+/).some((segment) => {
        return segment.startsWith('.');
    });
}

export function buildBreadcrumbs(
    directory: string,
    rootDirectory?: string,
    platform: NodeJS.Platform = process.platform
): ExplorerBreadcrumb[] {
    const normalized = resolve(directory);
    if (rootDirectory !== undefined && isWithinRoot(normalized, rootDirectory, platform)) {
        const normalizedRoot = resolve(rootDirectory);
        const rootName = basename(normalizedRoot) || normalizedRoot;
        const crumbs: ExplorerBreadcrumb[] = [{ name: rootName, path: normalizedRoot }];
        const rest = normalized.slice(normalizedRoot.length);
        const parts = rest.split(/[\\/]+/).filter((part) => {
            return part.length > 0;
        });
        let current = normalizedRoot;
        for (const part of parts) {
            current = current.endsWith(sep) ? `${current}${part}` : `${current}${sep}${part}`;
            crumbs.push({ name: part, path: current });
        }
        return crumbs;
    }
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
    private lastRootKey = '';
    private listSeq = 0;
    private readonly statLimit = createConcurrencyLimit(STAT_CONCURRENCY);

    constructor(private readonly deps: ExplorerServiceDependencies) {}

    resolveToken(token: number): ExplorerEntry | null {
        const entry = this.tokens.get(token);
        if (entry === undefined) {
            return null;
        }
        const platform = this.deps.platform ?? process.platform;
        if (!this.isInsideRoot(entry.path, this.rootDirectory(), platform, false)) {
            this.tokens.delete(token);
            this.tokenByPathKey.delete(pathKeyOf(entry.path, platform));
            return null;
        }
        return entry;
    }

    cancelPreview(): void {
        this.deps.thumbnails.cancelPreview();
    }

    async list(directory?: string, showHidden = false): Promise<ExplorerListResponse> {
        const platform = this.deps.platform ?? process.platform;
        const root = this.rootDirectory();
        const rootKey = pathKeyOf(root, platform);
        if (this.lastRootKey !== rootKey) {
            this.lastRootKey = rootKey;
            this.tokens.clear();
            this.tokenByPathKey.clear();
        }
        const hasRequested = typeof directory === 'string' && directory.trim().length > 0;
        if (hasRequested && !isAbsolute(directory)) {
            return { ok: false, reason: 'not-found' };
        }
        const requested = hasRequested ? directory : root;
        if (!isAbsolute(requested)) {
            return { ok: false, reason: 'not-found' };
        }
        const target = resolve(requested);
        if (!this.isInsideRoot(target, root, platform, true, showHidden)) {
            return { ok: false, reason: 'denied' };
        }
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
        const resolved = await this.resolveRealRootIfInside(target, root, platform, true, showHidden);
        if (resolved === null) {
            return { ok: false, reason: 'denied' };
        }
        const { realRoot, realTarget } = resolved;
        let dirents;
        try {
            dirents = await readdir(target, { withFileTypes: true });
        } catch (error) {
            return { ok: false, reason: mapListError(error) };
        }
        const isAtRoot = pathKeyOf(target, platform) === pathKeyOf(root, platform);
        const needWindowsHidden = !showHidden && platform === 'win32' && (!isAtRoot || dirents.length > 0);
        const windowsHidden = needWindowsHidden ? await this.readWindowsHiddenSnapshot(target, root, realTarget, realRoot, platform) : EMPTY_HIDDEN_SNAPSHOT;
        if (windowsHidden.targetHidden) {
            return { ok: false, reason: 'denied' };
        }
        if (seq === this.listSeq && this.currentDirectory !== target) {
            this.deps.thumbnails.cancelPending();
            this.currentDirectory = target;
        }
        const windowsHiddenKeys = windowsHidden.hiddenNames;
        const realTargetDirKey = pathKeyOf(realTarget, platform);
        const linkDirHiddenCache = new Map<string, Promise<ExplorerHiddenSnapshot>>();
        const visibleDirents = showHidden
            ? dirents
            : dirents.filter((dirent) => {
                  return !dirent.name.startsWith('.') && !windowsHiddenKeys.has(pathKeyOf(dirent.name, platform));
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
                        if (resolvedPath.length === 0 || !this.isInsideRoot(resolvedPath, realRoot, platform, false, showHidden)) {
                            return null;
                        }
                        if (!showHidden && platform === 'win32') {
                            const resolvedDir = dirname(resolvedPath);
                            const resolvedDirKey = pathKeyOf(resolvedDir, platform);
                            if (resolvedDirKey === realTargetDirKey) {
                                if (windowsHiddenKeys.has(pathKeyOf(basename(resolvedPath), platform))) {
                                    return null;
                                }
                            } else {
                                let pending = linkDirHiddenCache.get(resolvedDirKey);
                                if (pending === undefined) {
                                    pending = this.readWindowsHiddenNormalized(resolvedDir, realRoot, platform);
                                    linkDirHiddenCache.set(resolvedDirKey, pending);
                                }
                                const linkParentHidden = await pending;
                                if (linkParentHidden.targetHidden || linkParentHidden.hiddenNames.has(pathKeyOf(basename(resolvedPath), platform))) {
                                    return null;
                                }
                            }
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
        const parent = isAtRoot || parentCandidate === target || !this.isInsideRoot(parentCandidate, root, platform, true, showHidden) ? null : parentCandidate;
        return {
            ok: true,
            listing: {
                directory: target,
                parent,
                breadcrumbs: buildBreadcrumbs(target, root, platform),
                entries,
                roots: [{ id: 'downloads', label: basename(root) || 'downloads', path: root, kind: 'downloads' }]
            }
        };
    }

    async openFolder(directory: string): Promise<ExplorerOpenFolderResponse> {
        if (typeof directory !== 'string' || directory.trim().length === 0 || !isAbsolute(directory)) {
            return { ok: false, reason: 'not-found' };
        }
        const platform = this.deps.platform ?? process.platform;
        const root = this.rootDirectory();
        const resolvedTarget = resolve(directory);
        if (!this.isInsideRoot(resolvedTarget, root, platform, true)) {
            return { ok: false, reason: 'denied' };
        }
        let info;
        try {
            info = await stat(resolvedTarget);
        } catch {
            return { ok: false, reason: 'not-found' };
        }
        if (!info.isDirectory()) {
            return { ok: false, reason: 'not-found' };
        }
        if (!(await this.isRealInsideRoot(resolvedTarget, root, platform, true))) {
            return { ok: false, reason: 'denied' };
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
        const root = this.rootDirectory();
        const resolvedParent = resolve(parentDir);
        if (!this.isInsideRoot(resolvedParent, root, platform, true) || !(await this.isRealInsideRoot(resolvedParent, root, platform, true))) {
            return { ok: false, reason: 'denied' };
        }
        const target = join(resolvedParent, name);
        if (!this.isInsideRoot(target, root, platform, false)) {
            return { ok: false, reason: 'denied' };
        }
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
        const root = this.rootDirectory();
        const resolvedTarget = resolve(targetPath);
        if (dirname(resolvedTarget) === resolvedTarget || !this.isInsideRoot(resolvedTarget, root, platform, false)) {
            return { ok: false, reason: 'denied' };
        }
        let info;
        try {
            info = await lstat(resolvedTarget);
        } catch (error) {
            return { ok: false, reason: mapWriteError(error) };
        }
        if (info.isSymbolicLink() || !(await this.isRealInsideRoot(resolvedTarget, root, platform, false))) {
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
        if (!this.isInsideRoot(destination, root, platform, false)) {
            return { ok: false, reason: 'denied' };
        }
        if (destination === resolvedTarget) {
            return { ok: true, path: destination, name };
        }
        const caseOnly = isCaseInsensitive(platform) && destination.toLowerCase() === resolvedTarget.toLowerCase();
        if (!caseOnly && (await this.pathExists(destination))) {
            return { ok: false, reason: 'exists' };
        }
        try {
            await rename(resolvedTarget, destination);
            await this.evictPath(resolvedTarget, info, platform);
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
        const root = this.rootDirectory();
        const resolvedTarget = resolve(targetPath);
        if (dirname(resolvedTarget) === resolvedTarget || !this.isInsideRoot(resolvedTarget, root, platform, false)) {
            return { ok: false, reason: 'denied' };
        }
        let info;
        try {
            info = await lstat(resolvedTarget);
        } catch (error) {
            return { ok: false, reason: mapTrashError(error) };
        }
        if (info.isSymbolicLink() || !(await this.isRealInsideRoot(resolvedTarget, root, platform, false))) {
            return { ok: false, reason: 'denied' };
        }
        if (info.isDirectory()) {
            let children;
            try {
                children = await readdir(resolvedTarget);
            } catch (error) {
                return { ok: false, reason: mapTrashError(error) };
            }
            if (children.length > 0) {
                return { ok: false, reason: 'not-empty' };
            }
        } else if (!info.isFile() || mediaKindOfExtension(extname(resolvedTarget)) === null) {
            return { ok: false, reason: 'denied' };
        }
        try {
            await this.deps.trashItem(resolvedTarget);
            await this.evictPath(resolvedTarget, info, platform);
            return { ok: true };
        } catch (error) {
            return { ok: false, reason: mapTrashError(error) };
        }
    }

    async openExternal(targetPath: string): Promise<ExplorerOpenExternalResponse> {
        if (typeof targetPath !== 'string' || targetPath.trim().length === 0 || !isAbsolute(targetPath)) {
            return { ok: false, reason: 'not-found' };
        }
        const platform = this.deps.platform ?? process.platform;
        const root = this.rootDirectory();
        const resolvedTarget = resolve(targetPath);
        if (!this.isInsideRoot(resolvedTarget, root, platform, false)) {
            return { ok: false, reason: 'denied' };
        }
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
        if (!(await this.isRealInsideRoot(targetToOpen, root, platform, false))) {
            return { ok: false, reason: 'denied' };
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

    private rootDirectory(): string {
        return resolve(this.deps.defaultDirectory());
    }

    private isInsideRoot(targetPath: string, rootPath: string, platform: NodeJS.Platform, allowRoot: boolean, allowHidden = true): boolean {
        if (!isWithinRoot(targetPath, rootPath, platform) || (!allowHidden && hasHiddenRelativeSegment(targetPath, rootPath))) {
            return false;
        }
        if (!allowRoot && pathKeyOf(resolve(targetPath), platform) === pathKeyOf(resolve(rootPath), platform)) {
            return false;
        }
        return true;
    }

    private async resolveRealRootIfInside(
        targetPath: string,
        rootPath: string,
        platform: NodeJS.Platform,
        allowRoot: boolean,
        allowHidden = true
    ): Promise<{ realRoot: string; realTarget: string } | null> {
        const [realRoot, realTarget] = await Promise.all([
            realpath(rootPath).catch(() => {
                return '';
            }),
            realpath(targetPath).catch(() => {
                return '';
            })
        ]);
        if (realRoot.length === 0 || realTarget.length === 0) {
            return null;
        }
        return this.isInsideRoot(realTarget, realRoot, platform, allowRoot, allowHidden) ? { realRoot, realTarget } : null;
    }

    private async isRealInsideRoot(targetPath: string, rootPath: string, platform: NodeJS.Platform, allowRoot: boolean, allowHidden = true): Promise<boolean> {
        return (await this.resolveRealRootIfInside(targetPath, rootPath, platform, allowRoot, allowHidden)) !== null;
    }

    private async readWindowsHiddenNormalized(directory: string, root: string, platform: NodeJS.Platform): Promise<ExplorerHiddenSnapshot> {
        try {
            if (this.deps.readWindowsHidden === undefined) {
                return await defaultReadWindowsHidden(directory, root);
            }
            const raw = await this.deps.readWindowsHidden(directory, root);
            if (raw.hiddenNames.size === 0) {
                return { targetHidden: raw.targetHidden, hiddenNames: EMPTY_HIDDEN_SNAPSHOT.hiddenNames };
            }
            const normalized = new Set<string>();
            for (const name of raw.hiddenNames) {
                normalized.add(pathKeyOf(name, platform));
            }
            return { targetHidden: raw.targetHidden, hiddenNames: normalized };
        } catch {
            return EMPTY_HIDDEN_SNAPSHOT;
        }
    }

    private async readWindowsHiddenSnapshot(
        target: string,
        root: string,
        realTarget: string,
        realRoot: string,
        platform: NodeJS.Platform
    ): Promise<ExplorerHiddenSnapshot> {
        const realSnapshot = await this.readWindowsHiddenNormalized(realTarget, realRoot, platform);
        if (realSnapshot.targetHidden) {
            return realSnapshot;
        }
        if (pathKeyOf(realTarget, platform) === pathKeyOf(target, platform) && pathKeyOf(realRoot, platform) === pathKeyOf(root, platform)) {
            return realSnapshot;
        }
        const logicalSnapshot = await this.readWindowsHiddenNormalized(target, root, platform);
        if (logicalSnapshot.targetHidden) {
            return { targetHidden: true, hiddenNames: EMPTY_HIDDEN_SNAPSHOT.hiddenNames };
        }
        if (logicalSnapshot.hiddenNames.size === 0) {
            return realSnapshot;
        }
        if (realSnapshot.hiddenNames.size === 0) {
            return logicalSnapshot;
        }
        const merged = new Set<string>(realSnapshot.hiddenNames);
        for (const name of logicalSnapshot.hiddenNames) {
            merged.add(name);
        }
        return { targetHidden: false, hiddenNames: merged };
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

    private async evictPath(
        resolvedTarget: string,
        info: { isFile: () => boolean; isDirectory: () => boolean; mtimeMs: number; size: number },
        platform: NodeJS.Platform
    ): Promise<void> {
        const toEvict: Array<Pick<ExplorerEntry, 'path' | 'modifiedAt' | 'sizeBytes'>> = [];
        const targetKey = pathKeyOf(resolvedTarget, platform);
        if (info.isFile()) {
            const mtime = info.mtimeMs;
            toEvict.push({ path: resolvedTarget, modifiedAt: mtime, sizeBytes: info.size });
            const token = this.tokenByPathKey.get(targetKey);
            if (token !== undefined) {
                const entry = this.tokens.get(token);
                this.tokenByPathKey.delete(targetKey);
                this.tokens.delete(token);
                if (entry !== undefined && (entry.modifiedAt !== mtime || entry.sizeBytes !== info.size)) {
                    toEvict.push({ path: entry.path, modifiedAt: entry.modifiedAt, sizeBytes: entry.sizeBytes });
                }
            }
        } else if (info.isDirectory()) {
            const prefix = targetKey.endsWith(sep) ? targetKey : `${targetKey}${sep}`;
            for (const [token, entry] of this.tokens) {
                const entryKey = pathKeyOf(entry.path, platform);
                if (entryKey === targetKey || entryKey.startsWith(prefix)) {
                    this.tokens.delete(token);
                    if (this.tokenByPathKey.get(entryKey) === token) {
                        this.tokenByPathKey.delete(entryKey);
                    }
                    toEvict.push({ path: entry.path, modifiedAt: entry.modifiedAt, sizeBytes: entry.sizeBytes });
                }
            }
        }
        await Promise.all(
            toEvict.map((entry) => {
                return this.deps.thumbnails.evict(entry);
            })
        );
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
