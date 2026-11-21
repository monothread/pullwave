import type { ExplorerEntry, ExplorerRoot } from '@shared/explorer';
import type { Translator } from '@shared/i18n';

export type ExplorerFilter = 'all' | 'video' | 'audio';
export type ExplorerSortBy = 'name' | 'modified' | 'size' | 'kind';
export type ExplorerSortDirection = 'asc' | 'desc';
export type ExplorerViewMode = 'grid' | 'list';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
const NAME_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return '0 B';
    }
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < UNITS.length - 1) {
        value /= 1024;
        unit += 1;
    }
    const formatted = unit === 0 ? String(Math.round(value)) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
    return `${formatted} ${UNITS[unit]}`;
}

export function countEntries(entries: readonly ExplorerEntry[]): { folders: number; videos: number; audios: number } {
    let folders = 0;
    let videos = 0;
    let audios = 0;
    for (const entry of entries) {
        if (entry.kind === 'directory') {
            folders += 1;
        } else if (entry.kind === 'video') {
            videos += 1;
        } else {
            audios += 1;
        }
    }
    return { folders, videos, audios };
}

function compareEntries(a: ExplorerEntry, b: ExplorerEntry, sortBy: ExplorerSortBy, direction: ExplorerSortDirection): number {
    if (a.kind === 'directory' && b.kind !== 'directory') {
        return -1;
    }
    if (a.kind !== 'directory' && b.kind === 'directory') {
        return 1;
    }
    const factor = direction === 'asc' ? 1 : -1;
    let diff = 0;
    if (sortBy === 'modified') {
        diff = a.modifiedAt - b.modifiedAt;
    } else if (sortBy === 'size') {
        diff = a.sizeBytes - b.sizeBytes;
    } else if (sortBy === 'kind') {
        diff = a.kind.localeCompare(b.kind) || a.extension.localeCompare(b.extension);
    }
    if (diff !== 0) {
        return diff * factor;
    }
    return NAME_COLLATOR.compare(a.name, b.name) * factor;
}

export function filterAndSortEntries(
    entries: readonly ExplorerEntry[],
    filter: ExplorerFilter,
    query: string,
    sortBy: ExplorerSortBy,
    direction: ExplorerSortDirection
): ExplorerEntry[] {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = entries.filter((entry) => {
        if (filter !== 'all' && entry.kind !== 'directory' && entry.kind !== filter) {
            return false;
        }
        if (normalizedQuery.length > 0 && !entry.name.toLowerCase().includes(normalizedQuery)) {
            return false;
        }
        return true;
    });
    return filtered.sort((a, b) => {
        return compareEntries(a, b, sortBy, direction);
    });
}

export function rootDisplayLabel(root: ExplorerRoot, t: Translator): string {
    if (root.kind === 'downloads') {
        return t('explorer.root.downloads');
    }
    if (root.kind === 'home') {
        return t('explorer.root.home');
    }
    if (root.kind === 'videos') {
        return t('explorer.root.videos');
    }
    if (root.kind === 'music') {
        return t('explorer.root.music');
    }
    return root.label;
}

export function splitEntryName(entry: Pick<ExplorerEntry, 'kind' | 'name' | 'extension'>): { stem: string; extension: string } {
    if (entry.kind === 'directory' || entry.extension.length === 0) {
        return { stem: entry.name, extension: '' };
    }
    if (entry.name.toLowerCase().endsWith(entry.extension.toLowerCase())) {
        return {
            stem: entry.name.slice(0, entry.name.length - entry.extension.length),
            extension: entry.name.slice(entry.name.length - entry.extension.length)
        };
    }
    return { stem: entry.name, extension: '' };
}

export interface ContextMenuGeometry {
    clientX: number;
    clientY: number;
    menuWidth: number;
    menuHeight: number;
    viewportWidth: number;
    viewportHeight: number;
    zoom: number;
    padding?: number;
}

export function contextMenuPosition(geometry: ContextMenuGeometry): { left: number; top: number } {
    const zoom = Number.isFinite(geometry.zoom) && geometry.zoom > 0 ? geometry.zoom : 1;
    const padding = geometry.padding ?? 8;
    const viewWidth = geometry.viewportWidth / zoom;
    const viewHeight = geometry.viewportHeight / zoom;
    const cursorX = geometry.clientX / zoom;
    const cursorY = geometry.clientY / zoom;
    const maxLeft = Math.max(padding, viewWidth - geometry.menuWidth - padding);
    const maxTop = Math.max(padding, viewHeight - geometry.menuHeight - padding);
    const rawLeft = cursorX + geometry.menuWidth + padding <= viewWidth ? cursorX : cursorX - geometry.menuWidth;
    const rawTop = cursorY + geometry.menuHeight + padding <= viewHeight ? cursorY : cursorY - geometry.menuHeight;
    return {
        left: Math.min(Math.max(padding, rawLeft), maxLeft),
        top: Math.min(Math.max(padding, rawTop), maxTop)
    };
}
