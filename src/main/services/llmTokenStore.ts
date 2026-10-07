import { JsonStore } from './jsonStore';
import { isLlmTokenSlot, type LlmTokenSlot } from '@shared/llm';

// What the system offers to keep a secret: Electron's safeStorage (the keyring of the system), or a fake in the tests.
export interface SecretCipher {
    isAvailable: () => boolean;
    encrypt: (text: string) => Buffer;
    decrypt: (data: Buffer) => string;
}

// The tokens of the providers and of the services of speech to text (each one a slot), each one encrypted and apart from the settings. They stay in the main process: the window only
// learns whether a provider has one.
type StoredTokens = Partial<Record<LlmTokenSlot, string>>;

export class LlmTokenStore {
    constructor(
        private readonly store: JsonStore<StoredTokens>,
        private readonly cipher: SecretCipher
    ) {}

    // False when the system cannot keep a secret (a Linux without a keyring): then no token is saved.
    canStore(): boolean {
        return this.cipher.isAvailable();
    }

    has(slot: LlmTokenSlot): boolean {
        return this.get(slot) !== null;
    }

    get(slot: LlmTokenSlot): string | null {
        const encoded = this.store.read()[slot];
        if (typeof encoded !== 'string' || !this.canStore()) {
            return null;
        }
        try {
            return this.cipher.decrypt(Buffer.from(encoded, 'base64'));
        } catch {
            return null;
        }
    }

    // False when the token was not saved: it is empty or the system cannot keep it.
    set(slot: LlmTokenSlot, token: string): boolean {
        const trimmed = token.trim();
        if (trimmed.length === 0 || !this.canStore()) {
            return false;
        }
        this.store.write({ ...this.valid(), [slot]: this.cipher.encrypt(trimmed).toString('base64') });
        return true;
    }

    clear(slot: LlmTokenSlot): void {
        const kept = this.valid();
        delete kept[slot];
        this.store.write(kept);
    }

    // The slots that have a token.
    providers(): LlmTokenSlot[] {
        return (Object.keys(this.valid()) as LlmTokenSlot[]).filter((slot) => {
            return this.has(slot);
        });
    }

    // What the file holds, without the keys that are not a slot (the file can be edited by hand).
    private valid(): StoredTokens {
        const stored = this.store.read();
        const kept: StoredTokens = {};
        (Object.keys(stored) as string[]).forEach((key) => {
            const value = (stored as Record<string, unknown>)[key];
            if (isLlmTokenSlot(key) && typeof value === 'string') {
                kept[key] = value;
            }
        });
        return kept;
    }
}
