// @vitest-environment jsdom
import { openPreviewMedia, PREVIEW_BUFFER_SECONDS } from '@renderer/components/previewMedia';

const hls = vi.hoisted(() => {
    type Listener = (event: string, data: { fatal?: boolean; levels?: Array<{ height: number; bitrate: number }> }) => void;
    const state = {
        instances: [] as Array<{
            options: unknown;
            source: string | null;
            media: HTMLVideoElement | null;
            destroyed: boolean;
            listeners: Record<string, Listener>;
            currentLevel: number;
        }>
    };
    class FakeHls {
        static Events = { ERROR: 'hlsError', MANIFEST_PARSED: 'hlsManifestParsed' };
        readonly record: (typeof state.instances)[number];
        constructor(options: unknown) {
            this.record = { options, source: null, media: null, destroyed: false, listeners: {}, currentLevel: -1 };
            state.instances.push(this.record);
        }
        on(event: string, listener: Listener): void {
            this.record.listeners[event] = listener;
        }
        loadSource(url: string): void {
            this.record.source = url;
        }
        attachMedia(media: HTMLVideoElement): void {
            this.record.media = media;
        }
        destroy(): void {
            this.record.destroyed = true;
        }
        set currentLevel(level: number) {
            this.record.currentLevel = level;
        }
        get currentLevel(): number {
            return this.record.currentLevel;
        }
    }
    return { state, FakeHls };
});

vi.mock('hls.js', () => {
    return { default: hls.FakeHls };
});

const FILE_URL = 'pullwave-media://episode/1?v=1000';
const STREAM_URL = 'pullwave-stream://p/s1/abc';

let load: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    hls.state.instances.length = 0;
    load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {
        return undefined;
    });
});

afterEach(() => {
    load.mockRestore();
});

describe('openPreviewMedia', () => {
    describe('a downloaded file', () => {
        it('opens a muted video of the file that loads by itself, asked for without credentials, out of the page', () => {
            const media = openPreviewMedia({ kind: 'file', url: FILE_URL }, 42, vi.fn());
            const { element } = media;
            expect(element.tagName).toBe('VIDEO');
            expect(element.getAttribute('src')).toBe(FILE_URL);
            expect(element.muted).toBe(true);
            expect(element.preload).toBe('auto');
            expect(element.crossOrigin).toBe('anonymous');
            expect(element.autoplay).toBe(false);
            expect(element.isConnected).toBe(false);
            expect(hls.state.instances).toHaveLength(0);
        });

        it('says so when the video cannot be opened', () => {
            const onFailure = vi.fn();
            const { element } = openPreviewMedia({ kind: 'file', url: FILE_URL }, 0, onFailure);
            element.dispatchEvent(new Event('error'));
            expect(onFailure).toHaveBeenCalledTimes(1);
        });

        it('empties the video when it is closed, and says nothing of what happens to it after', () => {
            const onFailure = vi.fn();
            const media = openPreviewMedia({ kind: 'file', url: FILE_URL }, 0, onFailure);
            media.close();
            expect(media.element.hasAttribute('src')).toBe(false);
            expect(load).toHaveBeenCalledTimes(1);
            media.element.dispatchEvent(new Event('error'));
            expect(onFailure).not.toHaveBeenCalled();
        });
    });

    describe('a stream', () => {
        it('feeds hls.js with the playlist from the second asked for, loading little ahead, without a worker', () => {
            const { element } = openPreviewMedia({ kind: 'hls', url: STREAM_URL }, 42, vi.fn());
            expect(PREVIEW_BUFFER_SECONDS).toBe(4);
            expect(hls.state.instances).toHaveLength(1);
            expect(hls.state.instances[0]).toEqual({
                options: { enableWorker: false, maxBufferLength: 4, maxMaxBufferLength: 4, startPosition: 42 },
                source: STREAM_URL,
                media: element,
                destroyed: false,
                listeners: { hlsError: expect.any(Function), hlsManifestParsed: expect.any(Function) },
                currentLevel: -1
            });
            expect(element.hasAttribute('src')).toBe(false);
            expect(element.muted).toBe(true);
            expect(element.preload).toBe('auto');
            expect(element.crossOrigin).toBe('anonymous');
            expect(element.isConnected).toBe(false);
        });

        it('stays on the lightest quality of the source', () => {
            openPreviewMedia({ kind: 'hls', url: STREAM_URL }, 0, vi.fn());
            hls.state.instances[0]?.listeners.hlsManifestParsed?.('hlsManifestParsed', {
                levels: [
                    { height: 1080, bitrate: 5_300_000 },
                    { height: 360, bitrate: 900_000 },
                    { height: 720, bitrate: 3_000_000 }
                ]
            });
            expect(hls.state.instances[0]?.currentLevel).toBe(1);
        });

        it('leaves the quality to hls.js when the source lists none', () => {
            openPreviewMedia({ kind: 'hls', url: STREAM_URL }, 0, vi.fn());
            hls.state.instances[0]?.listeners.hlsManifestParsed?.('hlsManifestParsed', { levels: [] });
            expect(hls.state.instances[0]?.currentLevel).toBe(-1);
        });

        it('says so on a failure hls.js cannot recover from, and not on the others', () => {
            const onFailure = vi.fn();
            openPreviewMedia({ kind: 'hls', url: STREAM_URL }, 0, onFailure);
            hls.state.instances[0]?.listeners.hlsError?.('hlsError', { fatal: false });
            expect(onFailure).not.toHaveBeenCalled();
            hls.state.instances[0]?.listeners.hlsError?.('hlsError', { fatal: true });
            expect(onFailure).toHaveBeenCalledTimes(1);
        });

        it('says so when the video cannot be opened', () => {
            const onFailure = vi.fn();
            const { element } = openPreviewMedia({ kind: 'hls', url: STREAM_URL }, 0, onFailure);
            element.dispatchEvent(new Event('error'));
            expect(onFailure).toHaveBeenCalledTimes(1);
        });

        it('lets hls.js go and empties the video when it is closed', () => {
            const onFailure = vi.fn();
            const media = openPreviewMedia({ kind: 'hls', url: STREAM_URL }, 0, onFailure);
            media.close();
            expect(hls.state.instances[0]?.destroyed).toBe(true);
            expect(load).toHaveBeenCalledTimes(1);
            media.element.dispatchEvent(new Event('error'));
            expect(onFailure).not.toHaveBeenCalled();
        });
    });
});
