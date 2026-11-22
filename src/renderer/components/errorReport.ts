import type { ErrorDetails } from '@shared/errorDetails';
import type { MessageKey } from '@shared/i18n';
import { machineTimeZone } from '@shared/timezone';
import { formatDateTime } from './dateFormat';

export interface ErrorReport {
    summary: string;
    code: string | null;
    message: string;
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
    timeZone?: string;
}

export interface CodedError {
    code: string;
    details?: ErrorDetails;
}

export function codedErrorReport(summary: string, error: CodedError, message: string, hint: string | null = null): ErrorReport {
    return { summary, code: error.code, message, hint, details: error.details ?? null };
}

export function plainErrorReport(summary: string, message: string): ErrorReport {
    return { summary, code: null, message, hint: null, details: null };
}

export function hasMoreToSay(report: ErrorReport): boolean {
    return report.message !== '' || report.details !== null || report.code !== null || report.hint !== null;
}

function momentOf(occurredAt: number, language: string, timeZone: string): string {
    const date = new Date(occurredAt);
    return `${formatDateTime(occurredAt, language, timeZone)} (${date.toISOString()})`;
}

export function errorFields(report: ErrorReport, context: ErrorContext): ErrorField[] {
    const { details } = report;
    const timeZone = context.timeZone ?? machineTimeZone();
    const candidates: Array<[MessageKey, string | null | undefined]> = [
        ['errorDialog.field.code', report.code],
        ['errorDialog.field.when', details === null ? null : momentOf(details.occurredAt, context.language, timeZone)],
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
