import { inflateRawSync } from 'node:zlib';

export interface ZipEntry {
    name: string;
    // 0 is stored, 8 is deflated.
    method: number;
    data: Buffer;
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;

// Reads the entries of a ZIP (enough of the format for the archives the app writes).
export function readZipEntries(zip: Buffer): ZipEntry[] {
    let end = zip.length - 22;
    while (end >= 0 && zip.readUInt32LE(end) !== END_OF_CENTRAL_DIRECTORY) {
        end -= 1;
    }
    if (end < 0) {
        throw new Error('Not a zip file');
    }
    const count = zip.readUInt16LE(end + 10);
    let offset = zip.readUInt32LE(end + 16);
    const entries: ZipEntry[] = [];
    for (let position = 0; position < count; position += 1) {
        if (zip.readUInt32LE(offset) !== CENTRAL_DIRECTORY_HEADER) {
            throw new Error('Broken central directory');
        }
        const method = zip.readUInt16LE(offset + 10);
        const compressedSize = zip.readUInt32LE(offset + 20);
        const nameLength = zip.readUInt16LE(offset + 28);
        const extraLength = zip.readUInt16LE(offset + 30);
        const commentLength = zip.readUInt16LE(offset + 32);
        const localOffset = zip.readUInt32LE(offset + 42);
        const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf-8');
        const localNameLength = zip.readUInt16LE(localOffset + 26);
        const localExtraLength = zip.readUInt16LE(localOffset + 28);
        const start = localOffset + 30 + localNameLength + localExtraLength;
        const raw = zip.subarray(start, start + compressedSize);
        entries.push({ name, method, data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) });
        offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
}
