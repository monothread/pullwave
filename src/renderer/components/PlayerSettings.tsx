import { useEffect, useRef, type ReactNode } from 'react';
import type { SubtitleStyle } from '../hooks/useSubtitleStyle';
import { useTranslator } from '../i18n/useTranslator';
import { PlayerIcon } from './PlayerIcon';
import { SubtitleSizeControl } from './SubtitleSizeControl';

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
    // The switch of the next episode that starts by itself; left out, the player has none (the stream of the search has no next episode).
    autoNext?: AutoNextSetting;
    // Opens the window of the subtitles; left out, the settings have no way into it (the stream of the search has no files to manage).
    onManageSubtitles?: () => void;
}

// Whether the next episode starts by itself at the end of one, and the way to change it.
export interface AutoNextSetting {
    enabled: boolean;
    onToggle: () => void;
}

// What the window of the subtitles needs from the screen that has the subtitles of an episode: what it can do about them, and what it
// says went wrong. The window is opened from the gear of the player.
export interface SubtitleManagerSetting {
    // Whether the list of the subtitles of the episode has arrived: until then it is not known whether it has any, so nothing is offered to
    // translate or to create.
    loaded: boolean;
    // The episode has a subtitle to translate; otherwise the way to get one is to create it from the audio.
    hasSubtitles: boolean;
    // The check for the subtitles the source offers is going on.
    checking: boolean;
    // Why a subtitle could not be loaded, when it could not.
    failure: string | null;
    onLoad: () => void;
    // Opens the translation of a subtitle, or the creation of one when the episode has none.
    onCreate: () => void;
    onCheck: () => void;
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
export function hasPlayerSettings(subtitles: readonly SubtitleOption[], autoNext?: AutoNextSetting, subtitleManager?: SubtitleManagerSetting): boolean {
    return subtitles.length > 0 || autoNext !== undefined || subtitleManager !== undefined;
}

// The gear of the player and the panel it opens with every setting that is not on the bar (the sound stays there).
export function PlayerSettings({ open, onOpenChange, subtitles, selectedSubtitle, onSelectSubtitle, subtitleStyle, autoNext, onManageSubtitles }: PlayerSettingsProps) {
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
                <PlayerIcon name="settings" />
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
                    {autoNext !== undefined && (
                        <SettingRow label={t('anime.player.autoNext.setting')}>
                            <input
                                type="checkbox"
                                role="switch"
                                className="player__switch"
                                aria-label={t('anime.player.autoNext.setting')}
                                checked={autoNext.enabled}
                                onChange={autoNext.onToggle}
                            />
                        </SettingRow>
                    )}
                    {subtitles.length > 0 && (
                        <>
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
                                <SubtitleSizeControl subtitleStyle={subtitleStyle} groupClassName="player__size" buttonClassName="player__button" valueClassName="player__time" />
                            </SettingRow>
                        </>
                    )}
                    {onManageSubtitles !== undefined && (
                        <div className="player__setting">
                            <button
                                type="button"
                                className="btn btn--small"
                                onClick={() => {
                                    onOpenChange(false);
                                    onManageSubtitles();
                                }}
                            >
                                {t('anime.player.manageSubtitles')}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </span>
    );
}
