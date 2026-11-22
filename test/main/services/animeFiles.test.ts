import { DEFAULT_SETTINGS } from '@shared/constants';
import {
    isInsideDirectory,
    animeBaseDirectory,
    animeDownloadDirectory,
    folderNameBudget,
    MAX_FOLDER_NAME_LENGTH,
    MIN_FOLDER_NAME_LENGTH,
    WINDOWS_PATH_BUDGET,
    animeFileName,
    animeFolderName,
    animeFoldersToRemove,
    DEFAULT_ANIME_FOLDER,
    animeFolderOf,
    episodeDownloadDirectory,
    foldersWithoutOthers,
    SEASON_FOLDER_PREFIX,
    seasonDownloadDirectory,
    seasonFolderName,
    seriesFolderOf,
    METADATA_FILE_NAME,
    metadataPathFor,
    episodeFolderName,
    episodeFolderOf,
    EPISODE_FOLDER_PREFIX,
    removeEmptyDirectories,
    filesOfEpisode,
    removeDirectories,
    subtitlePathFor
} from '@main/services/animeFiles';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanTempDirs, makeTempDir } from '../../helpers/tempDir';

afterEach(() => {
    cleanTempDirs();
});

describe('subtitlePathFor', () => {
    it('swaps the extension for .vtt', () => {
        expect(subtitlePathFor(join('/lib', 'Naruto', 'Naruto Episode 1.mp4'))).toBe(join('/lib', 'Naruto', 'Naruto Episode 1.vtt'));
        expect(subtitlePathFor(join('/lib', 'a.mkv'))).toBe(join('/lib', 'a.vtt'));
    });

    it('only changes the last extension', () => {
        expect(subtitlePathFor(join('/lib', 'Mr. Robot Episode 1.mp4'))).toBe(join('/lib', 'Mr. Robot Episode 1.vtt'));
    });

    it('adds the extension when the file has none', () => {
        expect(subtitlePathFor(join('/lib', 'episode'))).toBe(join('/lib', 'episode.vtt'));
    });
});

describe('filesOfEpisode', () => {
    const files = (names: string[]) => {
        return { list: () => { return names; }, read: () => { return null; }, size: () => { return null; }, write: () => { return undefined; } };
    };

    const video = join('/lib', 'a.mp4');

    it('lists the video and its subtitles', () => {
        expect(filesOfEpisode(video, files([]))).toEqual([video, join('/lib', 'a.vtt'), join('/lib', 'pullwave.json')]);
    });

    it('also lists the subtitles of the source and the ones the user loaded, and nothing from other episodes', () => {
        expect(
            filesOfEpisode(video, files(['a.mp4', 'a.vtt', 'a.subtitle-English.vtt', 'a.subtitle-Japanese.vtt', 'a.import-mine.vtt', 'a.5.vtt', 'a2.vtt', 'b.subtitle-English.vtt']))
        ).toEqual([
            video,
            join('/lib', 'a.vtt'),
            join('/lib', 'a.subtitle-English.vtt'),
            join('/lib', 'a.subtitle-Japanese.vtt'),
            join('/lib', 'a.import-mine.vtt'),
            join('/lib', 'pullwave.json')
        ]);
    });

    it('lists what is really on the disk by default', () => {
        const dir = makeTempDir();
        ['a.mp4', 'a.vtt', 'a.subtitle-Japanese.vtt'].forEach((name) => {
            writeFileSync(join(dir, name), 'x');
        });
        expect(filesOfEpisode(join(dir, 'a.mp4'))).toEqual([join(dir, 'a.mp4'), join(dir, 'a.vtt'), join(dir, 'a.subtitle-Japanese.vtt'), join(dir, 'pullwave.json')]);
    });
});

describe('animeFolderName', () => {
    it('keeps a normal title', () => {
        expect(animeFolderName('Cyberpunk: Edgerunners')).toBe('Cyberpunk_ Edgerunners');
    });

    it('replaces what a file system does not accept', () => {
        expect(animeFolderName('A<B>C:D"E/F\\G|H?I*J', { platform: 'linux' })).toBe('A_B_C_D_E_F_G_H_I_J');
    });

    it('replaces control characters', () => {
        expect(animeFolderName(`one${String.fromCharCode(0)}two${String.fromCharCode(31)}three`)).toBe('one_two_three');
    });

    it('removes leading dots, so the folder is never hidden or a parent reference', () => {
        expect(animeFolderName('..hidden')).toBe('hidden');
        expect(animeFolderName('..')).toBe('anime');
    });

    it('limits the length and trims', () => {
        expect(animeFolderName(`${'a'.repeat(99)} bbb`)).toBe('a'.repeat(99));
        expect(animeFolderName(`  ${'x'.repeat(150)}  `)).toHaveLength(100);
    });

    it('falls back to a name when nothing is left', () => {
        expect(animeFolderName('   ')).toBe('anime');
        expect(animeFolderName('')).toBe('anime');
    });
});


describe('animeFileName', () => {
    it('names the file the way ani-cli does', () => {
        expect(animeFileName('Cyberpunk: Edgerunners', '3')).toBe('Cyberpunk_ Edgerunners Episode 3.mp4');
        expect(animeFileName('Fate/Zero', '12.5')).toBe('Fate_Zero Episode 12.5.mp4');
    });
});

describe('animeBaseDirectory', () => {
    it('uses the folder of the settings', () => {
        expect(animeBaseDirectory({ ...DEFAULT_SETTINGS, animeDownloadDir: '/media/anime' }, '/home/me/Downloads', 'linux')).toBe('/media/anime');
    });

    it('falls back to a folder inside Downloads', () => {
        expect(DEFAULT_ANIME_FOLDER).toBe('Pullwave Anime');
        expect(animeBaseDirectory(DEFAULT_SETTINGS, '/home/me/Downloads', 'linux')).toBe('/home/me/Downloads/Pullwave Anime');
    });
});

describe('animeFoldersToRemove', () => {
    it('gives the folder of the files and the one a download would use now, without repeating', () => {
        expect(animeFoldersToRemove('Naruto', ['/old/Naruto/a.mp4', '/old/Naruto/b.mp4'], '/new', 'linux')).toEqual(['/old/Naruto', '/new/Naruto']);
        expect(animeFoldersToRemove('Naruto', ['/lib/Naruto/a.mp4'], '/lib', 'linux')).toEqual(['/lib/Naruto']);
    });

    it('gives the folder a download would use even when nothing was downloaded', () => {
        expect(animeFoldersToRemove('Naruto', [], '/lib', 'linux')).toEqual(['/lib/Naruto']);
    });

    it('never gives a folder that is not named after the anime', () => {
        expect(animeFoldersToRemove('Naruto', ['/home/me/Videos/a.mp4', '/lib/Naruto/b.mp4'], '/lib', 'linux')).toEqual(['/lib/Naruto']);
        expect(animeFoldersToRemove('Naruto', ['/home/me/Videos/a.mp4'], '/lib', 'linux')).toEqual(['/lib/Naruto']);
    });

    it('matches the name the folder was created with', () => {
        expect(animeFoldersToRemove('Re:Zero', ['/lib/Re_Zero/a.mp4'], '/lib', 'linux')).toEqual(['/lib/Re_Zero']);
    });
});

describe('removeDirectories', () => {
    it('removes folders with everything in them, and ignores one that is not there', () => {
        const root = makeTempDir();
        mkdirSync(join(root, 'Naruto', 'nested'), { recursive: true });
        writeFileSync(join(root, 'Naruto', 'a.mp4'), 'x');
        writeFileSync(join(root, 'Naruto', 'nested', 'a.part'), 'x');
        mkdirSync(join(root, 'Bleach'));

        removeDirectories([join(root, 'Naruto'), join(root, 'missing')]);

        expect(existsSync(join(root, 'Naruto'))).toBe(false);
        expect(existsSync(join(root, 'Bleach'))).toBe(true);
    });

    it('keeps going when one folder cannot be removed', () => {
        const remove = vi.fn((path: string) => {
            if (path === '/a') {
                throw new Error('EBUSY');
            }
        });
        removeDirectories(['/a', '/b'], remove);
        expect(remove.mock.calls).toEqual([['/a'], ['/b']]);
    });
});

describe('animeFolderName on Windows', () => {
    const win = { platform: 'win32' as const };

    it('keeps a normal title as it is', () => {
        expect(animeFolderName('Cyberpunk: Edgerunners', win)).toBe('Cyberpunk_ Edgerunners');
    });

    it('removes dots and spaces from the end, which Windows refuses', () => {
        expect(animeFolderName('Mr. Robot.', win)).toBe('Mr. Robot');
        expect(animeFolderName('Title ...  ', win)).toBe('Title');
        expect(animeFolderName('Title.', { platform: 'linux' })).toBe('Title.');
    });

    it.each(['CON', 'con', 'PRN', 'Aux', 'NUL', 'COM1', 'com9', 'LPT1', 'lpt9', 'CON.txt', 'nul.anything'])('prefixes the name Windows keeps for devices: %s', (name) => {
        expect(animeFolderName(name, win)).toBe(`_${name}`);
    });

    it.each(['CONSOLE', 'Console Wars', 'COM10', 'COM0', 'LPT', 'Anime CON', 'NULL'])('leaves a name that only looks like one: %s', (name) => {
        expect(animeFolderName(name, win)).toBe(name);
    });

    it('does not prefix those names on other systems', () => {
        expect(animeFolderName('CON', { platform: 'linux' })).toBe('CON');
    });

    it('uses the platform it runs on by default', () => {
        expect(animeFolderName('Mr. Robot.')).toBe(process.platform === 'win32' ? 'Mr. Robot' : 'Mr. Robot.');
    });

    it('can be shortened and never ends up empty', () => {
        expect(animeFolderName('abcdefghij', { maxLength: 4 })).toBe('abcd');
        expect(animeFolderName('...', win)).toBe('anime');
        expect(animeFolderName('  . ', win)).toBe('anime');
    });
});

describe('the folder of an episode', () => {
    it('is named after the episode', () => {
        expect(EPISODE_FOLDER_PREFIX).toBe('Episode ');
        expect(episodeFolderName('1')).toBe('Episode 1');
        expect(episodeFolderName('12.5')).toBe('Episode 12.5');
    });

    it('is inside the folder of the anime, with the rules of the system the files are on', () => {
        expect(episodeDownloadDirectory('/lib/Naruto', '3', 'linux')).toBe('/lib/Naruto/Episode 3');
        expect(episodeDownloadDirectory('D:\\Anime\\Naruto', '3', 'win32')).toBe('D:\\Anime\\Naruto\\Episode 3');
        expect(episodeDownloadDirectory(join('/lib', 'Naruto'), '3')).toBe(join('/lib', 'Naruto', 'Episode 3'));
    });

    it('is found from a video that is in it, and not from one that is not', () => {
        expect(episodeFolderOf('/lib/Naruto/Episode 3/Naruto Episode 3.mp4', '3', 'linux')).toBe('/lib/Naruto/Episode 3');
        expect(episodeFolderOf('D:\\Anime\\Naruto\\Episode 3\\Naruto Episode 3.mp4', '3', 'win32')).toBe('D:\\Anime\\Naruto\\Episode 3');
        expect(episodeFolderOf('/lib/Naruto/Naruto Episode 3.mp4', '3', 'linux')).toBeNull();
        expect(episodeFolderOf('/lib/Naruto/Episode 4/Naruto Episode 3.mp4', '3', 'linux')).toBeNull();
        expect(episodeFolderOf('/lib/Naruto/Episode 3/Naruto Episode 3.mp4', '')).toBeNull();
    });
});

describe('animeFolderOf', () => {
    it('is the folder that holds the folders of the episodes', () => {
        expect(animeFolderOf('/lib/Naruto/Episode 3/Naruto Episode 3.mp4', '3', 'linux')).toBe('/lib/Naruto');
        expect(animeFolderOf('D:\\Anime\\Naruto\\Episode 3\\Naruto Episode 3.mp4', '3', 'win32')).toBe('D:\\Anime\\Naruto');
    });

    it('is the folder of the video when it is not in the folder of an episode', () => {
        expect(animeFolderOf('/lib/Naruto/Naruto Episode 3.mp4', '3', 'linux')).toBe('/lib/Naruto');
        expect(animeFolderOf('/lib/Naruto/Episode 4/Naruto Episode 3.mp4', '3', 'linux')).toBe('/lib/Naruto/Episode 4');
    });

    it('uses this system by default', () => {
        expect(animeFolderOf(join('/lib', 'Naruto', 'Episode 3', 'a.mp4'), '3')).toBe(join('/lib', 'Naruto'));
    });
});

describe('the metadata of an episode', () => {
    it('is a file with a fixed name in the folder of the video', () => {
        expect(METADATA_FILE_NAME).toBe('pullwave.json');
        expect(metadataPathFor(join('/lib', 'Naruto', 'Episode 1', 'Naruto Episode 1.mp4'))).toBe(join('/lib', 'Naruto', 'Episode 1', 'pullwave.json'));
    });
});

describe('the folder of a season of a series', () => {
    it('is named after the season', () => {
        expect(SEASON_FOLDER_PREFIX).toBe('Season ');
        expect(seasonFolderName(2)).toBe('Season 2');
    });

    it('is inside the folder of the series, with the rules of the system the files are on', () => {
        expect(seasonDownloadDirectory('/lib', 'Frieren: Beyond', 2, 'Frieren Season 2', 'linux')).toBe('/lib/Frieren_ Beyond/Season 2');
        expect(seasonDownloadDirectory('D:\\Anime', 'Re:Zero', 3, 'Re:Zero Season 3', 'win32')).toBe('D:\\Anime\\Re_Zero\\Season 3');
        expect(seasonDownloadDirectory(join('/lib'), 'Naruto', 1, 'Naruto')).toBe(join('/lib', 'Naruto', 'Season 1'));
    });

    it('shortens the name of the series on Windows so the whole path of a file stays under the limit', () => {
        const base = `C:\\${'a'.repeat(100)}`;
        const folder = seasonDownloadDirectory(base, 'S'.repeat(100), 99, 'T'.repeat(40), 'win32');
        expect(folder.endsWith('\\Season 99')).toBe(true);
        expect(`${folder}\\Episode 999\\${'T'.repeat(40)} Episode 999.mp4`.length).toBeLessThanOrEqual(WINDOWS_PATH_BUDGET);
    });

    it('never makes the name of the series shorter than the minimum', () => {
        const folder = seasonDownloadDirectory(`C:\\${'a'.repeat(300)}`, 'S'.repeat(100), 1, 'T', 'win32');
        expect(folder.split('\\').at(-2)?.length).toBe(MIN_FOLDER_NAME_LENGTH);
    });

    it('is found from the folder of the season, and not for the folder of an anime on its own', () => {
        expect(seriesFolderOf('/lib/Frieren/Season 2', 'linux')).toBe('/lib/Frieren');
        expect(seriesFolderOf('D:\\Anime\\Frieren\\Season 12', 'win32')).toBe('D:\\Anime\\Frieren');
        expect(seriesFolderOf('/lib/Frieren', 'linux')).toBeNull();
        expect(seriesFolderOf('/lib/Frieren/Season two', 'linux')).toBeNull();
        expect(seriesFolderOf('/lib/Frieren/My Season 2', 'linux')).toBeNull();
        expect(seriesFolderOf(join('/lib', 'Frieren', 'Season 1'))).toBe(join('/lib', 'Frieren'));
    });

    it('counts the extra level in the budget of Windows only', () => {
        expect(folderNameBudget('C:\\Anime', 'Naruto', 'win32', 10)).toBe(MAX_FOLDER_NAME_LENGTH);
        expect(folderNameBudget(`C:\\${'a'.repeat(120)}`, 'Naruto', 'win32', 10)).toBe(folderNameBudget(`C:\\${'a'.repeat(120)}`, 'Naruto', 'win32') - 10);
        expect(folderNameBudget('/short', 'Naruto', 'linux', 10)).toBe(MAX_FOLDER_NAME_LENGTH);
    });
});

describe('foldersWithoutOthers', () => {
    it('keeps the folders that none of the other files are in', () => {
        expect(foldersWithoutOthers(['/lib/A', '/lib/B'], ['/lib/B/Season 2/Episode 1/x.mp4', '/lib/C/y.mp4'], 'linux')).toEqual(['/lib/A']);
    });

    it('does not mistake a folder for another one that starts with its name', () => {
        expect(foldersWithoutOthers(['/lib/Bleach'], ['/lib/Bleach Kai/x.mp4'], 'linux')).toEqual(['/lib/Bleach']);
    });

    it('knows the folders of Windows', () => {
        expect(foldersWithoutOthers(['D:\\Anime\\A', 'D:\\Anime\\B'], ['D:\\Anime\\B\\Season 2\\x.mp4'], 'win32')).toEqual(['D:\\Anime\\A']);
    });

    it('keeps everything when there are no other files, and handles a folder given with its separator', () => {
        expect(foldersWithoutOthers(['/lib/A'], [], 'linux')).toEqual(['/lib/A']);
        expect(foldersWithoutOthers(['/lib/A/'], ['/lib/A/x.mp4'], 'linux')).toEqual([]);
        expect(foldersWithoutOthers([], ['/lib/A/x.mp4'], 'linux')).toEqual([]);
        expect(foldersWithoutOthers([join('/lib', 'A')], [join('/lib', 'A', 'x.mp4')])).toEqual([]);
    });
});

describe('removeEmptyDirectories', () => {
    it('removes a folder with nothing in it and leaves one that has files', () => {
        const root = makeTempDir();
        const empty = join(root, 'empty');
        const full = join(root, 'full');
        mkdirSync(empty);
        mkdirSync(full);
        writeFileSync(join(full, 'a.mp4'), 'x');
        removeEmptyDirectories([empty, full, join(root, 'missing')]);
        expect(existsSync(empty)).toBe(false);
        expect(existsSync(join(full, 'a.mp4'))).toBe(true);
    });

    it('goes on after one that cannot be removed', () => {
        const remove = vi.fn((path: string) => {
            if (path === 'a') {
                throw new Error('EBUSY');
            }
        });
        removeEmptyDirectories(['a', 'b'], remove);
        expect(remove.mock.calls).toEqual([['a'], ['b']]);
    });
});

describe('folderNameBudget', () => {
    it('is the usual length outside Windows, whatever the rest of the path is', () => {
        expect(folderNameBudget('/' + 'x'.repeat(300), 'Naruto', 'linux')).toBe(MAX_FOLDER_NAME_LENGTH);
    });

    it('is the usual length on Windows when the path is short', () => {
        expect(folderNameBudget('C:\\Anime', 'Naruto', 'win32')).toBe(MAX_FOLDER_NAME_LENGTH);
    });

    it('shrinks on Windows so the whole path of a file stays under the limit', () => {
        const base = `C:\\${'a'.repeat(120)}`;
        const title = 'Naruto';
        const budget = folderNameBudget(base, title, 'win32');
        expect(budget).toBeLessThan(MAX_FOLDER_NAME_LENGTH);
        const file = `${base}\\${'f'.repeat(budget)}\\Episode 999\\Naruto Episode 999.mp4`;
        expect(file.length).toBeLessThanOrEqual(WINDOWS_PATH_BUDGET);
    });

    it('counts the long name ani-cli gives the files, which is the whole title', () => {
        const base = 'C:\\Users\\me\\Downloads\\Pullwave Anime';
        expect(folderNameBudget(base, 'A'.repeat(100), 'win32')).toBeLessThan(folderNameBudget(base, 'A', 'win32'));
    });

    it('never goes below the minimum', () => {
        expect(folderNameBudget(`C:\\${'a'.repeat(300)}`, 'Naruto', 'win32')).toBe(MIN_FOLDER_NAME_LENGTH);
    });

    it('uses this platform by default', () => {
        expect(folderNameBudget('/short', 'Naruto')).toBe(MAX_FOLDER_NAME_LENGTH);
    });
});

describe('Windows paths', () => {
    it('joins the base folder, using the settings or Downloads', () => {
        expect(animeBaseDirectory(DEFAULT_SETTINGS, 'C:\\Users\\me\\Downloads', 'win32')).toBe('C:\\Users\\me\\Downloads\\Pullwave Anime');
        expect(animeBaseDirectory({ ...DEFAULT_SETTINGS, animeDownloadDir: 'D:\\Anime' }, 'C:\\x', 'win32')).toBe('D:\\Anime');
    });

    it('makes the folder of an anime inside the base one, with the name that Windows accepts', () => {
        expect(animeDownloadDirectory('D:\\Anime', 'Re:Zero', 'win32')).toBe('D:\\Anime\\Re_Zero');
        expect(animeDownloadDirectory('D:\\Anime', 'NUL', 'win32')).toBe('D:\\Anime\\_NUL');
        expect(animeDownloadDirectory('/media/anime', 'Re:Zero', 'linux')).toBe('/media/anime/Re_Zero');
    });

    it('works out the folders to remove from Windows paths', () => {
        expect(animeFoldersToRemove('Naruto', ['D:\\Anime\\Naruto\\Naruto Episode 1.mp4', 'D:\\Anime\\Naruto\\Naruto Episode 2.mp4'], 'D:\\Anime', 'win32')).toEqual(['D:\\Anime\\Naruto']);
        expect(animeFoldersToRemove('Naruto', ['D:\\Videos\\Naruto Episode 1.mp4'], 'D:\\Anime', 'win32')).toEqual(['D:\\Anime\\Naruto']);
    });

    it('matches the name a folder was given when its path was long', () => {
        const base = `C:\\${'a'.repeat(150)}`;
        const folder = animeDownloadDirectory(base, 'B'.repeat(80), 'win32');
        expect(folder.length).toBeLessThan(`${base}\\${'B'.repeat(80)}`.length);
        expect(animeFoldersToRemove('B'.repeat(80), [`${folder}\\${'B'.repeat(80)} Episode 1.mp4`], base, 'win32')).toEqual([folder]);
    });

    it('never removes a folder that is not named after the anime', () => {
        expect(animeFoldersToRemove('Naruto', ['C:\\Users\\me\\Videos\\a.mp4'], 'D:\\Anime', 'win32')).toEqual(['D:\\Anime\\Naruto']);
    });
});

describe('isInsideDirectory', () => {
    it('is true for the folder itself and for what is inside it, however deep', () => {
        expect(isInsideDirectory('/lib', '/lib', 'linux')).toBe(true);
        expect(isInsideDirectory('/lib/', '/lib', 'linux')).toBe(true);
        expect(isInsideDirectory('/lib/Naruto', '/lib', 'linux')).toBe(true);
        expect(isInsideDirectory('/lib/Naruto/Episode 1/a.mp4', '/lib', 'linux')).toBe(true);
        expect(isInsideDirectory('/lib/a/../b', '/lib', 'linux')).toBe(true);
    });

    it('is false for the folder above, a folder beside it and one that only starts with the same name', () => {
        expect(isInsideDirectory('/', '/lib', 'linux')).toBe(false);
        expect(isInsideDirectory('/lib2', '/lib', 'linux')).toBe(false);
        expect(isInsideDirectory('/library/Naruto', '/lib', 'linux')).toBe(false);
        expect(isInsideDirectory('/other/lib', '/lib', 'linux')).toBe(false);
        expect(isInsideDirectory('/lib/../etc', '/lib', 'linux')).toBe(false);
    });

    it('is true for a folder whose name starts with two dots, which is still inside', () => {
        expect(isInsideDirectory('/lib/..hidden', '/lib', 'linux')).toBe(true);
    });

    it('follows the rules of Windows: backslashes, drive letters and no difference between capitals', () => {
        expect(isInsideDirectory('D:\\Anime\\Naruto', 'D:\\Anime', 'win32')).toBe(true);
        expect(isInsideDirectory('d:\\anime\\NARUTO', 'D:\\Anime', 'win32')).toBe(true);
        expect(isInsideDirectory('D:\\Anime', 'D:\\Anime', 'win32')).toBe(true);
        expect(isInsideDirectory('E:\\Anime\\Naruto', 'D:\\Anime', 'win32')).toBe(false);
        expect(isInsideDirectory('D:\\Anime2', 'D:\\Anime', 'win32')).toBe(false);
    });
});
