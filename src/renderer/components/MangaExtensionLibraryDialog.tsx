import { useId } from 'react';
import { createPortal } from 'react-dom';
import type { LibraryManga } from '@shared/manga';
import { useTranslator } from '../i18n/useTranslator';
import { useModalDialog } from '../hooks/useModalDialog';
import { MangaEntryCard } from './MangaLibrary';

interface MangaExtensionLibraryDialogProps {
    extensionName: string;
    mangas: readonly LibraryManga[];
    onOpen: (mangaId: number) => void;
    onClose: () => void;
}

export function MangaExtensionLibraryDialog({ extensionName, mangas, onOpen, onClose }: MangaExtensionLibraryDialogProps) {
    const t = useTranslator();
    const titleId = useId();
    const { dialogRef, handleKeyDown } = useModalDialog(onClose, true);

    return createPortal(
        <div
            className="modal-backdrop"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                    onClose();
                }
            }}
            onClick={(event) => {
                event.stopPropagation();
            }}
        >
            <div ref={dialogRef} className="modal modal--library" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={handleKeyDown}>
                <h2 id={titleId} className="modal__title">
                    {t('manga.ext.library.title', { name: extensionName })}
                </h2>
                <ul className="cover-grid modal__grid" data-testid="manga-extension-library">
                    {mangas.map((manga) => {
                        return (
                            <MangaEntryCard
                                key={manga.id}
                                manga={manga}
                                onOpen={() => {
                                    onOpen(manga.id);
                                }}
                            />
                        );
                    })}
                </ul>
                <div className="modal__actions">
                    <button type="button" className="btn btn--small btn--ghost" onClick={onClose}>
                        {t('manga.ext.library.close')}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}
