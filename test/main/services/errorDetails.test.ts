import { commandLine, describeError, parseErrorDetails, serializeErrorDetails } from '@main/services/errorDetails';

const NOW = 1_700_000_000_000;

function now(): number {
    return NOW;
}

describe('describeError', () => {
    it('gives the moment, the kind and the stack of an error', () => {
        const error = new TypeError('bad input');
        expect(describeError(error, {}, now)).toEqual({ occurredAt: NOW, errorName: 'TypeError', stack: error.stack });
    });

    it('takes the moment from the clock when none is given', () => {
        vi.spyOn(Date, 'now').mockReturnValue(NOW);
        expect(describeError('text')).toEqual({ occurredAt: NOW });
        vi.restoreAllMocks();
    });

    it('gives only the moment for something that is not an error', () => {
        expect(describeError('text', {}, now)).toEqual({ occurredAt: NOW });
        expect(describeError(null, {}, now)).toEqual({ occurredAt: NOW });
        expect(describeError({ code: 'ENOENT' }, {}, now)).toEqual({ occurredAt: NOW });
    });

    it('leaves the stack out when the error has none', () => {
        const error = new Error('no stack');
        error.stack = undefined;
        expect(describeError(error, {}, now)).toEqual({ occurredAt: NOW, errorName: 'Error' });
    });

    it('keeps the code of the system, which comes with the call that failed', () => {
        const withSyscall = Object.assign(new Error('spawn x ENOENT'), { code: 'ENOENT', syscall: 'spawn x' });
        const withErrno = Object.assign(new Error('disk full'), { code: 'ENOSPC', errno: -28 });
        expect(describeError(withSyscall, {}, now).systemCode).toBe('ENOENT');
        expect(describeError(withErrno, {}, now).systemCode).toBe('ENOSPC');
    });

    it('keeps the codes named ERR_ and UND_ERR of the runtime', () => {
        expect(describeError(Object.assign(new Error('a'), { code: 'ERR_INVALID_URL' }), {}, now).systemCode).toBe('ERR_INVALID_URL');
        expect(describeError(Object.assign(new Error('b'), { code: 'UND_ERR_CONNECT_TIMEOUT' }), {}, now).systemCode).toBe('UND_ERR_CONNECT_TIMEOUT');
    });

    it('does not take the code the app gives its own errors for a code of the system', () => {
        expect(describeError(Object.assign(new Error('x'), { code: 'API_ERROR' }), {}, now).systemCode).toBeUndefined();
        expect(describeError(Object.assign(new Error('x'), { code: 'EMPTY_CHAPTER' }), {}, now).systemCode).toBeUndefined();
        expect(describeError(Object.assign(new Error('x'), { code: 42 }), {}, now).systemCode).toBeUndefined();
    });

    it('says what caused the error, and takes the code of the system from the cause', () => {
        const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:4567'), { code: 'ECONNREFUSED', errno: -111, syscall: 'connect' });
        const error = new TypeError('fetch failed', { cause });
        expect(describeError(error, {}, now)).toEqual({
            occurredAt: NOW,
            errorName: 'TypeError',
            stack: error.stack,
            systemCode: 'ECONNREFUSED',
            cause: 'connect ECONNREFUSED 127.0.0.1:4567'
        });
    });

    it('writes a cause that is not an error as text', () => {
        const error = new Error('failed', { cause: 'the plug' });
        expect(describeError(error, {}, now).cause).toBe('the plug');
    });

    it('lets what the caller knows win over what the error carries', () => {
        const error = new Error('boom');
        expect(describeError(error, { operation: 'Doing it', url: 'https://x.test/a', httpStatus: 502, errorName: 'Named' }, now)).toEqual({
            occurredAt: NOW,
            errorName: 'Named',
            stack: error.stack,
            operation: 'Doing it',
            url: 'https://x.test/a',
            httpStatus: 502
        });
    });
});

describe('serializeErrorDetails and parseErrorDetails', () => {
    it('writes the details as text and reads them back', () => {
        const details = { occurredAt: NOW, operation: 'Doing it', httpStatus: 500, stack: 'Error: x\n    at y' };
        const text = serializeErrorDetails(details);
        expect(text).toBe(JSON.stringify(details));
        expect(parseErrorDetails(text)).toEqual(details);
    });

    it('writes nothing when there are no details', () => {
        expect(serializeErrorDetails(undefined)).toBeNull();
    });

    it('reads no details from nothing, from damaged text or from something that is not details', () => {
        expect(parseErrorDetails(null)).toBeUndefined();
        expect(parseErrorDetails('{not json')).toBeUndefined();
        expect(parseErrorDetails('"text"')).toBeUndefined();
        expect(parseErrorDetails('null')).toBeUndefined();
        expect(parseErrorDetails('{"operation":"x"}')).toBeUndefined();
        expect(parseErrorDetails('{"occurredAt":"yesterday"}')).toBeUndefined();
    });
});

describe('commandLine', () => {
    it('writes the program and its arguments the way they would be typed', () => {
        expect(commandLine('yt-dlp', ['--newline', 'https://x.test/v'])).toBe('yt-dlp --newline https://x.test/v');
    });

    it('quotes what has spaces', () => {
        expect(commandLine('/opt/my tools/yt-dlp', ['-o', '/home/a b/%(title)s.%(ext)s'])).toBe('"/opt/my tools/yt-dlp" -o "/home/a b/%(title)s.%(ext)s"');
    });

    it('writes the program alone when it has no arguments', () => {
        expect(commandLine('yt-dlp', [])).toBe('yt-dlp');
    });
});
