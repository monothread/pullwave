import { ANICLI_UPDATE_STEPS, PROGRAM_IDS, type ToolState } from '@shared/tools';
import { createTranslator } from '@shared/i18n';
import { displayVersion, isWorking, lookupReasonKey, programErrorKey, programErrorReport, programProgressKey, updateStepKey, updateStepStates } from '@renderer/components/programText';

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
        ['incompatible', 'tools.lookup.incompatible'],
        ['failed', 'tools.lookup.failed']
    ] as const)('names the text of %s', (reason, key) => {
        expect(lookupReasonKey(reason)).toBe(key);
    });
});

describe('updateStepKey', () => {
    it.each([
        ['compatibility', 'tools.step.compatibility'],
        ['download', 'tools.step.download'],
        ['syntax', 'tools.step.syntax'],
        ['search', 'tools.step.search'],
        ['episodes', 'tools.step.episodes'],
        ['episode', 'tools.step.episode']
    ] as const)('names the text of %s', (step, key) => {
        expect(updateStepKey(step)).toBe(key);
    });

    it('has a text for every step, in every language', () => {
        (['en', 'pt', 'es', 'ja', 'zh'] as const).forEach((language) => {
            const t = createTranslator(language);
            ANICLI_UPDATE_STEPS.forEach((step) => {
                expect(t(updateStepKey(step))).not.toBe(updateStepKey(step));
            });
            expect(t('tools.step.title')).not.toBe('tools.step.title');
            expect(t('tools.lookup.incompatible')).not.toBe('tools.lookup.incompatible');
        });
    });
});

describe('updateStepStates', () => {
    function update(overrides: Partial<ToolState>): ToolState {
        return { id: 'anicli', status: 'verifying', version: null, bytesDone: 0, bytesTotal: 0, percent: 0, error: null, ...overrides };
    }

    it('lists the steps in order: the ones before the current one done, it going on, the ones after it to come', () => {
        expect(updateStepStates(update({ step: 'syntax' }))).toEqual([
            { step: 'compatibility', state: 'done' },
            { step: 'download', state: 'done' },
            { step: 'syntax', state: 'running' },
            { step: 'search', state: 'pending' },
            { step: 'episodes', state: 'pending' },
            { step: 'episode', state: 'pending' }
        ]);
    });

    it('marks the step it stopped at when the update failed', () => {
        expect(updateStepStates(update({ step: 'episodes', status: 'error' }))).toEqual([
            { step: 'compatibility', state: 'done' },
            { step: 'download', state: 'done' },
            { step: 'syntax', state: 'done' },
            { step: 'search', state: 'done' },
            { step: 'episodes', state: 'failed' },
            { step: 'episode', state: 'pending' }
        ]);
    });

    it('takes a state without a step for the download', () => {
        expect(updateStepStates(update({ status: 'downloading' })).map(({ state }) => {
            return state;
        })).toEqual(['done', 'running', 'pending', 'pending', 'pending', 'pending']);
    });

    it('has the first step going on when the update starts, and the last one going on (not done) when it is ready to be used', () => {
        expect(updateStepStates(update({ step: 'compatibility' }))[0]).toEqual({ step: 'compatibility', state: 'running' });
        expect(updateStepStates(update({ step: 'episode', status: 'ready' })).at(-1)).toEqual({ step: 'episode', state: 'running' });
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

describe('programErrorReport', () => {
    it('gives the words for the code, the code, and the message of the failure as the technical text', () => {
        expect(programErrorReport(createTranslator('en'), { code: 'DOWNLOAD_FAILED', message: 'getaddrinfo ENOTFOUND github.com' })).toEqual({
            summary: 'The download failed. Check your connection and try again.',
            code: 'DOWNLOAD_FAILED',
            message: 'getaddrinfo ENOTFOUND github.com',
            hint: null,
            details: null
        });
    });

    it('carries everything known about the failure', () => {
        const details = { occurredAt: 1700000000000, operation: 'Downloading ytdlp 2025.01.01', url: 'https://example.test/yt-dlp' };
        expect(programErrorReport(createTranslator('es'), { code: 'HASH_MISMATCH', message: 'sha mismatch', details })).toEqual({
            summary: createTranslator('es')('tools.error.HASH_MISMATCH'),
            code: 'HASH_MISMATCH',
            message: 'sha mismatch',
            hint: null,
            details
        });
    });
});
