import { useModalDialog } from '../hooks/useModalDialog';
import { useTranslator } from '../i18n/useTranslator';
import type { SubtitleManagerSetting } from './PlayerSettings';

interface SubtitleManagerDialogProps {
    manager: SubtitleManagerSetting;
    onClose: () => void;
}

// The window of the ways to get more subtitles for the episode, opened from the gear of the player: load a file, translate one or create
// it from the audio, and look for the ones the source has. Which subtitle is shown and how big stay in the gear.
export function SubtitleManagerDialog({ manager, onClose }: SubtitleManagerDialogProps) {
    const t = useTranslator();
    const { dialogRef, handleKeyDown } = useModalDialog(onClose, true);

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
                    // The keys are for the window: they do not pause, seek or change the volume of the video behind it.
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
