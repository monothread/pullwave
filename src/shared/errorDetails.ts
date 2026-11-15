export interface ErrorDetails {
    occurredAt: number;
    operation?: string;
    url?: string;
    httpStatus?: number;
    command?: string;
    exitCode?: number;
    systemCode?: string;
    errorName?: string;
    cause?: string;
    stack?: string;
}
