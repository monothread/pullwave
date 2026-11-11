import { createLogFeed, isFfmpegStatsLine } from '@main/services/logFeed';
import { createFakeLogWriter } from '../../helpers/fakeLogWriter';

describe('isFfmpegStatsLine', () => {
    it('recognizes the lines of statistics of ffmpeg', () => {
        expect(isFfmpegStatsLine('frame=  120 fps= 30 q=-1.0 size=    1024kB time=00:00:04.00 bitrate=2097.2kbits/s speed=1.0x')).toBe(true);
        expect(isFfmpegStatsLine('size=    2048kB time=00:00:05.00 bitrate=3355.4kbits/s speed=2.1x')).toBe(true);
        expect(isFfmpegStatsLine('   frame=1')).toBe(true);
    });

    it('does not take other lines for statistics', () => {
        expect(isFfmpegStatsLine('Input #0, mov,mp4,m4a,3gp,3g2,mj2, from \'a.mp4\':')).toBe(false);
        expect(isFfmpegStatsLine('[mp4 @ 0x5555] frame size not set')).toBe(false);
        expect(isFfmpegStatsLine('')).toBe(false);
    });
});

describe('createLogFeed', () => {
    it('writes each complete line on its stream, and the rest on flush', () => {
        const { writer, calls } = createFakeLogWriter();
        const feed = createLogFeed(writer, 'stderr');
        feed.push('one\ntw');
        feed.push('o\r\nthr');
        expect(calls).toEqual([
            { method: 'line', stream: 'stderr', text: 'one' },
            { method: 'line', stream: 'stderr', text: 'two' }
        ]);
        feed.flush();
        expect(calls).toEqual([
            { method: 'line', stream: 'stderr', text: 'one' },
            { method: 'line', stream: 'stderr', text: 'two' },
            { method: 'line', stream: 'stderr', text: 'thr' }
        ]);
    });

    it('writes the lines the test recognizes as progress, and the others as lines', () => {
        const { writer, calls } = createFakeLogWriter();
        const feed = createLogFeed(writer, 'stderr', isFfmpegStatsLine);
        feed.push('Stream mapping:\rframe=1 fps=0\rframe=2 fps=0\nDone\n');
        expect(calls).toEqual([
            { method: 'line', stream: 'stderr', text: 'Stream mapping:' },
            { method: 'progress', stream: 'stderr', text: 'frame=1 fps=0' },
            { method: 'progress', stream: 'stderr', text: 'frame=2 fps=0' },
            { method: 'line', stream: 'stderr', text: 'Done' }
        ]);
    });

    it('takes no line for progress without a test', () => {
        const { writer, calls } = createFakeLogWriter();
        const feed = createLogFeed(writer, 'stdout');
        feed.push('frame=1\n');
        expect(calls).toEqual([{ method: 'line', stream: 'stdout', text: 'frame=1' }]);
    });

    it('writes nothing on flush when no part of a line is left', () => {
        const { writer, calls } = createFakeLogWriter();
        const feed = createLogFeed(writer, 'stdout');
        feed.push('a\n');
        feed.flush();
        expect(calls).toEqual([{ method: 'line', stream: 'stdout', text: 'a' }]);
    });
});
