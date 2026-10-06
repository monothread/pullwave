import { useEffect, useRef, type ReactNode } from 'react';
import type { SubtitleStyle } from '../hooks/useSubtitleStyle';
import { useTranslator } from '../i18n/useTranslator';
import { MAX_SUBTITLE_SCALE, MIN_SUBTITLE_SCALE, scalePercent } from './subtitleScale';

// A subtitle the viewer can choose. The id is also the id of its <track>, which is how the control finds it.
export interface SubtitleOption {
    id: string;
    label: string;
}

export const SUBTITLES_OFF = 'off';

interface PlayerSettingsProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    subtitles: readonly SubtitleOption[];
    // The id of the subtitle being shown; null when they are off.
    selectedSubtitle: string | null;
    onSelectSubtitle: (id: string | null) => void;
    subtitleStyle: SubtitleStyle;
}

interface SettingRowProps {
    label: string;
    children: ReactNode;
}

function SettingRow({ label, children }: SettingRowProps) {
    return (
        <div className="player__setting">
            <span className="player__setting-label">{label}</span>
            {children}
        </div>
    );
}

// Whether the player has anything to set. The gear only shows up when it does, so a setting added later only has to be added here.
export function hasPlayerSettings(subtitles: readonly SubtitleOption[]): boolean {
    return subtitles.length > 0;
}

// The gear of the player and the panel it opens with every setting that is not on the bar (the sound stays there).
export function PlayerSettings({ open, onOpenChange, subtitles, selectedSubtitle, onSelectSubtitle, subtitleStyle }: PlayerSettingsProps) {
    const t = useTranslator();
    const root = useRef<HTMLSpanElement>(null);

    // The panel closes with Escape (before the browser leaves fullscreen with it) and with a click anywhere else.
    useEffect(() => {
        if (!open) {
            return undefined;
        }
        const onKeyDown = (event: globalThis.KeyboardEvent): void => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                onOpenChange(false);
            }
        };
        const onMouseDown = (event: MouseEvent): void => {
            if (event.target instanceof Node && !root.current?.contains(event.target)) {
                onOpenChange(false);
            }
        };
        document.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('mousedown', onMouseDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown, true);
            document.removeEventListener('mousedown', onMouseDown);
        };
    }, [open, onOpenChange]);

    return (
        <span ref={root}>
            <button
                type="button"
                className="player__button"
                aria-label={t('anime.player.settings')}
                aria-haspopup="dialog"
                aria-expanded={open}
                onClick={() => {
                    onOpenChange(!open);
                }}
            >
                ⚙
            </button>
            {open && (
                <div
                    className="player__settings"
                    role="dialog"
                    aria-label={t('anime.player.settings')}
                    onKeyDown={(event) => {
                        // The arrows move around the panel, they do not seek the video.
                        event.stopPropagation();
                    }}
                >
                    <SettingRow label={t('anime.player.subtitles')}>
                        <select
                            className="player__select"
                            aria-label={t('anime.player.subtitles')}
                            value={selectedSubtitle ?? SUBTITLES_OFF}
                            onChange={(event) => {
                                onSelectSubtitle(event.target.value === SUBTITLES_OFF ? null : event.target.value);
                            }}
                        >
                            <option value={SUBTITLES_OFF}>{t('anime.player.subtitlesOff')}</option>
                            {subtitles.map((option) => {
                                return (
                                    <option key={option.id} value={option.id}>
                                        {option.label}
                                    </option>
                                );
                            })}
                        </select>
                    </SettingRow>
                    <SettingRow label={t('anime.player.subtitleSize')}>
                        <span className="player__size" role="group" aria-label={t('anime.player.subtitleSize')}>
                            <button
                                type="button"
                                className="player__button"
                                aria-label={t('anime.player.subtitleSmaller')}
                                disabled={subtitleStyle.scale <= MIN_SUBTITLE_SCALE}
                                onClick={() => {
                                    subtitleStyle.resize(-1);
                                }}
                            >
                                A−
                            </button>
                            <span className="player__time">{scalePercent(subtitleStyle.scale)}</span>
                            <button
                                type="button"
                                className="player__button"
                                aria-label={t('anime.player.subtitleLarger')}
                                disabled={subtitleStyle.scale >= MAX_SUBTITLE_SCALE}
                                onClick={() => {
                                    subtitleStyle.resize(1);
                                }}
                            >
                                A+
                            </button>
                        </span>
                    </SettingRow>
                </div>
            )}
        </span>
    );
}
