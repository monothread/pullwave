export interface ErrorEmitterLike {
    on: (event: 'error', listener: (error: NodeJS.ErrnoException) => void) => unknown;
}

export function ignoreStdioErrors(streams: ErrorEmitterLike[] = [process.stdout, process.stderr]): void {
    streams.forEach((stream) => {
        stream.on('error', () => {
            return undefined;
        });
    });
}
