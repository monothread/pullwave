import { useEffect, useRef, type ReactNode } from 'react';
import type { SubtitleStyle } from '../hooks/useSubtitleStyle';
import { useTranslator } from '../i18n/useTranslator';
import { PlayerIcon } from './PlayerIcon';
import { SubtitleSizeControl } from './SubtitleSizeControl';

export interface SubtitleOption {
    id: string;
    label: string;
}

export const SUBTITLES_OFF = 'off';

interface PlayerSettingsProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    subtitles: readonly SubtitleOption[];
    selectedSubtitle: string | null;
    onSelectSubtitle: (id: string | null) => void;
    subtitleStyle: SubtitleStyle;
    autoNext?: AutoNextSetting;
    onManageSubtitles?: () => void;
}

export interface AutoNextSetting {
    enabled: boolean;
    onToggle: () => void;
}

export interface SubtitleManagerSetting {
    loaded: boolean;
    hasSubtitles: boolean;
    checking: boolean;
    failure: string | null;
    translatedSubtitles?: readonly SubtitleOption[];
    onLoad: () => void;
    onCreate: () => void;
    onCheck: () => void;
    onDeleteTranslated?: (trackId: string) => void;
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

export function hasPlayerSettings(subtitles: readonly SubtitleOption[], autoNext?: AutoNextSetting, subtitleManager?: SubtitleManagerSetting): boolean {
    return subtitles.length > 0 || autoNext !== undefined || subtitleManager !== undefined;
}

export function PlayerSettings({ open, onOpenChange, subtitles, selectedSubtitle, onSelectSubtitle, subtitleStyle, autoNext, onManageSubtitles }: PlayerSettingsProps) {
    const t = useTranslator();
    const root = useRef<HTMLSpanElement>(null);

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
