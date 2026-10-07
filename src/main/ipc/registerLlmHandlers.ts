import { IPC } from '@shared/constants';
import { isLlmTokenSlot, type LlmStatus } from '@shared/llm';
import type { LlmTokenStore } from '../services/llmTokenStore';
import type { IpcMainLike } from './registerHandlers';

// The longest token accepted: keys are a few hundred characters at most.
export const MAX_TOKEN_LENGTH = 2000;

export interface LlmHandlerDependencies {
    tokens: Pick<LlmTokenStore, 'canStore' | 'providers' | 'set' | 'clear'>;
}

// The tokens of the language models. The window can put one in, take it out and ask whether there is one, but never reads it back.
export function registerLlmHandlers(ipcMain: IpcMainLike, deps: LlmHandlerDependencies): void {
    ipcMain.handle(IPC.llmStatus, (): LlmStatus => {
        return { canStore: deps.tokens.canStore(), providers: deps.tokens.providers() };
    });
    ipcMain.handle(IPC.llmTokenSet, (_event, slot, token): boolean => {
        if (!isLlmTokenSlot(slot) || typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) {
            return false;
        }
        return deps.tokens.set(slot, token);
    });
    ipcMain.handle(IPC.llmTokenClear, (_event, slot): void => {
        if (isLlmTokenSlot(slot)) {
            deps.tokens.clear(slot);
        }
    });
}
