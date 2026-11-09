import type { SubtitleStyle } from '../hooks/useSubtitleStyle';
import { useTranslator } from '../i18n/useTranslator';
import { MAX_SUBTITLE_SCALE, MIN_SUBTITLE_SCALE, scalePercent } from './subtitleScale';

interface SubtitleSizeControlProps {
    subtitleStyle: SubtitleStyle;
    // How the buttons, the percent and the group look: the gear of the player and the window of the subtitles each have their own.
    groupClassName: string;
    buttonClassName: string;
    valueClassName: string;
}

// The two buttons that make the subtitles smaller and bigger, with the percent they are at.
export function SubtitleSizeControl({ subtitleStyle, groupClassName, buttonClassName, valueClassName }: SubtitleSizeControlProps) {
    const t = useTranslator();
    return (
        <span className={groupClassName} role="group" aria-label={t('anime.player.subtitleSize')}>
            <button
                type="button"
                className={buttonClassName}
                aria-label={t('anime.player.subtitleSmaller')}
                disabled={subtitleStyle.scale <= MIN_SUBTITLE_SCALE}
                onClick={() => {
                    subtitleStyle.resize(-1);
                }}
            >
                A−
            </button>
            <span className={valueClassName}>{scalePercent(subtitleStyle.scale)}</span>
            <button
                type="button"
                className={buttonClassName}
                aria-label={t('anime.player.subtitleLarger')}
                disabled={subtitleStyle.scale >= MAX_SUBTITLE_SCALE}
                onClick={() => {
                    subtitleStyle.resize(1);
                }}
            >
                A+
            </button>
        </span>
    );
}
