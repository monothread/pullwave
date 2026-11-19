export type LlmProtocol = 'openai' | 'anthropic' | 'gemini';

export const LLM_PROVIDER_IDS = ['openai', 'anthropic', 'gemini', 'deepseek', 'glm', 'kimi', 'custom'] as const;
export type LlmProviderId = (typeof LLM_PROVIDER_IDS)[number];

export interface LlmProviderInfo {
    protocol: LlmProtocol;
    defaultBaseUrl: string;
}

export const LLM_PROVIDERS: Record<LlmProviderId, LlmProviderInfo> = {
    openai: { protocol: 'openai', defaultBaseUrl: 'https://api.openai.com/v1' },
    anthropic: { protocol: 'anthropic', defaultBaseUrl: 'https://api.anthropic.com/v1' },
    gemini: { protocol: 'gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
    deepseek: { protocol: 'openai', defaultBaseUrl: 'https://api.deepseek.com' },
    glm: { protocol: 'openai', defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
    kimi: { protocol: 'openai', defaultBaseUrl: 'https://api.moonshot.ai/v1' },
    custom: { protocol: 'openai', defaultBaseUrl: '' }
};

export function isLlmProviderId(value: unknown): value is LlmProviderId {
    return typeof value === 'string' && (LLM_PROVIDER_IDS as readonly string[]).includes(value);
}

export const SPEECH_PROVIDER_IDS = ['openai', 'gemini', 'custom'] as const;
export type SpeechProviderId = (typeof SPEECH_PROVIDER_IDS)[number];

export const SPEECH_PROVIDERS: Record<SpeechProviderId, { defaultBaseUrl: string }> = {
    openai: { defaultBaseUrl: 'https://api.openai.com/v1' },
    gemini: { defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
    custom: { defaultBaseUrl: '' }
};

export type SpeechTranslatesTo = 'english' | 'any' | 'none';

export function speechTranslatesTo(provider: SpeechProviderId): SpeechTranslatesTo {
    if (provider === 'gemini') {
        return 'any';
    }
    return provider === 'openai' ? 'none' : 'english';
}

export const OPENAI_SPEECH_MODEL = 'gpt-transcribe';

export function speechModelOf(provider: SpeechProviderId, model: string): string {
    return provider === 'openai' ? OPENAI_SPEECH_MODEL : model;
}

export const SPEECH_PART_SECONDS = 600;
export const GEMINI_SPEECH_PART_SECONDS = 180;

export function speechCutsAtPauses(provider: SpeechProviderId): boolean {
    return provider === 'openai';
}

export function speechPartSeconds(provider: SpeechProviderId): number {
    return provider === 'gemini' ? GEMINI_SPEECH_PART_SECONDS : SPEECH_PART_SECONDS;
}

export const LLM_TOKEN_SLOTS = [...LLM_PROVIDER_IDS, 'speech-openai', 'speech-gemini', 'speech-custom'] as const;
export type LlmTokenSlot = (typeof LLM_TOKEN_SLOTS)[number];

export function isLlmTokenSlot(value: unknown): value is LlmTokenSlot {
    return typeof value === 'string' && (LLM_TOKEN_SLOTS as readonly string[]).includes(value);
}

export function speechTokenSlot(provider: SpeechProviderId): LlmTokenSlot {
    return `speech-${provider}`;
}

export type LlmErrorCode = 'INVALID_TOKEN' | 'RATE_LIMITED' | 'QUOTA_EXCEEDED' | 'MODEL_NOT_FOUND' | 'TIMEOUT' | 'NETWORK' | 'BAD_RESPONSE' | 'CANCELLED' | 'NO_TIMESTAMPS';

export interface LlmError {
    code: LlmErrorCode;
    raw: string;
    retryAfterSeconds?: number;
}

export interface TranslationSetup {
    provider: LlmProviderId;
    model: string;
    baseUrl: string;
}

export type TranslationSetupGap = 'no-token' | 'no-model' | 'no-address';

export function translationSetupGap(setup: TranslationSetup, hasToken: boolean): TranslationSetupGap | null {
    if (!hasToken) {
        return 'no-token';
    }
    if (setup.model.length === 0) {
        return 'no-model';
    }
    if (setup.baseUrl.length === 0 &&LLM_PROVIDERS[setup.provider].defaultBaseUrl.length === 0) {
        return 'no-address';
    }
    return null;
}

export type LlmCompletionResult ={ ok: true; text: string } | { ok: false; error: LlmError };

export interface LlmStatus {
    canStore: boolean;
    providers: LlmTokenSlot[];
}
