import { useEffect, useRef } from 'react';
import type { CutPreviewFailure } from '@shared/cut';
import type { MessageKey } from '@shared/i18n';
import { useTranslator } from '../i18n/useTranslator';
import { useCutStore, type CutPreviewState } from '../store/cutStore';
import { formatClock } from './cutText';
import { LoadingMark } from './LoadingMark';
import { VideoControls } from './VideoControls';

export const PREVIEW_FAILURE_KEYS: Record<Exclude<CutPreviewFailure, 'cancelled'>, MessageKey> = {
    'no-file': 'cut.preview.error.no-file',
    invalid: 'cut.preview.error.invalid',
    'no-ffmpeg': 'cut.preview.error.no-ffmpeg',
    failed: 'cut.preview.error.failed'
};

// The player has no subtitles to offer for a part being seen before it is cut.
const NO_SUBTITLES: readonly never[] = [];

function ignoreSubtitle(): void {
    return undefined;
}

interface PreviewStageProps {
    preview: CutPreviewState;
    // The picture of the file: shown while an audio plays.
    poster: string | undefined;
}

// What the player shows: the part playing, the part being made into a file the player plays, or why it cannot be played.
function PreviewStage({ preview, poster }: PreviewStageProps) {
    const t = useTranslator();
    const convertPreview = useCutStore((state) => {
        return state.convertPreview;
    });
    const video = useRef<HTMLVideoElement | null>(null);
    if (preview.status === 'failed') {
        const key = preview.error === null || preview.error === 'cancelled' ? 'cut.preview.error.failed' : PREVIEW_FAILURE_KEYS[preview.error];
        return (
            <p className="field__warning" role="alert">
                {t(key)}
            </p>
        );
    }
    if (preview.status !== 'ready' || preview.url === null) {
        return (
            <div className="cut-preview__wait">
                <LoadingMark label={t(preview.status === 'converting' ? 'cut.preview.converting' : 'cut.preview.loading')} />
            </div>
        );
    }
    return (
        <div className="player__stage">
            <video
                key={preview.url}
                ref={video}
                className="player__video"
                src={preview.url}
                poster={poster}
                autoPlay
                data-testid="cut-preview-video"
                onError={() => {
                    void convertPreview();
                }}
            />
            <VideoControls video={video} subtitles={NO_SUBTITLES} selectedSubtitle={null} onSelectSubtitle={ignoreSubtitle} range={{ start: preview.start, end: preview.end }} />
        </div>
    );
}

// The player of the app on one part of the file being cut, to see that the part is the right one before it is saved (D-131). Only that part
// plays, from its start to its end, as if it were the whole file.
export function CutPreviewPlayer() {
    const t = useTranslator();
    const preview = useCutStore((state) => {
        return state.preview;
    });
    const thumbnail = useCutStore((state) => {
        return state.thumbnail;
    });
    const closePreview = useCutStore((state) => {
        return state.closePreview;
    });
    const open = preview !== null;

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                closePreview();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [open, closePreview]);

    if (preview === null) {
        return null;
    }
    const title = t('cut.preview.title', { number: preview.number, start: formatClock(preview.segment.start), end: formatClock(preview.segment.end) });
    const poster = thumbnail?.status === 'ready' ? thumbnail.url : undefined;
    return (
        <div className="player cut-preview" role="dialog" aria-modal="true" aria-label={title}>
            <div className="player__box">
                <header className="job__head">
                    <h2 className="player__title">{title}</h2>
                    <span className="anime__actions">
                        {preview.converted && <span className="badge badge--waiting">{t('cut.preview.convertedBadge')}</span>}
                        <button type="button" className="btn btn--small btn--hot" autoFocus onClick={closePreview}>
                            {t('cut.preview.close')}
                        </button>
                    </span>
                </header>
                <PreviewStage preview={preview} poster={poster} />
            </div>
        </div>
    );
}
