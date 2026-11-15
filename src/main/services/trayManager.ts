import type { TraySupport } from '@shared/types';
import { translateMain } from './language';

export interface TrayHandle {
    destroy: () => void;
}

export interface TrayManagerDependencies {
    createTray: () => TrayHandle;
    checkSupport: () => Promise<TraySupport>;
}

export class TrayManager {
    private tray: TrayHandle | null = null;
    private enabled = false;
    private support: TraySupport = { available: true, reason: null };
    private queue: Promise<void> = Promise.resolve();

    constructor(private readonly deps: TrayManagerDependencies) {}

    sync(enabled: boolean): Promise<void> {
        this.queue = this.queue.then(() => {
            return this.apply(enabled);
        });
        return this.queue;
    }

    rebuild(): Promise<void> {
        this.queue = this.queue.then(() => {
            if (this.tray === null) {
                return;
            }
            this.destroyTray();
            this.createTray();
        });
        return this.queue;
    }

    async refreshSupport(): Promise<TraySupport> {
        this.support = await this.deps.checkSupport();
        return this.getSupport();
    }

    getSupport(): TraySupport {
        return { ...this.support };
    }

    canHideToTray(): boolean {
        return this.enabled && this.support.available && this.tray !== null;
    }

    private async apply(enabled: boolean): Promise<void> {
        this.enabled = enabled;
        if (!enabled) {
            this.destroyTray();
            return;
        }
        await this.refreshSupport();
        if (!this.support.available) {
            this.destroyTray();
            return;
        }
        this.createTray();
    }

    private createTray(): void {
        if (this.tray !== null) {
            return;
        }
        try {
            this.tray = this.deps.createTray();
        } catch {
            this.tray = null;
            this.support = { available: false, reason: translateMain('tray.createFailed') };
        }
    }

    private destroyTray(): void {
        this.tray?.destroy();
        this.tray = null;
    }
}
