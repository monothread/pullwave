// Some sources hide the video of an episode behind a picture: every segment starts with a small PNG image (a 1x1 pixel one, 70 bytes) and the video
// comes right after it, and the segments are named like images (seg_00000.ts.jpg). hls.js finds the video after the picture by itself, so the app
// plays such an episode as it is; yt-dlp joins the segments as they come, and what it saves is a file no player opens (mpv: "error reading
// packet"). Repairing that file is imageHeaderRepair.ts; this is how the picture is told.

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const CHUNK_HEADER_BYTES = 8;
const CHUNK_CRC_BYTES = 4;
const END_CHUNK = 'IEND';
// A picture longer than this is not the cover of a segment: the one seen is 70 bytes.
export const MAX_IMAGE_HEADER_BYTES = 64 * 1024;

function startsWithPngSignature(bytes: Uint8Array): boolean {
    return PNG_SIGNATURE.every((byte, position) => {
        return bytes[position] === byte;
    });
}

// Where the picture ends (the end of its IEND chunk), or null while the bytes do not reach it, and -1 when the chunks do not fit in the limit.
function endOfPicture(bytes: Uint8Array): number | null {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let position = PNG_SIGNATURE.length;
    while (position + CHUNK_HEADER_BYTES <= bytes.length) {
        const length = view.getUint32(position);
        const type = String.fromCharCode(...bytes.subarray(position + 4, position + 8));
        const end = position + CHUNK_HEADER_BYTES + length + CHUNK_CRC_BYTES;
        if (end > MAX_IMAGE_HEADER_BYTES) {
            return -1;
        }
        if (type === END_CHUNK) {
            return end <= bytes.length ? end : null;
        }
        position = end;
    }
    return null;
}

// How many bytes at the start are a picture that is followed by data (the end of its IEND chunk), or null when the start is not that. A picture
// with nothing after it is only a picture.
export function imageHeaderLength(bytes: Uint8Array): number | null {
    if (!startsWithPngSignature(bytes)) {
        return null;
    }
    const end = endOfPicture(bytes);
    return end !== null && end > 0 && bytes.length > end ? end : null;
}
