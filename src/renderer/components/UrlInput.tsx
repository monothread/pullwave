import { useRef, useState, type FormEvent } from 'react';
import { useTranslator } from '../i18n/useTranslator';
import type { DownloadOptions } from '@shared/types';
import { useAppStore } from '../store/appStore';
import { DownloadOptionsDialog } from './DownloadOptionsDialog';
import { hasOptions } from './downloadOptions';
import { SwitchInput } from './fields';

interface LinkRow {
    id: number;
    value: string;
    error: string | null;
    // Folder chosen for this link only; null uses the folder from the settings.
    directory: string | null;
    // Settings chosen for this link only.
    options: DownloadOptions;
}

function createRow(id: number): LinkRow {
    return { id, value: '', error: null, directory: null, options: {} };
}

export function UrlInput() {
    const t = useTranslator();
    const nextId = useRef(1);
    const [rows, setRows] = useState<LinkRow[]>([createRow(0)]);
    const [focusId, setFocusId] = useState<number | null>(null);
    const [optionsRowId, setOptionsRowId] = useState<number | null>(null);
    const addUrls = useAppStore((state) => {
        return state.addUrls;
    });
    const settings = useAppStore((state) => {
        return state.settings;
    });
    const saveSettings = useAppStore((state) => {
        return state.saveSettings;
    });
    const chooseDirectory = useAppStore((state) => {
        return state.chooseDirectory;
    });

    function newRow(): LinkRow {
        const row = createRow(nextId.current);
        nextId.current += 1;
        return row;
    }

    function updateRow(id: number, value: string): void {
        setRows((previous) => {
            return previous.map((row) => {
                return row.id === id ? { ...row, value, error: null } : row;
            });
        });
    }

    function setRowDirectory(id: number, directory: string | null): void {
        setRows((previous) => {
            return previous.map((row) => {
                return row.id === id ? { ...row, directory } : row;
            });
        });
    }

    async function chooseRowDirectory(id: number): Promise<void> {
        const directory = await chooseDirectory();
        if (directory) {
            setRowDirectory(id, directory);
        }
    }

    function setRowOptions(id: number, options: DownloadOptions): void {
        setRows((previous) => {
            return previous.map((row) => {
                return row.id === id ? { ...row, options } : row;
            });
        });
    }

    function addRow(): void {
        const row = newRow();
        setRows((previous) => {
            return [...previous, row];
        });
        setFocusId(row.id);
    }

    function removeRow(id: number): void {
        setRows((previous) => {
            return previous.filter((row) => {
                return row.id !== id;
            });
        });
    }

    async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        const filled = rows.filter((row) => {
            return row.value.trim().length > 0;
        });
        if (filled.length === 0) {
            setRows((previous) => {
                return previous.map((row, index) => {
                    return index === 0 ? { ...row, error: t('url.empty') } : row;
                });
            });
            return;
        }
        const results = await addUrls(
            filled.map((row) => {
                return { url: row.value.trim(), downloadDir: row.directory, options: row.options };
            })
        );
        const failed = filled.flatMap((row, index) => {
            const result = results[index];
            return result && !result.ok ? [{ ...row, error: result.message ?? t('url.addFailed') }] : [];
        });
        setRows(failed.length > 0 ? failed : [newRow()]);
    }

    const optionsRow = rows.find((row) => {
        return row.id === optionsRowId;
    });

    return (
        <form
            className="url-input"
            onSubmit={(event) => {
                void handleSubmit(event);
            }}
        >
            <span className="section-label">{t('url.targetLinks')}</span>
            <div className="link-rows">
                {rows.map((row, index) => {
                    return (
                        <div key={row.id} className="link-row">
                            <div className="link-row__line">
                                <input
                                    className={`input link-row__input ${row.error ? 'input--invalid' : ''}`}
                                    type="text"
                                    inputMode="url"
                                    spellCheck={false}
                                    autoComplete="off"
                                    autoFocus={row.id === focusId}
                                    aria-label={t('url.link', { n: index + 1 })}
                                    aria-invalid={row.error !== null}
                                    placeholder="https://..."
                                    title={row.value}
                                    value={row.value}
                                    onChange={(event) => {
                                        updateRow(row.id, event.target.value);
                                    }}
                                />
                                <button
                                    type="button"
                                    className={`btn btn--small ${row.directory ? 'btn--hot' : 'btn--ghost'}`}
                                    aria-label={t('url.chooseFolder', { n: index + 1 })}
                                    title={row.directory ?? t('url.folderTitle')}
                                    onClick={() => {
                                        void chooseRowDirectory(row.id);
                                    }}
                                >
                                    {t('url.folder')}
                                </button>
                                <button
                                    type="button"
                                    className={`btn btn--small ${hasOptions(row.options) ? 'btn--hot' : 'btn--ghost'}`}
                                    aria-label={t('options.buttonAria', { n: index + 1 })}
                                    aria-haspopup="dialog"
                                    onClick={() => {
                                        setOptionsRowId(row.id);
                                    }}
                                >
                                    {t('options.button')}
                                </button>
                                {rows.length > 1 && (
                                    <button
                                        type="button"
                                        className="btn btn--small btn--ghost"
                                        aria-label={t('url.removeLink', { n: index + 1 })}
                                        onClick={() => {
                                            removeRow(row.id);
                                        }}
                                    >
                                        ✕
                                    </button>
                                )}
                            </div>
                            {row.directory && (
                                <p className="link-row__folder">
                                    <span title={row.directory}>{t('url.savingTo', { directory: row.directory })}</span>
                                    <button
                                        type="button"
                                        className="btn btn--small btn--ghost"
                                        aria-label={t('url.defaultFolder', { n: index + 1 })}
                                        onClick={() => {
                                            setRowDirectory(row.id, null);
                                        }}
                                    >
                                        ✕
                                    </button>
                                </p>
                            )}
                            {row.error && (
                                <p className="link-row__error" role="alert">
                                    {row.error}
                                </p>
                            )}
                        </div>
                    );
                })}
            </div>
            <div className="url-input__row">
                <SwitchInput
                    label={t('url.audioOnly')}
                    checked={settings.audioOnly}
                    onChange={(audioOnly) => {
                        void saveSettings({ ...settings, audioOnly });
                    }}
                />
                <div className="url-input__buttons">
                    <button type="button" className="btn" onClick={addRow}>
                        {t('url.addLink')}
                    </button>
                    <button type="submit" className="btn btn--primary">
                        {t('url.download')}
                    </button>
                </div>
            </div>
            {optionsRow && (
                <DownloadOptionsDialog
                    linkNumber={rows.indexOf(optionsRow) + 1}
                    options={optionsRow.options}
                    settings={settings}
                    onApply={(options) => {
                        setRowOptions(optionsRow.id, options);
                        setOptionsRowId(null);
                    }}
                    onClose={() => {
                        setOptionsRowId(null);
                    }}
                />
            )}
        </form>
    );
}
