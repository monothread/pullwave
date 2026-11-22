import { killProcessTree } from '@main/services/processTree';

describe('killProcessTree', () => {
    it('ends the whole process tree with taskkill on Windows', () => {
        const kill = vi.fn();
        const taskkill = vi.fn();
        killProcessTree({ pid: 4321, kill }, 'win32', taskkill);
        expect(taskkill).toHaveBeenCalledTimes(1);
        expect(taskkill).toHaveBeenCalledWith('taskkill', ['/PID', '4321', '/T', '/F']);
        expect(kill).not.toHaveBeenCalled();
    });

    it('falls back to a plain kill on Windows when the process has no pid', () => {
        const kill = vi.fn();
        const taskkill = vi.fn();
        killProcessTree({ kill }, 'win32', taskkill);
        expect(taskkill).not.toHaveBeenCalled();
        expect(kill).toHaveBeenCalledWith('SIGTERM');
    });

    it.each<NodeJS.Platform>(['linux', 'darwin'])('sends SIGTERM to the whole process group on %s, so the ffmpeg of yt-dlp ends too', (platform) => {
        const kill = vi.fn();
        const taskkill = vi.fn();
        const killGroup = vi.fn();
        killProcessTree({ pid: 99, kill }, platform, taskkill, 'SIGTERM', killGroup);
        expect(killGroup).toHaveBeenCalledTimes(1);
        expect(killGroup).toHaveBeenCalledWith(99, 'SIGTERM');
        expect(kill).not.toHaveBeenCalled();
        expect(taskkill).not.toHaveBeenCalled();
    });

    it('sends the signal that was asked for to the group', () => {
        const killGroup = vi.fn();
        killProcessTree({ pid: 99, kill: vi.fn() }, 'linux', vi.fn(), 'SIGKILL', killGroup);
        expect(killGroup).toHaveBeenCalledWith(99, 'SIGKILL');
    });

    it('signals the process alone when the group cannot be reached', () => {
        const kill = vi.fn();
        const killGroup = vi.fn(() => {
            throw new Error('ESRCH');
        });
        killProcessTree({ pid: 99, kill }, 'linux', vi.fn(), 'SIGKILL', killGroup);
        expect(killGroup).toHaveBeenCalledTimes(1);
        expect(kill).toHaveBeenCalledTimes(1);
        expect(kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('signals the process alone when it has no pid', () => {
        const kill = vi.fn();
        const killGroup = vi.fn();
        killProcessTree({ kill }, 'linux', vi.fn(), 'SIGTERM', killGroup);
        expect(killGroup).not.toHaveBeenCalled();
        expect(kill).toHaveBeenCalledWith('SIGTERM');
    });

    it.skipIf(process.platform === 'win32')('ends a real process group, children included', async () => {
        const { spawn } = await import('node:child_process');
        const child = spawn(process.execPath, ['-e', 'const { spawn } = require("node:child_process"); spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" }); setInterval(() => {}, 1000);'], {
            detached: true,
            stdio: 'ignore'
        });
        const pid = child.pid ?? 0;
        await new Promise((resolve) => {
            setTimeout(resolve, 400);
        });
        expect(() => {
            process.kill(-pid, 0);
        }).not.toThrow();
        const closed = new Promise((resolve) => {
            child.once('close', resolve);
        });
        killProcessTree(child, 'linux');
        await closed;
        await new Promise((resolve) => {
            setTimeout(resolve, 300);
        });
        expect(() => {
            process.kill(-pid, 0);
        }).toThrow();
    });

    it('does not fail when taskkill cannot be started (default spawn)', () => {
        expect(() => {
            killProcessTree({ pid: 2147483646, kill: vi.fn() }, 'win32');
        }).not.toThrow();
    });
});
