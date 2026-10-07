import type { AnimeStream, AnimeStreamSubtitle, AnimeSubtitleImportResponse, AnimeSubtitleTrack } from '@shared/anime';
import type { MessageKey } from '@shared/i18n';
import type { LanguageCode } from '@shared/types';
import { subtitleDisplayNames } from './subtitleName';
import type { SubtitleOption } from './VideoControls';

const STORAGE_PREFIX = 'pullwave-subtitle-';
const OFF = 'off';
// The id the player gives the subtitles ani-cli picked (their own id is empty, which a <track> cannot have).
export const DEFAULT_OPTION_ID = 'default';

export type SubtitleImportFailure = Exclude<Extract<AnimeSubtitleImportResponse, { ok: false }>['reason'], 'cancelled'>;

const IMPORT_FAILURE_KEYS: Record<SubtitleImportFailure, MessageKey> = {
    unsupported: 'anime.player.subtitleError.unsupported',
    'too-large': 'anime.player.subtitleError.too-large',
    unreadable: 'anime.player.subtitleError.unreadable',
    missing: 'anime.player.subtitleError.missing'
};

export function importFailureKey(reason: SubtitleImportFailure): MessageKey {
    return IMPORT_FAILURE_KEYS[reason];
}

export function optionIdOf(track: AnimeSubtitleTrack): string {
    return track.id.length > 0 ? track.id : DEFAULT_OPTION_ID;
}

// The options of the menu of subtitles. With a language, the names of the subtitles of the source are written in it (see
// subtitleName.ts); the ones the user loaded keep the name of their file.
export function optionsOf(tracks: readonly AnimeSubtitleTrack[], language?: LanguageCode): SubtitleOption[] {
    const labels = language === undefined ? tracks.map((track) => {
        return track.label;
    }) : subtitleDisplayNames(
        tracks.map((track) => {
            return track.label;
        }),
        language
    );
    return tracks.map((track, position) => {
        return { id: optionIdOf(track), label: track.kind === 'imported' || track.kind === 'generated' || track.kind === 'translated' ? track.label : (labels[position] as string) };
    });
}

// The id of the only subtitle a stream has when the source does not list them (the one ani-cli picked).
export const STREAM_SUBTITLE_ID = 'stream';

// The subtitles of a stream, the one ani-cli picked first (it is the one shown at first). Without a list from the source, the one that
// was picked is all there is.
export function streamTracks(stream: AnimeStream): AnimeStreamSubtitle[] {
    if (stream.subtitles.length === 0) {
        return stream.subtitleUrl === null ? [] : [{ id: STREAM_SUBTITLE_ID, label: 'Subtitles', url: stream.subtitleUrl }];
    }
    const picked = stream.subtitles.findIndex((subtitle) => {
        return subtitle.url === stream.subtitleUrl;
    });
    return picked > 0 ? [stream.subtitles[picked] as AnimeStreamSubtitle, ...stream.subtitles.filter((_subtitle, position) => {
        return position !== picked;
    })] : stream.subtitles;
}

// The options of the menu of subtitles of a stream, written in the language of the screen (see subtitleName.ts). A stream whose
// subtitles the source does not list keeps its one generic name.
export function streamOptionsOf(tracks: readonly AnimeStreamSubtitle[], language: LanguageCode): SubtitleOption[] {
    const listed = tracks.some((track) => {
        return track.id !== STREAM_SUBTITLE_ID;
    });
    const labels = listed
        ? subtitleDisplayNames(
              tracks.map((track) => {
                  return track.label;
              }),
              language
          )
        : tracks.map((track) => {
              return track.label;
          });
    return tracks.map((track, position) => {
        return { id: track.id, label: labels[position] as string };
    });
}

// What the viewer chose the last time they watched the episode: an id, null for "off", undefined when they never chose.
export function readSubtitleChoice(episodeId: number): string | null | undefined {
    try {
        const stored = window.localStorage.getItem(`${STORAGE_PREFIX}${episodeId}`);
        if (stored === null) {
            return undefined;
        }
        return stored === OFF ? null : stored;
    } catch {
        return undefined;
    }
}

export function saveSubtitleChoice(episodeId: number, choice: string | null): void {
    try {
        window.localStorage.setItem(`${STORAGE_PREFIX}${episodeId}`, choice ?? OFF);
    } catch {
        return;
    }
}

// The subtitle to show: the one chosen before when it is still there, otherwise the first (the one ani-cli picked).
export function initialSubtitle(options: readonly SubtitleOption[], stored: string | null | undefined): string | null {
    if (stored === null) {
        return null;
    }
    const found = options.find((option) => {
        return option.id === stored;
    });
    return found ? found.id : (options[0]?.id ?? null);
}
