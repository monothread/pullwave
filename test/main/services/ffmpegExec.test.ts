import { join } from 'node:path';
import { openFfmpegLog, runFfmpegQuietly } from '@main/services/ffmpegExec';
import { LogHub, processLogs } from '@main/services/logHub';
import { createFakeLogWriter } from '../../helpers/fakeLogWriter';
import { makeTempDir } from '../../helpers/tempDir';

// Node stands in for ffmpeg: what it is given to run says what it writes and how it ends.
const NODE = process.execPath;

describe('openFfmpegLog', () => {
    it('opens a writer of the log of ffmpeg of the app', () => {
        const open = vi.spyOn(processLogs, 'open');
        const writer = openFfmpegLog();
        expect(open).toHaveBeenCalledWith('ffmpeg');
        expect(writer).toBe(open.mock.results[0]?.value);
        open.mockRestore();
    });
});

describe('runFfmpegQuietly', () => {
    it('resolves true for a run that ends well, and logs the command, both outputs line by line and the end', async () => {
        const { writer, calls } = createFakeLogWriter();
        const args = ['-e', "process.stdout.write('out 1\\nout 2'); process.stderr.write('frame=1 fps=0\\rerr 1\\n');"];
        await expect(runFfmpegQuietly(NODE, args, writer)).resolves.toBe(true);
        expect(calls).toEqual([
            { method: 'command', program: NODE, args },
            { method: 'line', stream: 'stdout', text: 'out 1' },
            { method: 'line', stream: 'stdout', text: 'out 2' },
            { method: 'progress', stream: 'stderr', text: 'frame=1 fps=0' },
            { method: 'line', stream: 'stderr', text: 'err 1' },
            { method: 'exit', code: 0, signal: undefined }
        ]);
    });

    it('resolves false for a run that ends with an error, and logs its code', async () => {
        const { writer, calls } = createFakeLogWriter();
        const args = ['-e', "process.stderr.write('Invalid data found\\n'); process.exit(3);"];
        await expect(runFfmpegQuietly(NODE, args, writer)).resolves.toBe(false);
        expect(calls).toEqual([
            { method: 'command', program: NODE, args },
            { method: 'line', stream: 'stderr', text: 'Invalid data found' },
            { method: 'exit', code: 3, signal: null }
        ]);
    });

    it('resolves false for a run ended by a signal, and logs the signal', async () => {
        const { writer, calls } = createFakeLogWriter();
        const args = ['-e', "process.kill(process.pid, 'SIGTERM'); setTimeout(() => undefined, 5000);"];
        const ok = await runFfmpegQuietly(NODE, args, writer);
        expect(ok).toBe(false);
        expect(calls.at(-1)).toEqual(process.platform === 'win32' ? { method: 'exit', code: 1, signal: null } : { method: 'exit', code: null, signal: 'SIGTERM' });
    });

    it('resolves false for a program that cannot be started, and logs why', async () => {
        const { writer, calls } = createFakeLogWriter();
        const missing = join(makeTempDir(), 'no-such-ffmpeg');
        await expect(runFfmpegQuietly(missing, ['-i', 'a.ts'], writer)).resolves.toBe(false);
        expect(calls).toEqual([
            { method: 'command', program: missing, args: ['-i', 'a.ts'] },
            { method: 'failure', message: `could not start: spawn ${missing} ENOENT` }
        ]);
    });

    it('writes to the log of ffmpeg of the app by default', async () => {
        const hub = new LogHub();
        const open = vi.spyOn(processLogs, 'open').mockImplementation((source) => {
            return hub.open(source);
        });
        await runFfmpegQuietly(NODE, ['-e', "process.stderr.write('hi\\n')"]);
        expect(open).toHaveBeenCalledWith('ffmpeg');
        expect(
            hub.snapshot('ffmpeg').map((line) => {
                return [line.stream, line.text];
            })
        ).toEqual([
            ['command', `${NODE} -e process.stderr.write('hi\\n')`],
            ['stderr', 'hi'],
            ['event', 'exited with code 0']
        ]);
        open.mockRestore();
    });
});
