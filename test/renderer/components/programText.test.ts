import { PROGRAM_IDS, type ToolState } from '@shared/tools';
import { displayVersion, isWorking, lookupReasonKey, programErrorKey, programProgressKey } from '@renderer/components/programText';

function stateWith(status: ToolState['status']): ToolState {
    return { id: 'ytdlp', status, version: null, bytesDone: 0, bytesTotal: 0, percent: 0, error: null };
}

describe('programErrorKey', () => {
    it.each([
        ['UNSUPPORTED_PLATFORM', 'tools.error.UNSUPPORTED_PLATFORM'],
        ['DOWNLOAD_FAILED', 'tools.error.DOWNLOAD_FAILED'],
        ['HASH_MISMATCH', 'tools.error.HASH_MISMATCH'],
        ['EXTRACT_FAILED', 'tools.error.EXTRACT_FAILED'],
        ['INCOMPLETE', 'tools.error.INCOMPLETE'],
        ['DISK', 'tools.error.DISK'],
        ['DOCKER_MISSING', 'tools.error.DOCKER_MISSING'],
        ['INVALID', 'tools.error.INVALID']
    ] as const)('names the text of %s', (code, key) => {
        expect(programErrorKey(code)).toBe(key);
    });
});

describe('lookupReasonKey', () => {
    it.each([
        ['no-release', 'tools.lookup.no-release'],
        ['signature', 'tools.lookup.signature'],
        ['checksum', 'tools.lookup.checksum'],
        ['invalid', 'tools.lookup.invalid'],
        ['patches', 'tools.lookup.patches'],
        ['failed', 'tools.lookup.failed']
    ] as const)('names the text of %s', (reason, key) => {
        expect(lookupReasonKey(reason)).toBe(key);
    });
});

describe('programProgressKey', () => {
    it.each([
        ['missing', 'tools.status.missing'],
        ['downloading', 'tools.status.downloading'],
        ['verifying', 'tools.status.verifying'],
        ['extracting', 'tools.status.extracting']
    ] as const)('names the text of %s', (status, key) => {
        expect(programProgressKey(status)).toBe(key);
    });
});

describe('isWorking', () => {
    it('is true while a program is downloaded, verified or unpacked', () => {
        expect(isWorking(stateWith('downloading'))).toBe(true);
        expect(isWorking(stateWith('verifying'))).toBe(true);
        expect(isWorking(stateWith('extracting'))).toBe(true);
    });

    it('is false when it is waiting, ready or failed', () => {
        expect(isWorking(stateWith('missing'))).toBe(false);
        expect(isWorking(stateWith('ready'))).toBe(false);
        expect(isWorking(stateWith('error'))).toBe(false);
    });
});

describe('displayVersion', () => {
    it('shows a commit of ani-cli by its first seven digits, and a short version as it is', () => {
        expect(displayVersion('anicli', '0123456789abcdef0123456789abcdef01234567')).toBe('0123456');
        expect(displayVersion('anicli', '4.10')).toBe('4.10');
    });

    it('shows the build of ffmpeg as a build', () => {
        expect(displayVersion('ffmpeg', 'latest-abc123')).toBe('build abc123');
        expect(displayVersion('ffmpeg', '7.1')).toBe('7.1');
    });

    it('leaves the others as they are', () => {
        PROGRAM_IDS.filter((id) => {
            return id !== 'anicli' && id !== 'ffmpeg';
        }).forEach((id) => {
            expect(displayVersion(id, '2026.08.19')).toBe('2026.08.19');
        });
    });
});
