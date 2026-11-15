import type { WebContents } from 'electron';
import type { DiagnosticLog } from './diagnosticLog';

export type DiagnosticContents = Pick<WebContents, 'on' | 'executeJavaScript'>;

export interface WindowDiagnosticsOptions {
    onBridgeMissing: (reason: string) => void;
}

export function attachWindowDiagnostics(contents: DiagnosticContents, log: DiagnosticLog, options: WindowDiagnosticsOptions): void {
    contents.on('preload-error', (_event, preloadPath, error) => {
        const reason = `Preload failed: ${preloadPath}: ${error.stack ?? error.message}`;
        log.write(reason);
        options.onBridgeMissing(reason);
    });
    contents.on('console-message', (event) => {
        const { level, message, sourceId, lineNumber } = event;
        if (level === 'error' || level === 'warning') {
            log.write(`Page ${level}: ${message} (${sourceId}:${lineNumber})`);
        }
    });
    contents.on('render-process-gone', (_event, details) => {
        log.write(`Render process gone: ${details.reason} (exit code ${details.exitCode})`);
    });
    contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
        log.write(`Page failed to load: ${errorDescription} (${errorCode}) ${validatedUrl}`);
    });
    contents.on('did-finish-load', () => {
        void contents
            .executeJavaScript("typeof window.api === 'object' && window.api !== null")
            .then((present: unknown) => {
                if (present !== true) {
                    const reason = 'The page loaded but window.api is missing, so its buttons cannot reach the app.';
                    log.write(reason);
                    options.onBridgeMissing(reason);
                }
            })
            .catch((error: unknown) => {
                log.write(`Could not check window.api: ${String(error)}`);
            });
    });
}
