import type { SubtitleGenerateFailure, SubtitleTranslateFailure } from '@shared/anime';
import { createTranslator } from '@shared/i18n';
import { LLM_PROVIDER_IDS, type LlmErrorCode } from '@shared/llm';
import { estimateFailureText, generateEstimateFailureText, generateFailureText, providerName, speechProviderName, translateFailureText } from '@renderer/components/translateText';

const t = createTranslator('en');

const PROVIDER_NAMES = {
    openai: 'ChatGPT (OpenAI)',
    anthropic: 'Claude (Anthropic)',
    gemini: 'Gemini (Google)',
    deepseek: 'DeepSeek',
    glm: 'GLM (Zhipu)',
    kimi: 'Kimi (Moonshot)',
    custom: 'Other (OpenAI-compatible)'
} as const;

const FAILURE_TEXTS: Record<Exclude<SubtitleTranslateFailure, 'failed'>, string> = {
    missing: 'The video of this episode is not on the disk, so its subtitle cannot be translated.',
    'no-source': 'This episode has no subtitle to translate.',
    'no-token': 'There is no token for this provider. Add one in the anime settings.',
    'no-model': 'No model is set. Write the name of the model in the anime settings.',
    'no-address': 'This provider needs an address. Write it in the anime settings.',
    unreadable: 'The subtitle file could not be read or saved.',
    'too-large': 'This subtitle file is too large.',
    empty: 'This subtitle has no lines to translate.',
    busy: 'This episode is being translated already.',
    cancelled: 'The translation was cancelled.'
};

const LLM_TEXTS: Record<LlmErrorCode, string> = {
    INVALID_TOKEN: 'The provider did not accept the token. Check it in the anime settings.',
    RATE_LIMITED: 'The provider is limiting the requests. Try again in a few minutes.',
    QUOTA_EXCEEDED: 'The account has no credit or quota left.',
    MODEL_NOT_FOUND: 'The provider does not know this model. Check its name in the anime settings.',
    TIMEOUT: 'The provider took too long to answer.',
    NETWORK: 'The provider could not be reached. Check your connection and the address.',
    BAD_RESPONSE: 'The provider answered in a way the app could not use.',
    CANCELLED: 'The translation was cancelled.'
};

describe('providerName', () => {
    it.each(LLM_PROVIDER_IDS)('names %s as the people know it', (provider) => {
        expect(providerName(provider, t)).toBe(PROVIDER_NAMES[provider]);
    });
});

describe('translateFailureText', () => {
    it.each(Object.entries(FAILURE_TEXTS))('says what "%s" means', (reason, text) => {
        expect(translateFailureText({ ok: false, reason: reason as Exclude<SubtitleTranslateFailure, 'failed'> }, t)).toBe(text);
    });

    it.each(Object.entries(LLM_TEXTS))('says that the translation failed, and why, for %s', (code, text) => {
        expect(translateFailureText({ ok: false, reason: 'failed', error: { code: code as LlmErrorCode, raw: 'ignored' } }, t)).toBe(`The translation failed. ${text}`);
    });
});

describe('estimateFailureText', () => {
    it.each(['missing', 'no-source', 'unreadable', 'too-large', 'empty'] as const)('says what "%s" means', (reason) => {
        expect(estimateFailureText(reason, t)).toBe(FAILURE_TEXTS[reason]);
    });
});

describe('speechProviderName', () => {
    it('names OpenAI by its model of speech to text and the service of one\'s own like the language models do', () => {
        expect(speechProviderName('openai', t)).toBe('OpenAI (Whisper)');
        expect(speechProviderName('custom', t)).toBe('Other (OpenAI-compatible)');
    });
});

const GENERATE_FAILURE_TEXTS: Record<Exclude<SubtitleGenerateFailure, 'failed'>, string> = {
    missing: 'The video of this episode is not on the disk, so its subtitle cannot be created.',
    'no-token': 'There is no token for this service. Add one in the anime settings.',
    'no-model': 'No model is set. Write the name of the model in the anime settings.',
    'no-address': 'This service needs an address. Write it in the anime settings.',
    'no-translation-token': 'There is no token for the translation. Add one in the anime settings.',
    'no-translation-model': 'No model is set for the translation. Write the name of the model in the anime settings.',
    'no-translation-address': 'The translation provider needs an address. Write it in the anime settings.',
    'no-audio': 'This video has no audio to transcribe.',
    'no-speech': 'No speech was recognized in the audio, so no subtitle was created.',
    'extract-failed': 'The audio could not be taken out of the video.',
    unreadable: 'The subtitle file could not be saved.',
    busy: 'This episode is being worked on already.',
    cancelled: 'The subtitle was cancelled.'
};

describe('generateFailureText', () => {
    it.each(Object.entries(GENERATE_FAILURE_TEXTS))('says what "%s" means', (reason, text) => {
        expect(generateFailureText({ ok: false, reason: reason as Exclude<SubtitleGenerateFailure, 'failed'> }, t)).toBe(text);
    });

    it.each(Object.entries(LLM_TEXTS))('says that the subtitle could not be created, and why, for %s', (code, text) => {
        expect(generateFailureText({ ok: false, reason: 'failed', error: { code: code as LlmErrorCode, raw: 'ignored' } }, t)).toBe(`The subtitle could not be created. ${text}`);
    });
});

describe('generateEstimateFailureText', () => {
    it.each(['missing', 'no-audio', 'extract-failed'] as const)('says what "%s" means', (reason) => {
        expect(generateEstimateFailureText(reason, t)).toBe(GENERATE_FAILURE_TEXTS[reason]);
    });
});
