import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_SUBTITLE_BYTES } from '@shared/anime';
import {
    defaultSubtitleFileSystem,
    DEFAULT_SUBTITLE_LABEL,
    importedLabel,
    generatedSubtitlePath,
    importedSubtitlePath,
    importSubtitle,
    listSubtitleFiles,
    listSubtitleTracks,
    resolveSubtitlePath,
    sourceLabelKey,
    sourceLabelOf,
    sourceSubtitlePath,
    subtitleFilesOf,
    toWebVtt,
    translatedSubtitlePath,
    type SubtitleFileSystem
} from '@main/services/subtitleFiles';
import { cleanTempDirs, makeTempDir } from '../../helpers/tempDir';

afterEach(() => {
    cleanTempDirs();
});

const DIR = join('/lib', 'Naruto');
const VIDEO = join(DIR, 'Naruto Episode 1.mp4');

function memory(contents: Record<string, string>): SubtitleFileSystem & { written: Record<string, string> } {
    const written: Record<string, string> = {};
    return {
        written,
        list: (directory) => {
            return Object.keys({ ...contents, ...written })
                .filter((path) => {
                    return path.startsWith(`${directory}/`) || path.startsWith(`${directory}\\`);
                })
                .map((path) => {
                    return path.slice(directory.length + 1);
                });
        },
        read: (path) => {
            return { ...contents, ...written }[path] ?? null;
        },
        size: (path) => {
            const text = { ...contents, ...written }[path];
            return text === undefined ? null : Buffer.byteLength(text);
        },
        write: (path, content) => {
            written[path] = content;
        }
    };
}

const SRT = '1\r\n00:00:01,500 --> 00:00:03,000\r\nHello\r\n\r\n2\r\n00:00:04,5 --> 00:00:06,25\r\nBye\r\n';

describe('listSubtitleTracks', () => {
    it('gives nothing when the episode has no subtitles', () => {
        expect(listSubtitleTracks(VIDEO, memory({ [VIDEO]: 'v' }))).toEqual([]);
    });

    it('gives nothing when the folder cannot be read', () => {
        expect(listSubtitleTracks(join(makeTempDir(), 'missing', 'a.mp4'))).toEqual([]);
    });

    it('lists the default first, then the source ones by name, then the loaded ones', () => {
        const files = memory({
            [join(DIR, 'Naruto Episode 1.vtt')]: 'default',
            [join(DIR, 'Naruto Episode 1.subtitle-Spanish.vtt')]: 'es',
            [join(DIR, 'Naruto Episode 1.subtitle-Japanese.vtt')]: 'ja',
            [join(DIR, 'Naruto Episode 1.import-My file.vtt')]: 'mine'
        });
        expect(listSubtitleTracks(VIDEO, files)).toEqual([
            { id: '', label: DEFAULT_SUBTITLE_LABEL, kind: 'default' },
            { id: 'subtitle-Japanese', label: 'Japanese', kind: 'source' },
            { id: 'subtitle-Spanish', label: 'Spanish', kind: 'source' },
            { id: 'import-My file', label: 'My file', kind: 'imported' }
        ]);
    });

    it('names the default after the source subtitle that is the same text, and shows that one once', () => {
        const files = memory({
            [join(DIR, 'Naruto Episode 1.vtt')]: 'english text',
            [join(DIR, 'Naruto Episode 1.subtitle-English.vtt')]: 'english text',
            [join(DIR, 'Naruto Episode 1.subtitle-Japanese.vtt')]: 'ja'
        });
        expect(listSubtitleTracks(VIDEO, files)).toEqual([
            { id: '', label: 'English', kind: 'default' },
            { id: 'subtitle-Japanese', label: 'Japanese', kind: 'source' }
        ]);
    });

    it('keeps the default as it is when its text cannot be read', () => {
        const files = memory({ [join(DIR, 'Naruto Episode 1.vtt')]: 'x', [join(DIR, 'Naruto Episode 1.subtitle-English.vtt')]: 'x' });
        const unreadable: SubtitleFileSystem = { ...files, read: () => { return null; } };
        expect(listSubtitleTracks(VIDEO, unreadable)).toEqual([
            { id: '', label: DEFAULT_SUBTITLE_LABEL, kind: 'default' },
            { id: 'subtitle-English', label: 'English', kind: 'source' }
        ]);
    });

    it('lists only a source subtitle when there is no default file', () => {
        const files = memory({ [join(DIR, 'Naruto Episode 1.subtitle-Japanese.vtt')]: 'ja' });
        expect(listSubtitleTracks(VIDEO, files)).toEqual([{ id: 'subtitle-Japanese', label: 'Japanese', kind: 'source' }]);
    });

    it('ignores files of other episodes, other extensions and empty names', () => {
        const files = memory({
            [join(DIR, 'Naruto Episode 10.subtitle-English.vtt')]: 'x',
            [join(DIR, 'Naruto Episode 1.5.vtt')]: 'x',
            [join(DIR, 'Naruto Episode 1.subtitle-English.srt')]: 'x',
            [join(DIR, 'Naruto Episode 1.subtitle-.vtt')]: 'x',
            [join(DIR, 'Naruto Episode 1.import-.vtt')]: 'x',
            [join(DIR, 'Naruto Episode 1.other.vtt')]: 'x'
        });
        expect(listSubtitleTracks(VIDEO, files)).toEqual([]);
    });

    it('works with a video that has no extension', () => {
        const path = join(DIR, 'Episode');
        expect(listSubtitleTracks(path, memory({ [join(DIR, 'Episode.subtitle-English.vtt')]: 'x' }))).toEqual([{ id: 'subtitle-English', label: 'English', kind: 'source' }]);
    });

    it('lists what is on the disk by default', () => {
        const dir = makeTempDir();
        writeFileSync(join(dir, 'a.mp4'), 'v');
        writeFileSync(join(dir, 'a.vtt'), 'one');
        writeFileSync(join(dir, 'a.subtitle-Japanese.vtt'), 'two');
        expect(listSubtitleFiles(join(dir, 'a.mp4'))).toEqual([
            { track: { id: '', label: DEFAULT_SUBTITLE_LABEL, kind: 'default' }, path: join(dir, 'a.vtt') },
            { track: { id: 'subtitle-Japanese', label: 'Japanese', kind: 'source' }, path: join(dir, 'a.subtitle-Japanese.vtt') }
        ]);
    });
});

describe('resolveSubtitlePath', () => {
    const files = memory({
        [join(DIR, 'Naruto Episode 1.vtt')]: 'default',
        [join(DIR, 'Naruto Episode 1.subtitle-Japanese.vtt')]: 'ja'
    });

    it('finds the file of a subtitle of the episode', () => {
        expect(resolveSubtitlePath(VIDEO, 'subtitle-Japanese', files)).toBe(join(DIR, 'Naruto Episode 1.subtitle-Japanese.vtt'));
        expect(resolveSubtitlePath(VIDEO, '', files)).toBe(join(DIR, 'Naruto Episode 1.vtt'));
    });

    it('answers with the path of the default even when it is not there, so the file server can say it is missing', () => {
        expect(resolveSubtitlePath(VIDEO, '', memory({}))).toBe(join(DIR, 'Naruto Episode 1.vtt'));
    });

    it('never turns an id into a path', () => {
        expect(resolveSubtitlePath(VIDEO, 'subtitle-Korean', files)).toBeNull();
        expect(resolveSubtitlePath(VIDEO, '../../etc/passwd', files)).toBeNull();
        expect(resolveSubtitlePath(VIDEO, 'subtitle-../x', files)).toBeNull();
    });

    it('reads the disk by default', () => {
        const dir = makeTempDir();
        writeFileSync(join(dir, 'a.subtitle-Japanese.vtt'), 'ja');
        expect(resolveSubtitlePath(join(dir, 'a.mp4'), 'subtitle-Japanese')).toBe(join(dir, 'a.subtitle-Japanese.vtt'));
    });
});

describe('subtitleFilesOf', () => {
    it('lists every subtitle file of the episode and nothing else', () => {
        const files = memory({
            [VIDEO]: 'v',
            [join(DIR, 'Naruto Episode 1.vtt')]: 'a',
            [join(DIR, 'Naruto Episode 1.subtitle-Japanese.vtt')]: 'b',
            [join(DIR, 'Naruto Episode 1.import-mine.vtt')]: 'c',
            [join(DIR, 'Naruto Episode 1.other.vtt')]: 'd',
            [join(DIR, 'Naruto Episode 2.vtt')]: 'e'
        });
        expect(subtitleFilesOf(VIDEO, files)).toEqual([
            join(DIR, 'Naruto Episode 1.vtt'),
            join(DIR, 'Naruto Episode 1.subtitle-Japanese.vtt'),
            join(DIR, 'Naruto Episode 1.import-mine.vtt')
        ]);
    });
});

describe('importedLabel', () => {
    it.each([
        ['Naruto - 01.ja.srt', 'Naruto - 01.ja'],
        ['aula 日本語.vtt', 'aula 日本語'],
        ['a/b:c*.srt', 'a_b_c_'],
        ['legenda.', 'legenda'],
        ['.srt', 'srt'],
        ['...srt', 'subtitle'],
        ['.', 'subtitle'],
        ['', 'subtitle'],
        ['sem extensão', 'sem extensão'],
        [`${'x'.repeat(80)}.srt`, 'x'.repeat(60)]
    ])('turns %s into %s', (fileName, label) => {
        expect(importedLabel(fileName)).toBe(label);
    });
});

describe('importedSubtitlePath', () => {
    it('puts it next to the video, named after the video and the file', () => {
        expect(importedSubtitlePath(VIDEO, 'japonês.srt')).toBe(join(DIR, 'Naruto Episode 1.import-japonês.vtt'));
    });
});

describe('translatedSubtitlePath', () => {
    it('puts it next to the video, named after the video and the language', () => {
        expect(translatedSubtitlePath(VIDEO, 'Português')).toBe(join(DIR, 'Naruto Episode 1.translated-Português.vtt'));
    });

    it('cleans what a file name does not accept from the language', () => {
        expect(translatedSubtitlePath(VIDEO, 'pt/BR:*')).toBe(join(DIR, 'Naruto Episode 1.translated-pt_BR__.vtt'));
    });
});

describe('generatedSubtitlePath', () => {
    it('puts it next to the video, named after the video and the language that is spoken', () => {
        expect(generatedSubtitlePath(VIDEO, 'Japanese')).toBe(join(DIR, 'Naruto Episode 1.generated-Japanese.vtt'));
    });

    it('cleans what a file name does not accept from the language', () => {
        expect(generatedSubtitlePath(VIDEO, 'ja/JP:*')).toBe(join(DIR, 'Naruto Episode 1.generated-ja_JP__.vtt'));
    });
});

describe('the generated subtitles of an episode', () => {
    const GENERATED = join(DIR, 'Naruto Episode 1.generated-Japanese.vtt');
    const IMPORTED = join(DIR, 'Naruto Episode 1.import-fan.vtt');
    const TRANSLATED = join(DIR, 'Naruto Episode 1.translated-Spanish.vtt');

    it('lists it after the imported ones and before the translated ones', () => {
        const files = memory({
            [VIDEO]: 'v',
            [TRANSLATED]: 'WEBVTT\n\nA',
            [GENERATED]: 'WEBVTT\n\nB',
            [IMPORTED]: 'WEBVTT\n\nC'
        });
        expect(listSubtitleTracks(VIDEO, files)).toEqual([
            { id: 'import-fan', label: 'fan', kind: 'imported' },
            { id: 'generated-Japanese', label: 'Japanese', kind: 'generated' },
            { id: 'translated-Spanish', label: 'Spanish', kind: 'translated' }
        ]);
    });

    it('does not list a file that has the prefix and no language', () => {
        const files = memory({ [VIDEO]: 'v', [join(DIR, 'Naruto Episode 1.generated-.vtt')]: 'WEBVTT\n\nA' });
        expect(listSubtitleTracks(VIDEO, files)).toEqual([]);
    });

    it('finds the file of one by its id', () => {
        const files = memory({ [VIDEO]: 'v', [GENERATED]: 'WEBVTT\n\nA' });
        expect(resolveSubtitlePath(VIDEO, 'generated-Japanese', files)).toBe(GENERATED);
    });

    it('takes it away with the video', () => {
        const files = memory({ [VIDEO]: 'v', [GENERATED]: 'WEBVTT\n\nA' });
        expect(subtitleFilesOf(VIDEO, files)).toEqual([GENERATED]);
    });
});

describe('the translated subtitles of an episode', () => {
    const TRANSLATED = join(DIR, 'Naruto Episode 1.translated-Português.vtt');
    const IMPORTED = join(DIR, 'Naruto Episode 1.import-fan.vtt');
    const SOURCE = join(DIR, 'Naruto Episode 1.subtitle-English.vtt');

    it('lists them last, after the default, source and imported ones', () => {
        const files = memory({
            [VIDEO]: 'v',
            [TRANSLATED]: 'WEBVTT\n\nA',
            [IMPORTED]: 'WEBVTT\n\nB',
            [SOURCE]: 'WEBVTT\n\nC',
            [join(DIR, 'Naruto Episode 1.vtt')]: 'WEBVTT\n\nD'
        });
        expect(listSubtitleTracks(VIDEO, files)).toEqual([
            { id: '', label: DEFAULT_SUBTITLE_LABEL, kind: 'default' },
            { id: 'subtitle-English', label: 'English', kind: 'source' },
            { id: 'import-fan', label: 'fan', kind: 'imported' },
            { id: 'translated-Português', label: 'Português', kind: 'translated' }
        ]);
    });

    it('does not list a file that has the prefix and no language', () => {
        const files = memory({ [VIDEO]: 'v', [join(DIR, 'Naruto Episode 1.translated-.vtt')]: 'WEBVTT\n\nA' });
        expect(listSubtitleTracks(VIDEO, files)).toEqual([]);
    });

    it('finds the file of one by its id', () => {
        const files = memory({ [VIDEO]: 'v', [TRANSLATED]: 'WEBVTT\n\nA' });
        expect(resolveSubtitlePath(VIDEO, 'translated-Português', files)).toBe(TRANSLATED);
    });

    it('takes them away with the video', () => {
        const files = memory({ [VIDEO]: 'v', [TRANSLATED]: 'WEBVTT\n\nA' });
        expect(subtitleFilesOf(VIDEO, files)).toEqual([TRANSLATED]);
    });
});

describe('toWebVtt', () => {
    it('keeps WebVTT as it is, with the line breaks and the byte order mark normalized', () => {
        expect(toWebVtt('﻿WEBVTT\r\n\r\n00:01.000 --> 00:02.000\r\nHi\r\n')).toBe('WEBVTT\n\n00:01.000 --> 00:02.000\nHi\n');
        expect(toWebVtt('WEBVTT')).toBe('WEBVTT');
    });

    it('converts SubRip: the comma of the times becomes a dot and the milliseconds have three digits', () => {
        expect(toWebVtt(SRT)).toBe('WEBVTT\n\n1\n00:00:01.500 --> 00:00:03.000\nHello\n\n2\n00:00:04.500 --> 00:00:06.250\nBye\n');
    });

    it('does not touch commas in the text of a cue', () => {
        expect(toWebVtt('1\n00:00:01,000 --> 00:00:02,000\nWell, 00:00:09,123 later\n')).toBe('WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nWell, 00:00:09,123 later\n');
    });

    it('gives null for what is not a subtitle', () => {
        expect(toWebVtt('just some text')).toBeNull();
        expect(toWebVtt('')).toBeNull();
        expect(toWebVtt('WEBVTTX\nnope')).toBeNull();
        expect(toWebVtt('[Script Info]\nDialogue: 0,0:00:01.00,0:00:02.00')).toBeNull();
    });
});

describe('importSubtitle', () => {
    const CHOSEN = join('/home', 'user', 'ja.srt');

    function setup(chosen: string | null, contents: Record<string, string> = { [CHOSEN]: SRT }) {
        const files = memory({ [VIDEO]: 'v', ...contents });
        const chooseFile = vi.fn(async () => {
            return chosen;
        });
        return { files, chooseFile, run: () => { return importSubtitle(VIDEO, { chooseFile, files }); } };
    }

    it('saves the file next to the video as WebVTT and says which subtitle it is', async () => {
        const { files, chooseFile, run } = setup(CHOSEN);
        const target = join(DIR, 'Naruto Episode 1.import-ja.vtt');
        expect(await run()).toEqual({
            ok: true,
            tracks: [{ id: 'import-ja', label: 'ja', kind: 'imported' }],
            imported: { id: 'import-ja', label: 'ja', kind: 'imported' }
        });
        expect(chooseFile).toHaveBeenCalledTimes(1);
        expect(files.written).toEqual({ [target]: 'WEBVTT\n\n1\n00:00:01.500 --> 00:00:03.000\nHello\n\n2\n00:00:04.500 --> 00:00:06.250\nBye\n' });
    });

    it('lists the loaded subtitle with the ones the episode already has', async () => {
        const { run } = setup(CHOSEN, { [CHOSEN]: 'WEBVTT\n', [join(DIR, 'Naruto Episode 1.subtitle-English.vtt')]: 'en' });
        const result = await run();
        expect(result).toMatchObject({ ok: true, imported: { id: 'import-ja' } });
        expect(result.ok && result.tracks.map((track) => { return track.id; })).toEqual(['subtitle-English', 'import-ja']);
    });

    it('replaces a subtitle loaded before with the same file name', async () => {
        const { files, run } = setup(CHOSEN, { [CHOSEN]: SRT, [join(DIR, 'Naruto Episode 1.import-ja.vtt')]: 'old' });
        await run();
        expect(files.written[join(DIR, 'Naruto Episode 1.import-ja.vtt')]).toContain('Hello');
    });

    it('does nothing when the user gives up', async () => {
        const { files, run } = setup(null);
        expect(await run()).toEqual({ ok: false, reason: 'cancelled' });
        expect(files.written).toEqual({});
    });

    it.each(['/home/user/sub.ass', '/home/user/sub.txt', '/home/user/sub'])('refuses %s, which is not a .vtt or .srt', async (chosen) => {
        const { files, run } = setup(chosen, { [chosen]: SRT });
        expect(await run()).toEqual({ ok: false, reason: 'unsupported' });
        expect(files.written).toEqual({});
    });

    it('accepts the extensions in capitals', async () => {
        const chosen = '/home/user/SUB.SRT';
        const { run } = setup(chosen, { [chosen]: SRT });
        expect(await run()).toMatchObject({ ok: true });
    });

    it('refuses a file that is not there or cannot be read', async () => {
        expect(await setup(CHOSEN, {}).run()).toEqual({ ok: false, reason: 'unreadable' });
        const { files, chooseFile } = setup(CHOSEN);
        const noText: SubtitleFileSystem = { ...files, read: () => { return null; } };
        expect(await importSubtitle(VIDEO, { chooseFile, files: noText })).toEqual({ ok: false, reason: 'unreadable' });
    });

    it('refuses a file that is too large, without reading it', async () => {
        const { files, chooseFile } = setup(CHOSEN);
        const read = vi.fn(() => { return 'x'; });
        const big: SubtitleFileSystem = { ...files, size: () => { return MAX_SUBTITLE_BYTES + 1; }, read };
        expect(await importSubtitle(VIDEO, { chooseFile, files: big })).toEqual({ ok: false, reason: 'too-large' });
        expect(read).not.toHaveBeenCalled();
    });

    it('accepts a file of exactly the largest size', async () => {
        const { files, chooseFile } = setup(CHOSEN);
        const limit: SubtitleFileSystem = { ...files, size: () => { return MAX_SUBTITLE_BYTES; } };
        expect(await importSubtitle(VIDEO, { chooseFile, files: limit })).toMatchObject({ ok: true });
    });

    it('refuses a file whose text is not a subtitle', async () => {
        const { files, run } = setup(CHOSEN, { [CHOSEN]: 'not a subtitle at all' });
        expect(await run()).toEqual({ ok: false, reason: 'unsupported' });
        expect(files.written).toEqual({});
    });

    it('says so when the copy cannot be written', async () => {
        const { files, chooseFile } = setup(CHOSEN);
        const readOnly: SubtitleFileSystem = { ...files, write: () => { throw new Error('EACCES'); } };
        expect(await importSubtitle(VIDEO, { chooseFile, files: readOnly })).toEqual({ ok: false, reason: 'unreadable' });
    });

    it('says so when the copy is not found after being written', async () => {
        const { files, chooseFile } = setup(CHOSEN);
        const lost: SubtitleFileSystem = { ...files, write: () => { return undefined; } };
        expect(await importSubtitle(VIDEO, { chooseFile, files: lost })).toEqual({ ok: false, reason: 'unreadable' });
    });

    it('works on the disk by default', async () => {
        const dir = makeTempDir();
        const video = join(dir, 'a.mp4');
        const source = join(dir, 'ja.srt');
        writeFileSync(video, 'v');
        writeFileSync(source, SRT);
        const result = await importSubtitle(video, { chooseFile: async () => { return source; } });
        expect(result).toMatchObject({ ok: true, imported: { id: 'import-ja' } });
        expect(readFileSync(join(dir, 'a.import-ja.vtt'), 'utf-8')).toContain('00:00:01.500 --> 00:00:03.000');
    });
});

describe('defaultSubtitleFileSystem', () => {
    it('reads, measures, lists and writes files, creating the folder it writes into', () => {
        const dir = makeTempDir();
        const file = join(dir, 'nested', 'a.vtt');
        defaultSubtitleFileSystem.write(file, 'text');
        expect(existsSync(file)).toBe(true);
        expect(defaultSubtitleFileSystem.read(file)).toBe('text');
        expect(defaultSubtitleFileSystem.size(file)).toBe(4);
        expect(defaultSubtitleFileSystem.list(join(dir, 'nested'))).toEqual(['a.vtt']);
    });

    it('answers for what is not there', () => {
        const dir = makeTempDir();
        expect(defaultSubtitleFileSystem.read(join(dir, 'missing'))).toBeNull();
        expect(defaultSubtitleFileSystem.size(join(dir, 'missing'))).toBeNull();
        expect(defaultSubtitleFileSystem.size(dir)).toBeNull();
        expect(defaultSubtitleFileSystem.list(join(dir, 'missing'))).toEqual([]);
    });
});

describe('the labels of the subtitles of the source', () => {
    it('turns what a file name does not accept into "_" and drops the spaces at the end, as the patch of ani-cli does', () => {
        expect(sourceLabelOf('English')).toBe('English');
        expect(sourceLabelOf('Portuguese - Brazil (CC)')).toBe('Portuguese - Brazil (CC)');
        expect(sourceLabelOf('English / SDH: 2')).toBe('English _ SDH_ 2');
        expect(sourceLabelOf('English   ')).toBe('English');
        expect(sourceLabelOf('日本語')).toBe('___');
        expect(sourceLabelOf('a.b_c-d')).toBe('a.b_c-d');
    });

    it('tells two labels apart by their name, not by the case nor by how many "_" the same name has', () => {
        expect(sourceLabelKey('English')).toBe(sourceLabelKey('english'));
        expect(sourceLabelKey('日本語')).toBe(sourceLabelKey('日本'));
        expect(sourceLabelKey('English')).not.toBe(sourceLabelKey('Spanish'));
        expect(sourceLabelKey('English  ')).toBe(sourceLabelKey('English'));
    });

    it('names the file after the video, with the prefix of the source and the cleaned label', () => {
        expect(sourceSubtitlePath(VIDEO, 'Portuguese - Brazil')).toBe(join(DIR, 'Naruto Episode 1.subtitle-Portuguese - Brazil.vtt'));
        expect(sourceSubtitlePath(VIDEO, 'a/b')).toBe(join(DIR, 'Naruto Episode 1.subtitle-a_b.vtt'));
        expect(sourceSubtitlePath(VIDEO, '../../x')).toBe(join(DIR, 'Naruto Episode 1.subtitle-.._.._x.vtt'));
    });

    it('is a path that the list of the subtitles of the episode finds again, under the same label', () => {
        const path = sourceSubtitlePath(VIDEO, 'Portuguese - Brazil');
        const files = memory({ [path]: 'WEBVTT' });
        expect(listSubtitleTracks(VIDEO, files)).toEqual([{ id: 'subtitle-Portuguese - Brazil', label: 'Portuguese - Brazil', kind: 'source' }]);
    });
});

