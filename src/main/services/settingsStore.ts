import { DEFAULT_SETTINGS } from '@shared/constants';
import type { Settings } from '@shared/types';
import { JsonStore } from './jsonStore';
import { sanitizeSettings } from './settingsSanitizer';

// The settings are read (and checked) from the file once, then kept in memory: they are asked for on every step of the queues.
export class SettingsStore {
    private readonly store: JsonStore<Partial<Settings>>;
    private current: Settings | null = null;

    constructor(filePath: string) {
        this.store = new JsonStore<Partial<Settings>>(filePath, {});
    }

    // A copy, so a caller that changes what it got does not change the settings of everyone else.
    get(): Settings {
        if (this.current === null) {
            this.current = sanitizeSettings({ ...DEFAULT_SETTINGS, ...this.store.read() });
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
