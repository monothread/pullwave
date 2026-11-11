import { salvageRecording } from '@main/services/recordingSalvage';
import { runFfmpegQuietly } from '@main/services/ffmpegExec';

// The default runner of ffmpeg (which writes to the log of ffmpeg) is a stand-in here: no test runs ffmpeg.
vi.mock('@main/services/ffmpegExec', () => {
    return { runFfmpegQuietly: vi.fn() };
});

const FINAL = '/dl/Live Show [abc].mp4';
const PARTIAL = `${FINAL}.part`;

function setup(existing: string[], ffmpegWorks = true) {
    const files = new Set(existing);
    const runFfmpeg = vi.fn<(binary: string, args: string[]) => Promise<boolean>>().mockImplementation(() => {
        if (ffmpegWorks) {
            files.add(FINAL);
        }
        return Promise.resolve(ffmpegWorks);
    });
    const removeFile = vi.fn((path: string) => {
        files.delete(path);
    });
    const options = {
        ffmpegBinary: '/app/bin/ffmpeg',
        filePath: FINAL,
        runFfmpeg,
        fileExists: (path: string) => {
            return files.has(path);
        },
        removeFile
    };
    return { options, runFfmpeg, removeFile, files };
}

describe('salvageRecording', () => {
    it('copies the partial file into the final file without re-encoding and removes the partial', async () => {
        const { options, runFfmpeg, removeFile } = setup([PARTIAL]);
        await expect(salvageRecording(options)).resolves.toBe(FINAL);
        expect(runFfmpeg).toHaveBeenCalledTimes(1);
        expect(runFfmpeg).toHaveBeenCalledWith('/app/bin/ffmpeg', ['-y', '-v', 'error', '-i', PARTIAL, '-c', 'copy', FINAL]);
        expect(removeFile).toHaveBeenCalledTimes(1);
        expect(removeFile).toHaveBeenCalledWith(PARTIAL);
    });

    it('keeps the partial file and returns null when ffmpeg fails', async () => {
        const { options, removeFile, files } = setup([PARTIAL], false);
        await expect(salvageRecording(options)).resolves.toBeNull();
        expect(removeFile).not.toHaveBeenCalled();
        expect(files.has(PARTIAL)).toBe(true);
    });

    it('keeps the partial file when ffmpeg reports success but produced no file', async () => {
        const { options, runFfmpeg, removeFile } = setup([PARTIAL]);
        runFfmpeg.mockResolvedValueOnce(true);
        const files = new Set([PARTIAL]);
        await expect(salvageRecording({ ...options, fileExists: (path) => {
            return files.has(path);
        } })).resolves.toBeNull();
        expect(removeFile).not.toHaveBeenCalled();
    });

    it('returns the final file as it is when there is no partial file but the final exists', async () => {
        const { options, runFfmpeg } = setup([FINAL]);
        await expect(salvageRecording(options)).resolves.toBe(FINAL);
        expect(runFfmpeg).not.toHaveBeenCalled();
    });

    it('returns null when neither file exists', async () => {
        const { options, runFfmpeg } = setup([]);
        await expect(salvageRecording(options)).resolves.toBeNull();
        expect(runFfmpeg).not.toHaveBeenCalled();
    });

    it('reports a failure of the default ffmpeg runner when the binary does not exist', async () => {
        await expect(
            salvageRecording({ ffmpegBinary: '/definitely/not/ffmpeg', filePath: FINAL, fileExists: (path) => {
                return path === PARTIAL;
            } })
        ).resolves.toBeNull();
    });
});

describe('salvageRecording with the default runner of ffmpeg', () => {
    it('copies the partial file with the runner that writes to the log of ffmpeg, with the exact arguments', async () => {
        const { options, files } = setup([PARTIAL]);
        vi.mocked(runFfmpegQuietly).mockImplementation(() => {
            files.add(FINAL);
            return Promise.resolve(true);
        });
        await expect(salvageRecording({ ...options, runFfmpeg: undefined })).resolves.toBe(FINAL);
        expect(runFfmpegQuietly).toHaveBeenCalledTimes(1);
        expect(runFfmpegQuietly).toHaveBeenCalledWith('/app/bin/ffmpeg', ['-y', '-v', 'error', '-i', PARTIAL, '-c', 'copy', FINAL]);
    });
});
