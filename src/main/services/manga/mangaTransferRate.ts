// The speed of the chapter being downloaded and the time it still needs, from the pages that arrived in the last few seconds (an old
// burst or a slow start does not weigh on what is shown for long).
export const RATE_WINDOW_MS = 10_000;

export interface TransferMeasure {
    // null while no page has arrived in the window (only pages already on the disk, or none yet).
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

    // `startedAt` is when the run began: the first pages are measured from it, so the time of asking for the first one counts.
    constructor(private readonly startedAt: number) {}

    // A page was asked of the server now: the bytes it brought (0 when it failed, which still took its time).
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
