import type { ErrorDetails } from '@shared/errorDetails';
import type { MessageKey } from '@shared/i18n';

// An error as the window of details shows it: the words for the user, and everything the app knows about it.
export interface ErrorReport {
    // What went wrong, in words for the user.
    summary: string;
    // The code the app gave the error, when it gave one.
    code: string | null;
    // The technical text of the error (what the window copies).
    message: string;
    // What the user can do about it, when the app knows.
    hint: string | null;
    details: ErrorDetails | null;
}

export interface ErrorField {
    label: MessageKey;
    value: string;
}

export interface ErrorContext {
    appVersion: string;
    system: string;
    language: string;
}

export interface CodedError {
    code: string;
    details?: ErrorDetails;
}

// An error that has a code and a text, from any part of the app: the words for the user are given by the part that knows them.
export function codedErrorReport(summary: string, error: CodedError, message: string, hint: string | null = null): ErrorReport {
    return { summary, code: error.code, message, hint, details: error.details ?? null };
}

// An error that is only a text (the server of the manga says it, or a check failed).
export function plainErrorReport(summary: string, message: string): ErrorReport {
    return { summary, code: null, message, hint: null, details: null };
}

// Whether the report has something besides its words to show (an error that is only a sentence has no window to open).
export function hasMoreToSay(report: ErrorReport): boolean {
    return report.message !== '' || report.details !== null || report.code !== null || report.hint !== null;
}

function momentOf(occurredAt: number, language: string): string {
    const date = new Date(occurredAt);
    return `${date.toLocaleString(language)} (${date.toISOString()})`;
}

// What the window lists besides the text of the error: only what is known, in a fixed order.
export function errorFields(report: ErrorReport, context: ErrorContext): ErrorField[] {
    const { details } = report;
    const candidates: Array<[MessageKey, string | null | undefined]> = [
        ['errorDialog.field.code', report.code],
        ['errorDialog.field.when', details === null ? null : momentOf(details.occurredAt, context.language)],
        ['errorDialog.field.operation', details?.operation],
        ['errorDialog.field.url', details?.url],
        ['errorDialog.field.httpStatus', details?.httpStatus === undefined ? null : String(details.httpStatus)],
        ['errorDialog.field.command', details?.command],
        ['errorDialog.field.exitCode', details?.exitCode === undefined ? null : String(details.exitCode)],
        ['errorDialog.field.systemCode', details?.systemCode],
        ['errorDialog.field.errorName', details?.errorName],
        ['errorDialog.field.cause', details?.cause],
        ['errorDialog.field.appVersion', context.appVersion],
        ['errorDialog.field.system', context.system]
    ];
    return candidates
        .filter((candidate): candidate is [MessageKey, string] => {
            return candidate[1] !== null && candidate[1] !== undefined && candidate[1] !== '';
        })
        .map(([label, value]) => {
            return { label, value };
        });
}
