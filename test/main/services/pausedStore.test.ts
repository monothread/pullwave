import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { keepInside, PausedStore, readExtras, readPausedDownload, type PausedDownload } from '@main/services/pausedStore';
import { cleanTempDirs, makeTempDir } from '../../helpers/tempDir';
import { makeJob } from '../../helpers/mockApi';

afterEach(() => {
    cleanTempDirs();
});

const PAUSED: PausedDownload = {
    job: makeJob({ id: 'job-1', url: 'https://example.com/video', status: 'paused', title: 'Some Video', percent: 42.5, speed: '', eta: '', createdAt: 1700000000000, pageUrl: 'https://example.com/page', customized: true }),
    extras: { referer: 'https://example.com/', userAgent: 'Mozilla/5.0', title: 'Some Video', downloadDir: '/dl/other', ipFamily: 4, pageUrl: 'https://example.com/page', options: { maxResolution: '720' } },
    outputPaths: ['/dl/Some Video [abc].mp4', '/dl/Some Video [abc].f137.mp4']
};

describe('readPausedDownload', () => {
    it('reads a download as it was kept', () => {
        expect(readPausedDownload(JSON.parse(JSON.stringify(PAUSED)))).toEqual(PAUSED);
    });

    it('makes the card a paused one with nothing running, whatever the file says', () => {
        const read = readPausedDownload({
            ...PAUSED,
            job: { ...PAUSED.job, status: 'running', speed: '1MiB/s', eta: '00:10', live: true, waitingForLive: true, merging: true, saving: true, postProcess: 'Merger', filePath: '/dl/x.mp4', hasPartial: true, downloadedBytes: 5, elapsedSeconds: 9, error: { code: 'NETWORK' } }
        });

        expect(read?.job).toMatchObject({ status: 'paused', speed: '', eta: '', live: false, waitingForLive: false, merging: false, saving: false, postProcess: null, filePath: null, hasPartial: false, downloadedBytes: 0, elapsedSeconds: 0, error: null, endCheck: null });
    });

    it('keeps the percent between 0 and 100', () => {
        expect(readPausedDownload({ ...PAUSED, job: { ...PAUSED.job, percent: 250 } })?.job.percent).toBe(100);
        expect(readPausedDownload({ ...PAUSED, job: { ...PAUSED.job, percent: -4 } })?.job.percent).toBe(0);
    });

    it('has no title or page when the file has none that is text', () => {
        const read = readPausedDownload({ ...PAUSED, job: { ...PAUSED.job, title: 5, pageUrl: null, customized: 'yes' } });

        expect(read?.job).toMatchObject({ title: null, pageUrl: null, customized: false });
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

describe('readExtras', () => {
    it('keeps every field a download can have, as it was kept', () => {
        expect(readExtras(PAUSED.extras)).toEqual(PAUSED.extras);
    });

    it.each([null, undefined, 'x', 5, true, [1, 2], []])('has no extras for %j', (raw) => {
        expect(readExtras(raw)).toEqual({});
    });

    it('never reads the cookie or the part number, even when the file has them', () => {
        expect(readExtras({ referer: 'https://example.com/', cookie: 'session=secret', resumedPart: 2 })).toEqual({ referer: 'https://example.com/' });
    });

    it('leaves out the fields that are not text, or are empty', () => {
        expect(readExtras({ referer: 5, userAgent: '', title: null, pageUrl: ['x'], downloadDir: {} })).toEqual({});
    });

    it('leaves out a text that is longer than any real one', () => {
        const long = 'a'.repeat(4097);
        expect(readExtras({ referer: long, userAgent: long, title: long, pageUrl: long })).toEqual({});
        expect(readExtras({ title: 'a'.repeat(4096) })).toEqual({ title: 'a'.repeat(4096) });
    });

    it.each([
        ['relative/folder'],
        ['./folder'],
        ['']
    ])('leaves out the folder %j, because it is not an absolute path', (downloadDir) => {
        expect(readExtras({ downloadDir })).toEqual({});
    });

    it('keeps an absolute folder', () => {
        expect(readExtras({ downloadDir: '/home/user/Videos' })).toEqual({ downloadDir: '/home/user/Videos' });
    });

    it.each([4, 6])('keeps the IP family %s', (ipFamily) => {
        expect(readExtras({ ipFamily })).toEqual({ ipFamily });
    });

    it.each([[5], ['4'], [null], [0]])('leaves out the IP family %j', (ipFamily) => {
        expect(readExtras({ ipFamily })).toEqual({});
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
    it('keeps the files in the folder, in the folders below it, and in the same order', () => {
        expect(keepInside(['/dl/b.mp4', '/dl/sub/a.mp4', '/dl/sub/deeper/c.mp4'], '/dl')).toEqual(['/dl/b.mp4', '/dl/sub/a.mp4', '/dl/sub/deeper/c.mp4']);
    });

    it('drops the files that are somewhere else, including the ones that only start with the same name', () => {
        expect(keepInside(['/etc/passwd', '/dlx/a.mp4', '/home/a.mp4', '/dl/a.mp4'], '/dl')).toEqual(['/dl/a.mp4']);
    });

    it('drops the files that leave the folder with ..', () => {
        expect(keepInside(['/dl/../etc/a.mp4', '/dl/sub/../../etc/b.mp4', '/dl/sub/../c.mp4'], '/dl')).toEqual(['/dl/sub/../c.mp4']);
    });

    it('drops a path that is not absolute, whatever the folder the process is in', () => {
        expect(keepInside(['a.mp4', 'dl/a.mp4', './a.mp4'], '/dl')).toEqual([]);
    });

    it('drops the folder itself, which is not a file in it', () => {
        expect(keepInside(['/dl', '/dl/'], '/dl')).toEqual([]);
    });

    it('accepts a folder written with a trailing slash', () => {
        expect(keepInside(['/dl/a.mp4'], '/dl/')).toEqual(['/dl/a.mp4']);
    });

    it('has nothing for no files', () => {
        expect(keepInside([], '/dl')).toEqual([]);
    });
});

describe('readPausedDownload with edited extras and files', () => {
    it('reads the extras through their check and keeps the long file names out', () => {
        const read = readPausedDownload({ job: PAUSED.job, extras: { referer: 'https://example.com/', cookie: 'secret', ipFamily: 9 }, outputPaths: ['/dl/a.mp4', 'a'.repeat(5000)] });
        expect(read?.extras).toEqual({ referer: 'https://example.com/' });
        expect(read?.outputPaths).toEqual(['/dl/a.mp4']);
    });
});
