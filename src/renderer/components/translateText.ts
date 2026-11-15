import type { SubtitleGenerateFailure, SubtitleGenerateResponse, SubtitleTranslateFailure, SubtitleTranslateResponse } from '@shared/anime';
import type { MessageKey, Translator } from '@shared/i18n';
import type { LlmErrorCode, LlmProviderId, SpeechProviderId } from '@shared/llm';

const FAILURE_KEYS: Record<Exclude<SubtitleTranslateFailure, 'failed'>, MessageKey> = {
    missing: 'anime.translate.error.missing',
    'no-source': 'anime.translate.error.no-source',
    'no-token': 'anime.translate.error.no-token',
    'no-model': 'anime.translate.error.no-model',
    'no-address': 'anime.translate.error.no-address',
    unreadable: 'anime.translate.error.unreadable',
    'too-large': 'anime.translate.error.too-large',
    empty: 'anime.translate.error.empty',
    busy: 'anime.translate.error.busy',
    exists: 'anime.translate.error.exists',
    cancelled: 'anime.translate.error.cancelled'
};

const LLM_ERROR_KEYS: Record<LlmErrorCode, MessageKey> = {
    INVALID_TOKEN: 'llm.error.INVALID_TOKEN',
    RATE_LIMITED: 'llm.error.RATE_LIMITED',
    QUOTA_EXCEEDED: 'llm.error.QUOTA_EXCEEDED',
    MODEL_NOT_FOUND: 'llm.error.MODEL_NOT_FOUND',
    TIMEOUT: 'llm.error.TIMEOUT',
    NETWORK: 'llm.error.NETWORK',
    BAD_RESPONSE: 'llm.error.BAD_RESPONSE',
    CANCELLED: 'llm.error.CANCELLED',
    NO_TIMESTAMPS: 'llm.error.NO_TIMESTAMPS'
};

const PROVIDER_KEYS: Record<LlmProviderId, MessageKey> = {
    openai: 'llm.provider.openai',
    anthropic: 'llm.provider.anthropic',
    gemini: 'llm.provider.gemini',
    deepseek: 'llm.provider.deepseek',
    glm: 'llm.provider.glm',
    kimi: 'llm.provider.kimi',
    custom: 'llm.provider.custom'
};

export function providerName(provider: LlmProviderId, t: Translator): string {
    return t(PROVIDER_KEYS[provider]);
}

export function translateFailureText(response: Extract<SubtitleTranslateResponse, { ok: false }>, t: Translator): string {
    if (response.reason === 'failed') {
        return t('anime.translate.error.failed', { reason: t(LLM_ERROR_KEYS[response.error.code]) });
    }
    return t(FAILURE_KEYS[response.reason]);
}

export function estimateFailureText(reason: Exclude<SubtitleTranslateFailure, 'failed'>, t: Translator): string {
    return t(FAILURE_KEYS[reason]);
}

const GENERATE_FAILURE_KEYS: Record<Exclude<SubtitleGenerateFailure, 'failed'>, MessageKey> = {
    missing: 'anime.generate.error.missing',
    'no-token': 'anime.generate.error.no-token',
    'no-model': 'anime.generate.error.no-model',
    'no-address': 'anime.generate.error.no-address',
    'no-translation-token': 'anime.generate.error.no-translation-token',
    'no-translation-model': 'anime.generate.error.no-translation-model',
    'no-translation-address': 'anime.generate.error.no-translation-address',
    'no-audio': 'anime.generate.error.no-audio',
    'no-speech': 'anime.generate.error.no-speech',
    'extract-failed': 'anime.generate.error.extract-failed',
    unreadable: 'anime.generate.error.unreadable',
    busy: 'anime.generate.error.busy',
    cancelled: 'anime.generate.error.cancelled'
};

const SPEECH_PROVIDER_KEYS: Record<SpeechProviderId, MessageKey> = {
    openai: 'speech.provider.openai',
    gemini: 'llm.provider.gemini',
    custom: 'llm.provider.custom'
};

export function speechProviderName(provider: SpeechProviderId, t: Translator): string {
    return t(SPEECH_PROVIDER_KEYS[provider]);
}

export function generateFailureText(response: Extract<SubtitleGenerateResponse, { ok: false }>, t: Translator): string {
    if (response.reason === 'failed') {
        return t('anime.generate.error.failed', { reason: t(LLM_ERROR_KEYS[response.error.code]) });
    }
    return t(GENERATE_FAILURE_KEYS[response.reason]);
}

export function generateEstimateFailureText(reason: Extract<SubtitleGenerateFailure, 'missing' | 'no-audio' | 'extract-failed'>, t: Translator): string {
    return t(GENERATE_FAILURE_KEYS[reason]);
}
