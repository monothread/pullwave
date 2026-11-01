// Everything known about an error besides its code and its text. Every field but the moment is optional: each place that fails knows a
// different part of it (a request knows the address and the HTTP status, a program knows its exit code and its command...).
export interface ErrorDetails {
    // When it happened (milliseconds since 1970).
    occurredAt: number;
    // What was being done, in words (for example "Asking the manga server for the chapters").
    operation?: string;
    // The address that was being asked, when there was one.
    url?: string;
    httpStatus?: number;
    // The program that was run, with its arguments.
    command?: string;
    exitCode?: number;
    // The code of the system (ENOENT, ECONNREFUSED...).
    systemCode?: string;
    // The kind of error (TypeError, TimeoutError...).
    errorName?: string;
    // The error that caused this one.
    cause?: string;
    stack?: string;
}
