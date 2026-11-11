import { buildConcatList, mergeParts } from '@main/services/partsMerger';
import { runFfmpegQuietly } from '@main/services/ffmpegExec';

// The default runner of ffmpeg (which writes to the log of ffmpeg) is a stand-in here: no test runs ffmpeg.
vi.mock('@main/services/ffmpegExec', () => {
    return { runFfmpegQuietly: vi.fn() };
});

const PART_1 = '/dl/Live Show [abc].mp4';
const PART_2 = '/dl/Live Show [abc] (part 2).mp4';
const PART_3 = '/dl/Live Show [abc] (part 3).mp4';
const LIST = `${PART_1}.concat.txt`;
const MERGED = '/dl/Live Show [abc].merging.mp4';

function setup(existing: string[], ffmpegWorks = true, producesFile = true) {
    const files = new Set(existing);
    const runFfmpeg = vi.fn<(binary: string, args: string[]) => Promise<boolean>>().mockImplementation(() => {
        if (producesFile) {
            files.add(MERGED);
        }
        return Promise.resolve(ffmpegWorks);
    });
    const removeFile = vi.fn((path: string) => {
        files.delete(path);
    });
    const writeTextFile = vi.fn();
    const renameFile = vi.fn((from: string, to: string) => {
        files.delete(from);
        files.add(to);
    });
    const options = {
        ffmpegBinary: '/app/bin/ffmpeg',
        paths: [PART_1, PART_2, PART_3],
        runFfmpeg,
        fileExists: (path: string) => {
            return files.has(path);
        },
        removeFile,
        writeTextFile,
        renameFile
    };
    return { options, runFfmpeg, removeFile, writeTextFile, renameFile, files };
}

describe('buildConcatList', () => {
    it('writes one file line per path in order', () => {
        expect(buildConcatList([PART_1, PART_2])).toBe(`file '${PART_1}'\nfile '${PART_2}'`);
    });

    it('escapes single quotes inside a path', () => {
        expect(buildConcatList(["/dl/It's live.mp4"])).toBe("file '/dl/It'\\''s live.mp4'");
    });

    it('returns an empty list for no paths', () => {
        expect(buildConcatList([])).toBe('');
    });
});

describe('mergeParts', () => {
    it('copies every part, in order, into a temporary file without re-encoding', async () => {
        const { options, runFfmpeg, writeTextFile } = setup([PART_1, PART_2, PART_3]);
        await mergeParts(options);
        expect(writeTextFile).toHaveBeenCalledTimes(1);
        expect(writeTextFile).toHaveBeenCalledWith(LIST, `file '${PART_1}'\nfile '${PART_2}'\nfile '${PART_3}'`);
        expect(runFfmpeg).toHaveBeenCalledTimes(1);
        expect(runFfmpeg).toHaveBeenCalledWith('/app/bin/ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', LIST, '-c', 'copy', MERGED]);
    });

    it('replaces the first part with the merged file, removes the other parts and the list and returns the first path', async () => {
        const { options, removeFile, renameFile, files } = setup([PART_1, PART_2, PART_3]);
        await expect(mergeParts(options)).resolves.toBe(PART_1);
        expect(renameFile).toHaveBeenCalledTimes(1);
        expect(renameFile).toHaveBeenCalledWith(MERGED, PART_1);
        expect(removeFile).toHaveBeenCalledTimes(3);
        expect(removeFile).toHaveBeenCalledWith(LIST);
        expect(removeFile).toHaveBeenCalledWith(PART_2);
        expect(removeFile).toHaveBeenCalledWith(PART_3);
        expect([...files]).toEqual([PART_1]);
    });

    it('skips the parts that do not exist', async () => {
        const { options, runFfmpeg, writeTextFile, removeFile } = setup([PART_1, PART_3]);
        await expect(mergeParts(options)).resolves.toBe(PART_1);
        expect(writeTextFile).toHaveBeenCalledWith(LIST, `file '${PART_1}'\nfile '${PART_3}'`);
        expect(runFfmpeg).toHaveBeenCalledTimes(1);
        expect(removeFile).not.toHaveBeenCalledWith(PART_2);
        expect(removeFile).toHaveBeenCalledWith(PART_3);
    });

    it('keeps every part and returns null when ffmpeg fails', async () => {
        const { options, removeFile, renameFile, files } = setup([PART_1, PART_2, PART_3], false, false);
        await expect(mergeParts(options)).resolves.toBeNull();
        expect(renameFile).not.toHaveBeenCalled();
        expect(removeFile).toHaveBeenCalledTimes(1);
        expect(removeFile).toHaveBeenCalledWith(LIST);
        expect([...files]).toEqual([PART_1, PART_2, PART_3]);
    });

    it('removes the incomplete merged file and keeps every part when ffmpeg fails after writing it', async () => {
        const { options, removeFile, renameFile, files } = setup([PART_1, PART_2], false);
        await expect(mergeParts(options)).resolves.toBeNull();
        expect(renameFile).not.toHaveBeenCalled();
        expect(removeFile).toHaveBeenCalledWith(LIST);
        expect(removeFile).toHaveBeenCalledWith(MERGED);
        expect([...files]).toEqual([PART_1, PART_2]);
    });

    it('keeps every part and returns null when ffmpeg reports success but produced no file', async () => {
        const { options, removeFile, renameFile, files } = setup([PART_1, PART_2], true, false);
        await expect(mergeParts(options)).resolves.toBeNull();
        expect(renameFile).not.toHaveBeenCalled();
        expect(removeFile).toHaveBeenCalledTimes(1);
        expect(removeFile).toHaveBeenCalledWith(LIST);
        expect([...files]).toEqual([PART_1, PART_2]);
    });

    it('does nothing and returns the only existing part when there is nothing to join', async () => {
        const { options, runFfmpeg, writeTextFile, removeFile } = setup([PART_2]);
        await expect(mergeParts(options)).resolves.toBe(PART_2);
        expect(runFfmpeg).not.toHaveBeenCalled();
        expect(writeTextFile).not.toHaveBeenCalled();
        expect(removeFile).not.toHaveBeenCalled();
    });

    it('returns null when no part exists', async () => {
        const { options, runFfmpeg } = setup([]);
        await expect(mergeParts(options)).resolves.toBeNull();
        expect(runFfmpeg).not.toHaveBeenCalled();
    });
});

describe('mergeParts with the default runner of ffmpeg', () => {
    it('joins the parts with the runner that writes to the log of ffmpeg, with the exact arguments', async () => {
        const { options, files } = setup([PART_1, PART_2]);
        vi.mocked(runFfmpegQuietly).mockImplementation(() => {
            files.add(MERGED);
            return Promise.resolve(true);
        });
        await expect(mergeParts({ ...options, runFfmpeg: undefined, paths: [PART_1, PART_2] })).resolves.toBe(PART_1);
        expect(runFfmpegQuietly).toHaveBeenCalledTimes(1);
        expect(runFfmpegQuietly).toHaveBeenCalledWith('/app/bin/ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', LIST, '-c', 'copy', MERGED]);
    });
});
