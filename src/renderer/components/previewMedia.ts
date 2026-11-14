import Hls from 'hls.js';
import { lowestLevelIndex } from './streamLevel';
import type { PreviewMedia, SeekPreviewSource } from './seekPreview';

// How much of the stream the preview loads past the second it shows: the segment of that second, and little more.
export const PREVIEW_BUFFER_SECONDS = 4;

function hiddenVideo(): HTMLVideoElement {
    const element = document.createElement('video');
    element.muted = true;
    element.preload = 'auto';
    element.crossOrigin = 'anonymous';
    return element;
}

function emptyVideo(element: HTMLVideoElement): void {
    element.removeAttribute('src');
    element.load();
}

function openFile(element: HTMLVideoElement, url: string): () => void {
    element.src = url;
    return () => {
        emptyVideo(element);
    };
}

// The playlist goes through hls.js, as the player's own does, at the lightest quality of the source: the preview is a small picture.
function openPlaylist(element: HTMLVideoElement, url: string, startAt: number, onFailure: () => void): () => void {
    const hls = new Hls({ enableWorker: false, maxBufferLength: PREVIEW_BUFFER_SECONDS, maxMaxBufferLength: PREVIEW_BUFFER_SECONDS, startPosition: startAt });
    hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
            onFailure();
        }
    });
    hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        const lowest = lowestLevelIndex(data.levels);
        if (lowest !== null) {
            hls.currentLevel = lowest;
        }
    });
    hls.loadSource(url);
    hls.attachMedia(element);
    return () => {
        hls.destroy();
        emptyVideo(element);
    };
}

// Opens the hidden video the frames of the preview are taken from. It is muted, never played and never put in the page.
export function openPreviewMedia(source: SeekPreviewSource, startAt: number, onFailure: () => void): PreviewMedia {
    const element = hiddenVideo();
    element.addEventListener('error', onFailure);
    const stop = source.kind === 'file' ? openFile(element, source.url) : openPlaylist(element, source.url, startAt, onFailure);
    return {
        element,
        close: () => {
            element.removeEventListener('error', onFailure);
            stop();
        }
    };
}
