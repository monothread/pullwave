import type { Settings } from '@shared/types';
import { JsonStore } from './jsonStore';
import { sanitizeSettings } from './settingsSanitizer';

export class SettingsStore {
    private readonly store: JsonStore<Partial<Settings>>;
    private current: Settings | null = null;

    constructor(filePath: string) {
        this.store = new JsonStore<Partial<Settings>>(filePath, {});
    }

    get(): Settings {
        if (this.current === null) {
            this.current = sanitizeSettings(this.store.read());
        }
        return { ...this.current };
    }

    save(input: unknown): Settings {
        const sanitized = sanitizeSettings(input);
        this.store.write(sanitized);
        this.current = sanitized;
        return { ...sanitized };
    }
}
