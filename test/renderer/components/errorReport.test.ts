import type { ErrorDetails } from '@shared/errorDetails';
import { codedErrorReport, errorFields, hasMoreToSay, plainErrorReport, type ErrorContext, type ErrorReport } from '@renderer/components/errorReport';

const CONTEXT: ErrorContext = { appVersion: '0.23.0', system: 'Mozilla/5.0 (X11; Linux x86_64) Electron/40.0.0', language: 'en' };
const OCCURRED_AT = 1700000000000;
const ISO = '2023-11-14T22:13:20.000Z';

const FULL_DETAILS: ErrorDetails = {
    occurredAt: OCCURRED_AT,
    operation: 'Running yt-dlp',
    url: 'https://example.test/video',
    httpStatus: 403,
    command: 'yt-dlp --newline https://example.test/video',
    exitCode: 1,
    systemCode: 'ECONNRESET',
    errorName: 'TypeError',
    cause: 'read ECONNRESET',
    stack: 'TypeError: fetch failed\n    at run (a.ts:1:1)'
};

describe('codedErrorReport', () => {
    it('gives the words, the code, the technical text, the hint and the details', () => {
        expect(codedErrorReport('Network failure', { code: 'NETWORK', details: FULL_DETAILS }, 'getaddrinfo failed', 'Check your connection.')).toEqual({
            summary: 'Network failure',
            code: 'NETWORK',
            message: 'getaddrinfo failed',
            hint: 'Check your connection.',
            details: FULL_DETAILS
        });
    });

    it('has no hint and no details unless they are given', () => {
        expect(codedErrorReport('Something went wrong.', { code: 'UNKNOWN' }, 'boom')).toEqual({
            summary: 'Something went wrong.',
            code: 'UNKNOWN',
            message: 'boom',
            hint: null,
            details: null
        });
    });
});

describe('plainErrorReport', () => {
    it('is the words and the text, with nothing else known', () => {
        expect(plainErrorReport('The manga server could not start.', 'port in use')).toEqual({
            summary: 'The manga server could not start.',
            code: null,
            message: 'port in use',
            hint: null,
            details: null
        });
    });
});

describe('hasMoreToSay', () => {
    const base: ErrorReport = { summary: 'x', code: null, message: '', hint: null, details: null };

    it('is false for an error that is only a sentence', () => {
        expect(hasMoreToSay(base)).toBe(false);
    });

    it.each<[string, Partial<ErrorReport>]>([
        ['a technical text', { message: 'boom' }],
        ['details', { details: { occurredAt: OCCURRED_AT } }],
        ['a code', { code: 'NETWORK' }],
        ['a hint', { hint: 'Try again.' }]
    ])('is true for an error with %s', (_name, extra) => {
        expect(hasMoreToSay({ ...base, ...extra })).toBe(true);
    });
});

describe('errorFields', () => {
    it('lists everything known, in a fixed order', () => {
        const report = codedErrorReport('Network failure', { code: 'NETWORK', details: FULL_DETAILS }, 'getaddrinfo failed');
        expect(errorFields(report, CONTEXT)).toEqual([
            { label: 'errorDialog.field.code', value: 'NETWORK' },
            { label: 'errorDialog.field.when', value: `${new Date(OCCURRED_AT).toLocaleString('en')} (${ISO})` },
            { label: 'errorDialog.field.operation', value: 'Running yt-dlp' },
            { label: 'errorDialog.field.url', value: 'https://example.test/video' },
            { label: 'errorDialog.field.httpStatus', value: '403' },
            { label: 'errorDialog.field.command', value: 'yt-dlp --newline https://example.test/video' },
            { label: 'errorDialog.field.exitCode', value: '1' },
            { label: 'errorDialog.field.systemCode', value: 'ECONNRESET' },
            { label: 'errorDialog.field.errorName', value: 'TypeError' },
            { label: 'errorDialog.field.cause', value: 'read ECONNRESET' },
            { label: 'errorDialog.field.appVersion', value: '0.23.0' },
            { label: 'errorDialog.field.system', value: 'Mozilla/5.0 (X11; Linux x86_64) Electron/40.0.0' }
        ]);
    });

    it('lists only what is known', () => {
        expect(errorFields(plainErrorReport('Could not start.', 'port in use'), CONTEXT)).toEqual([
            { label: 'errorDialog.field.appVersion', value: '0.23.0' },
            { label: 'errorDialog.field.system', value: 'Mozilla/5.0 (X11; Linux x86_64) Electron/40.0.0' }
        ]);
    });

    it('leaves out an exit code and an HTTP status that are not there, but keeps a zero', () => {
        const report = codedErrorReport('x', { code: 'UNKNOWN', details: { occurredAt: OCCURRED_AT, exitCode: 0, httpStatus: 0 } }, 'm');
        expect(
            errorFields(report, { ...CONTEXT, appVersion: '', system: '' }).map((field) => {
                return [field.label, field.value];
            })
        ).toEqual([
            ['errorDialog.field.code', 'UNKNOWN'],
            ['errorDialog.field.when', `${new Date(OCCURRED_AT).toLocaleString('en')} (${ISO})`],
            ['errorDialog.field.httpStatus', '0'],
            ['errorDialog.field.exitCode', '0']
        ]);
    });

    it('leaves out the version of the app and the system when they are not known', () => {
        const fields = errorFields(plainErrorReport('x', 'm'), { appVersion: '', system: '', language: 'en' });
        expect(fields).toEqual([]);
    });

    it('writes the moment in the language of the app', () => {
        const report = codedErrorReport('x', { code: 'UNKNOWN', details: { occurredAt: OCCURRED_AT } }, 'm');
        const when = errorFields(report, { ...CONTEXT, language: 'ja' }).find((field) => {
            return field.label === 'errorDialog.field.when';
        });
        expect(when?.value).toBe(`${new Date(OCCURRED_AT).toLocaleString('ja')} (${ISO})`);
    });
});
