import { isLlmProviderId, isLlmTokenSlot, LLM_PROVIDER_IDS, LLM_PROVIDERS, LLM_TOKEN_SLOTS, SPEECH_PROVIDER_IDS, SPEECH_PROVIDERS, speechTokenSlot, speechTranslatesTo } from '@shared/llm';

describe('LLM_PROVIDER_IDS', () => {
    it('lists the providers the app knows, in the order the settings show them', () => {
        expect(LLM_PROVIDER_IDS).toEqual(['openai', 'anthropic', 'gemini', 'deepseek', 'glm', 'kimi', 'custom']);
    });
});

describe('LLM_PROVIDERS', () => {
    it('has the protocol and the address of every provider', () => {
        expect(LLM_PROVIDERS).toEqual({
            openai: { protocol: 'openai', defaultBaseUrl: 'https://api.openai.com/v1' },
            anthropic: { protocol: 'anthropic', defaultBaseUrl: 'https://api.anthropic.com/v1' },
            gemini: { protocol: 'gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
            deepseek: { protocol: 'openai', defaultBaseUrl: 'https://api.deepseek.com' },
            glm: { protocol: 'openai', defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
            kimi: { protocol: 'openai', defaultBaseUrl: 'https://api.moonshot.ai/v1' },
            custom: { protocol: 'openai', defaultBaseUrl: '' }
        });
    });

    it('has an entry for each id', () => {
        expect(Object.keys(LLM_PROVIDERS)).toEqual([...LLM_PROVIDER_IDS]);
    });
});

describe('isLlmProviderId', () => {
    it.each(LLM_PROVIDER_IDS)('accepts %s', (provider) => {
        expect(isLlmProviderId(provider)).toBe(true);
    });

    it.each(['OpenAI', 'mistral', '', 'toString', 4, null, undefined, {}, ['openai']])('does not accept %j', (value) => {
        expect(isLlmProviderId(value)).toBe(false);
    });
});

describe('the services of speech to text', () => {
    it('are the ones that speak the protocol of OpenAI (with the address of OpenAI or the user\'s own) and Gemini', () => {
        expect(SPEECH_PROVIDER_IDS).toEqual(['openai', 'gemini', 'custom']);
        expect(SPEECH_PROVIDERS).toEqual({
            openai: { defaultBaseUrl: 'https://api.openai.com/v1' },
            gemini: { defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
            custom: { defaultBaseUrl: '' }
        });
    });

    it.each([
        ['openai', 'english'],
        ['custom', 'english'],
        ['gemini', 'any']
    ] as const)('write the audio at once in %s only when it can: %s', (provider, translatesTo) => {
        expect(speechTranslatesTo(provider)).toBe(translatesTo);
    });

    it.each(SPEECH_PROVIDER_IDS)('keep the token of %s in a slot of their own', (provider) => {
        expect(speechTokenSlot(provider)).toBe(`speech-${provider}`);
    });
});

describe('LLM_TOKEN_SLOTS', () => {
    it('has a slot for each provider and one for each service of speech to text', () => {
        expect(LLM_TOKEN_SLOTS).toEqual(['openai', 'anthropic', 'gemini', 'deepseek', 'glm', 'kimi', 'custom', 'speech-openai', 'speech-gemini', 'speech-custom']);
    });

    it.each(LLM_TOKEN_SLOTS)('accepts %s', (slot) => {
        expect(isLlmTokenSlot(slot)).toBe(true);
    });

    it.each(['speech-anthropic', 'speech', 'OpenAI', '', 'toString', 4, null, undefined, {}])('does not accept %j', (value) => {
        expect(isLlmTokenSlot(value)).toBe(false);
    });

    it('does not take a speech slot for a provider of the language models', () => {
        expect(isLlmProviderId('speech-openai')).toBe(false);
    });
});
