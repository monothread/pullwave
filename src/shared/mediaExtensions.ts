export const VIDEO_EXTENSIONS: readonly string[] = [
    '.mp4',
    '.m4v',
    '.mov',
    '.mkv',
    '.webm',
    '.avi',
    '.flv',
    '.ts',
    '.wmv',
    '.mpeg',
    '.mpg',
    '.3gp'
];

export const AUDIO_EXTENSIONS: readonly string[] = [
    '.mp3',
    '.m4a',
    '.aac',
    '.opus',
    '.ogg',
    '.oga',
    '.flac',
    '.wav',
    '.wma'
];

export const VIDEO_EXTENSION_SET: ReadonlySet<string> = new Set(VIDEO_EXTENSIONS);
export const AUDIO_EXTENSION_SET: ReadonlySet<string> = new Set(AUDIO_EXTENSIONS);

export const VIDEO_DIALOG_EXTENSIONS: string[] = VIDEO_EXTENSIONS.map((ext) => {
    return ext.slice(1);
});

export const AUDIO_DIALOG_EXTENSIONS: string[] = AUDIO_EXTENSIONS.map((ext) => {
    return ext.slice(1);
});

export type MediaFileKind = 'video' | 'audio';

export function mediaKindOfExtension(extension: string): MediaFileKind | null {
    const normalized = extension.toLowerCase();
    if (VIDEO_EXTENSION_SET.has(normalized)) {
        return 'video';
    }
    if (AUDIO_EXTENSION_SET.has(normalized)) {
        return 'audio';
    }
    return null;
}
