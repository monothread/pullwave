import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import { isCompletePage, pageIndexOfFile } from './mangaFiles';

function openZip(file: string): Promise<yauzl.ZipFile> {
    return new Promise((resolve, reject) => {
        yauzl.open(file, { lazyEntries: true, autoClose: false }, (error, zip) => {
            if (error !== null || zip === undefined) {
                reject(error ?? new Error('The file of the chapter could not be opened'));
                return;
            }
            resolve(zip);
        });
    });
}

function openEntry(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<NodeJS.ReadableStream> {
    return new Promise((resolve, reject) => {
        zip.openReadStream(entry, (error, stream) => {
            if (error !== null || stream === undefined) {
                reject(error ?? new Error('The page could not be read'));
                return;
            }
            resolve(stream);
        });
    });
}

// Puts the pages of a CBZ the app made (the files named after their place, "001.jpg"...) into a folder. Anything else in the archive
// (the ComicInfo, a name with a path) is left out: the names written are never the ones of the archive.
export async function extractCbzPages(file: string, directory: string): Promise<void> {
    const zip = await openZip(file);
    try {
        await new Promise<void>((resolve, reject) => {
            zip.on('entry', (entry: yauzl.Entry) => {
                if (pageIndexOfFile(entry.fileName) === null || !isCompletePage(entry.fileName)) {
                    zip.readEntry();
                    return;
                }
                openEntry(zip, entry)
                    .then((stream) => {
                        return pipeline(stream, createWriteStream(join(directory, entry.fileName)));
                    })
                    .then(() => {
                        zip.readEntry();
                    })
                    .catch(reject);
            });
            zip.once('end', resolve);
            zip.once('error', reject);
            zip.readEntry();
        });
    } finally {
        zip.close();
    }
}
