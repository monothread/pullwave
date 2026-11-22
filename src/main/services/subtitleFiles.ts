import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { MAX_SUBTITLE_BYTES, type AnimeSubtitleDeleteResponse, type AnimeSubtitleImportResponse, type AnimeSubtitleTrack } from '@shared/anime';

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
    list: (directory: string) => string[];
    read: (path: string) => string | null;
    size: (path: string) => number | null;
    write: (path: string, content: string) => void;
    remove?: (path: string) => void;
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
    },
    remove: (path) => {
        rmSync(path, { force: true });
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

export function resolveSubtitlePath(videoPath: string, trackId: string, files: SubtitleFileSystem = defaultSubtitleFileSystem): string | null {
    const found = listSubtitleFiles(videoPath, files).find((file) => {
        return file.track.id === trackId;
    });
    if (found) {
        return found.path;
    }
    return trackId === '' ? join(dirname(videoPath), `${baseNameOf(videoPath)}.vtt`) : null;
}

export function subtitleFilesOf(videoPath: string, files: SubtitleFileSystem = defaultSubtitleFileSystem): string[] {
    const directory = dirname(videoPath);
    const base = baseNameOf(videoPath);
    return files.list(directory).filter((name) => {
        return name === `${base}.vtt` || (name.startsWith(`${base}.`) && name.endsWith('.vtt') && trackOf(name.slice(base.length + 1, -'.vtt'.length)) !== null);
    }).map((name) => {
        return join(directory, name);
    });
}

export function importedLabel(fileName: string): string {
    const extension = extname(fileName);
    const name = extension.length > 0 ? fileName.slice(0, -extension.length) : fileName;
    const cleaned = name.replace(UNSAFE_LABEL_CHARACTERS, '_').trim().slice(0, MAX_LABEL_LENGTH).replace(/^[. ]+|[. ]+$/g, '');
    return cleaned.length > 0 ? cleaned : 'subtitle';
}

export function sourceLabelOf(label: string): string {
    return label.replace(/[^A-Za-z0-9 ._()-]/g, '_').replace(/ +$/, '');
}

export function sourceLabelKey(label: string): string {
    return sourceLabelOf(label).replace(/_+/g, '_').toLowerCase();
}

export function sourceSubtitlePath(videoPath: string, label: string): string {
    return join(dirname(videoPath), `${baseNameOf(videoPath)}.${SOURCE_SUBTITLE_PREFIX}${sourceLabelOf(label)}.vtt`);
}

export function importedSubtitlePath(videoPath: string, fileName: string): string {
    return join(dirname(videoPath), `${baseNameOf(videoPath)}.${IMPORTED_SUBTITLE_PREFIX}${importedLabel(fileName)}.vtt`);
}

export function generatedSubtitlePath(videoPath: string, language: string): string {
    return join(dirname(videoPath), `${baseNameOf(videoPath)}.${GENERATED_SUBTITLE_PREFIX}${importedLabel(language)}.vtt`);
}

export function translatedSubtitlePath(videoPath: string, language: string): string {
    return join(dirname(videoPath), `${baseNameOf(videoPath)}.${TRANSLATED_SUBTITLE_PREFIX}${importedLabel(language)}.vtt`);
}

export function hasTranslatedSubtitle(videoPath: string, language: string, files: SubtitleFileSystem = defaultSubtitleFileSystem): boolean {
    const target = translatedSubtitlePath(videoPath, language);
    return files.list(dirname(target)).includes(basename(target));
}

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
    chooseFile: () => Promise<string | null>;
    files?: SubtitleFileSystem;
}

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

export function deleteTranslatedSubtitle(
    videoPath: string,
    trackId: string,
    files: SubtitleFileSystem = defaultSubtitleFileSystem
): AnimeSubtitleDeleteResponse {
    if (!trackId.startsWith(TRANSLATED_SUBTITLE_PREFIX)) {
        return { ok: false, reason: 'not-found' };
    }
    const found = listSubtitleFiles(videoPath, files).find((file) => {
        return file.track.id === trackId && file.track.kind === 'translated';
    });
    if (found === undefined) {
        return { ok: false, reason: 'not-found' };
    }
    const remove = files.remove ?? ((target: string): void => {
        rmSync(target, { force: true });
    });
    try {
        remove(found.path);
    } catch {
        return { ok: false, reason: 'unreadable' };
    }
    return { ok: true, tracks: listSubtitleTracks(videoPath, files) };
}
