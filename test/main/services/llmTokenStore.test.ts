import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JsonStore } from '@main/services/jsonStore';
import { LlmTokenStore, type SecretCipher } from '@main/services/llmTokenStore';
import { cleanTempDirs, makeTempDir } from '../../helpers/tempDir';

afterEach(() => {
    cleanTempDirs();
});

function fakeCipher(available = true): SecretCipher {
    return {
        isAvailable: () => {
            return available;
        },
        encrypt: (text) => {
            return Buffer.from(`enc:${text}`);
        },
        decrypt: (data) => {
            const text = data.toString();
            if (!text.startsWith('enc:')) {
                throw new Error('not encrypted');
            }
            return text.slice('enc:'.length);
        }
    };
}

function setup(available = true): { store: LlmTokenStore; file: string } {
    const file = join(makeTempDir(), 'llm-tokens.json');
    return { store: new LlmTokenStore(new JsonStore(file, {}), fakeCipher(available)), file };
}

describe('LlmTokenStore', () => {
    it('has no token at first', () => {
        const { store } = setup();
        expect(store.has('openai')).toBe(false);
        expect(store.get('openai')).toBeNull();
        expect(store.providers()).toEqual([]);
    });

    it('saves a token encrypted and gives it back', () => {
        const { store, file } = setup();
        expect(store.set('openai', 'sk-secret')).toBe(true);
        expect(store.has('openai')).toBe(true);
        expect(store.get('openai')).toBe('sk-secret');
        expect(readFileSync(file, 'utf-8')).not.toContain('sk-secret');
        expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({ openai: Buffer.from('enc:sk-secret').toString('base64') });
    });

    it('trims the token it saves', () => {
        const { store } = setup();
        store.set('gemini', '  key-1 \n');
        expect(store.get('gemini')).toBe('key-1');
    });

    it('does not save an empty token', () => {
        const { store, file } = setup();
        expect(store.set('openai', '   ')).toBe(false);
        expect(store.has('openai')).toBe(false);
        expect(existsSync(file)).toBe(false);
    });

    it('keeps the tokens of the providers apart', () => {
        const { store } = setup();
        store.set('openai', 'a');
        store.set('anthropic', 'b');
        expect(store.get('openai')).toBe('a');
        expect(store.get('anthropic')).toBe('b');
        expect(store.providers()).toEqual(['openai', 'anthropic']);
    });

    it('replaces the token of a provider', () => {
        const { store } = setup();
        store.set('kimi', 'old');
        store.set('kimi', 'new');
        expect(store.get('kimi')).toBe('new');
    });

    it('clears only the token of one provider', () => {
        const { store } = setup();
        store.set('openai', 'a');
        store.set('anthropic', 'b');
        store.clear('openai');
        expect(store.has('openai')).toBe(false);
        expect(store.get('anthropic')).toBe('b');
    });

    it('clears a provider that has no token without failing', () => {
        const { store } = setup();
        expect(() => {
            store.clear('glm');
        }).not.toThrow();
        expect(store.providers()).toEqual([]);
    });

    it('does not save, and says so, when the system cannot keep a secret', () => {
        const { store, file } = setup(false);
        expect(store.canStore()).toBe(false);
        expect(store.set('openai', 'sk-secret')).toBe(false);
        expect(existsSync(file)).toBe(false);
    });

    it('gives no token when the system can no longer decrypt', () => {
        const { store, file } = setup();
        store.set('openai', 'a');
        const unavailable = new LlmTokenStore(new JsonStore(file, {}), fakeCipher(false));
        expect(unavailable.get('openai')).toBeNull();
        expect(unavailable.has('openai')).toBe(false);
    });

    it('gives no token when the saved one cannot be decrypted', () => {
        const { store, file } = setup();
        writeFileSync(file, JSON.stringify({ openai: Buffer.from('garbage').toString('base64') }), 'utf-8');
        expect(store.get('openai')).toBeNull();
    });

    it('keeps the token of a speech to text service apart from the one of the provider with the same name', () => {
        const { store } = setup();
        store.set('custom', 'for-the-model');
        store.set('speech-custom', 'for-the-speech');
        expect(store.get('custom')).toBe('for-the-model');
        expect(store.get('speech-custom')).toBe('for-the-speech');
        expect(store.providers()).toEqual(['custom', 'speech-custom']);
        store.clear('speech-custom');
        expect(store.has('speech-custom')).toBe(false);
        expect(store.get('custom')).toBe('for-the-model');
    });

    it('ignores the entries of the file that are not a provider or not a text', () => {
        const { store, file } = setup();
        writeFileSync(file, JSON.stringify({ unknown: 'x', openai: 12 }), 'utf-8');
        expect(store.providers()).toEqual([]);
        store.set('gemini', 'k');
        expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({ gemini: Buffer.from('enc:k').toString('base64') });
    });
});
