// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { SeekPreviewSource } from '@renderer/components/seekPreview';
import { useSeekPreview } from '@renderer/hooks/useSeekPreview';

interface OpenedMedia {
    source: SeekPreviewSource;
    startAt: number;
    onFailure: () => void;
    element: HTMLVideoElement;
    close: ReturnType<typeof vi.fn<() => void>>;
    moves: number[];
}

const media = vi.hoisted(() => {
    return { opened: [] as OpenedMedia[] };
});

vi.mock('@renderer/components/previewMedia', () => {
    return {
        openPreviewMedia: (source: SeekPreviewSource, startAt: number, onFailure: () => void) => {
            const element = document.createElement('video');
            const moves: number[] = [];
            Object.defineProperty(element, 'readyState', { value: 1, configurable: true });
            Object.defineProperty(element, 'videoWidth', { value: 1280, configurable: true });
            Object.defineProperty(element, 'videoHeight', { value: 720, configurable: true });
            Object.defineProperty(element, 'currentTime', {
                configurable: true,
                get: () => {
                    return moves.at(-1) ?? 0;
                },
                set: (value: number) => {
                    moves.push(value);
                }
            });
            const opened: OpenedMedia = { source, startAt, onFailure, element, close: vi.fn<() => void>(), moves };
            media.opened.push(opened);
            return { element, close: opened.close };
        }
    };
});

const FILE: SeekPreviewSource = { kind: 'file', url: 'pullwave-media://episode/1?v=1000' };
const OTHER_FILE: SeekPreviewSource = { kind: 'file', url: 'pullwave-media://episode/2?v=1000' };
const STREAM: SeekPreviewSource = { kind: 'hls', url: 'pullwave-stream://p/s1/abc' };

let drawImage: ReturnType<typeof vi.fn>;
let getContext: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    media.opened.length = 0;
    // jsdom has no canvas: the hook's canvases get a context that only records what is drawn.
    drawImage = vi.fn();
    getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
        return { drawImage } as unknown as CanvasRenderingContext2D;
    });
});

afterEach(() => {
    getContext.mockRestore();
});

interface Props {
    source: SeekPreviewSource | undefined;
    second: number | null;
}

function renderPreview(initial: Props) {
    return renderHook(
        ({ source, second }: Props) => {
            return useSeekPreview(source, second);
        },
        { initialProps: initial }
    );
}

function finishSeek(opened: OpenedMedia | undefined): void {
    act(() => {
        opened?.element.dispatchEvent(new Event('seeked'));
    });
}

describe('useSeekPreview', () => {
    it('opens nothing and gives no frame while the mouse is not on the timeline', () => {
        const { result } = renderPreview({ source: FILE, second: null });
        expect(result.current).toBeNull();
        expect(media.opened).toHaveLength(0);
    });

    it('opens nothing and gives no frame when there is no source', () => {
        const { result } = renderPreview({ source: undefined, second: 12 });
        expect(result.current).toBeNull();
        expect(media.opened).toHaveLength(0);
    });

    it('opens the source at the second under the mouse and gives its frame once it is drawn', () => {
        const { result } = renderPreview({ source: STREAM, second: 12 });
        expect(media.opened).toHaveLength(1);
        expect(media.opened[0]).toMatchObject({ source: STREAM, startAt: 12, moves: [12] });
        expect(result.current).toBeNull();

        finishSeek(media.opened[0]);
        expect(result.current).toBeInstanceOf(HTMLCanvasElement);
        expect(result.current).toMatchObject({ width: 160, height: 90 });
        expect(drawImage).toHaveBeenCalledWith(media.opened[0]?.element, 0, 0, 160, 90);
    });

    it('follows the mouse with the same media, and gives back a frame already drawn', () => {
        const { result, rerender } = renderPreview({ source: FILE, second: 12 });
        finishSeek(media.opened[0]);
        const first = result.current;

        rerender({ source: FILE, second: 40 });
        expect(media.opened).toHaveLength(1);
        expect(media.opened[0]?.moves).toEqual([12, 40]);
        // The frame before stays until the new one is drawn.
        expect(result.current).toBe(first);
        finishSeek(media.opened[0]);
        expect(result.current).not.toBe(first);
        expect(result.current).toBeInstanceOf(HTMLCanvasElement);

        rerender({ source: FILE, second: 12 });
        expect(result.current).toBe(first);
        expect(media.opened[0]?.moves).toEqual([12, 40]);
    });

    it('keeps the last frame and the media when the mouse leaves the timeline', () => {
        const { result, rerender } = renderPreview({ source: FILE, second: 12 });
        finishSeek(media.opened[0]);
        const frame = result.current;
        rerender({ source: FILE, second: null });
        expect(result.current).toBe(frame);
        expect(media.opened[0]?.close).not.toHaveBeenCalled();
    });

    it('keeps the same media when the source is given again as a new object with the same address', () => {
        const { rerender } = renderPreview({ source: { ...FILE }, second: 12 });
        rerender({ source: { ...FILE }, second: 13 });
        expect(media.opened).toHaveLength(1);
        expect(media.opened[0]?.close).not.toHaveBeenCalled();
    });

    it('lets the media go, forgets the frame and opens the new source when the source changes', () => {
        const { result, rerender } = renderPreview({ source: FILE, second: 12 });
        finishSeek(media.opened[0]);
        expect(result.current).not.toBeNull();

        rerender({ source: OTHER_FILE, second: 12 });
        expect(media.opened[0]?.close).toHaveBeenCalledTimes(1);
        expect(result.current).toBeNull();
        expect(media.opened).toHaveLength(2);
        expect(media.opened[1]).toMatchObject({ source: OTHER_FILE, startAt: 12, moves: [12] });
    });

    it('lets the media go when the source is taken away', () => {
        const { result, rerender } = renderPreview({ source: FILE, second: 12 });
        finishSeek(media.opened[0]);
        rerender({ source: undefined, second: 12 });
        expect(media.opened[0]?.close).toHaveBeenCalledTimes(1);
        expect(result.current).toBeNull();
        expect(media.opened).toHaveLength(1);
    });

    it('gives no frame, and opens nothing more, once the source cannot be opened', () => {
        const { result, rerender } = renderPreview({ source: FILE, second: 12 });
        finishSeek(media.opened[0]);
        expect(result.current).not.toBeNull();

        act(() => {
            media.opened[0]?.onFailure();
        });
        expect(result.current).toBeNull();
        expect(media.opened[0]?.close).toHaveBeenCalledTimes(1);

        rerender({ source: FILE, second: 30 });
        expect(result.current).toBeNull();
        expect(media.opened).toHaveLength(1);
    });

    it('lets the media go when the player closes', () => {
        const { unmount } = renderPreview({ source: FILE, second: 12 });
        unmount();
        expect(media.opened[0]?.close).toHaveBeenCalledTimes(1);
    });
});
