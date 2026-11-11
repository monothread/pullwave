import type { LogWriter, OutputStream } from '@main/services/logHub';

// One call made to a log writer, in the order it was made.
export type LogCall =
    | { method: 'command'; program: string; args: string[] }
    | { method: 'line'; stream: OutputStream; text: string }
    | { method: 'progress'; stream: OutputStream; text: string }
    | { method: 'exit'; code: number | null; signal: NodeJS.Signals | null | undefined }
    | { method: 'failure'; message: string };

export interface FakeLogWriter {
    writer: LogWriter;
    calls: LogCall[];
}

// A log writer that keeps every call it gets, so a test can check exactly what a run wrote.
export function createFakeLogWriter(): FakeLogWriter {
    const calls: LogCall[] = [];
    const writer: LogWriter = {
        command: (program, args) => {
            calls.push({ method: 'command', program, args: [...args] });
        },
        line: (stream, text) => {
            calls.push({ method: 'line', stream, text });
        },
        progress: (stream, text) => {
            calls.push({ method: 'progress', stream, text });
        },
        exit: (code, signal) => {
            calls.push({ method: 'exit', code, signal });
        },
        failure: (message) => {
            calls.push({ method: 'failure', message });
        }
    };
    return { writer, calls };
}
