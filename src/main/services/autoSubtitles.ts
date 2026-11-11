import {
    TRANSLATION_LANGUAGES,
    type AnimeSubtitleSetting,
    type AnimeSubtitleTrack,
    type AutoTranslateOffReason,
    type SubtitleTranslateRequest,
    type SubtitleTranslateResponse,
    type TranslationLanguage
} from '@shared/anime';
import type { LlmErrorCode, TranslationSetupGap } from '@shared/llm';
import type { LanguageCode } from '@shared/types';
import { subtitleLabels } from './aniSubtitles';
import { hasSubtitleIn } from './subtitleLanguage';

// The answers of the provider that would come again for every episode: the translation is turned off when one comes.
const REFUSALS: Partial<Record<LlmErrorCode, AutoTranslateOffReason>> = {
    QUOTA_EXCEEDED: 'quota',
    INVALID_TOKEN: 'token',
    MODEL_NOT_FOUND: 'model'
};

const SETUP_GAPS: readonly string[] = ['no-token', 'no-model', 'no-address'] satisfies readonly TranslationSetupGap[];

function isTranslationLanguage(value: string): value is TranslationLanguage {
    return (TRANSLATION_LANGUAGES as readonly string[]).includes(value);
}

// The language the subtitles are wanted in: the one of the anime subtitles of the settings ("auto" is the language of the app, as ani-cli
// picks it), or, when that leaves the choice to ani-cli ("default"), the language subtitles are translated into.
export function autoTranslateTarget(setting: AnimeSubtitleSetting, appLanguage: LanguageCode, translateLanguage: TranslationLanguage): TranslationLanguage {
    const [label] = subtitleLabels(setting, appLanguage);
    return label !== undefined && isTranslationLanguage(label) ? label : translateLanguage;
}


// Why the answer of a translation turns the automatic translation off, or null when it does not (a failure of that episode only, or one that
// may not come again).
export function offReasonOf(response: SubtitleTranslateResponse): AutoTranslateOffReason | null {
    if (response.ok) {
        return null;
    }
    if (response.reason === 'failed') {
        return REFUSALS[response.error.code] ?? null;
    }
    return SETUP_GAPS.includes(response.reason) ? 'setup' : null;
}

export interface AutoSubtitleDependencies {
    // Whether the user turned the automatic translation on (read every time).
    isEnabled: () => boolean;
    // What the settings lack for a subtitle to be translated; null when nothing.
    setupGap: () => TranslationSetupGap | null;
    // The language the subtitles are wanted in.
    target: () => TranslationLanguage;
    // The subtitles of a downloaded episode, or null when it has no video.
    tracks: (episodeId: number) => AnimeSubtitleTrack[] | null;
    // Queues the translation of a subtitle (the queue the user's translations go in) and answers when it ends; cancels the one of an episode.
    translate: (request: SubtitleTranslateRequest) => Promise<SubtitleTranslateResponse>;
    cancel: (episodeId: number) => void;
    // Saves the setting off and tells the window why.
    turnOff: (reason: AutoTranslateOffReason) => void;
}

// Translates, once they are downloaded, the subtitle of the new episodes that the check for new episodes downloaded, when they have a subtitle
// but none in the language that is wanted (an episode with no subtitle is left as it is). When the provider refuses in a way that would come
// again for every episode, or the settings lack what the translation needs, the setting is turned off and what was waiting is let go.
export class AutoSubtitleTranslator {
    // The episodes the check queued for download, waiting for their download to end.
    private readonly expected = new Set<number>();
    // The episodes whose translation this queued and that did not end yet.
    private readonly translating = new Set<number>();

    constructor(private readonly deps: AutoSubtitleDependencies) {}

    // The check queued these episodes for download (nothing is kept when the setting is off).
    expect(episodeIds: readonly number[]): void {
        if (!this.deps.isEnabled()) {
            return;
        }
        episodeIds.forEach((episodeId) => {
            this.expected.add(episodeId);
        });
    }

    // The download of an episode ended: its subtitle is translated when the check queued it and it needs one.
    async episodeDownloaded(episodeId: number): Promise<void> {
        if (!this.expected.delete(episodeId) || !this.deps.isEnabled()) {
            return;
        }
        if (this.deps.setupGap() !== null) {
            this.turnOff('setup');
            return;
        }
        const language = this.deps.target();
        const tracks = this.deps.tracks(episodeId);
        if (tracks === null || tracks.length === 0 || hasSubtitleIn(tracks, language)) {
            return;
        }
        // Never `replace`: a translation into that language already next to the video is left as it is (also when its label was not read).
        await this.translate({ episodeId, trackId: null, language, replace: false });
    }

    // The setting was saved or a token changed: when it is on but the settings lack what the translation needs, it is turned off.
    enforceSetup(): void {
        if (this.deps.isEnabled() && this.deps.setupGap() !== null) {
            this.turnOff('setup');
        }
    }

    private async translate(request: SubtitleTranslateRequest): Promise<void> {
        this.translating.add(request.episodeId);
        let response: SubtitleTranslateResponse;
        try {
            response = await this.deps.translate(request);
        } catch {
            // The queue answers its failures; one that throws says nothing about the provider, so the setting stays as it is.
            return;
        } finally {
            this.translating.delete(request.episodeId);
        }
        const reason = offReasonOf(response);
        if (reason !== null) {
            this.turnOff(reason);
        }
    }

    // Forgets what was waiting, cancels the translations this queued (never the user's) and, when the setting is still on, turns it off.
    private turnOff(reason: AutoTranslateOffReason): void {
        this.expected.clear();
        const running = [...this.translating];
        this.translating.clear();
        if (this.deps.isEnabled()) {
            this.deps.turnOff(reason);
        }
        running.forEach((episodeId) => {
            this.deps.cancel(episodeId);
        });
    }
}
