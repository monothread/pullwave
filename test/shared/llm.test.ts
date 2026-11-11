import { isLlmProviderId, isLlmTokenSlot, LLM_PROVIDER_IDS, LLM_PROVIDERS, LLM_TOKEN_SLOTS, OPENAI_SPEECH_MODEL, SPEECH_PROVIDER_IDS, SPEECH_PROVIDERS, speechCutsAtPauses, speechModelOf, speechTokenSlot, speechTranslatesTo, translationSetupGap } from '@shared/llm';

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
        ['openai', 'none'],
        ['custom', 'english'],
        ['gemini', 'any']
    ] as const)('write the audio at once in %s only when it can: %s', (provider, translatesTo) => {
        expect(speechTranslatesTo(provider)).toBe(translatesTo);
    });

    it('use only gpt-transcribe with OpenAI', () => {
        expect(OPENAI_SPEECH_MODEL).toBe('gpt-transcribe');
    });

    it.each([
        ['openai', 'whisper-1', 'gpt-transcribe'],
        ['openai', '', 'gpt-transcribe'],
        ['custom', 'whisper-1', 'whisper-1'],
        ['custom', '', ''],
        ['gemini', 'gemini-pro', 'gemini-pro']
    ] as const)('ask %s with the model %j as %j', (provider, model, used) => {
        expect(speechModelOf(provider, model)).toBe(used);
    });

    it.each([
        ['openai', true],
        ['custom', false],
        ['gemini', false]
    ] as const)('cut the audio at its pauses for %s: %s', (provider, cuts) => {
        expect(speechCutsAtPauses(provider)).toBe(cuts);
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

describe('translationSetupGap', () => {
    it.each(LLM_PROVIDER_IDS)('finds nothing missing for %s with the token, the model and an address', (provider) => {
        expect(translationSetupGap({ provider, model: 'model-1', baseUrl: 'https://llm.example/v1' }, true)).toBeNull();
    });

    it.each(['openai', 'anthropic', 'gemini', 'deepseek', 'glm', 'kimi'] as const)('needs no address of the user for %s, which has its own', (provider) => {
        expect(translationSetupGap({ provider, model: 'model-1', baseUrl: '' }, true)).toBeNull();
    });

    it('says the address is missing for a provider of the user that has none', () => {
        expect(translationSetupGap({ provider: 'custom', model: 'model-1', baseUrl: '' }, true)).toBe('no-address');
    });

    it('says the model is missing when the settings have none', () => {
        expect(translationSetupGap({ provider: 'openai', model: '', baseUrl: '' }, true)).toBe('no-model');
    });

    it('says the token is missing before anything else', () => {
        expect(translationSetupGap({ provider: 'custom', model: '', baseUrl: '' }, false)).toBe('no-token');
        expect(translationSetupGap({ provider: 'openai', model: 'model-1', baseUrl: '' }, false)).toBe('no-token');
    });

    it('says the model is missing before the address', () => {
        expect(translationSetupGap({ provider: 'custom', model: '', baseUrl: '' }, true)).toBe('no-model');
    });
});
