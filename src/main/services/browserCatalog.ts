import type { DetectedBrowser } from '@shared/types';

export class BrowserCatalog {
    private pending: Promise<DetectedBrowser[]>;

    constructor(private readonly detect: () => Promise<DetectedBrowser[]>) {
        this.pending = this.scan();
    }

    list(refresh = false): Promise<DetectedBrowser[]> {
        if (refresh) {
            this.pending = this.scan();
        }
        return this.pending;
    }

    private async scan(): Promise<DetectedBrowser[]> {
        try {
            return await this.detect();
        } catch {
            return [];
        }
    }
}
