import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { MAX_SUBTITLE_BYTES, type AnimeSubtitleImportResponse, type AnimeSubtitleTrack } from '@shared/anime';

// The subtitles of an episode sit next to its video, named after it:
//   "<name>.vtt"                    the one ani-cli picked
//   "<name>.subtitle-<language>.vtt" the ones the source offered (saved by the patch of ani-cli, see aniSubtitles.ts)
//   "<name>.import-<name>.vtt"      the ones the user loaded
//   "<name>.generated-<language>.vtt" the one made from the audio of the episode
//   "<name>.translated-<language>.vtt" the ones a language model translated from another
// The prefixes keep them apart from the subtitles of another episode whose name starts the same way ("... 1" and "... 1.5").
export const SOURCE_SUBTITLE_PREFIX = 'subtitle-';
export const IMPORTED_SUBTITLE_PREFIX = 'import-';
export const GENERATED_SUBTITLE_PREFIX = 'generated-';
export const TRANSLATED_SUBTITLE_PREFIX = 'translated-';
export const DEFAULT_SUBTITLE_LABEL = 'Default';
const MAX_LABEL_LENGTH = 60;
const SUBTITLE_EXTENSIONS = ['.vtt', '.srt'];
const SRT_TIMING = /\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/;
const SRT_STAMP = /(\d{1,2}:\d{2}:\d{2}),(\d{1,3})/g;
const UNSAFE_LABEL_CHARACTERS = /[^\p{L}\p{N} ._()-]/gu;

export interface SubtitleFileSystem {
    // The names of the files in a folder; none when it cannot be read.
    list: (directory: string) => string[];
    // The text of a file, or null when it cannot be read.
    read: (path: string) => string | null;
    // The size of a file, or null when it is not there.
    size: (path: string) => number | null;
    write: (path: string, content: string) => void;
}

export const defaultSubtitleFileSystem: SubtitleFileSystem = {
    list: (directory) => {
        try {
            return readdirSync(directory);
        } catch {
            return [];
        }
    },
    read: (path) => {
        try {
            return readFileSync(path, 'utf-8');
        } catch {
            return null;
        }
    },
    size: (path) => {
        try {
            const stats = statSync(path);
            return stats.isFile() ? stats.size : null;
        } catch {
            return null;
        }
    },
    write: (path, content) => {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content, 'utf-8');
    }
};

export interface SubtitleFile {
    track: AnimeSubtitleTrack;
    path: string;
}

function baseNameOf(videoPath: string): string {
    const name = basename(videoPath);
    const extension = extname(name);
    return extension.length > 0 ? name.slice(0, -extension.length) : name;
}

function trackOf(middle: string): AnimeSubtitleTrack | null {
    if (middle.startsWith(SOURCE_SUBTITLE_PREFIX) && middle.length > SOURCE_SUBTITLE_PREFIX.length) {
        return { id: middle, label: middle.slice(SOURCE_SUBTITLE_PREFIX.length), kind: 'source' };
    }
    if (middle.startsWith(IMPORTED_SUBTITLE_PREFIX) && middle.length > IMPORTED_SUBTITLE_PREFIX.length) {
        return { id: middle, label: middle.slice(IMPORTED_SUBTITLE_PREFIX.length), kind: 'imported' };
    }
    if (middle.startsWith(GENERATED_SUBTITLE_PREFIX) && middle.length > GENERATED_SUBTITLE_PREFIX.length) {
        return { id: middle, label: middle.slice(GENERATED_SUBTITLE_PREFIX.length), kind: 'generated' };
    }
    if (middle.startsWith(TRANSLATED_SUBTITLE_PREFIX) && middle.length > TRANSLATED_SUBTITLE_PREFIX.length) {
        return { id: middle, label: middle.slice(TRANSLATED_SUBTITLE_PREFIX.length), kind: 'translated' };
    }
    return null;
}

const KIND_ORDER = { default: 0, source: 1, imported: 2, generated: 3, translated: 4 } as const;

// Every subtitle file the episode has: the default one first, then the ones of the source, then the imported ones. When one of
// the others is the same text as the default (the source offers it too), it is the default that stays, with its name.
export function listSubtitleFiles(videoPath: string, files: SubtitleFileSystem = defaultSubtitleFileSystem): SubtitleFile[] {
    const directory = dirname(videoPath);
    const base = baseNameOf(videoPath);
    const names = files.list(directory);
    const others: SubtitleFile[] = [];
    names.forEach((name) => {
        if (!name.startsWith(`${base}.`) || !name.endsWith('.vtt')) {
            return;
        }
        const track = trackOf(name.slice(base.length + 1, -'.vtt'.length));
        if (track !== null) {
            others.push({ track, path: join(directory, name) });
        }
    });
    others.sort((first, second) => {
        return KIND_ORDER[first.track.kind] - KIND_ORDER[second.track.kind] || first.track.label.localeCompare(second.track.label);
    });
    const defaultName = `${base}.vtt`;
    if (!names.includes(defaultName)) {
        return others;
    }
    const defaultPath = join(directory, defaultName);
    const defaultText = files.read(defaultPath);
    const same = others.findIndex((other) => {
        return defaultText !== null && files.read(other.path) === defaultText;
    });
    const label = same === -1 ? DEFAULT_SUBTITLE_LABEL : (others[same] as SubtitleFile).track.label;
    const rest = others.filter((_other, index) => {
        return index !== same;
    });
    return [{ track: { id: '', label, kind: 'default' }, path: defaultPath }, ...rest];
}

export function listSubtitleTracks(videoPath: string, files: SubtitleFileSystem = defaultSubtitleFileSystem): AnimeSubtitleTrack[] {
    return listSubtitleFiles(videoPath, files).map((file) => {
        return file.track;
    });
}

// The file of a subtitle of the episode, or null when it has none with that id. The id is looked up among the files of the
// episode, never turned into a path, so nothing outside them can be asked for.
export function resolveSubtitlePath(videoPath: string, trackId: string, files: SubtitleFileSystem = defaultSubtitleFileSystem): string | null {
    const found = listSubtitleFiles(videoPath, files).find((file) => {
        return file.track.id === trackId;
    });
    if (found) {
        return found.path;
    }
    return trackId === '' ? join(dirname(videoPath), `${baseNameOf(videoPath)}.vtt`) : null;
}

// Every file that goes away with the video: the subtitles it has, the one ani-cli picked included.
export function subtitleFilesOf(videoPath: string, files: SubtitleFileSystem = defaultSubtitleFileSystem): string[] {
    const directory = dirname(videoPath);
    const base = baseNameOf(videoPath);
    return files.list(directory).filter((name) => {
        return name === `${base}.vtt` || (name.startsWith(`${base}.`) && name.endsWith('.vtt') && trackOf(name.slice(base.length + 1, -'.vtt'.length)) !== null);
    }).map((name) => {
        return join(directory, name);
    });
}

// The label of a loaded subtitle: the name of its file, without what a file name does not accept.
export function importedLabel(fileName: string): string {
    const extension = extname(fileName);
    const name = extension.length > 0 ? fileName.slice(0, -extension.length) : fileName;
    const cleaned = name.replace(UNSAFE_LABEL_CHARACTERS, '_').trim().slice(0, MAX_LABEL_LENGTH).replace(/^[. ]+|[. ]+$/g, '');
    return cleaned.length > 0 ? cleaned : 'subtitle';
}

// The label of a subtitle of the source as the patch of ani-cli writes it in a file name (see aniSubtitles.ts): what a file name
// does not accept becomes "_", and the spaces at the end go.
export function sourceLabelOf(label: string): string {
    return label.replace(/[^A-Za-z0-9 ._()-]/g, '_').replace(/ +$/, '');
}

// What tells two labels of the same language apart or together: where the source writes the same name with other characters a
// run of "_" can have another length, so it counts as one.
export function sourceLabelKey(label: string): string {
    return sourceLabelOf(label).replace(/_+/g, '_').toLowerCase();
}

export function sourceSubtitlePath(videoPath: string, label: string): string {
    return join(dirname(videoPath), `${baseNameOf(videoPath)}.${SOURCE_SUBTITLE_PREFIX}${sourceLabelOf(label)}.vtt`);
}

export function importedSubtitlePath(videoPath: string, fileName: string): string {
    return join(dirname(videoPath), `${baseNameOf(videoPath)}.${IMPORTED_SUBTITLE_PREFIX}${importedLabel(fileName)}.vtt`);
}

// Where the subtitle made from the audio, in the language that is spoken, goes.
export function generatedSubtitlePath(videoPath: string, language: string): string {
    return join(dirname(videoPath), `${baseNameOf(videoPath)}.${GENERATED_SUBTITLE_PREFIX}${importedLabel(language)}.vtt`);
}

// Where the translation of a subtitle into a language goes; the language is cleaned the way the label of a loaded file is.
export function translatedSubtitlePath(videoPath: string, language: string): string {
    return join(dirname(videoPath), `${baseNameOf(videoPath)}.${TRANSLATED_SUBTITLE_PREFIX}${importedLabel(language)}.vtt`);
}

// The text as WebVTT, or null when it is neither WebVTT nor SubRip (the player only understands the first; the second is the
// usual format of subtitles found online and only differs in a few details).
export function toWebVtt(text: string): string | null {
    const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (/^WEBVTT(\s|$)/.test(normalized)) {
        return normalized;
    }
    if (!SRT_TIMING.test(normalized)) {
        return null;
    }
    const converted = normalized
        .split('\n')
        .map((line) => {
            return line.includes('-->') ? line.replace(SRT_STAMP, (_match, time: string, millis: string) => {
                return `${time}.${millis.padEnd(3, '0')}`;
            }) : line;
        })
        .join('\n');
    return `WEBVTT\n\n${converted.trim()}\n`;
}

export interface SubtitleImportDependencies {
    // Asks the user for a file; null when they gave up.
    chooseFile: () => Promise<string | null>;
    files?: SubtitleFileSystem;
}

// Copies a subtitle file the user chose next to the video, as WebVTT.
export async function importSubtitle(videoPath: string, dependencies: SubtitleImportDependencies): Promise<AnimeSubtitleImportResponse> {
    const files = dependencies.files ?? defaultSubtitleFileSystem;
    const chosen = await dependencies.chooseFile();
    if (chosen === null) {
        return { ok: false, reason: 'cancelled' };
    }
    if (!SUBTITLE_EXTENSIONS.includes(extname(chosen).toLowerCase())) {
        return { ok: false, reason: 'unsupported' };
    }
    const size = files.size(chosen);
    if (size === null) {
        return { ok: false, reason: 'unreadable' };
    }
    if (size > MAX_SUBTITLE_BYTES) {
        return { ok: false, reason: 'too-large' };
    }
    const text = files.read(chosen);
    if (text === null) {
        return { ok: false, reason: 'unreadable' };
    }
    const vtt = toWebVtt(text);
    if (vtt === null) {
        return { ok: false, reason: 'unsupported' };
    }
    const target = importedSubtitlePath(videoPath, basename(chosen));
    try {
        files.write(target, vtt);
    } catch {
        return { ok: false, reason: 'unreadable' };
    }
    const tracks = listSubtitleFiles(videoPath, files);
    const imported = tracks.find((file) => {
        return file.path === target;
    });
    if (!imported) {
        return { ok: false, reason: 'unreadable' };
    }
    return {
        ok: true,
        tracks: tracks.map((file) => {
            return file.track;
        }),
        imported: imported.track
    };
}
