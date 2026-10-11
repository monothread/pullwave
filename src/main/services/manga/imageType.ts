export interface ImageType {
    mime: string;
    extension: string;
}

const JPEG: ImageType = { mime: 'image/jpeg', extension: 'jpg' };
const PNG: ImageType = { mime: 'image/png', extension: 'png' };
const GIF: ImageType = { mime: 'image/gif', extension: 'gif' };
const WEBP: ImageType = { mime: 'image/webp', extension: 'webp' };
const AVIF: ImageType = { mime: 'image/avif', extension: 'avif' };
const BMP: ImageType = { mime: 'image/bmp', extension: 'bmp' };

// How many bytes at the start of a file are enough to tell what it is.
export const IMAGE_SIGNATURE_BYTES = 16;

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
    return signature.every((value, position) => {
        return bytes[offset + position] === value;
    });
}

function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
    return startsWith(bytes, [...text].map((character) => {
        return character.charCodeAt(0);
    }), offset);
}

// What an image is by its first bytes (null when they are not those of an image the readers handle). The `Content-Type` of a
// site is often wrong, the bytes are not.
export function detectImageType(bytes: Uint8Array): ImageType | null {
    if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
        return JPEG;
    }
    if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
        return PNG;
    }
    if (asciiAt(bytes, 0, 'GIF87a') || asciiAt(bytes, 0, 'GIF89a')) {
        return GIF;
    }
    if (asciiAt(bytes, 0, 'RIFF') && asciiAt(bytes, 8, 'WEBP')) {
        return WEBP;
    }
    if (asciiAt(bytes, 4, 'ftyp') && (asciiAt(bytes, 8, 'avif') || asciiAt(bytes, 8, 'avis'))) {
        return AVIF;
    }
    if (asciiAt(bytes, 0, 'BM')) {
        return BMP;
    }
    return null;
}

const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'image/bmp': 'bmp'
};

// The type to use for a file: what its bytes say, otherwise what the site said it was, otherwise a JPEG.
export function resolveImageType(bytes: Uint8Array, contentType: string | null): ImageType {
    const detected = detectImageType(bytes);
    if (detected !== null) {
        return detected;
    }
    const mime = contentType?.split(';')[0]?.trim().toLowerCase() ?? '';
    const extension = EXTENSION_BY_MIME[mime];
    return extension === undefined ? JPEG : { mime: mime === 'image/jpg' ? 'image/jpeg' : mime, extension };
}
