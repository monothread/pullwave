export const RATE_WINDOW_MS = 10_000;

export interface TransferMeasure {
    bytesPerSecond: number | null;
    etaSeconds: number | null;
}

interface PageSample {
    at: number;
    bytes: number;
}

const UNKNOWN_MEASURE: TransferMeasure = { bytesPerSecond: null, etaSeconds: null };

export class PageTransferRate {
    private samples: PageSample[] = [];

    constructor(private readonly startedAt: number) {}

    add(at: number, bytes: number): void {
        this.samples.push({ at, bytes });
    }

    measure(at: number, pagesLeft: number): TransferMeasure {
        const windowStart = Math.max(this.startedAt, at - RATE_WINDOW_MS);
        this.samples = this.samples.filter((sample) => {
            return sample.at > windowStart;
        });
        const seconds = (at - windowStart) / 1000;
        if (this.samples.length === 0 || seconds <= 0) {
            return UNKNOWN_MEASURE;
        }
        const bytes = this.samples.reduce((total, sample) => {
            return total + sample.bytes;
        }, 0);
        const secondsPerPage = seconds / this.samples.length;
        return { bytesPerSecond: bytes / seconds, etaSeconds: Math.max(0, pagesLeft) * secondsPerPage };
    }
}
