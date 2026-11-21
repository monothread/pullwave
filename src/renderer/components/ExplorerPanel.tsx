import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { ExplorerEntry, ExplorerListFailure, ExplorerWriteFailure } from '@shared/explorer';
import type { MessageKey } from '@shared/i18n';
import { INCREMENTAL_STEP } from '../hooks/useIncrementalList';
import { useModalDialog } from '../hooks/useModalDialog';
import { useAppLanguage, useTranslator } from '../i18n/useTranslator';
import { useAppStore } from '../store/appStore';
import { useConvertStore } from '../store/convertStore';
import { useCutStore } from '../store/cutStore';
import { useExplorerStore } from '../store/explorerStore';
import { useMergeStore } from '../store/mergeStore';
import { ConfirmDialog } from './ConfirmDialog';
import { ExplorerMediaPlayer } from './ExplorerMediaPlayer';
import {
    contextMenuPosition,
    countEntries,
    filterAndSortEntries,
    formatBytes,
    rootDisplayLabel,
    splitEntryName,
    type ExplorerFilter,
    type ExplorerSortBy
} from './explorerHelpers';
import { IncrementalItems } from './IncrementalItems';
import { LoadingMark } from './LoadingMark';
import { SelectField } from './fields';

const LIST_ERROR_KEYS: Record<ExplorerListFailure, MessageKey> = {
    'not-found': 'explorer.error.not-found',
    denied: 'explorer.error.denied',
    'not-directory': 'explorer.error.not-directory',
    failed: 'explorer.error.failed'
};

const WRITE_ERROR_KEYS: Record<ExplorerWriteFailure, MessageKey> = {
    'invalid-name': 'explorer.write.invalid-name',
    exists: 'explorer.write.exists',
    'not-found': 'explorer.write.not-found',
    denied: 'explorer.write.denied',
    'not-empty': 'explorer.write.not-empty',
    failed: 'explorer.write.failed'
};

const SORT_OPTIONS: readonly ExplorerSortBy[] = ['name', 'modified', 'size', 'kind'];
const FILTERS: readonly ExplorerFilter[] = ['all', 'video', 'audio'];
const MENU_EDGE_PADDING = 8;

interface NameDialogProps {
    title: string;
    label: string;
    initialValue: string;
    suffix: string;
    placeholder?: string;
    confirmLabel: string;
    onSubmit: (value: string) => Promise<ExplorerWriteFailure | null>;
    onCancel: () => void;
}

function NameDialog({ title, label, initialValue, suffix, placeholder, confirmLabel, onSubmit, onCancel }: NameDialogProps) {
    const t = useTranslator();
    const titleId = useId();
    const [value, setValue] = useState(initialValue);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<ExplorerWriteFailure | null>(null);
    const { dialogRef, handleKeyDown } = useModalDialog(onCancel, !busy);

    async function submit(event: FormEvent): Promise<void> {
        event.preventDefault();
        if (busy) {
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const failure = await onSubmit(value.trim() + suffix);
            if (failure !== null) {
                setError(failure);
                return;
            }
            onCancel();
        } catch {
            setError('failed');
        } finally {
            setBusy(false);
        }
    }

    return createPortal(
        <div
            className="modal-backdrop"
            onMouseDown={(event) => {
                if (!busy && event.target === event.currentTarget) {
                    onCancel();
                }
            }}
        >
            <div ref={dialogRef} className="modal modal--confirm" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={handleKeyDown}>
                <form
                    className="explorer-dialog__form"
                    onSubmit={(event) => {
                        void submit(event);
                    }}
                >
                    <h2 id={titleId} className="modal__title">
                        {title}
                    </h2>
                    <label className="field">
                        <span className="field__label">{label}</span>
                        <div className="explorer-dialog__input-row">
                            <input
                                className="input"
                                type="text"
                                aria-label={label}
                                value={value}
                                placeholder={placeholder}
                                disabled={busy}
                                autoFocus
                                onChange={(event) => {
                                    setValue(event.target.value);
                                    setError(null);
                                }}
                            />
                            {suffix.length > 0 && <span className="badge badge--done">{suffix}</span>}
                        </div>
                    </label>
                    {error !== null && (
                        <p className="field__warning" role="alert">
                            {t(WRITE_ERROR_KEYS[error])}
                        </p>
                    )}
                    <div className="modal__actions">
                        <button type="button" className="btn btn--small" disabled={busy} onClick={onCancel}>
                            {t('explorer.dialog.cancel')}
                        </button>
                        <button type="submit" className="btn btn--small btn--primary" disabled={busy || value.trim().length === 0}>
                            {confirmLabel}
                        </button>
                    </div>
                </form>
            </div>
        </div>,
        document.body
    );
}

interface ContextMenuAction {
    id: string;
    label: string;
    danger?: boolean;
    onSelect: () => void;
}

interface ContextMenuState {
    x: number;
    y: number;
    entry: ExplorerEntry | null;
    directory: string;
}

interface ExplorerContextMenuProps {
    x: number;
    y: number;
    actions: readonly ContextMenuAction[];
    onClose: () => void;
}

function currentUiZoom(): number {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom');
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function ExplorerContextMenu({ x, y, actions, onClose }: ExplorerContextMenuProps) {
    const t = useTranslator();
    const menuRef = useRef<HTMLDivElement | null>(null);
    const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const [position, setPosition] = useState(() => {
        const zoom = currentUiZoom();
        return { left: x / zoom, top: y / zoom };
    });

    useLayoutEffect(() => {
        const element = menuRef.current;
        if (element === null) {
            return;
        }
        const zoom = currentUiZoom();
        const rect = element.getBoundingClientRect();
        const menuWidth = element.offsetWidth > 0 ? element.offsetWidth : rect.width / zoom;
        const menuHeight = element.offsetHeight > 0 ? element.offsetHeight : rect.height / zoom;
        setPosition(
            contextMenuPosition({
                clientX: x,
                clientY: y,
                menuWidth,
                menuHeight,
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
                zoom,
                padding: MENU_EDGE_PADDING
            })
        );
    }, [x, y, actions.length]);

    useEffect(() => {
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        itemRefs.current[0]?.focus({ preventScroll: true });
        return () => {
            if (previous !== null && previous.isConnected && document.activeElement === document.body) {
                previous.focus({ preventScroll: true });
            }
        };
    }, []);

    useEffect(() => {
        const focusAt = (nextIndex: number): void => {
            const count = actions.length;
            if (count === 0) {
                return;
            }
            const wrapped = ((nextIndex % count) + count) % count;
            itemRefs.current[wrapped]?.focus({ preventScroll: true });
        };
        const currentIndex = (): number => {
            return itemRefs.current.findIndex((button) => {
                return button === document.activeElement;
            });
        };
        const onPointerDown = (event: globalThis.MouseEvent): void => {
            if (menuRef.current !== null && !menuRef.current.contains(event.target as Node | null)) {
                onClose();
            }
        };
        const onKeyDown = (event: globalThis.KeyboardEvent): void => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                onClose();
                return;
            }
            if (event.key === 'Tab') {
                onClose();
                return;
            }
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                focusAt(currentIndex() + 1);
                return;
            }
            if (event.key === 'ArrowUp') {
                event.preventDefault();
                const index = currentIndex();
                focusAt(index < 0 ? actions.length - 1 : index - 1);
                return;
            }
            if (event.key === 'Home') {
                event.preventDefault();
                focusAt(0);
                return;
            }
            if (event.key === 'End') {
                event.preventDefault();
                focusAt(actions.length - 1);
            }
        };
        const dismiss = (): void => {
            onClose();
        };
        window.addEventListener('mousedown', onPointerDown, true);
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('resize', dismiss);
        window.addEventListener('scroll', dismiss, true);
        window.addEventListener('blur', dismiss);
        return () => {
            window.removeEventListener('mousedown', onPointerDown, true);
            window.removeEventListener('keydown', onKeyDown, true);
            window.removeEventListener('resize', dismiss);
            window.removeEventListener('scroll', dismiss, true);
            window.removeEventListener('blur', dismiss);
        };
    }, [actions.length, onClose]);

    return createPortal(
        <div
            ref={menuRef}
            className="explorer-menu"
            role="menu"
            aria-label={t('explorer.menu.aria')}
            style={{ left: `${String(position.left)}px`, top: `${String(position.top)}px` }}
            onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
            }}
        >
            {actions.map((action, index) => {
                return (
                    <button
                        key={action.id}
                        ref={(element) => {
                            itemRefs.current[index] = element;
                        }}
                        type="button"
                        role="menuitem"
                        className={`explorer-menu__item${action.danger === true ? ' explorer-menu__item--danger' : ''}`}
                        onClick={() => {
                            onClose();
                            action.onSelect();
                        }}
                    >
                        {action.label}
                    </button>
                );
            })}
        </div>,
        document.body
    );
}

function VideoThumb({ src, name }: { src: string; name: string }) {
    const t = useTranslator();
    const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');

    if (status === 'failed') {
        return (
            <span className="explorer__thumb explorer__thumb--empty" aria-hidden="true">
                ▶
            </span>
        );
    }

    return (
        <span className={`explorer__thumb${status === 'loading' ? ' explorer__thumb--loading' : ''}`}>
            <img
                className="explorer__thumb-img"
                src={src}
                alt={t('explorer.thumbnail', { name })}
                loading="lazy"
                draggable={false}
                onLoad={() => {
                    setStatus('ready');
                }}
                onError={() => {
                    setStatus('failed');
                }}
            />
        </span>
    );
}

function EntryVisual({ entry }: { entry: ExplorerEntry }) {
    if (entry.kind === 'directory') {
        return (
            <span className="explorer__thumb explorer__thumb--folder" aria-hidden="true">
                📁
            </span>
        );
    }
    if (entry.kind === 'audio') {
        return (
            <span className="explorer__thumb explorer__thumb--audio" aria-hidden="true">
                ♫
            </span>
        );
    }
    if (entry.thumbnailUrl !== null) {
        return <VideoThumb key={entry.thumbnailUrl} src={entry.thumbnailUrl} name={entry.name} />;
    }
    return (
        <span className="explorer__thumb explorer__thumb--empty" aria-hidden="true">
            ▶
        </span>
    );
}

interface EntryItemProps {
    entry: ExplorerEntry;
    language: string;
    highlighted: boolean;
    onOpen: (entry: ExplorerEntry) => void;
    onContextMenu: (event: MouseEvent<HTMLElement>, entry: ExplorerEntry) => void;
    onSendToConvert: (entry: ExplorerEntry) => void;
    onSendToCut: (entry: ExplorerEntry) => void;
    onSendToMerge: (entry: ExplorerEntry) => void;
}

function ExplorerItem({ entry, language, highlighted, onOpen, onContextMenu, onSendToConvert, onSendToCut, onSendToMerge }: EntryItemProps) {
    const t = useTranslator();
    const itemRef = useRef<HTMLLIElement | null>(null);
    const kindLabel = t(`explorer.kind.${entry.kind}`);
    const badgeText = entry.kind === 'directory' ? kindLabel : entry.extension.slice(1).toUpperCase();
    const meta =
        entry.kind === 'directory'
            ? entry.modifiedAt > 0
                ? new Date(entry.modifiedAt).toLocaleDateString(language)
                : kindLabel
            : `${formatBytes(entry.sizeBytes)} · ${new Date(entry.modifiedAt).toLocaleDateString(language)}`;

    useEffect(() => {
        if (highlighted && itemRef.current !== null && typeof itemRef.current.scrollIntoView === 'function') {
            itemRef.current.scrollIntoView({ block: 'nearest' });
        }
    }, [highlighted]);

    return (
        <li
            ref={itemRef}
            className={`explorer__item explorer__item--${entry.kind}${highlighted ? ' explorer__item--highlighted' : ''}`}
            data-testid={`explorer-item-${entry.kind}`}
            onContextMenu={(event) => {
                onContextMenu(event, entry);
            }}
        >
            <button
                type="button"
                className="explorer__open"
                title={entry.path}
                onClick={() => {
                    onOpen(entry);
                }}
            >
                <span className="explorer__visual">
                    <EntryVisual entry={entry} />
                    <span className={`badge explorer__kind-badge${entry.kind === 'directory' ? ' badge--waiting' : ' badge--done'}`}>{badgeText}</span>
                </span>
                <span className="explorer__info">
                    <span className="explorer__name">{entry.name}</span>
                    <span className="history__meta">{meta}</span>
                </span>
            </button>
            {entry.kind !== 'directory' && (
                <div className="explorer__item-actions">
                    {entry.kind === 'video' && (
                        <>
                            <button
                                type="button"
                                className="btn btn--small"
                                title={`${t('explorer.action.convert')}: ${entry.name}`}
                                onClick={() => {
                                    onSendToConvert(entry);
                                }}
                            >
                                {t('explorer.action.convert')}
                            </button>
                            <button
                                type="button"
                                className="btn btn--small"
                                title={`${t('explorer.action.merge')}: ${entry.name}`}
                                onClick={() => {
                                    onSendToMerge(entry);
                                }}
                            >
                                {t('explorer.action.merge')}
                            </button>
                        </>
                    )}
                    <button
                        type="button"
                        className="btn btn--small"
                        title={`${t('explorer.action.cut')}: ${entry.name}`}
                        onClick={() => {
                            onSendToCut(entry);
                        }}
                    >
                        {t('explorer.action.cut')}
                    </button>
                </div>
            )}
        </li>
    );
}

export function ExplorerPanel() {
    const t = useTranslator();
    const language = useAppLanguage();
    const openTools = useAppStore((state) => {
        return state.openTools;
    });
    const directory = useExplorerStore((state) => {
        return state.directory;
    });
    const parent = useExplorerStore((state) => {
        return state.parent;
    });
    const breadcrumbs = useExplorerStore((state) => {
        return state.breadcrumbs;
    });
    const roots = useExplorerStore((state) => {
        return state.roots;
    });
    const entries = useExplorerStore((state) => {
        return state.entries;
    });
    const loaded = useExplorerStore((state) => {
        return state.loaded;
    });
    const loading = useExplorerStore((state) => {
        return state.loading;
    });
    const error = useExplorerStore((state) => {
        return state.error;
    });
    const historyLength = useExplorerStore((state) => {
        return state.history.length;
    });
    const historyIndex = useExplorerStore((state) => {
        return state.historyIndex;
    });
    const filter = useExplorerStore((state) => {
        return state.filter;
    });
    const query = useExplorerStore((state) => {
        return state.query;
    });
    const sortBy = useExplorerStore((state) => {
        return state.sortBy;
    });
    const sortDirection = useExplorerStore((state) => {
        return state.sortDirection;
    });
    const viewMode = useExplorerStore((state) => {
        return state.viewMode;
    });
    const highlightedPath = useExplorerStore((state) => {
        return state.highlightedPath;
    });
    const clearHighlight = useExplorerStore((state) => {
        return state.clearHighlight;
    });
    const downloadDir = useAppStore((state) => {
        return state.settings?.downloadDir ?? '';
    });
    const open = useExplorerStore((state) => {
        return state.open;
    });
    const refresh = useExplorerStore((state) => {
        return state.refresh;
    });
    const goBack = useExplorerStore((state) => {
        return state.goBack;
    });
    const goForward = useExplorerStore((state) => {
        return state.goForward;
    });
    const goUp = useExplorerStore((state) => {
        return state.goUp;
    });
    const setFilter = useExplorerStore((state) => {
        return state.setFilter;
    });
    const setQuery = useExplorerStore((state) => {
        return state.setQuery;
    });
    const setSortBy = useExplorerStore((state) => {
        return state.setSortBy;
    });
    const toggleSortDirection = useExplorerStore((state) => {
        return state.toggleSortDirection;
    });
    const setViewMode = useExplorerStore((state) => {
        return state.setViewMode;
    });
    const createFolder = useExplorerStore((state) => {
        return state.createFolder;
    });
    const renameEntry = useExplorerStore((state) => {
        return state.renameEntry;
    });
    const trashEntry = useExplorerStore((state) => {
        return state.trashEntry;
    });
    const playEntry = useExplorerStore((state) => {
        return state.playEntry;
    });

    const [menu, setMenu] = useState<ContextMenuState | null>(null);
    const [creatingFolder, setCreatingFolder] = useState(false);
    const [renaming, setRenaming] = useState<ExplorerEntry | null>(null);
    const [trashing, setTrashing] = useState<ExplorerEntry | null>(null);
    const [trashError, setTrashError] = useState<{ directory: string; reason: ExplorerWriteFailure } | null>(null);

    const closeMenu = useCallback(() => {
        setMenu(null);
    }, []);

    const activeMenu = menu !== null && menu.directory === directory ? menu : null;
    const activeTrashError = trashError !== null && trashError.directory === directory ? trashError.reason : null;

    useEffect(() => {
        if (!loaded && !loading) {
            void open();
        }
    }, [loaded, loading, open]);

    const lastDownloadDirRef = useRef(downloadDir);
    useEffect(() => {
        if (lastDownloadDirRef.current === downloadDir) {
            return;
        }
        lastDownloadDirRef.current = downloadDir;
        if (loaded) {
            void open();
        }
    }, [downloadDir, loaded, open]);

    const visibleEntries = useMemo(() => {
        return filterAndSortEntries(entries, filter, query, sortBy, sortDirection);
    }, [entries, filter, query, sortBy, sortDirection]);

    const highlightedIndex = useMemo(() => {
        if (highlightedPath === null) {
            return -1;
        }
        return visibleEntries.findIndex((entry) => {
            return entry.path === highlightedPath;
        });
    }, [highlightedPath, visibleEntries]);

    const incrementalStep = highlightedIndex >= INCREMENTAL_STEP ? highlightedIndex + 1 : INCREMENTAL_STEP;

    const counts = useMemo(() => {
        return countEntries(visibleEntries);
    }, [visibleEntries]);

    const canBack = historyIndex > 0;
    const canForward = historyIndex >= 0 && historyIndex < historyLength - 1;

    function handleOpen(entry: ExplorerEntry): void {
        clearHighlight();
        setTrashError(null);
        if (entry.kind === 'directory') {
            void open(entry.path);
            return;
        }
        playEntry(entry);
    }

    function handleSendToConvert(entry: ExplorerEntry): void {
        openTools('convert');
        void useConvertStore.getState().addPaths([entry.path]);
    }

    function handleSendToCut(entry: ExplorerEntry): void {
        openTools('cut');
        void useCutStore.getState().openPath(entry.path);
    }

    function handleSendToMerge(entry: ExplorerEntry): void {
        openTools('merge');
        void useMergeStore.getState().addPaths([entry.path]);
    }

    async function confirmTrash(entry: ExplorerEntry): Promise<void> {
        setTrashing(null);
        setTrashError(null);
        const currentDir = directory;
        const response = await trashEntry(entry);
        if (!response.ok) {
            setTrashError({ directory: currentDir, reason: response.reason });
        }
    }

    function openItemMenu(event: MouseEvent<HTMLElement>, entry: ExplorerEntry): void {
        event.preventDefault();
        event.stopPropagation();
        setMenu({ x: event.clientX, y: event.clientY, entry, directory });
    }

    function openBackgroundMenu(event: MouseEvent<HTMLElement>): void {
        if (directory.length === 0) {
            return;
        }
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest('input, textarea, select, button, a, [role="dialog"], [role="menu"]') !== null) {
            return;
        }
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY, entry: null, directory });
    }

    function menuActionsFor(state: ContextMenuState): ContextMenuAction[] {
        const entry = state.entry;
        if (entry === null) {
            return [
                {
                    id: 'new-folder',
                    label: t('explorer.action.newFolder'),
                    onSelect: () => {
                        setTrashError(null);
                        setCreatingFolder(true);
                    }
                },
                {
                    id: 'open-folder',
                    label: t('explorer.menu.openFolder'),
                    onSelect: () => {
                        void window.api.explorer.openFolder(directory);
                    }
                },
                {
                    id: 'refresh',
                    label: t('explorer.refresh'),
                    onSelect: () => {
                        void refresh();
                    }
                }
            ];
        }
        const actions: ContextMenuAction[] = [
            {
                id: 'open',
                label: entry.kind === 'directory' ? t('explorer.action.open') : t('explorer.action.play'),
                onSelect: () => {
                    handleOpen(entry);
                }
            }
        ];
        if (entry.kind === 'video') {
            actions.push(
                {
                    id: 'convert',
                    label: t('explorer.menu.convert'),
                    onSelect: () => {
                        handleSendToConvert(entry);
                    }
                },
                {
                    id: 'merge',
                    label: t('explorer.menu.merge'),
                    onSelect: () => {
                        handleSendToMerge(entry);
                    }
                }
            );
        }
        if (entry.kind !== 'directory') {
            actions.push({
                id: 'cut',
                label: t('explorer.menu.cut'),
                onSelect: () => {
                    handleSendToCut(entry);
                }
            });
        }
        actions.push(
            {
                id: 'rename',
                label: t('explorer.action.rename'),
                onSelect: () => {
                    setTrashError(null);
                    setRenaming(entry);
                }
            },
            {
                id: 'show-in-folder',
                label: t('explorer.menu.showInFolder'),
                onSelect: () => {
                    void window.api.showItemInFolder(entry.path);
                }
            },
            {
                id: 'trash',
                label: t('explorer.action.trash'),
                danger: true,
                onSelect: () => {
                    setTrashError(null);
                    setTrashing(entry);
                }
            }
        );
        return actions;
    }

    const renameParts = renaming === null ? null : splitEntryName(renaming);

    return (
        <>
        <section className="explorer panel" aria-label={t('explorer.aria')} onContextMenu={openBackgroundMenu}>
            <div className="explorer__head">
                <p className="section-label">{t('explorer.title')}</p>
                <div className="explorer__roots" role="navigation" aria-label={t('explorer.roots.aria')}>
                    {roots.map((root) => {
                        const isCurrent = directory === root.path;
                        return (
                            <button
                                key={root.id}
                                type="button"
                                className={`btn btn--small${isCurrent ? ' btn--primary' : ''}`}
                                aria-current={isCurrent ? 'location' : undefined}
                                onClick={() => {
                                    void open(root.path);
                                }}
                            >
                                {rootDisplayLabel(root, t)}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="explorer__nav">
                <div className="explorer__nav-buttons">
                    <button
                        type="button"
                        className="btn btn--small"
                        disabled={!canBack}
                        aria-label={t('explorer.back')}
                        title={t('explorer.back')}
                        onClick={() => {
                            void goBack();
                        }}
                    >
                        ←
                    </button>
                    <button
                        type="button"
                        className="btn btn--small"
                        disabled={!canForward}
                        aria-label={t('explorer.forward')}
                        title={t('explorer.forward')}
                        onClick={() => {
                            void goForward();
                        }}
                    >
                        →
                    </button>
                    <button
                        type="button"
                        className="btn btn--small"
                        disabled={parent === null}
                        aria-label={t('explorer.up')}
                        title={t('explorer.up')}
                        onClick={() => {
                            void goUp();
                        }}
                    >
                        ↑
                    </button>
                    <button
                        type="button"
                        className="btn btn--small"
                        disabled={loading}
                        aria-label={t('explorer.refresh')}
                        title={t('explorer.refresh')}
                        onClick={() => {
                            void refresh();
                        }}
                    >
                        ↻
                    </button>
                </div>

                <nav className="explorer__breadcrumbs" aria-label={t('explorer.breadcrumbs.aria')}>
                    {breadcrumbs.map((crumb, index) => {
                        const isLast = index === breadcrumbs.length - 1;
                        return (
                            <span key={crumb.path} className="explorer__crumb">
                                {index > 0 && (
                                    <span className="explorer__crumb-sep" aria-hidden="true">
                                        /
                                    </span>
                                )}
                                <button
                                    type="button"
                                    className={`explorer__crumb-btn${isLast ? ' explorer__crumb-btn--current' : ''}`}
                                    aria-current={isLast ? 'location' : undefined}
                                    onClick={() => {
                                        void open(crumb.path);
                                    }}
                                >
                                    {crumb.name}
                                </button>
                            </span>
                        );
                    })}
                </nav>
            </div>

            <div className="explorer__toolbar">
                <div className="explorer__filters" role="group" aria-label={t('explorer.filter.aria')}>
                    {FILTERS.map((kind) => {
                        return (
                            <button
                                key={kind}
                                type="button"
                                className={`btn btn--small${filter === kind ? ' btn--primary' : ''}`}
                                aria-pressed={filter === kind}
                                onClick={() => {
                                    setFilter(kind);
                                }}
                            >
                                {t(`explorer.filter.${kind}`)}
                            </button>
                        );
                    })}
                </div>

                <input
                    className="input explorer__search"
                    type="search"
                    aria-label={t('explorer.search')}
                    placeholder={t('explorer.search.placeholder')}
                    value={query}
                    data-search-field=""
                    onChange={(event) => {
                        setQuery(event.target.value);
                    }}
                />

                <div className="explorer__sort">
                    <SelectField<ExplorerSortBy>
                        label={t('explorer.sort')}
                        value={sortBy}
                        options={SORT_OPTIONS}
                        formatOption={(option) => {
                            return t(`explorer.sort.${option}`);
                        }}
                        onChange={setSortBy}
                    />
                    <button
                        type="button"
                        className="btn btn--small explorer__dir-btn"
                        aria-label={t(sortDirection === 'asc' ? 'explorer.sort.asc' : 'explorer.sort.desc')}
                        title={t(sortDirection === 'asc' ? 'explorer.sort.asc' : 'explorer.sort.desc')}
                        onClick={toggleSortDirection}
                    >
                        {sortDirection === 'asc' ? '↑' : '↓'}
                    </button>
                </div>

                <div className="explorer__view-toggle" role="group" aria-label={`${t('explorer.view.grid')} / ${t('explorer.view.list')}`}>
                    <button
                        type="button"
                        className={`btn btn--small${viewMode === 'grid' ? ' btn--primary' : ''}`}
                        aria-pressed={viewMode === 'grid'}
                        onClick={() => {
                            setViewMode('grid');
                        }}
                    >
                        {t('explorer.view.grid')}
                    </button>
                    <button
                        type="button"
                        className={`btn btn--small${viewMode === 'list' ? ' btn--primary' : ''}`}
                        aria-pressed={viewMode === 'list'}
                        onClick={() => {
                            setViewMode('list');
                        }}
                    >
                        {t('explorer.view.list')}
                    </button>
                </div>
            </div>

            {error !== null && (
                <p className="field__warning" role="alert">
                    {t(LIST_ERROR_KEYS[error])}
                </p>
            )}
            {activeTrashError !== null && (
                <p className="field__warning" role="alert">
                    {t(WRITE_ERROR_KEYS[activeTrashError])}
                </p>
            )}

            {loading && <LoadingMark label={t('explorer.loading')} />}

            {!loading && error === null && (
                <>
                    <div className="explorer__summary">
                        <p className="history__meta">{t('explorer.count', counts)}</p>
                        {directory.length > 0 && (
                            <button
                                type="button"
                                className="btn btn--small"
                                onClick={() => {
                                    void window.api.explorer.openFolder(directory);
                                }}
                            >
                                {t('explorer.openFolder')}
                            </button>
                        )}
                    </div>
                    {entries.length === 0 ? (
                        <p className="empty">{t('explorer.empty')}</p>
                    ) : visibleEntries.length === 0 ? (
                        <p className="empty">{t('explorer.noMatch')}</p>
                    ) : (
                        <ul className={`explorer__entries explorer__entries--${viewMode}`} data-testid="explorer-entries">
                            <IncrementalItems
                                items={visibleEntries}
                                listKey={`${directory}|${filter}|${query}|${sortBy}|${sortDirection}|${String(incrementalStep)}`}
                                end="li"
                                step={incrementalStep}
                                renderItem={(entry) => {
                                    return (
                                        <ExplorerItem
                                            key={entry.path}
                                            entry={entry}
                                            language={language}
                                            highlighted={highlightedPath === entry.path}
                                            onOpen={handleOpen}
                                            onContextMenu={openItemMenu}
                                            onSendToConvert={handleSendToConvert}
                                            onSendToCut={handleSendToCut}
                                            onSendToMerge={handleSendToMerge}
                                        />
                                    );
                                }}
                            />
                        </ul>
                    )}
                </>
            )}

        </section>

            {activeMenu !== null && <ExplorerContextMenu x={activeMenu.x} y={activeMenu.y} actions={menuActionsFor(activeMenu)} onClose={closeMenu} />}

            {creatingFolder && (
                <NameDialog
                    title={t('explorer.newFolder.title')}
                    label={t('explorer.newFolder.label')}
                    initialValue=""
                    suffix=""
                    placeholder={t('explorer.newFolder.placeholder')}
                    confirmLabel={t('explorer.newFolder.confirm')}
                    onSubmit={async (name) => {
                        const response = await createFolder(name);
                        return response.ok ? null : response.reason;
                    }}
                    onCancel={() => {
                        setCreatingFolder(false);
                    }}
                />
            )}

            {renaming !== null && renameParts !== null && (
                <NameDialog
                    title={t('explorer.rename.title')}
                    label={t('explorer.rename.label')}
                    initialValue={renameParts.stem}
                    suffix={renameParts.extension}
                    confirmLabel={t('explorer.rename.confirm')}
                    onSubmit={async (fullName) => {
                        const response = await renameEntry(renaming, fullName);
                        return response.ok ? null : response.reason;
                    }}
                    onCancel={() => {
                        setRenaming(null);
                    }}
                />
            )}

            {trashing !== null && (
                <ConfirmDialog
                    title={t('explorer.trash.title')}
                    message={t('explorer.trash.message', { name: trashing.name })}
                    confirmLabel={t('explorer.trash.confirm')}
                    cancelLabel={t('explorer.dialog.cancel')}
                    onConfirm={() => {
                        void confirmTrash(trashing);
                    }}
                    onCancel={() => {
                        setTrashing(null);
                    }}
                />
            )}

            <ExplorerMediaPlayer />
        </>
    );
}
