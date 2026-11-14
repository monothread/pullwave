// The picture shown above the timeline while the mouse is on it: the frame of the second under the mouse. A second video, never shown and
// never played, is moved to that second and its frame is drawn on a small canvas; every frame drawn is kept, so a second seen once comes back at once.

// Where the frames come from: the file of a downloaded episode, or the HLS playlist of one that is watched without downloading.
export type SeekPreviewSource = { kind: 'file'; url: string } | { kind: 'hls'; url: string };

// The hidden video the frames are taken from, and the way to let it go.
export interface PreviewMedia {
    element: HTMLVideoElement;
    close: () => void;
}

export type OpenPreviewMedia = (source: SeekPreviewSource, startAt: number, onFailure: () => void) => PreviewMedia;

export interface SeekPreviewCallbacks {
    // A frame of the second that was asked for last.
    onFrame: (frame: HTMLCanvasElement) => void;
    // The video could not be opened: there is no preview for this source.
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

// The width of the picture (its height follows the shape of the video).
export const PREVIEW_WIDTH = 160;
// The most frames kept at once (each one is about 60 KB): past it the one seen longest ago goes.
export const MAX_PREVIEW_FRAMES = 300;
// HTMLMediaElement.HAVE_METADATA: the length and the size of the video are known, so it can be moved to a second.
const HAVE_METADATA = 1;

// The second the preview shows for a moment of the video: the whole second under the mouse, never past the last one the video has.
export function previewSecondOf(time: number, duration: number): number {
    const last = Math.max(0, Math.ceil(duration) - 1);
    return Math.min(Math.max(0, Math.floor(time)), last);
}

// The size of the picture for a video of this size; null while the size of the video is not known.
export function previewSizeOf(videoWidth: number, videoHeight: number, width: number = PREVIEW_WIDTH): PreviewSize | null {
    if (videoWidth <= 0 || videoHeight <= 0) {
        return null;
    }
    return { width, height: Math.round((width * videoHeight) / videoWidth) };
}

// The frames already drawn, by second; the one used longest ago goes first when there are too many.
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

// Takes the frames of one source. The video is opened the first time a second is asked for (an episode whose timeline is never hovered
// loads nothing more), and moves to one second at a time: while it moves, only the last second asked for is kept to be the next one, so a
// mouse that runs along the bar does not queue a move for every second it crosses.
export class SeekPreviewGrabber {
    private media: PreviewMedia | null = null;
    private readonly cache: PreviewFrameCache<HTMLCanvasElement>;
    // The second asked for last: only its frame is shown.
    private latest: number | null = null;
    // The second the video is moving to, and the one it moves to after it.
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
