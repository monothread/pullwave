import { translateMain } from './language';

export type CloseAction = 'allow' | 'hide' | 'ask-quit';

export interface CloseState {
    quitting: boolean;
    canHideToTray: boolean;
}

export interface QuitDependencies {
    pendingCount: () => number;
    confirm: (pending: number) => Promise<boolean>;
    quit: () => void;
}

export function decideCloseAction(state: CloseState): CloseAction {
    if (state.quitting) {
        return 'allow';
    }
    return state.canHideToTray ? 'hide' : 'ask-quit';
}

export function describePending(pending: number): string {
    return pending === 1 ? translateMain('dialog.pendingOne') : translateMain('dialog.pendingMany', { count: pending });
}

export async function requestQuit(deps: QuitDependencies): Promise<boolean> {
    const pending = deps.pendingCount();
    if (pending > 0 && !(await deps.confirm(pending))) {
        return false;
    }
    deps.quit();
    return true;
}

export function createQuitRequester(deps: QuitDependencies): () => Promise<boolean> {
    let asking = false;
    return async (): Promise<boolean> => {
        if (asking) {
            return false;
        }
        asking = true;
        try {
            return await requestQuit(deps);
        } finally {
            asking = false;
        }
    };
}
