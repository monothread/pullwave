import type { LogWriter, OutputStream } from '@main/services/logHub';

export type LogCall =
    | { method: 'command'; program: string; args: string[] }
    | { method: 'line'; stream: OutputStream; text: string }
    | { method: 'progress'; stream: OutputStream; text: string }
    | { method: 'exit'; code: number | null; signal: NodeJS.Signals | null | undefined }
    | { method: 'failure'; message: string }
    | { method: 'stopped' };

export interface FakeLogWriter {
    writer: LogWriter;
    calls: LogCall[];
}

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
        },
        stopped: () => {
            calls.push({ method: 'stopped' });
        }
    };
    return { writer, calls };
}
