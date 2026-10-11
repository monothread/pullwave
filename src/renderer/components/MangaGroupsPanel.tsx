import { useState } from 'react';
import { MAX_GROUP_NAME_LENGTH } from '@shared/manga';
import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';
import { TextField } from './fields';

// Where the groups of the library are made, renamed and deleted (the mangas in a deleted group stay in the library).
export function MangaGroupsPanel() {
    const t = useTranslator();
    const groups = useMangaStore((state) => {
        return state.groups;
    });
    const createGroup = useMangaStore((state) => {
        return state.createGroup;
    });
    const renameGroup = useMangaStore((state) => {
        return state.renameGroup;
    });
    const deleteGroup = useMangaStore((state) => {
        return state.deleteGroup;
    });
    const [name, setName] = useState('');
    const [problem, setProblem] = useState<string | null>(null);
    const [editing, setEditing] = useState<number | null>(null);
    const [editedName, setEditedName] = useState('');
    const [confirming, setConfirming] = useState<number | null>(null);

    function problemOf(reason: 'invalid' | 'taken' | 'not-found'): string {
        return reason === 'taken' ? t('manga.groups.error.taken') : t('manga.groups.error.invalid');
    }

    async function handleCreate(): Promise<void> {
        const response = await createGroup(name);
        if (response.ok) {
            setName('');
            setProblem(null);
        } else {
            setProblem(problemOf(response.reason));
        }
    }

    async function handleRename(groupId: number): Promise<void> {
        const response = await renameGroup(groupId, editedName);
        if (response.ok) {
            setEditing(null);
            setProblem(null);
        } else {
            setProblem(problemOf(response.reason));
        }
    }

    return (
        <fieldset className="panel manga__groups">
            <legend>{t('manga.groups.title')}</legend>
            <p className="field__hint">{t('manga.groups.hint')}</p>
            {groups.length === 0 && <p className="empty">{t('manga.groups.empty')}</p>}
            <ul className="history__list">
                {groups.map((group) => {
                    return (
                        <li key={group.id} className="history__item" data-testid="manga-group">
                            {editing === group.id ? (
                                <>
                                    <TextField
                                        label={t('manga.groups.name')}
                                        value={editedName}
                                        onChange={(value) => {
                                            setEditedName(value.slice(0, MAX_GROUP_NAME_LENGTH));
                                        }}
                                    />
                                    <span className="anime__actions">
                                        <button
                                            type="button"
                                            className="btn btn--small btn--primary"
                                            onClick={() => {
                                                void handleRename(group.id);
                                            }}
                                        >
                                            {t('manga.groups.save')}
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn--small btn--ghost"
                                            onClick={() => {
                                                setEditing(null);
                                                setProblem(null);
                                            }}
                                        >
                                            {t('manga.groups.cancel')}
                                        </button>
                                    </span>
                                </>
                            ) : (
                                <>
                                    <div className="history__main">
                                        <span className="history__title">{group.name}</span>
                                    </div>
                                    <span className="anime__actions">
                                        <button
                                            type="button"
                                            className="btn btn--small"
                                            aria-label={`${t('manga.groups.rename')}: ${group.name}`}
                                            onClick={() => {
                                                setEditing(group.id);
                                                setEditedName(group.name);
                                                setConfirming(null);
                                                setProblem(null);
                                            }}
                                        >
                                            {t('manga.groups.rename')}
                                        </button>
                                        {confirming === group.id ? (
                                            <>
                                                <button
                                                    type="button"
                                                    className="btn btn--small btn--hot"
                                                    aria-label={`${t('manga.groups.confirmDelete')}: ${group.name}`}
                                                    onClick={() => {
                                                        setConfirming(null);
                                                        void deleteGroup(group.id);
                                                    }}
                                                >
                                                    {t('manga.groups.confirmDelete')}
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn btn--small btn--ghost"
                                                    onClick={() => {
                                                        setConfirming(null);
                                                    }}
                                                >
                                                    {t('manga.groups.keep')}
                                                </button>
                                            </>
                                        ) : (
                                            <button
                                                type="button"
                                                className="btn btn--small btn--hot"
                                                aria-label={`${t('manga.groups.delete')}: ${group.name}`}
                                                onClick={() => {
                                                    setConfirming(group.id);
                                                }}
                                            >
                                                {t('manga.groups.delete')}
                                            </button>
                                        )}
                                    </span>
                                </>
                            )}
                        </li>
                    );
                })}
            </ul>
            <form
                className="field-row"
                onSubmit={(event) => {
                    event.preventDefault();
                    void handleCreate();
                }}
            >
                <TextField
                    label={t('manga.groups.name')}
                    value={name}
                    onChange={(value) => {
                        setName(value.slice(0, MAX_GROUP_NAME_LENGTH));
                    }}
                />
                <button type="submit" className="btn btn--primary" disabled={name.trim().length === 0}>
                    {t('manga.groups.create')}
                </button>
            </form>
            {problem !== null && (
                <p className="field__warning" role="alert">
                    {problem}
                </p>
            )}
        </fieldset>
    );
}
