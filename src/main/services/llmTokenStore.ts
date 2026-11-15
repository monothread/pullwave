import { JsonStore } from './jsonStore';
import { isLlmTokenSlot, type LlmTokenSlot } from '@shared/llm';

export interface SecretCipher {
    isAvailable: () => boolean;
    encrypt: (text: string) => Buffer;
    decrypt: (data: Buffer) => string;
}

type StoredTokens = Partial<Record<LlmTokenSlot, string>>;

export class LlmTokenStore {
    constructor(
        private readonly store: JsonStore<StoredTokens>,
        private readonly cipher: SecretCipher
    ) {}

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

    providers(): LlmTokenSlot[] {
        return (Object.keys(this.valid()) as LlmTokenSlot[]).filter((slot) => {
            return this.has(slot);
        });
    }

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
