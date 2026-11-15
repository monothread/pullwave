import {
    type AnimeSubtitleTrack,
    type AutoTranslateOffReason,
    type SubtitleTranslateRequest,
    type SubtitleTranslateResponse,
    type TranslationLanguage
} from '@shared/anime';
import type { LlmErrorCode, TranslationSetupGap } from '@shared/llm';
import { hasSubtitleIn } from './subtitleLanguage';

const REFUSALS: Partial<Record<LlmErrorCode, AutoTranslateOffReason>> = {
    QUOTA_EXCEEDED: 'quota',
    INVALID_TOKEN: 'token',
    MODEL_NOT_FOUND: 'model'
};

const SETUP_GAPS: readonly string[] = ['no-token', 'no-model', 'no-address'] satisfies readonly TranslationSetupGap[];

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
    isEnabled: () => boolean;
    setupGap: () => TranslationSetupGap | null;
    target: () => TranslationLanguage;
    tracks: (episodeId: number) => AnimeSubtitleTrack[] | null;
    translate: (request: SubtitleTranslateRequest) => Promise<SubtitleTranslateResponse>;
    cancel: (episodeId: number) => void;
    turnOff: (reason: AutoTranslateOffReason) => void;
}

export class AutoSubtitleTranslator {
    private readonly expected = new Set<number>();
    private readonly translating = new Set<number>();

    constructor(private readonly deps: AutoSubtitleDependencies) {}

    expect(episodeIds: readonly number[]): void {
        if (!this.deps.isEnabled()) {
            return;
        }
        episodeIds.forEach((episodeId) => {
            this.expected.add(episodeId);
        });
    }

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
        await this.translate({ episodeId, trackId: null, language, replace: false });
    }

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
            return;
        } finally {
            this.translating.delete(request.episodeId);
        }
        const reason = offReasonOf(response);
        if (reason !== null) {
            this.turnOff(reason);
        }
    }

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
