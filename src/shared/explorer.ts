export const EXPLORER_MEDIA_SCHEME = 'pullwave-explorer';

export type ExplorerMediaRoute = 'media' | 'preview' | 'thumbnail';

export type ExplorerEntryKind = 'directory' | 'video' | 'audio';

export type ExplorerRootKind = 'downloads' | 'home' | 'videos' | 'music' | 'drive';

export interface ExplorerRoot {
    id: string;
    label: string;
    path: string;
    kind: ExplorerRootKind;
}

export interface ExplorerBreadcrumb {
    name: string;
    path: string;
}

export interface ExplorerEntry {
    path: string;
    name: string;
    kind: ExplorerEntryKind;
    extension: string;
    sizeBytes: number;
    modifiedAt: number;
    token: number | null;
    thumbnailUrl: string | null;
    mediaUrl: string | null;
}

export interface ExplorerListing {
    directory: string;
    parent: string | null;
    breadcrumbs: ExplorerBreadcrumb[];
    entries: ExplorerEntry[];
    roots: ExplorerRoot[];
}

export type ExplorerListFailure = 'not-found' | 'denied' | 'not-directory' | 'failed';

export type ExplorerListResponse = { ok: true; listing: ExplorerListing } | { ok: false; reason: ExplorerListFailure };

export type ExplorerWriteFailure = 'invalid-name' | 'exists' | 'not-found' | 'denied' | 'not-empty' | 'failed';

export type ExplorerCreateFolderResponse = { ok: true; path: string } | { ok: false; reason: ExplorerWriteFailure };

export type ExplorerRenameResponse = { ok: true; path: string; name: string } | { ok: false; reason: ExplorerWriteFailure };

export type ExplorerTrashFailure = 'not-found' | 'denied' | 'not-empty' | 'failed';

export type ExplorerTrashResponse = { ok: true } | { ok: false; reason: ExplorerTrashFailure };

export type ExplorerOpenExternalResponse = { ok: true } | { ok: false; reason: 'not-found' | 'denied' | 'failed' };

export type ExplorerOpenFolderResponse = { ok: true } | { ok: false; reason: 'not-found' | 'denied' | 'failed' };

export type ExplorerPreviewFailure = 'not-found' | 'no-ffmpeg' | 'failed' | 'cancelled';

export type ExplorerPreviewResponse = { ok: true; url: string; converted: boolean } | { ok: false; reason: ExplorerPreviewFailure };

export interface ExplorerApi {
    list: (directory?: string, showHidden?: boolean) => Promise<ExplorerListResponse>;
    openFolder: (directory: string) => Promise<ExplorerOpenFolderResponse>;
    createFolder: (parentDir: string, name: string) => Promise<ExplorerCreateFolderResponse>;
    rename: (path: string, newName: string) => Promise<ExplorerRenameResponse>;
    trash: (path: string) => Promise<ExplorerTrashResponse>;
    openExternal: (path: string) => Promise<ExplorerOpenExternalResponse>;
    preview: (token: number) => Promise<ExplorerPreviewResponse>;
    cancelPreview: () => Promise<void>;
}
