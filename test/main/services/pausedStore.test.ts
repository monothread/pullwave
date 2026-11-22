import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { keepInside, PausedStore, readExtras, readParts, readPausedDownload, type PausedDownload } from '@main/services/pausedStore';
import { cleanTempDirs, makeTempDir } from '../../helpers/tempDir';
import { makeJob } from '../../helpers/mockApi';

afterEach(() => {
    cleanTempDirs();
});

const DL_DIR = resolve('dl');
const OTHER_DIR = resolve('dl', 'other');

const PAUSED: PausedDownload = {
    job: makeJob({ id: 'job-1', url: 'https://example.com/video', status: 'paused', title: 'Some Video', percent: 42.5, speed: '', eta: '', createdAt: 1700000000000, customized: true }),
    extras: { downloadDir: OTHER_DIR, options: { maxResolution: '720' } },
    outputPaths: [join(DL_DIR, 'Some Video [abc].mp4'), join(DL_DIR, 'Some Video [abc].f137.mp4')]
};

describe('readPausedDownload', () => {
    it('reads a download as it was kept', () => {
        expect(readPausedDownload(JSON.parse(JSON.stringify(PAUSED)))).toEqual(PAUSED);
    });

    it('makes the card a paused one with nothing running, whatever the file says', () => {
        const read = readPausedDownload({
            ...PAUSED,
            job: { ...PAUSED.job, status: 'running', speed: '1MiB/s', eta: '00:10', live: true, waitingForLive: true, merging: true, saving: true, postProcess: 'Merger', postProcessSteps: ['Merger'], filePath: '/dl/x.mp4', hasPartial: true, downloadedBytes: 5, elapsedSeconds: 9, error: { code: 'NETWORK' } }
        });

        expect(read?.job).toMatchObject({ status: 'paused', speed: '', eta: '', live: false, waitingForLive: false, merging: false, saving: false, postProcess: null, postProcessSteps: [], filePath: null, hasPartial: false, downloadedBytes: 0, elapsedSeconds: 0, error: null, endCheck: null });
    });

    it('brings a paused download back without a picture: the pictures are kept in memory only, so the one of an earlier run is gone', () => {
        const read = readPausedDownload({ ...PAUSED, job: { ...PAUSED.job, thumbnail: 'pullwave-thumb://job/p1?v=3' } });
        expect(read?.job.thumbnail).toBeNull();
    });

    it('brings back the bars of the parts of a download whose video and audio come apart', () => {
        const parts = [
            { kind: 'video', percent: 100 },
            { kind: 'audio', percent: 37.5 }
        ];
        const read = readPausedDownload(JSON.parse(JSON.stringify({ ...PAUSED, job: { ...PAUSED.job, parts } })));
        expect(read?.job.parts).toEqual(parts);
    });

    it('has no bars of parts when the file has none, or has some that cannot be read', () => {
        expect(readPausedDownload({ ...PAUSED, job: { ...PAUSED.job, parts: undefined } })?.job.parts).toBeNull();
        expect(readPausedDownload({ ...PAUSED, job: { ...PAUSED.job, parts: [{ kind: 'subtitle', percent: 5 }, { kind: 'audio', percent: 5 }] } })?.job.parts).toBeNull();
    });

    it('keeps the percent between 0 and 100', () => {
        expect(readPausedDownload({ ...PAUSED, job: { ...PAUSED.job, percent: 250 } })?.job.percent).toBe(100);
        expect(readPausedDownload({ ...PAUSED, job: { ...PAUSED.job, percent: -4 } })?.job.percent).toBe(0);
    });

    it('has no title when the file has none that is text', () => {
        const read = readPausedDownload({ ...PAUSED, job: { ...PAUSED.job, title: 5, customized: 'yes' } });

        expect(read?.job).toMatchObject({ title: null, customized: false });
    });

    it('has no extras and no files when the file has none that is valid', () => {
        expect(readPausedDownload({ job: PAUSED.job, extras: 'x', outputPaths: 'y' })).toMatchObject({ extras: {}, outputPaths: [] });
        expect(readPausedDownload({ job: PAUSED.job, extras: [1], outputPaths: [1, '', null, '/dl/a.mp4'] })).toMatchObject({ extras: {}, outputPaths: ['/dl/a.mp4'] });
        expect(readPausedDownload({ job: PAUSED.job })).toMatchObject({ extras: {}, outputPaths: [] });
    });

    it.each([
        ['null', null],
        ['text', 'x'],
        ['an entry without a card', { extras: {}, outputPaths: [] }],
        ['a card without an id', { job: { ...PAUSED.job, id: '' } }],
        ['a card with an id that is not text', { job: { ...PAUSED.job, id: 5 } }],
        ['a card without an address', { job: { ...PAUSED.job, url: undefined } }],
        ['a card with an address that is empty', { job: { ...PAUSED.job, url: '' } }],
        ['a card without a percent', { job: { ...PAUSED.job, percent: 'half' } }],
        ['a card with a percent that is not a number', { job: { ...PAUSED.job, percent: Number.NaN } }],
        ['a card without a date', { job: { ...PAUSED.job, createdAt: undefined } }]
    ])('does not read %s', (_name, raw) => {
        expect(readPausedDownload(raw)).toBeNull();
    });
});

describe('PausedStore', () => {
    it('has nothing when there is no file', () => {
        expect(new PausedStore(join(makeTempDir(), 'paused.json')).load()).toEqual([]);
    });

    it('gives back what was saved, in the same order', () => {
        const store = new PausedStore(join(makeTempDir(), 'paused.json'));
        const second: PausedDownload = { ...PAUSED, job: { ...PAUSED.job, id: 'job-2', url: 'https://example.com/other' }, extras: {}, outputPaths: [] };

        store.save([PAUSED, second]);

        expect(store.load()).toEqual([PAUSED, second]);
    });

    it('keeps it for the next run: a new store on the same file reads it', () => {
        const path = join(makeTempDir(), 'paused.json');
        new PausedStore(path).save([PAUSED]);

        expect(new PausedStore(path).load()).toEqual([PAUSED]);
    });

    it('replaces what was saved, and saving none leaves none', () => {
        const store = new PausedStore(join(makeTempDir(), 'paused.json'));
        store.save([PAUSED]);
        store.save([]);

        expect(store.load()).toEqual([]);
    });

    it('creates the folder of the file when it is not there', () => {
        const path = join(makeTempDir(), 'deeper', 'folders', 'paused.json');
        const store = new PausedStore(path);

        store.save([PAUSED]);

        expect(store.load()).toEqual([PAUSED]);
    });

    it('has nothing when the file is not JSON, or is not a list', () => {
        const directory = makeTempDir();
        writeFileSync(join(directory, 'broken.json'), 'not json');
        writeFileSync(join(directory, 'object.json'), '{"job":{}}');

        expect(new PausedStore(join(directory, 'broken.json')).load()).toEqual([]);
        expect(new PausedStore(join(directory, 'object.json')).load()).toEqual([]);
    });

    it('leaves out the entries that are not downloads and keeps the ones that are', () => {
        const directory = makeTempDir();
        writeFileSync(join(directory, 'paused.json'), JSON.stringify([null, 'x', { job: { id: 'a' } }, PAUSED]));

        expect(new PausedStore(join(directory, 'paused.json')).load()).toEqual([PAUSED]);
    });

    it('does not fail when the file cannot be written: the pause then lasts while the app is open', () => {
        const directory = makeTempDir();
        writeFileSync(join(directory, 'in-the-way'), 'a file where a folder should be');
        const store = new PausedStore(join(directory, 'in-the-way', 'paused.json'));

        expect(() => {
            store.save([PAUSED]);
        }).not.toThrow();
        expect(store.load()).toEqual([]);
    });
});

describe('readParts', () => {
    it('reads two parts or more, each of a kind the app knows and with a percent', () => {
        expect(readParts([{ kind: 'video', percent: 100 }, { kind: 'audio', percent: 0 }, { kind: 'other', percent: 12.5 }])).toEqual([
            { kind: 'video', percent: 100 },
            { kind: 'audio', percent: 0 },
            { kind: 'other', percent: 12.5 }
        ]);
    });

    it('keeps the percent of each part between 0 and 100', () => {
        expect(readParts([{ kind: 'video', percent: 180 }, { kind: 'audio', percent: -2 }])).toEqual([
            { kind: 'video', percent: 100 },
            { kind: 'audio', percent: 0 }
        ]);
    });

    it('leaves out the fields a part does not have', () => {
        expect(readParts([{ kind: 'video', percent: 10, formatId: '137' }, { kind: 'audio', percent: 0, extra: true }])).toEqual([
            { kind: 'video', percent: 10 },
            { kind: 'audio', percent: 0 }
        ]);
    });

    it.each([
        ['nothing', undefined],
        ['null', null],
        ['an object that is not a list', { kind: 'video', percent: 1 }],
        ['an empty list', []],
        ['a single part', [{ kind: 'video', percent: 1 }]]
    ])('has no parts for %s', (_name, raw) => {
        expect(readParts(raw)).toBeNull();
    });

    it.each([
        ['a kind the app does not know', { kind: 'subtitle', percent: 1 }],
        ['no kind', { percent: 1 }],
        ['a percent that is not a number', { kind: 'audio', percent: '50' }],
        ['a percent that is not finite', { kind: 'audio', percent: Number.NaN }],
        ['something that is not an object', 'audio'],
        ['null', null]
    ])('has no parts when one of them has %s', (_name, part) => {
        expect(readParts([{ kind: 'video', percent: 100 }, part])).toBeNull();
    });
});

describe('readExtras', () => {
    it('keeps every field a download can have, as it was kept', () => {
        expect(readExtras(PAUSED.extras)).toEqual(PAUSED.extras);
    });

    it.each([null, undefined, 'x', 5, true, [1, 2], []])('has no extras for %j', (raw) => {
        expect(readExtras(raw)).toEqual({});
    });

    it('drops legacy stream-finder fields and resumedPart even when an older file has them', () => {
        expect(
            readExtras({
                referer: 'https://example.com/',
                userAgent: 'Mozilla/5.0',
                title: 'Old Title',
                pageUrl: 'https://example.com/page',
                ipFamily: 4,
                cookie: 'session=secret',
                resumedPart: 2,
                downloadDir: OTHER_DIR
            })
        ).toEqual({ downloadDir: OTHER_DIR });
    });

    it('leaves out fields that are not valid', () => {
        expect(readExtras({ downloadDir: {} })).toEqual({});
    });

    it('leaves out a folder path that is longer than any real one', () => {
        expect(readExtras({ downloadDir: join(DL_DIR, 'a'.repeat(4097)) })).toEqual({});
    });

    it.each([
        ['relative/folder'],
        ['./folder'],
        ['']
    ])('leaves out the folder %j, because it is not an absolute path', (downloadDir) => {
        expect(readExtras({ downloadDir })).toEqual({});
    });

    it('keeps an absolute folder', () => {
        const videosDir = resolve('home', 'user', 'Videos');
        expect(readExtras({ downloadDir: videosDir })).toEqual({ downloadDir: videosDir });
    });

    it('keeps the options that are valid and leaves out the rest, as when a download is added', () => {
        expect(readExtras({ options: { maxResolution: '720', audioOnly: true, verifyLiveEndSeconds: 9999, extraArgs: '--exec rm', maxResolution2: 1 } })).toEqual({
            options: { maxResolution: '720', audioOnly: true, verifyLiveEndSeconds: 120 }
        });
        expect(readExtras({ options: { maxResolution: '9999', audioOnly: 'yes' } })).toEqual({});
        expect(readExtras({ options: 'x' })).toEqual({});
    });
});

describe('keepInside', () => {
    const inside = (name: string): string => {
        return join(DL_DIR, name);
    };

    it('keeps the files in the folder, in the folders below it, and in the same order', () => {
        const files = [inside('b.mp4'), join(DL_DIR, 'sub', 'a.mp4'), join(DL_DIR, 'sub', 'deeper', 'c.mp4')];
        expect(keepInside(files, DL_DIR)).toEqual(files);
    });

    it('drops the files that are somewhere else, including the ones that only start with the same name', () => {
        const validFile = inside('a.mp4');
        expect(keepInside([resolve('etc', 'passwd'), join(`${DL_DIR}x`, 'a.mp4'), resolve('home', 'a.mp4'), validFile], DL_DIR)).toEqual([validFile]);
    });

    it('drops the files that leave the folder with ..', () => {
        const stillInside = join(DL_DIR, 'sub', '..', 'c.mp4');
        expect(keepInside([join(DL_DIR, '..', 'etc', 'a.mp4'), join(DL_DIR, 'sub', '..', '..', 'etc', 'b.mp4'), stillInside], DL_DIR)).toEqual([stillInside]);
    });

    it('drops a path that is not absolute, whatever the folder the process is in', () => {
        expect(keepInside(['a.mp4', 'dl/a.mp4', './a.mp4'], DL_DIR)).toEqual([]);
    });

    it('drops the folder itself, which is not a file in it', () => {
        expect(keepInside([DL_DIR, `${DL_DIR}/`], DL_DIR)).toEqual([]);
    });

    it('accepts a folder written with a trailing slash', () => {
        const validFile = inside('a.mp4');
        expect(keepInside([validFile], `${DL_DIR}/`)).toEqual([validFile]);
    });

    it('has nothing for no files', () => {
        expect(keepInside([], DL_DIR)).toEqual([]);
    });
});

describe('readPausedDownload with edited extras and files', () => {
    it('reads the extras through their check and keeps the long file names out', () => {
        const fileA = join(DL_DIR, 'a.mp4');
        const read = readPausedDownload({ job: PAUSED.job, extras: { downloadDir: OTHER_DIR, referer: 'https://example.com/', cookie: 'secret' }, outputPaths: [fileA, 'a'.repeat(5000)] });
        expect(read?.extras).toEqual({ downloadDir: OTHER_DIR });
        expect(read?.outputPaths).toEqual([fileA]);
    });
});
