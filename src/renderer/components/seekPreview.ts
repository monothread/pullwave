export type SeekPreviewSource = { kind: 'file'; url: string } | { kind: 'hls'; url: string };

export interface PreviewMedia {
    element: HTMLVideoElement;
    close: () => void;
}

export type OpenPreviewMedia = (source: SeekPreviewSource, startAt: number, onFailure: () => void) => PreviewMedia;

export interface SeekPreviewCallbacks {
    onFrame: (frame: HTMLCanvasElement) => void;
    onFailure: () => void;
}

export interface SeekPreviewDependencies {
    openMedia: OpenPreviewMedia;
    createCanvas: () => HTMLCanvasElement;
    maxFrames?: number;
}

export interface PreviewSize {
    width: number;
    height: number;
}

export const PREVIEW_WIDTH = 160;
export const MAX_PREVIEW_FRAMES = 300;
const HAVE_METADATA = 1;

export function previewSecondOf(time: number, duration: number): number {
    const last = Math.max(0, Math.ceil(duration) - 1);
    return Math.min(Math.max(0, Math.floor(time)), last);
}

export function previewSizeOf(videoWidth: number, videoHeight: number, width: number = PREVIEW_WIDTH): PreviewSize | null {
    if (videoWidth <= 0 || videoHeight <= 0) {
        return null;
    }
    return { width, height: Math.round((width * videoHeight) / videoWidth) };
}

export class PreviewFrameCache<T> {
    private readonly frames = new Map<number, T>();

    constructor(private readonly limit: number) {}

    get size(): number {
        return this.frames.size;
    }

    get(second: number): T | undefined {
        const frame = this.frames.get(second);
        if (frame !== undefined) {
            this.frames.delete(second);
            this.frames.set(second, frame);
        }
        return frame;
    }

    set(second: number, frame: T): void {
        this.frames.delete(second);
        this.frames.set(second, frame);
        while (this.frames.size > this.limit) {
            const oldest = this.frames.keys().next().value;
            if (oldest === undefined) {
                break;
            }
            this.frames.delete(oldest);
        }
    }
}

export class SeekPreviewGrabber {
    private media: PreviewMedia | null = null;
    private readonly cache: PreviewFrameCache<HTMLCanvasElement>;
    private latest: number | null = null;
    private seeking: number | null = null;
    private queued: number | null = null;
    private failed = false;
    private closed = false;

    constructor(
        private readonly source: SeekPreviewSource,
        private readonly callbacks: SeekPreviewCallbacks,
        private readonly deps: SeekPreviewDependencies
    ) {
        this.cache = new PreviewFrameCache(deps.maxFrames ?? MAX_PREVIEW_FRAMES);
    }

    request(second: number): void {
        if (this.failed || this.closed) {
            return;
        }
        this.latest = second;
        const cached = this.cache.get(second);
        if (cached !== undefined) {
            this.queued = null;
            this.callbacks.onFrame(cached);
            return;
        }
        this.queued = second;
        this.openOnce(second);
        this.seekNext();
    }

    close(): void {
        this.closed = true;
        this.release();
    }

    private openOnce(startAt: number): void {
        if (this.media !== null) {
            return;
        }
        this.media = this.deps.openMedia(this.source, startAt, this.fail);
        this.media.element.addEventListener('loadedmetadata', this.seekNext);
        this.media.element.addEventListener('seeked', this.capture);
    }

    private readonly seekNext = (): void => {
        const element = this.media?.element;
        if (element === undefined || this.seeking !== null || this.queued === null || element.readyState < HAVE_METADATA) {
            return;
        }
        this.seeking = this.queued;
        this.queued = null;
        element.currentTime = this.seeking;
    };

    private readonly capture = (): void => {
        const element = this.media?.element;
        const second = this.seeking;
        if (element === undefined || second === null) {
            return;
        }
        this.seeking = null;
        const frame = this.draw(element);
        if (frame !== null) {
            this.cache.set(second, frame);
            if (second === this.latest) {
                this.callbacks.onFrame(frame);
            }
        }
        this.seekNext();
    };

    private draw(element: HTMLVideoElement): HTMLCanvasElement | null {
        const size = previewSizeOf(element.videoWidth, element.videoHeight);
        if (size === null) {
            return null;
        }
        const canvas = this.deps.createCanvas();
        canvas.width = size.width;
        canvas.height = size.height;
        const context = canvas.getContext('2d');
        if (context === null) {
            return null;
        }
        context.drawImage(element, 0, 0, size.width, size.height);
        return canvas;
    }

    private readonly fail = (): void => {
        if (this.failed || this.closed) {
            return;
        }
        this.failed = true;
        this.release();
        this.callbacks.onFailure();
    };

    private release(): void {
        const media = this.media;
        this.media = null;
        this.seeking = null;
        this.queued = null;
        if (media !== null) {
            media.element.removeEventListener('loadedmetadata', this.seekNext);
            media.element.removeEventListener('seeked', this.capture);
            media.close();
        }
    }
}
