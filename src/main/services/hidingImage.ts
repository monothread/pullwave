const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const CHUNK_HEADER_BYTES = 8;
const CHUNK_CRC_BYTES = 4;
const END_CHUNK = 'IEND';
export const MAX_IMAGE_HEADER_BYTES = 64 * 1024;

function startsWithPngSignature(bytes: Uint8Array): boolean {
    return PNG_SIGNATURE.every((byte, position) => {
        return bytes[position] === byte;
    });
}

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

export function imageHeaderLength(bytes: Uint8Array): number | null {
    if (!startsWithPngSignature(bytes)) {
        return null;
    }
    const end = endOfPicture(bytes);
    return end !== null && end > 0 && bytes.length > end ? end : null;
}
