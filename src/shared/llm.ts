// How the app talks to a language model. Three protocols cover the providers: the one OpenAI made (which most of the others copy),
// the one of Anthropic and the one of Gemini.
export type LlmProtocol = 'openai' | 'anthropic' | 'gemini';

export const LLM_PROVIDER_IDS = ['openai', 'anthropic', 'gemini', 'deepseek', 'glm', 'kimi', 'custom'] as const;
export type LlmProviderId = (typeof LLM_PROVIDER_IDS)[number];

export interface LlmProviderInfo {
    protocol: LlmProtocol;
    // The address the requests go to, up to the part the protocol adds; the user can change it (it is the only one for "custom").
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

// The services that turn speech into text (to create the subtitle of an episode that has none). Two protocols are spoken: the one of OpenAI,
// `POST <address>/audio/transcriptions` (which the ones that copy it accept too: the address is the user's for "custom"), and the one of
// Gemini, which is asked in a prompt to write what is said and can write it in any language, not only English.
export const SPEECH_PROVIDER_IDS = ['openai', 'gemini', 'custom'] as const;
export type SpeechProviderId = (typeof SPEECH_PROVIDER_IDS)[number];

export const SPEECH_PROVIDERS: Record<SpeechProviderId, { defaultBaseUrl: string }> = {
    openai: { defaultBaseUrl: 'https://api.openai.com/v1' },
    gemini: { defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
    custom: { defaultBaseUrl: '' }
};

// Which languages a service can write the audio in at once, without the text being translated afterwards: only English for the ones that
// speak the protocol of OpenAI (its endpoint of translations), any language for Gemini.
export type SpeechTranslatesTo = 'english' | 'any';

export function speechTranslatesTo(provider: SpeechProviderId): SpeechTranslatesTo {
    return provider === 'gemini' ? 'any' : 'english';
}

// Where a token is kept: one for each provider of the language models and one for each service of speech to text, so the same kind of
// provider can be used for both with two different tokens.
export const LLM_TOKEN_SLOTS = [...LLM_PROVIDER_IDS, 'speech-openai', 'speech-gemini', 'speech-custom'] as const;
export type LlmTokenSlot = (typeof LLM_TOKEN_SLOTS)[number];

export function isLlmTokenSlot(value: unknown): value is LlmTokenSlot {
    return typeof value === 'string' && (LLM_TOKEN_SLOTS as readonly string[]).includes(value);
}

export function speechTokenSlot(provider: SpeechProviderId): LlmTokenSlot {
    return `speech-${provider}`;
}

// Why a request to a language model did not give a text: the token is not accepted, the provider asks to wait or has no more
// credit, the model is not there, the answer did not come in time or could not be read, or the user cancelled.
export type LlmErrorCode = 'INVALID_TOKEN' | 'RATE_LIMITED' | 'QUOTA_EXCEEDED' | 'MODEL_NOT_FOUND' | 'TIMEOUT' | 'NETWORK' | 'BAD_RESPONSE' | 'CANCELLED';

export interface LlmError {
    code: LlmErrorCode;
    // What the provider said, or the reason it could not be reached; it never holds the token.
    raw: string;
    // How long the provider asked to wait, when it said.
    retryAfterSeconds?: number;
}

export type LlmCompletionResult = { ok: true; text: string } | { ok: false; error: LlmError };

// What the window may know about the tokens: which slots (providers) have one, and whether the system can keep one at all.
export interface LlmStatus {
    canStore: boolean;
    providers: LlmTokenSlot[];
}
