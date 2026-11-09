import { imageHeaderLength, MAX_IMAGE_HEADER_BYTES } from '@main/services/hidingImage';

// Built chunk by chunk so that the length of every part is right whatever the picture is: signature, IHDR (1x1), IDAT and IEND.
function chunk(type: string, data: Uint8Array): Buffer {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(data.length, 0);
    header.write(type, 4, 'ascii');
    return Buffer.concat([header, data, Buffer.alloc(4, 0xab)]);
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PICTURE = Buffer.concat([SIGNATURE, chunk('IHDR', Buffer.alloc(13, 1)), chunk('IDAT', Buffer.alloc(13, 2)), chunk('IEND', Buffer.alloc(0))]);
// A piece of transport stream: the sync byte 0x47 every 188 bytes.
const VIDEO = Buffer.concat(
    Array.from({ length: 4 }, (_value, index) => {
        return Buffer.concat([Buffer.from([0x47]), Buffer.alloc(187, index + 1)]);
    })
);

describe('the picture the tests use', () => {
    it('is a picture of 70 bytes like the one the source puts in front of every segment', () => {
        expect(PICTURE.length).toBe(8 + 25 + 25 + 12);
        expect(PICTURE.length).toBe(70);
    });
});

describe('imageHeaderLength', () => {
    it('gives the length of the picture when data follows it', () => {
        expect(imageHeaderLength(Buffer.concat([PICTURE, VIDEO]))).toBe(70);
    });

    it('gives null for data that does not start with a picture', () => {
        expect(imageHeaderLength(VIDEO)).toBeNull();
        expect(imageHeaderLength(Buffer.from('WEBVTT\n\n'))).toBeNull();
        expect(imageHeaderLength(new Uint8Array(0))).toBeNull();
    });

    it('gives null for a picture with nothing after it, which is a picture and not a hidden video', () => {
        expect(imageHeaderLength(PICTURE)).toBeNull();
    });

    it('gives null while the bytes do not reach the end of the picture', () => {
        expect(imageHeaderLength(PICTURE.subarray(0, 40))).toBeNull();
        expect(imageHeaderLength(PICTURE.subarray(0, 69))).toBeNull();
    });

    it('gives null for a picture whose chunks do not fit in the limit', () => {
        const big = Buffer.concat([SIGNATURE, chunk('IDAT', Buffer.alloc(MAX_IMAGE_HEADER_BYTES)), chunk('IEND', Buffer.alloc(0)), VIDEO]);
        expect(imageHeaderLength(big)).toBeNull();
    });
});
