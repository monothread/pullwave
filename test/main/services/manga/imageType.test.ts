import { detectImageType, IMAGE_SIGNATURE_BYTES, resolveImageType } from '@main/services/manga/imageType';

function bytes(...values: number[]): Uint8Array {
    return Uint8Array.from(values);
}

function ascii(text: string): number[] {
    return [...text].map((character) => {
        return character.charCodeAt(0);
    });
}

const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0);
const GIF89 = bytes(...ascii('GIF89a'), 1, 0);
const GIF87 = bytes(...ascii('GIF87a'), 1, 0);
const WEBP = bytes(...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WEBP'), 0);
const AVIF = bytes(0, 0, 0, 0x20, ...ascii('ftyp'), ...ascii('avif'));
const AVIS = bytes(0, 0, 0, 0x20, ...ascii('ftyp'), ...ascii('avis'));
const BMP = bytes(...ascii('BM'), 0, 0);

describe('detectImageType', () => {
    it('reads at most 16 bytes of a file', () => {
        expect(IMAGE_SIGNATURE_BYTES).toBe(16);
    });

    it.each([
        ['a JPEG', JPEG, { mime: 'image/jpeg', extension: 'jpg' }],
        ['a PNG', PNG, { mime: 'image/png', extension: 'png' }],
        ['a GIF89a', GIF89, { mime: 'image/gif', extension: 'gif' }],
        ['a GIF87a', GIF87, { mime: 'image/gif', extension: 'gif' }],
        ['a WebP', WEBP, { mime: 'image/webp', extension: 'webp' }],
        ['an AVIF', AVIF, { mime: 'image/avif', extension: 'avif' }],
        ['an AVIF sequence', AVIS, { mime: 'image/avif', extension: 'avif' }],
        ['a BMP', BMP, { mime: 'image/bmp', extension: 'bmp' }]
    ])('recognizes %s by its first bytes', (_name, content, expected) => {
        expect(detectImageType(content)).toEqual(expected);
    });

    it('returns null for an HTML error page', () => {
        expect(detectImageType(bytes(...ascii('<!DOCTYPE html>')))).toBeNull();
    });

    it('returns null for an empty file', () => {
        expect(detectImageType(new Uint8Array())).toBeNull();
    });

    it('does not take a RIFF file that is not WebP for an image', () => {
        expect(detectImageType(bytes(...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WAVE')))).toBeNull();
    });

    it('does not take an ftyp box of another brand for AVIF', () => {
        expect(detectImageType(bytes(0, 0, 0, 0x20, ...ascii('ftyp'), ...ascii('mp42')))).toBeNull();
    });
});

describe('resolveImageType', () => {
    it('trusts the bytes over what the site said', () => {
        expect(resolveImageType(PNG, 'image/jpeg')).toEqual({ mime: 'image/png', extension: 'png' });
    });

    it('falls back to the Content-Type when the bytes are not recognized', () => {
        expect(resolveImageType(bytes(1, 2, 3), 'image/webp; charset=binary')).toEqual({ mime: 'image/webp', extension: 'webp' });
    });

    it('maps image/jpg to image/jpeg', () => {
        expect(resolveImageType(bytes(1, 2, 3), 'image/jpg')).toEqual({ mime: 'image/jpeg', extension: 'jpg' });
    });

    it('defaults to a JPEG when nothing is known', () => {
        expect(resolveImageType(bytes(1, 2, 3), null)).toEqual({ mime: 'image/jpeg', extension: 'jpg' });
    });

    it('defaults to a JPEG for a Content-Type that is not an image', () => {
        expect(resolveImageType(bytes(1, 2, 3), 'text/html')).toEqual({ mime: 'image/jpeg', extension: 'jpg' });
    });
});
