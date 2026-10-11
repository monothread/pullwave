import { crc32 } from 'node:zlib';

export interface CraftedEntry {
    name: string;
    data?: string;
    // The Unix mode kept in the external attributes (for executables, links and folders).
    mode?: number;
}

// A ZIP with stored entries and whatever names and modes are asked for, including the ones a careful writer refuses to make
// (a path that goes up, an absolute path, a link).
export function craftZip(entries: readonly CraftedEntry[]): Buffer {
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    entries.forEach((entry) => {
        const name = Buffer.from(entry.name, 'utf-8');
        const data = Buffer.from(entry.data ?? '', 'utf-8');
        const checksum = crc32(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt32LE(checksum, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(0x031e, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt32LE(checksum, 16);
        central.writeUInt32LE(data.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38);
        central.writeUInt32LE(offset, 42);
        locals.push(local, name, data);
        centrals.push(central, name);
        offset += local.length + name.length + data.length;
    });
    const directory = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, directory, end]);
}
