import { join } from 'node:path';
import { defaultScanFileSystem, MAX_SCAN_DEPTH, scanLibraryFolder, VIDEO_EXTENSIONS, type ScanFileSystem } from '@main/services/libraryScan';
import { writeFileSync, mkdirSync } from 'node:fs';
import { cleanTempDirs, makeTempDir } from '../../helpers/tempDir';

afterEach(() => {
    cleanTempDirs();
});

// A folder tree in memory: a name ending in "/" is a folder, anything else is a file with that text.
function tree(contents: Record<string, string>): ScanFileSystem {
    return {
        entries: (directory) => {
            const prefix = directory === '/' ? '/' : `${directory}/`;
            const names = new Map<string, boolean>();
            Object.keys(contents).forEach((path) => {
                if (path.startsWith(prefix) && path !== prefix) {
                    const rest = path.slice(prefix.length);
                    const [first] = rest.split('/');
                    names.set(first as string, rest.includes('/'));
                }
            });
            return [...names].map(([name, isDirectory]) => {
                return { name, directory: isDirectory };
            });
        },
        read: (path) => {
            return contents[path] ?? null;
        }
    };
}

const META = (overrides: Record<string, unknown> = {}): string => {
    return JSON.stringify({
        version: 1,
        title: 'Re:Zero',
        query: 're zero',
        searchIndex: 3,
        number: '2',
        positionSeconds: 100,
        durationSeconds: 1400,
        watched: true,
        ...overrides
    });
};

describe('constants', () => {
    it('looks at four kinds of video, three folders deep', () => {
        expect(VIDEO_EXTENSIONS).toEqual(['.mp4', '.mkv', '.webm', '.m4v']);
        expect(MAX_SCAN_DEPTH).toBe(3);
    });
});

describe('scanLibraryFolder', () => {
    it('finds the episodes of the app, each in a folder of its own', () => {
        const files = tree({
            '/lib/Naruto/Episode 1/Naruto Episode 1.mp4': '',
            '/lib/Naruto/Episode 1/Naruto Episode 1.vtt': '',
            '/lib/Naruto/Episode 2/Naruto Episode 2.mkv': ''
        });
        expect(scanLibraryFolder('/lib', files)).toEqual({
            ignored: 0,
            episodes: [
                { videoPath: '/lib/Naruto/Episode 1/Naruto Episode 1.mp4', title: 'Naruto', number: '1', query: 'Naruto', searchIndex: 0, progress: null, series: null, season: null, seasonName: null },
                { videoPath: '/lib/Naruto/Episode 2/Naruto Episode 2.mkv', title: 'Naruto', number: '2', query: 'Naruto', searchIndex: 0, progress: null, series: null, season: null, seasonName: null }
            ]
        });
    });

    it('finds the episodes that were downloaded before each had a folder', () => {
        const files = tree({ '/lib/Naruto/Naruto Episode 10.mp4': '', '/lib/Naruto/Naruto Episode 9.mp4': '' });
        expect(
            scanLibraryFolder('/lib', files).episodes.map((episode) => {
                return [episode.title, episode.number];
            })
        ).toEqual([
            ['Naruto', '10'],
            ['Naruto', '9']
        ]);
    });

    it('takes what the metadata says, over the names', () => {
        const files = tree({ '/lib/Whatever/Renamed/video.mp4': '', '/lib/Whatever/Renamed/pullwave.json': META() });
        expect(scanLibraryFolder('/lib', files)).toEqual({
            ignored: 0,
            episodes: [
                {
                    videoPath: '/lib/Whatever/Renamed/video.mp4',
                    title: 'Re:Zero',
                    number: '2',
                    query: 're zero',
                    searchIndex: 3,
                    progress: { positionSeconds: 100, durationSeconds: 1400, watched: true },
                    series: null,
                    season: null,
                    seasonName: null
                }
            ]
        });
    });

    it('takes the series and the season from the metadata', () => {
        const files = tree({ '/lib/x/Season 1/Episode 2/video.mp4': '', '/lib/x/Season 1/Episode 2/pullwave.json': META({ series: 'Frieren', season: 3 }) });
        expect(scanLibraryFolder('/lib', files).episodes[0]).toMatchObject({ title: 'Re:Zero', series: 'Frieren', season: 3 });
    });

    it('takes the name the anime is shown with from the metadata', () => {
        const files = tree({ '/lib/x/Episode 2/video.mp4': '', '/lib/x/Episode 2/pullwave.json': META({ series: 'Bleach', season: 4, seasonName: 'The Conflict' }) });
        expect(scanLibraryFolder('/lib', files).episodes[0]).toMatchObject({ series: 'Bleach', season: 4, seasonName: 'The Conflict' });
    });

    it('takes the series and the season from the folders when there is no metadata', () => {
        const files = tree({
            '/lib/Frieren/Season 2/Episode 1/Frieren Season 2 Episode 1.mp4': '',
            '/lib/Frieren/Season 12/Episode 3/video.mp4': ''
        });
        expect(
            scanLibraryFolder('/lib', files).episodes.map((episode) => {
                return [episode.title, episode.number, episode.series, episode.season];
            })
        ).toEqual([
            ['Frieren', '3', 'Frieren', 12],
            ['Frieren Season 2', '1', 'Frieren', 2]
        ]);
    });

    it('finds nothing of a series in folders that only look like it', () => {
        const files = tree({
            '/lib/Frieren/Season two/Episode 1/a Episode 1.mp4': '',
            '/lib/Frieren/Part 2/Episode 1/b Episode 1.mp4': '',
            '/lib/Frieren/Season 2/d Episode 1.mp4': ''
        });
        expect(
            scanLibraryFolder('/lib', files).episodes.map((episode) => {
                return [episode.series, episode.season];
            })
        ).toEqual([
            [null, null],
            [null, null],
            [null, null]
        ]);
    });

    it('takes the folder that was chosen for the series when the season folders are right inside it', () => {
        const files = tree({ '/lib/Frieren/Season 2/Episode 1/Frieren Episode 1.mp4': '' });
        expect(scanLibraryFolder('/lib/Frieren', files).episodes[0]).toMatchObject({ series: 'Frieren', season: 2 });
    });

    it('falls back to the names when the metadata is not valid', () => {
        const files = tree({ '/lib/Naruto/Episode 4/Naruto Episode 4.mp4': '', '/lib/Naruto/Episode 4/pullwave.json': META({ number: 'four' }) });
        expect(scanLibraryFolder('/lib', files).episodes).toEqual([
            { videoPath: '/lib/Naruto/Episode 4/Naruto Episode 4.mp4', title: 'Naruto', number: '4', query: 'Naruto', searchIndex: 0, progress: null, series: null, season: null, seasonName: null }
        ]);
    });

    it('takes the title from the name of the file, and from the folder of the anime when the file does not have it', () => {
        const files = tree({
            '/lib/Folder Name/Episode 1/Re_Zero Episode 1.mp4': '',
            '/lib/Folder Name/Episode 2/video.mp4': '',
            '/lib/Other/Episode 3/Different Episode 4.mp4': ''
        });
        expect(
            scanLibraryFolder('/lib', files).episodes.map((episode) => {
                return [episode.title, episode.number];
            })
        ).toEqual([
            ['Re_Zero', '1'],
            ['Folder Name', '2'],
            ['Other', '3']
        ]);
    });

    it('understands episodes with a decimal number', () => {
        const files = tree({ '/lib/Naruto/Episode 12.5/Naruto Episode 12.5.mp4': '', '/lib/Naruto/Naruto Episode 7.5.mp4': '' });
        expect(
            scanLibraryFolder('/lib', files).episodes.map((episode) => {
                return episode.number;
            })
        ).toEqual(['12.5', '7.5']);
    });

    it('finds the episodes whichever folder was chosen: all the anime, one anime or one episode', () => {
        const files = tree({ '/lib/Naruto/Episode 1/Naruto Episode 1.mp4': '' });
        ['/lib', '/lib/Naruto', '/lib/Naruto/Episode 1'].forEach((root) => {
            expect(scanLibraryFolder(root, files).episodes).toHaveLength(1);
        });
    });

    it('counts the videos it cannot tell the episode of, and does not look at what is not a video', () => {
        const files = tree({
            '/lib/Naruto/Episode 1/Naruto Episode 1.mp4': '',
            '/lib/Naruto/random.mp4': '',
            '/lib/Naruto/trailer.mkv': '',
            '/lib/Naruto/Naruto Episode 1.vtt': '',
            '/lib/Naruto/Naruto Episode 1.mp4.part': '',
            '/lib/Naruto/notes.txt': '',
            '/lib/Naruto/Episode 1/pullwave.json': '{}'
        });
        const result = scanLibraryFolder('/lib', files);
        expect(result.episodes).toHaveLength(1);
        expect(result.ignored).toBe(2);
    });

    it('does not mind the case of the extension', () => {
        const files = tree({ '/lib/Naruto/Naruto Episode 1.MP4': '' });
        expect(scanLibraryFolder('/lib', files).episodes).toHaveLength(1);
    });

    it('does not go deeper than it should', () => {
        const files = tree({
            '/lib/a/b/c/Naruto Episode 1.mp4': '',
            '/lib/a/b/c/d/Naruto Episode 2.mp4': ''
        });
        expect(
            scanLibraryFolder('/lib', files).episodes.map((episode) => {
                return episode.number;
            })
        ).toEqual(['1']);
    });

    it('lists the episodes in a steady order', () => {
        const files = tree({ '/lib/B/B Episode 1.mp4': '', '/lib/A/A Episode 2.mp4': '', '/lib/A/A Episode 1.mp4': '' });
        expect(
            scanLibraryFolder('/lib', files).episodes.map((episode) => {
                return episode.videoPath;
            })
        ).toEqual(['/lib/A/A Episode 1.mp4', '/lib/A/A Episode 2.mp4', '/lib/B/B Episode 1.mp4']);
    });

    it('gives nothing for a folder that is empty or cannot be read', () => {
        expect(scanLibraryFolder('/lib', tree({}))).toEqual({ episodes: [], ignored: 0 });
        expect(scanLibraryFolder(join(makeTempDir(), 'missing'))).toEqual({ episodes: [], ignored: 0 });
    });

    it('reads the disk by default', () => {
        const root = makeTempDir();
        const folder = join(root, 'Naruto', 'Episode 1');
        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, 'Naruto Episode 1.mp4'), 'x');
        writeFileSync(join(folder, 'pullwave.json'), META());
        const result = scanLibraryFolder(root);
        expect(result.episodes).toEqual([
            {
                videoPath: join(folder, 'Naruto Episode 1.mp4'),
                title: 'Re:Zero',
                number: '2',
                query: 're zero',
                searchIndex: 3,
                progress: { positionSeconds: 100, durationSeconds: 1400, watched: true },
                series: null,
                season: null,
                seasonName: null
            }
        ]);
        expect(defaultScanFileSystem.read(join(folder, 'missing'))).toBeNull();
    });
});
