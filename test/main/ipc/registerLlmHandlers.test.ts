import { IPC } from '@shared/constants';
import { LLM_TOKEN_SLOTS, type LlmTokenSlot } from '@shared/llm';
import type { IpcMainLike } from '@main/ipc/registerHandlers';
import { MAX_TOKEN_LENGTH, registerLlmHandlers } from '@main/ipc/registerLlmHandlers';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

function setup(canStore = true, providers: LlmTokenSlot[] = [], withListener = true) {
    const handlers = new Map<string, Handler>();
    const ipcMain: IpcMainLike = {
        handle: (channel, listener) => {
            handlers.set(channel, listener);
        }
    };
    const tokens = {
        canStore: vi.fn(() => {
            return canStore;
        }),
        providers: vi.fn(() => {
            return providers;
        }),
        set: vi.fn<(provider: string, token: string) => boolean>(() => {
            return true;
        }),
        clear: vi.fn()
    };
    const onChanged = vi.fn();
    registerLlmHandlers(ipcMain, withListener ? { tokens, onChanged } : { tokens });
    const call = (channel: string, ...args: unknown[]): unknown => {
        const handler = handlers.get(channel);
        if (!handler) {
            throw new Error(`No handler for ${channel}`);
        }
        return handler({}, ...args);
    };
    return { call, tokens, onChanged, channels: [...handlers.keys()].sort() };
}

describe('registerLlmHandlers', () => {
    it('registers the three channels of the tokens', () => {
        expect(setup().channels).toEqual([IPC.llmStatus, IPC.llmTokenClear, IPC.llmTokenSet].sort());
    });

    describe('the status', () => {
        it('tells whether the system can keep a token and which providers have one, and never the tokens', () => {
            const { call, tokens } = setup(true, ['openai', 'speech-openai']);
            expect(call(IPC.llmStatus)).toEqual({ canStore: true, providers: ['openai', 'speech-openai'] });
            expect(tokens.canStore).toHaveBeenCalledTimes(1);
            expect(tokens.providers).toHaveBeenCalledTimes(1);
        });

        it('says when the system cannot keep a token', () => {
            expect(setup(false).call(IPC.llmStatus)).toEqual({ canStore: false, providers: [] });
        });
    });

    describe('putting a token in', () => {
        it.each(LLM_TOKEN_SLOTS)('keeps the token of %s and says it was kept', (provider) => {
            const { call, tokens } = setup();
            expect(call(IPC.llmTokenSet, provider, 'sk-secret')).toBe(true);
            expect(tokens.set).toHaveBeenCalledTimes(1);
            expect(tokens.set).toHaveBeenCalledWith(provider, 'sk-secret');
        });

        it('tells that a token changed once it is kept', () => {
            const { call, onChanged } = setup();
            call(IPC.llmTokenSet, 'openai', 'sk-secret');
            expect(onChanged).toHaveBeenCalledTimes(1);
            expect(onChanged).toHaveBeenCalledWith();
        });

        it('keeps the token when nobody listens for the changes', () => {
            const { call, tokens } = setup(true, [], false);
            expect(call(IPC.llmTokenSet, 'openai', 'sk-secret')).toBe(true);
            expect(tokens.set).toHaveBeenCalledWith('openai', 'sk-secret');
        });

        it('says it was not kept when the store did not keep it, and tells no change', () => {
            const { call, tokens, onChanged } = setup();
            tokens.set.mockReturnValueOnce(false);
            expect(call(IPC.llmTokenSet, 'openai', 'sk-secret')).toBe(false);
            expect(onChanged).not.toHaveBeenCalled();
        });

        it('takes a token of the longest size', () => {
            const { call, tokens } = setup();
            const token = 'k'.repeat(MAX_TOKEN_LENGTH);
            expect(call(IPC.llmTokenSet, 'openai', token)).toBe(true);
            expect(tokens.set).toHaveBeenCalledWith('openai', token);
        });

        it.each([
            ['a provider that does not exist', 'mistral', 'sk-secret'],
            ['a speech service that does not exist', 'speech-anthropic', 'sk-secret'],
            ['no provider', undefined, 'sk-secret'],
            ['a provider that is not text', 4, 'sk-secret'],
            ['a token that is not text', 'openai', 12],
            ['no token', 'openai', undefined],
            ['a token that is too long', 'openai', 'k'.repeat(MAX_TOKEN_LENGTH + 1)]
        ])('keeps nothing and says so for %s', (_name, provider, token) => {
            const { call, tokens, onChanged } = setup();
            expect(call(IPC.llmTokenSet, provider, token)).toBe(false);
            expect(tokens.set).not.toHaveBeenCalled();
            expect(onChanged).not.toHaveBeenCalled();
        });
    });

    describe('taking a token out', () => {
        it.each(LLM_TOKEN_SLOTS)('removes the token of %s', (provider) => {
            const { call, tokens } = setup();
            expect(call(IPC.llmTokenClear, provider)).toBeUndefined();
            expect(tokens.clear).toHaveBeenCalledTimes(1);
            expect(tokens.clear).toHaveBeenCalledWith(provider);
        });

        it('tells that a token changed once it is removed', () => {
            const { call, onChanged } = setup();
            call(IPC.llmTokenClear, 'openai');
            expect(onChanged).toHaveBeenCalledTimes(1);
            expect(onChanged).toHaveBeenCalledWith();
        });

        it('removes the token when nobody listens for the changes', () => {
            const { call, tokens } = setup(true, [], false);
            call(IPC.llmTokenClear, 'openai');
            expect(tokens.clear).toHaveBeenCalledWith('openai');
        });

        it.each([['mistral'], ['speech-anthropic'], [undefined], [4], [null]])('removes nothing for the provider %s', (provider) => {
            const { call, tokens, onChanged } = setup();
            expect(call(IPC.llmTokenClear, provider)).toBeUndefined();
            expect(tokens.clear).not.toHaveBeenCalled();
            expect(onChanged).not.toHaveBeenCalled();
        });
    });
});
