import type { FormatPart, ProgressInfo } from '@shared/types';

export type PartProgress = Pick<ProgressInfo, 'formatId' | 'percent' | 'partBytes'>;

// How far a whole video is when yt-dlp downloads its formats one after the other (the video, then the audio): it reports each part from 0
// to 100, so the bar would fill with the video, fall back to nothing and race to the end with the audio. Here every part counts for its
// size (for the same share each when a size is not known), the parts before the one being downloaded are done, and the percentage never
// goes down.
export class CombinedProgress {
    private readonly sizes: Array<number | null>;
    private readonly fractions: number[];
    private shown = 0;

    constructor(private readonly parts: FormatPart[]) {
        this.sizes = parts.map((part) => {
            return part.expectedBytes;
        });
        this.fractions = parts.map(() => {
            return 0;
        });
    }

    // The percentage of the whole video; the percentage of the part as it is when the part is not one of the video (yt-dlp did not say
    // which part it is, or it is another download).
    percentOf(progress: PartProgress): number {
        const index = this.parts.findIndex((part) => {
            return part.formatId === progress.formatId;
        });
        if (index < 0) {
            return progress.percent;
        }
        this.record(index, progress);
        this.shown = Math.max(this.shown, this.wholePercent());
        return this.shown;
    }

    private record(index: number, progress: PartProgress): void {
        for (let before = 0; before < index; before += 1) {
            this.fractions[before] = 1;
        }
        this.fractions[index] = Math.min(1, Math.max(0, progress.percent / 100));
        if (progress.partBytes !== null && progress.partBytes > 0) {
            this.sizes[index] = progress.partBytes;
        }
    }

    private weights(): number[] {
        const sizes = this.sizes.filter((size): size is number => {
            return size !== null;
        });
        return sizes.length === this.sizes.length ? sizes : this.sizes.map(() => {
            return 1;
        });
    }

    private wholePercent(): number {
        const weights = this.weights();
        const total = weights.reduce((sum, weight) => {
            return sum + weight;
        }, 0);
        const done = weights.reduce((sum, weight, index) => {
            return sum + weight * (this.fractions[index] ?? 0);
        }, 0);
        return (done / total) * 100;
    }
}
