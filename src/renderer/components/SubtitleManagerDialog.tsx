import { useModalDialog } from '../hooks/useModalDialog';
import { useTranslator } from '../i18n/useTranslator';
import { ConfirmButton } from './ConfirmButton';
import type { SubtitleManagerSetting } from './PlayerSettings';

interface SubtitleManagerDialogProps {
    manager: SubtitleManagerSetting;
    onClose: () => void;
}

export function SubtitleManagerDialog({ manager, onClose }: SubtitleManagerDialogProps) {
    const t = useTranslator();
    const { dialogRef, handleKeyDown } = useModalDialog(onClose, true);
    const translatedSubtitles = manager.translatedSubtitles ?? [];

    return (
        <div className="modal-backdrop">
            <div
                ref={dialogRef}
                className="modal modal--wide player__manager"
                role="dialog"
                aria-modal="true"
                aria-labelledby="manage-subtitles-title"
                onKeyDown={(event) => {
                    handleKeyDown(event);
                    event.stopPropagation();
                }}
            >
                <h2 id="manage-subtitles-title" className="modal__title">
                    {t('anime.player.manageSubtitles.title')}
                </h2>
                {manager.failure !== null && (
                    <p className="field__warning" role="alert">
                        {manager.failure}
                    </p>
                )}
                {translatedSubtitles.length > 0 && manager.onDeleteTranslated !== undefined && (
                    <div className="field">
                        <span className="field__label">{t('anime.player.manageSubtitles.translated')}</span>
                        {translatedSubtitles.map((track) => {
                            return (
                                <div key={track.id} className="player__setting">
                                    <span className="player__setting-label">{track.label}</span>
                                    <ConfirmButton
                                        className="btn btn--small btn--ghost"
                                        ariaLabel={`${t('anime.player.deleteSubtitle')} ${track.label}`}
                                        dialog={{
                                            title: t('anime.player.deleteSubtitle.title'),
                                            message: t('anime.player.deleteSubtitle.message', { label: track.label }),
                                            confirmLabel: t('anime.player.deleteSubtitle.confirm')
                                        }}
                                        onConfirm={() => {
                                            manager.onDeleteTranslated?.(track.id);
                                        }}
                                    >
                                        {t('anime.player.deleteSubtitle')}
                                    </ConfirmButton>
                                </div>
                            );
                        })}
                    </div>
                )}
                <div className="modal__actions">
                    <button type="button" className="btn btn--small" onClick={manager.onLoad}>
                        {t('anime.player.loadSubtitle')}
                    </button>
                    {manager.loaded && (
                        <button type="button" className="btn btn--small" onClick={manager.onCreate}>
                            {manager.hasSubtitles ? t('anime.player.translate') : t('anime.player.generate')}
                        </button>
                    )}
                    <button type="button" className="btn btn--small" disabled={manager.checking} onClick={manager.onCheck}>
                        {manager.checking ? t('anime.player.checkingSubtitles') : t('anime.player.checkSubtitles')}
                    </button>
                    <button type="button" className="btn btn--small btn--ghost" onClick={onClose}>
                        {t('anime.player.manageSubtitles.close')}
                    </button>
                </div>
            </div>
        </div>
    );
}
