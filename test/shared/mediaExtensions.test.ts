import {
    AUDIO_DIALOG_EXTENSIONS,
    AUDIO_EXTENSIONS,
    VIDEO_DIALOG_EXTENSIONS,
    VIDEO_EXTENSIONS,
    mediaKindOfExtension
} from '@shared/mediaExtensions';

describe('mediaExtensions', () => {
    it('classifies video extensions case-insensitively', () => {
        VIDEO_EXTENSIONS.forEach((ext) => {
            expect(mediaKindOfExtension(ext)).toBe('video');
            expect(mediaKindOfExtension(ext.toUpperCase())).toBe('video');
        });
    });

    it('classifies audio extensions case-insensitively', () => {
        AUDIO_EXTENSIONS.forEach((ext) => {
            expect(mediaKindOfExtension(ext)).toBe('audio');
            expect(mediaKindOfExtension(ext.toUpperCase())).toBe('audio');
        });
    });

    it('returns null for non-media extensions and empty strings', () => {
        expect(mediaKindOfExtension('.txt')).toBeNull();
        expect(mediaKindOfExtension('.png')).toBeNull();
        expect(mediaKindOfExtension('.pdf')).toBeNull();
        expect(mediaKindOfExtension('.zip')).toBeNull();
        expect(mediaKindOfExtension('')).toBeNull();
    });

    it('provides dialog extensions without leading dots', () => {
        expect(VIDEO_DIALOG_EXTENSIONS).toContain('mp4');
        expect(VIDEO_DIALOG_EXTENSIONS).toContain('mkv');
        expect(AUDIO_DIALOG_EXTENSIONS).toContain('mp3');
        expect(AUDIO_DIALOG_EXTENSIONS).toContain('flac');
        expect(
            VIDEO_DIALOG_EXTENSIONS.every((ext) => {
                return !ext.startsWith('.');
            })
        ).toBe(true);
    });
});
