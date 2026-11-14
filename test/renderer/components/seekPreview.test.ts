import {
    MAX_PREVIEW_FRAMES,
    PREVIEW_WIDTH,
    PreviewFrameCache,
    SeekPreviewGrabber,
    previewSecondOf,
    previewSizeOf,
    type OpenPreviewMedia,
    type PreviewMedia,
    type SeekPreviewSource
} from '@renderer/components/seekPreview';

// A hidden video: it moves when its time is set and says so with `seeked` when the test tells it the frame is there.
class FakeVideo extends EventTarget {
    readyState = 0;
    videoWidth = 1920;
    videoHeight = 1080;
    readonly moves: number[] = [];
    private time = 0;

    get currentTime(): number {
        return this.time;
    }

    set currentTime(value: number) {
        this.time = value;
        this.moves.push(value);
    }

    loadMetadata(): void {
        this.readyState = 1;
        this.dispatchEvent(new Event('loadedmetadata'));
    }

    finishSeek(): void {
        this.dispatchEvent(new Event('seeked'));
    }
}

interface FakeCanvas {
    width: number;
    height: number;
    drawn: Array<{ source: unknown; x: number; y: number; width: number; height: number }>;
    getContext: (kind: string) => { drawImage: (source: unknown, x: number, y: number, width: number, height: number) => void } | null;
}

function fakeCanvas(hasContext = true): FakeCanvas {
    const canvas: FakeCanvas = {
        width: 0,
        height: 0,
        drawn: [],
        getContext: (kind: string) => {
            if (!hasContext || kind !== '2d') {
                return null;
            }
            return {
                drawImage: (source, x, y, width, height) => {
                    canvas.drawn.push({ source, x, y, width, height });
                }
            };
        }
    };
    return canvas;
}

interface Harness {
    grabber: SeekPreviewGrabber;
    video: FakeVideo;
    openMedia: ReturnType<typeof vi.fn<OpenPreviewMedia>>;
    close: ReturnType<typeof vi.fn<() => void>>;
    onFrame: ReturnType<typeof vi.fn<(frame: HTMLCanvasElement) => void>>;
    onFailure: ReturnType<typeof vi.fn<() => void>>;
    canvases: FakeCanvas[];
    // The failure callback the grabber gave to the media.
    failMedia: () => void;
}

const FILE: SeekPreviewSource = { kind: 'file', url: 'pullwave-media://episode/1?v=1000' };

function setup(options: { source?: SeekPreviewSource; maxFrames?: number; hasContext?: boolean } = {}): Harness {
    const video = new FakeVideo();
    const close = vi.fn<() => void>();
    const canvases: FakeCanvas[] = [];
    let failure: () => void = () => {
        throw new Error('the media was not opened');
    };
    const openMedia = vi.fn<OpenPreviewMedia>((_source, _startAt, onFailure) => {
        failure = onFailure;
        const media: PreviewMedia = { element: video as unknown as HTMLVideoElement, close };
        return media;
    });
    const onFrame = vi.fn<(frame: HTMLCanvasElement) => void>();
    const onFailure = vi.fn<() => void>();
    const grabber = new SeekPreviewGrabber(
        options.source ?? FILE,
        { onFrame, onFailure },
        {
            openMedia,
            createCanvas: () => {
                const canvas = fakeCanvas(options.hasContext ?? true);
                canvases.push(canvas);
                return canvas as unknown as HTMLCanvasElement;
            },
            maxFrames: options.maxFrames
        }
    );
    return {
        grabber,
        video,
        openMedia,
        close,
        onFrame,
        onFailure,
        canvases,
        failMedia: () => {
            failure();
        }
    };
}

describe('previewSecondOf', () => {
    it('gives the whole second under the mouse', () => {
        expect(previewSecondOf(0, 120)).toBe(0);
        expect(previewSecondOf(0.99, 120)).toBe(0);
        expect(previewSecondOf(42.5, 120)).toBe(42);
        expect(previewSecondOf(43, 120)).toBe(43);
    });

    it('never gives a second past the last one the video has', () => {
        expect(previewSecondOf(120, 120)).toBe(119);
        expect(previewSecondOf(119.9, 119.4)).toBe(119);
        expect(previewSecondOf(500, 8)).toBe(7);
    });

    it('never gives a second before the start', () => {
        expect(previewSecondOf(-3, 120)).toBe(0);
    });

    it('gives the first second of a video shorter than one second, or of unknown length', () => {
        expect(previewSecondOf(0.4, 0.5)).toBe(0);
        expect(previewSecondOf(5, 0)).toBe(0);
    });
});

describe('previewSizeOf', () => {
    it('keeps the shape of the video at the width of the preview', () => {
        expect(PREVIEW_WIDTH).toBe(160);
        expect(previewSizeOf(1920, 1080)).toEqual({ width: 160, height: 90 });
        expect(previewSizeOf(160, 120)).toEqual({ width: 160, height: 120 });
        expect(previewSizeOf(64, 64)).toEqual({ width: 160, height: 160 });
    });

    it('rounds the height', () => {
        expect(previewSizeOf(1920, 817)).toEqual({ width: 160, height: 68 });
    });

    it('takes another width', () => {
        expect(previewSizeOf(1920, 1080, 320)).toEqual({ width: 320, height: 180 });
    });

    it('gives null while the size of the video is not known', () => {
        expect(previewSizeOf(0, 0)).toBeNull();
        expect(previewSizeOf(1920, 0)).toBeNull();
        expect(previewSizeOf(0, 1080)).toBeNull();
    });
});

describe('PreviewFrameCache', () => {
    it('gives back what was kept, and nothing for a second never kept', () => {
        const cache = new PreviewFrameCache<string>(3);
        cache.set(1, 'one');
        expect(cache.get(1)).toBe('one');
        expect(cache.get(2)).toBeUndefined();
        expect(cache.size).toBe(1);
    });

    it('lets the frame used longest ago go when there are too many', () => {
        const cache = new PreviewFrameCache<string>(2);
        cache.set(1, 'one');
        cache.set(2, 'two');
        cache.set(3, 'three');
        expect(cache.size).toBe(2);
        expect(cache.get(1)).toBeUndefined();
        expect(cache.get(2)).toBe('two');
        expect(cache.get(3)).toBe('three');
    });

    it('counts a frame that was read as used: the one not read goes first', () => {
        const cache = new PreviewFrameCache<string>(2);
        cache.set(1, 'one');
        cache.set(2, 'two');
        expect(cache.get(1)).toBe('one');
        cache.set(3, 'three');
        expect(cache.get(2)).toBeUndefined();
        expect(cache.get(1)).toBe('one');
        expect(cache.get(3)).toBe('three');
    });

    it('replaces the frame of a second kept again, without counting it twice', () => {
        const cache = new PreviewFrameCache<string>(2);
        cache.set(1, 'one');
        cache.set(1, 'other');
        expect(cache.size).toBe(1);
        expect(cache.get(1)).toBe('other');
    });

    it('keeps nothing with a limit of zero', () => {
        const cache = new PreviewFrameCache<string>(0);
        cache.set(1, 'one');
        expect(cache.size).toBe(0);
        expect(cache.get(1)).toBeUndefined();
    });
});

describe('SeekPreviewGrabber', () => {
    it('opens nothing until a second is asked for', () => {
        const { openMedia } = setup();
        expect(openMedia).not.toHaveBeenCalled();
    });

    it('opens the media the first time, at that second, and only once', () => {
        const hls: SeekPreviewSource = { kind: 'hls', url: 'pullwave-stream://p/s1/abc' };
        const { grabber, openMedia } = setup({ source: hls });
        grabber.request(42);
        grabber.request(43);
        expect(openMedia).toHaveBeenCalledTimes(1);
        expect(openMedia).toHaveBeenCalledWith(hls, 42, expect.any(Function));
    });

    it('waits for the length of the video before it moves it, then moves it to the second asked for', () => {
        const { grabber, video } = setup();
        grabber.request(42);
        expect(video.moves).toEqual([]);
        video.loadMetadata();
        expect(video.moves).toEqual([42]);
    });

    it('moves at once when the video already knows its length', () => {
        const { grabber, video } = setup();
        video.readyState = 4;
        grabber.request(10);
        expect(video.moves).toEqual([10]);
    });

    it('draws the frame of the second on a canvas of the size of the preview and gives it', () => {
        const { grabber, video, onFrame, canvases } = setup();
        video.loadMetadata();
        grabber.request(42);
        expect(onFrame).not.toHaveBeenCalled();
        video.finishSeek();
        expect(canvases).toHaveLength(1);
        expect(canvases[0]).toMatchObject({ width: 160, height: 90, drawn: [{ source: video, x: 0, y: 0, width: 160, height: 90 }] });
        expect(onFrame).toHaveBeenCalledTimes(1);
        expect(onFrame).toHaveBeenCalledWith(canvases[0]);
    });

    it('gives a second already drawn at once, without moving the video', () => {
        const { grabber, video, onFrame, canvases } = setup();
        video.loadMetadata();
        grabber.request(42);
        video.finishSeek();
        grabber.request(43);
        video.finishSeek();
        expect(video.moves).toEqual([42, 43]);

        grabber.request(42);
        expect(video.moves).toEqual([42, 43]);
        expect(canvases).toHaveLength(2);
        expect(onFrame).toHaveBeenLastCalledWith(canvases[0]);
        expect(onFrame).toHaveBeenCalledTimes(3);
    });

    it('while the video moves, keeps only the last second asked for as the next move', () => {
        const { grabber, video, onFrame, canvases } = setup();
        video.loadMetadata();
        grabber.request(1);
        grabber.request(2);
        grabber.request(3);
        grabber.request(4);
        expect(video.moves).toEqual([1]);

        video.finishSeek();
        // The frame of 1 is kept but not shown: the mouse is on 4 now.
        expect(onFrame).not.toHaveBeenCalled();
        expect(video.moves).toEqual([1, 4]);

        video.finishSeek();
        expect(onFrame).toHaveBeenCalledTimes(1);
        expect(onFrame).toHaveBeenCalledWith(canvases[1]);
        expect(video.moves).toEqual([1, 4]);

        // The frame of 1 was kept.
        grabber.request(1);
        expect(onFrame).toHaveBeenLastCalledWith(canvases[0]);
        expect(video.moves).toEqual([1, 4]);
    });

    it('does not move again when the mouse comes to a second already drawn while the video moves', () => {
        const { grabber, video, onFrame, canvases } = setup();
        video.loadMetadata();
        grabber.request(1);
        video.finishSeek();
        grabber.request(5);
        grabber.request(6);
        grabber.request(1);
        expect(onFrame).toHaveBeenLastCalledWith(canvases[0]);

        video.finishSeek();
        // The frame of 5 is kept, not shown over the one of 1, and 6 is not asked for any more.
        expect(onFrame).toHaveBeenCalledTimes(2);
        expect(onFrame).toHaveBeenLastCalledWith(canvases[0]);
        expect(video.moves).toEqual([1, 5]);
    });

    it('ignores a move it did not ask for', () => {
        const { grabber, video, onFrame, canvases } = setup();
        grabber.request(3);
        video.finishSeek();
        expect(canvases).toHaveLength(0);
        expect(onFrame).not.toHaveBeenCalled();
    });

    it('gives nothing, and goes on, while the size of the picture is not known', () => {
        const { grabber, video, onFrame, canvases } = setup();
        video.videoWidth = 0;
        video.loadMetadata();
        grabber.request(3);
        grabber.request(4);
        video.finishSeek();
        expect(canvases).toHaveLength(0);
        expect(onFrame).not.toHaveBeenCalled();
        expect(video.moves).toEqual([3, 4]);

        // The frame was not kept: the second is asked for again.
        video.videoWidth = 640;
        video.videoHeight = 360;
        video.finishSeek();
        grabber.request(3);
        expect(video.moves).toEqual([3, 4, 3]);
    });

    it('gives nothing when the canvas cannot be drawn on', () => {
        const { grabber, video, onFrame, canvases } = setup({ hasContext: false });
        video.loadMetadata();
        grabber.request(3);
        video.finishSeek();
        expect(canvases).toHaveLength(1);
        expect(onFrame).not.toHaveBeenCalled();
    });

    it('keeps at most the frames it is told to, and the first one asked for goes', () => {
        const { grabber, video } = setup({ maxFrames: 2 });
        video.loadMetadata();
        [1, 2, 3].forEach((second) => {
            grabber.request(second);
            video.finishSeek();
        });
        grabber.request(3);
        grabber.request(2);
        expect(video.moves).toEqual([1, 2, 3]);
        grabber.request(1);
        expect(video.moves).toEqual([1, 2, 3, 1]);
    });

    it('keeps 300 frames by default', () => {
        expect(MAX_PREVIEW_FRAMES).toBe(300);
        const { grabber, video } = setup();
        video.loadMetadata();
        for (let second = 0; second <= MAX_PREVIEW_FRAMES; second += 1) {
            grabber.request(second);
            video.finishSeek();
        }
        expect(video.moves).toHaveLength(MAX_PREVIEW_FRAMES + 1);
        grabber.request(MAX_PREVIEW_FRAMES);
        grabber.request(1);
        expect(video.moves).toHaveLength(MAX_PREVIEW_FRAMES + 1);
        grabber.request(0);
        expect(video.moves).toHaveLength(MAX_PREVIEW_FRAMES + 2);
    });

    it('lets the media go when it is closed, and does nothing after', () => {
        const { grabber, video, close, openMedia, onFrame } = setup();
        video.loadMetadata();
        grabber.request(3);
        grabber.close();
        expect(close).toHaveBeenCalledTimes(1);

        video.finishSeek();
        video.loadMetadata();
        grabber.request(4);
        expect(onFrame).not.toHaveBeenCalled();
        expect(openMedia).toHaveBeenCalledTimes(1);
        expect(video.moves).toEqual([3]);
        grabber.close();
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('closes without anything to let go when nothing was asked for', () => {
        const { grabber, close } = setup();
        grabber.close();
        expect(close).not.toHaveBeenCalled();
    });

    it('says so once and lets the media go when it cannot be opened, and asks for nothing more', () => {
        const { grabber, video, close, openMedia, onFailure, onFrame, failMedia } = setup();
        video.loadMetadata();
        grabber.request(3);
        failMedia();
        expect(onFailure).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(1);

        failMedia();
        expect(onFailure).toHaveBeenCalledTimes(1);
        video.finishSeek();
        grabber.request(4);
        expect(onFrame).not.toHaveBeenCalled();
        expect(openMedia).toHaveBeenCalledTimes(1);
        expect(video.moves).toEqual([3]);
    });

    it('says nothing of a failure after it was closed', () => {
        const { grabber, onFailure, failMedia } = setup();
        grabber.request(3);
        grabber.close();
        failMedia();
        expect(onFailure).not.toHaveBeenCalled();
    });
});
