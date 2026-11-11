import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AnimeDb } from '@main/services/animeDb';
import {
    METADATA_FILE_NAME,
    METADATA_AUDIO,
    METADATA_VERSION,
    metadataOf,
    metadataPathFor,
    parseEpisodeMetadata,
    readEpisodeMetadata,
    refreshEpisodeMetadata,
    writeEpisodeMetadata,
    type EpisodeMetadata
} from '@main/services/episodeMetadata';
import { defaultSubtitleFileSystem } from '@main/services/subtitleFiles';
import { cleanTempDirs, makeTempDir } from '../../helpers/tempDir';
import { makeAnime, makeEpisode } from '../../helpers/animeFixtures';

afterEach(() => {
    cleanTempDirs();
});

const METADATA: EpisodeMetadata = {
    version: 1,
    title: 'Re:Zero',
    query: 're zero',
    searchIndex: 3,
    audio: 'sub',
    number: '12.5',
    positionSeconds: 600.5,
    durationSeconds: 1440,
    watched: true
};

function valid(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({ ...METADATA, ...overrides });
}

describe('constants and paths', () => {
    it('names the file and puts it in the folder of the video', () => {
        expect(METADATA_FILE_NAME).toBe('pullwave.json');
        expect(METADATA_VERSION).toBe(1);
        // Still written, so the versions of the app that refused a file without it can import the library.
        expect(METADATA_AUDIO).toBe('sub');
        expect(metadataPathFor(join('/lib', 'Naruto', 'Episode 1', 'Naruto Episode 1.mp4'))).toBe(join('/lib', 'Naruto', 'Episode 1', 'pullwave.json'));
    });
});

describe('metadataOf', () => {
    it('takes what identifies the anime and where the viewer stopped', () => {
        const anime = makeAnime([], { id: 4, title: 'Re:Zero', query: 're zero', searchIndex: 3 });
        const episode = makeEpisode({ number: '12.5', positionSeconds: 600.5, durationSeconds: 1440, watched: true });
        expect(metadataOf(anime, episode)).toEqual(METADATA);
    });
});

describe('parseEpisodeMetadata', () => {
    it('reads a file whatever audio it says, or none (the app only has the subtitled anime now)', () => {
        expect(parseEpisodeMetadata(valid({ audio: 'dub' }))).toEqual(METADATA);
        expect(parseEpisodeMetadata(valid({ audio: 'raw' }))).toEqual(METADATA);
        expect(parseEpisodeMetadata(valid({ audio: undefined }))).toEqual(METADATA);
    });

    it('reads a valid file', () => {
        expect(parseEpisodeMetadata(valid())).toEqual(METADATA);
        expect(parseEpisodeMetadata(valid({ searchIndex: 0, positionSeconds: 0, durationSeconds: 0, watched: false }))).toEqual({
            ...METADATA,
            searchIndex: 0,
            positionSeconds: 0,
            durationSeconds: 0,
            watched: false
        });
    });

    it('drops what the app does not know', () => {
        expect(parseEpisodeMetadata(valid({ extra: 'x' }))).toEqual(METADATA);
    });

    it.each([
        ['not JSON', '{nope'],
        ['empty', ''],
        ['a number', '3'],
        ['null', 'null'],
        ['an array', '[]']
    ])('refuses %s', (_name, content) => {
        expect(parseEpisodeMetadata(content)).toBeNull();
    });

    it.each([
        ['another version', { version: 2 }],
        ['no version', { version: undefined }],
        ['a title that is not text', { title: 3 }],
        ['an empty title', { title: '   ' }],
        ['a query that is not text', { query: null }],
        ['a position that is not an integer', { searchIndex: 1.5 }],
        ['a negative position', { searchIndex: -1 }],
        ['a position that is text', { searchIndex: '2' }],
        ['an episode that is not a number', { number: 'one' }],
        ['an episode with a path in it', { number: '../1' }],
        ['an episode that is a number', { number: 1 }],
        ['a negative time', { positionSeconds: -1 }],
        ['a time that is not finite', { durationSeconds: null }],
        ['a time that is text', { positionSeconds: '5' }],
        ['a watched that is not a boolean', { watched: 1 }]
    ])('refuses a file with %s', (_name, overrides) => {
        expect(parseEpisodeMetadata(valid(overrides))).toBeNull();
    });
});

describe('the series in the metadata', () => {
    it('is written when the anime is in a series, and not otherwise', () => {
        const episode = makeEpisode({ number: '2' });
        expect(metadataOf(makeAnime([], { series: 'Frieren', season: 2 }), episode)).toMatchObject({ series: 'Frieren', season: 2 });
        expect(Object.keys(metadataOf(makeAnime([], { series: null, season: null }), episode))).not.toContain('series');
        expect(Object.keys(metadataOf(makeAnime([], { series: 'Frieren', season: null }), episode))).not.toContain('series');
    });

    it('carries the name the anime is shown with, only with the series', () => {
        const episode = makeEpisode({ number: '2' });
        expect(metadataOf(makeAnime([], { series: 'Bleach', season: 4, seasonName: 'The Conflict' }), episode)).toMatchObject({ series: 'Bleach', season: 4, seasonName: 'The Conflict' });
        expect(Object.keys(metadataOf(makeAnime([], { series: 'Bleach', season: 4, seasonName: null }), episode))).not.toContain('seasonName');
        expect(Object.keys(metadataOf(makeAnime([], { series: null, season: null, seasonName: 'Alone' }), episode))).not.toContain('seasonName');
        expect(parseEpisodeMetadata(valid({ series: 'Bleach', season: 4, seasonName: '  The  Conflict ' }))).toEqual({ ...METADATA, series: 'Bleach', season: 4, seasonName: 'The Conflict' });
        expect(parseEpisodeMetadata(valid({ series: 'Bleach', season: 4, seasonName: ' ' }))).toEqual({ ...METADATA, series: 'Bleach', season: 4 });
        expect(parseEpisodeMetadata(valid({ series: 'Bleach', season: 4, seasonName: 5 }))).toEqual({ ...METADATA, series: 'Bleach', season: 4 });
        expect(parseEpisodeMetadata(valid({ seasonName: 'Alone' }))).toEqual(METADATA);
    });

    it('is read with the rest, and cleaned', () => {
        expect(parseEpisodeMetadata(valid({ series: '  Frieren  Beyond ', season: 3 }))).toEqual({ ...METADATA, series: 'Frieren Beyond', season: 3 });
    });

    it.each([
        ['a season without a series', { season: 2 }],
        ['a series without a season', { series: 'Frieren' }],
        ['an empty series', { series: ' ', season: 2 }],
        ['a series that is not text', { series: 4, season: 2 }],
        ['a season out of range', { series: 'Frieren', season: 100 }],
        ['a season that is not an integer', { series: 'Frieren', season: 1.5 }],
        ['a season that is text', { series: 'Frieren', season: '2' }]
    ])('leaves out %s and keeps the rest of the file', (_name, extra) => {
        const parsed = parseEpisodeMetadata(valid(extra));
        expect(parsed).toEqual(METADATA);
        expect(Object.keys(parsed ?? {})).not.toContain('series');
        expect(Object.keys(parsed ?? {})).not.toContain('season');
    });

    it('is kept when the file is written and read back', () => {
        const folder = join(makeTempDir(), 'Frieren', 'Season 2', 'Episode 1');
        const video = join(folder, 'a.mp4');
        const joined = { ...METADATA, series: 'Frieren', season: 2 };
        writeEpisodeMetadata(video, joined, defaultSubtitleFileSystem);
        expect(readEpisodeMetadata(video, defaultSubtitleFileSystem)).toEqual(joined);
    });
});

describe('readEpisodeMetadata and writeEpisodeMetadata', () => {
    it('writes beside the video and reads it back', () => {
        const folder = join(makeTempDir(), 'Naruto', 'Episode 1');
        const video = join(folder, 'Naruto Episode 1.mp4');
        writeEpisodeMetadata(video, METADATA, defaultSubtitleFileSystem);
        expect(JSON.parse(readFileSync(join(folder, 'pullwave.json'), 'utf-8'))).toEqual(METADATA);
        expect(readEpisodeMetadata(video, defaultSubtitleFileSystem)).toEqual(METADATA);
    });

    it('reads nothing when the file is not there or is not valid', () => {
        const folder = makeTempDir();
        const video = join(folder, 'a.mp4');
        expect(readEpisodeMetadata(video, defaultSubtitleFileSystem)).toBeNull();
        writeFileSync(join(folder, 'pullwave.json'), '{broken');
        expect(readEpisodeMetadata(video, defaultSubtitleFileSystem)).toBeNull();
    });

    it('does not fail when the file cannot be written', () => {
        const write = vi.fn(() => {
            throw new Error('EACCES');
        });
        expect(() => {
            writeEpisodeMetadata('/lib/a.mp4', METADATA, { write });
        }).not.toThrow();
        expect(write).toHaveBeenCalledWith(join('/lib', 'pullwave.json'), `${JSON.stringify(METADATA, null, 2)}\n`);
    });
});

describe('refreshEpisodeMetadata', () => {
    function setup(videoOf: (folder: string) => string, overrides: { status?: 'done' | 'error' } = {}) {
        const root = makeTempDir();
        const db = new AnimeDb(':memory:');
        const anime = db.upsertAnime({ title: 'Naruto', query: 'naruto', searchIndex: 2 });
        const episode = db.ensureEpisode(anime.id, '1');
        const video = videoOf(root);
        if (overrides.status === 'error') {
            db.markFailed(episode.id, 'error', null);
        } else {
            db.markDone(episode.id, video, 10);
        }
        db.saveProgress({ episodeId: episode.id, positionSeconds: 30, durationSeconds: 1400, watched: false });
        return { db, episode, video, root };
    }

    it('saves what the library knows of a downloaded episode in a folder of its own', () => {
        const { db, episode, video } = setup((root) => {
            return join(root, 'Naruto', 'Episode 1', 'Naruto Episode 1.mp4');
        });
        refreshEpisodeMetadata(db, episode.id, defaultSubtitleFileSystem);
        expect(readEpisodeMetadata(video, defaultSubtitleFileSystem)).toEqual({
            version: 1,
            title: 'Naruto',
            query: 'naruto',
            searchIndex: 2,
            audio: 'sub',
            number: '1',
            positionSeconds: 30,
            durationSeconds: 1400,
            watched: false
        });
    });

    it('saves it again with the new progress', () => {
        const { db, episode, video } = setup((root) => {
            return join(root, 'Naruto', 'Episode 1', 'Naruto Episode 1.mp4');
        });
        refreshEpisodeMetadata(db, episode.id, defaultSubtitleFileSystem);
        db.saveProgress({ episodeId: episode.id, positionSeconds: 1300, durationSeconds: 1400, watched: true });
        refreshEpisodeMetadata(db, episode.id, defaultSubtitleFileSystem);
        expect(readEpisodeMetadata(video, defaultSubtitleFileSystem)).toMatchObject({ positionSeconds: 1300, watched: true });
    });

    it('writes nothing for a video that is not in the folder of its episode, which it would share with the others', () => {
        const write = vi.fn();
        const { db, episode } = setup((root) => {
            return join(root, 'Naruto', 'Naruto Episode 1.mp4');
        });
        refreshEpisodeMetadata(db, episode.id, { write });
        expect(write).not.toHaveBeenCalled();
    });

    it('writes nothing for an episode that is not downloaded or does not exist', () => {
        const write = vi.fn();
        const { db, episode } = setup(
            (root) => {
                return join(root, 'Naruto', 'Episode 1', 'a.mp4');
            },
            { status: 'error' }
        );
        refreshEpisodeMetadata(db, episode.id, { write });
        refreshEpisodeMetadata(db, 999, { write });
        expect(write).not.toHaveBeenCalled();
    });

    it('works on the folders of the system it is told', () => {
        const write = vi.fn();
        const db = new AnimeDb(':memory:');
        const anime = db.upsertAnime({ title: 'Naruto', query: 'naruto', searchIndex: 2 });
        const episode = db.ensureEpisode(anime.id, '1');
        db.markDone(episode.id, 'D:\\Anime\\Naruto\\Episode 1\\Naruto Episode 1.mp4', 10);
        refreshEpisodeMetadata(db, episode.id, { write }, 'win32');
        expect(write).toHaveBeenCalledTimes(1);
    });
});
