import { VIDEO_THUMBNAIL_SCHEME } from '@shared/constants';
import { processLogs, type LogHub } from './logHub';
import { STREAM_USER_AGENT } from './streamProxy';

export const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;
export const THUMBNAIL_TIMEOUT_MS = 15_000;
export const MAX_THUMBNAILS = 50;
const PICTURE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

interface Picture {
    bytes: Uint8Array<ArrayBuffer>;
    type: string;
}

export interface VideoThumbnailsDependencies {
    fetchImpl?: typeof fetch;
    log?: Pick<LogHub, 'write'>;
    timeoutMs?: number;
    maxBytes?: number;
    maxPictures?: number;
}

class PictureError extends Error {}

function pictureType(response: Response): string {
    return (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

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

export class VideoThumbnails {
    private readonly pictures = new Map<string, Picture>();
    private version = 0;

    constructor(private readonly deps: VideoThumbnailsDependencies = {}) {}

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
