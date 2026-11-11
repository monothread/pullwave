import { VIDEO_THUMBNAIL_SCHEME } from '@shared/constants';
import { processLogs, type LogHub } from './logHub';
import { STREAM_USER_AGENT } from './streamProxy';

// The largest picture that is kept, and how long its address has to answer.
export const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;
export const THUMBNAIL_TIMEOUT_MS = 15_000;
// The most pictures kept at once: one per download of the queue; past it the oldest goes.
export const MAX_THUMBNAILS = 50;
// The kinds of picture the window can show.
const PICTURE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

interface Picture {
    bytes: Uint8Array<ArrayBuffer>;
    type: string;
}

export interface VideoThumbnailsDependencies {
    fetchImpl?: typeof fetch;
    // Where a picture that could not be fetched is told (the log of yt-dlp by default).
    log?: Pick<LogHub, 'write'>;
    timeoutMs?: number;
    maxBytes?: number;
    maxPictures?: number;
}

class PictureError extends Error {}

// The kind of the picture as the server says it, without its parameters (`image/jpeg; charset=…`).
function pictureType(response: Response): string {
    return (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

// The body of the answer, stopped as soon as it is larger than the limit (the size the server announces is not trusted).
async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
    const announced = Number(response.headers.get('content-length') ?? '');
    if (Number.isFinite(announced) && announced > maxBytes) {
        throw new PictureError(`too large (${String(announced)} bytes)`);
    }
    const reader = response.body?.getReader();
    if (reader === undefined) {
        return new Uint8Array(await response.arrayBuffer());
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel();
            throw new PictureError(`too large (more than ${String(maxBytes)} bytes)`);
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    chunks.forEach((chunk) => {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    });
    return bytes;
}

// The address of a picture as the window asks for it: `pullwave-thumb://job/<id>?v=<n>`; null when it is not one.
export function parseThumbnailAddress(address: string): string | null {
    try {
        const url = new URL(address);
        if (url.protocol !== `${VIDEO_THUMBNAIL_SCHEME}:` || url.hostname !== 'job') {
            return null;
        }
        const id = decodeURIComponent(url.pathname.replace(/^\//, ''));
        return id.length > 0 ? id : null;
    } catch {
        return null;
    }
}

// The pictures of the videos of the queue, fetched by the app from the address yt-dlp gives and kept in memory only: the window shows them
// from here, so it never asks a site itself (sites refuse pictures asked from another page, and their addresses expire). A picture goes
// when its download leaves the queue, and nothing is written to the disk.
export class VideoThumbnails {
    private readonly pictures = new Map<string, Picture>();
    private version = 0;

    constructor(private readonly deps: VideoThumbnailsDependencies = {}) {}

    // Fetches the picture of a download and gives the address the window shows it at, or null when it could not be fetched.
    async load(jobId: string, address: string): Promise<string | null> {
        try {
            const picture = await this.fetchPicture(address);
            this.keep(jobId, picture);
            this.version += 1;
            return `${VIDEO_THUMBNAIL_SCHEME}://job/${encodeURIComponent(jobId)}?v=${String(this.version)}`;
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            (this.deps.log ?? processLogs).write('yt-dlp', 'event', `the picture of the video could not be fetched (${reason}): ${address}`);
            return null;
        }
    }

    forget(jobId: string): void {
        this.pictures.delete(jobId);
    }

    // The answer to the window for an address of a picture: the picture, or 404 when it is not there (any more).
    respond(address: string): Response {
        const id = parseThumbnailAddress(address);
        const picture = id === null ? undefined : this.pictures.get(id);
        if (picture === undefined) {
            return new Response(null, { status: 404 });
        }
        return new Response(picture.bytes, { status: 200, headers: { 'Content-Type': picture.type, 'Cache-Control': 'no-store' } });
    }

    private keep(jobId: string, picture: Picture): void {
        this.pictures.delete(jobId);
        this.pictures.set(jobId, picture);
        const max = this.deps.maxPictures ?? MAX_THUMBNAILS;
        while (this.pictures.size > max) {
            const oldest = this.pictures.keys().next().value;
            if (oldest === undefined) {
                break;
            }
            this.pictures.delete(oldest);
        }
    }

    private async fetchPicture(address: string): Promise<Picture> {
        const response = await (this.deps.fetchImpl ?? fetch)(address, {
            headers: { 'User-Agent': STREAM_USER_AGENT, Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8' },
            redirect: 'follow',
            signal: AbortSignal.timeout(this.deps.timeoutMs ?? THUMBNAIL_TIMEOUT_MS)
        });
        if (!response.ok) {
            throw new PictureError(`HTTP ${String(response.status)}`);
        }
        const type = pictureType(response);
        if (!PICTURE_TYPES.has(type)) {
            throw new PictureError(`not a picture: ${type === '' ? 'no type' : type}`);
        }
        const bytes = await readLimited(response, this.deps.maxBytes ?? MAX_THUMBNAIL_BYTES);
        if (bytes.byteLength === 0) {
            throw new PictureError('empty');
        }
        return { bytes, type };
    }
}
