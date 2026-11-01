import type { ErrorDetails } from '@shared/errorDetails';

// The code of the system (ENOENT, ECONNREFUSED, ERR_...) an error carries. The `code` of the errors the app makes (INVALID, API_ERROR...)
// is not one: the system ones come with the call that failed (`syscall`) or the number of the error (`errno`), or are named ERR_*.
function systemCodeOf(error: unknown): string | null {
    if (typeof error !== 'object' || error === null) {
        return null;
    }
    const { code, errno, syscall } = error as { code?: unknown; errno?: unknown; syscall?: unknown };
    if (typeof code !== 'string') {
        return null;
    }
    return typeof errno === 'number' || typeof syscall === 'string' || code.startsWith('ERR_') || code.startsWith('UND_ERR') ? code : null;
}

// What an error carries by itself (its kind, the code of the system, its cause and its stack) plus what the place that caught it knows.
export function describeError(error: unknown, known: Partial<ErrorDetails> = {}, now: () => number = Date.now): ErrorDetails {
    const details: ErrorDetails = { occurredAt: now() };
    if (error instanceof Error) {
        details.errorName = error.name;
        if (error.stack !== undefined) {
            details.stack = error.stack;
        }
        const systemCode = systemCodeOf(error) ?? systemCodeOf(error.cause);
        if (systemCode !== null) {
            details.systemCode = systemCode;
        }
        if (error.cause !== undefined) {
            details.cause = error.cause instanceof Error ? error.cause.message : String(error.cause);
        }
    }
    return { ...details, ...known };
}

// The details kept in a column of text, and back (a damaged or old value is no details).
export function serializeErrorDetails(details: ErrorDetails | undefined): string | null {
    return details === undefined ? null : JSON.stringify(details);
}

export function parseErrorDetails(value: string | null): ErrorDetails | undefined {
    if (value === null) {
        return undefined;
    }
    try {
        const parsed: unknown = JSON.parse(value);
        if (typeof parsed === 'object' && parsed !== null && typeof (parsed as { occurredAt?: unknown }).occurredAt === 'number') {
            return parsed as ErrorDetails;
        }
    } catch {
        return undefined;
    }
    return undefined;
}

// A program with its arguments as it would be typed (an argument with spaces is quoted).
export function commandLine(program: string, args: readonly string[]): string {
    return [program, ...args]
        .map((part) => {
            return /\s/.test(part) ? JSON.stringify(part) : part;
        })
        .join(' ');
}
