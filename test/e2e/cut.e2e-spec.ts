import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import './display';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installedProgramsEnv } from './programs';

const ROOT = resolve(__dirname, '../..');
const ELECTRON_PATH = createRequire(__filename)('electron') as unknown as string;
const EXE = process.platform === 'win32' ? '.exe' : '';
const FFMPEG = join(ROOT, 'resources', 'bin', `ffmpeg${EXE}`);
const HAS_FFMPEG = existsSync(FFMPEG);

let workDir: string;
let app: ElectronApplication;
let page: Page;
let downloads: string;
let video: string;
let longVideo: string;
let song: string;

function ffmpeg(args: string[]): string {
    try {
        execFileSync(FFMPEG, ['-hide_banner', '-v', 'error', '-y', ...args], { stdio: 'pipe' });
        return '';
    } catch (error) {
        return String((error as { stderr?: Buffer }).stderr ?? error);
    }
}

// What ffmpeg says about a file when it is given only the input: the length, and whether it has a picture.
function probe(path: string): { seconds: number; hasVideo: boolean; hasAudio: boolean } {
    let output = '';
    try {
        execFileSync(FFMPEG, ['-hide_banner', '-i', path], { stdio: 'pipe' });
    } catch (error) {
        output = String((error as { stderr?: Buffer }).stderr);
    }
    const duration = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(output);
    return {
        seconds: duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : -1,
        hasVideo: /Stream #\d+:\d+[^\n]*: Video:/.test(output),
        hasAudio: /Stream #\d+:\d+[^\n]*: Audio:/.test(output)
    };
}

async function launch(file: string, audioFormat = 'mp3'): Promise<void> {
    mkdirSync(join(workDir, 'user-data'), { recursive: true });
    writeFileSync(join(workDir, 'user-data', 'settings.json'), JSON.stringify({ language: 'en', checkUpdatesOnStart: false, downloadDir: downloads, audioFormat }));
    app = await electron.launch({
        executablePath: ELECTRON_PATH,
        args: [ROOT, '--no-sandbox', `--user-data-dir=${join(workDir, 'user-data')}`],
        env: { ...process.env, ...installedProgramsEnv(workDir), PULLWAVE_CUT_FILE: file } as Record<string, string>
    });
    page = await app.firstWindow();
    await page.setViewportSize({ width: 1100, height: 780 });
    await page.waitForSelector('.logo');
    await expect(page.getByText('// BOOTING SYSTEMS…')).toBeHidden({ timeout: 60000 });
    await page.getByRole('navigation', { name: 'Video downloader' }).getByRole('button', { name: 'CUT' }).click();
}

// The button that makes the cut, which is named like the tab (the tab is outside the region).
function cutButton() {
    return page.getByRole('region', { name: 'Cut a file' }).getByRole('button', { name: 'CUT', exact: true });
}

async function choose(): Promise<void> {
    await page.getByRole('button', { name: 'CHOOSE FILE' }).click();
    await expect(page.getByTestId('cut-segment')).toHaveCount(1, { timeout: 20000 });
}

async function fill(number: number, start: string, end: string): Promise<void> {
    await page.getByLabel(`Start of part ${number}`).fill(start);
    await page.getByLabel(`End of part ${number}`).fill(end);
}

test.skip(!HAS_FFMPEG, 'needs the real ffmpeg of resources/bin (node scripts/fetch-binaries.mjs)');

test.beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), 'pullwave-cut-e2e-'));
    downloads = join(workDir, 'downloads');
    mkdirSync(downloads, { recursive: true });
    video = join(workDir, 'Talk.mp4');
    longVideo = join(workDir, 'Long.mp4');
    song = join(workDir, 'Song.mp3');
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc=duration=12:size=320x240:rate=15', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video]);
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=duration=90:size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=90', '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', longVideo]);
    ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=523:duration=20', '-c:a', 'libmp3lame', song]);
});

test.afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
});

test.afterEach(async () => {
    await app.close();
    rmSync(downloads, { recursive: true, force: true });
    mkdirSync(downloads, { recursive: true });
});

test('cuts a video into the parts that were marked, each one a video of the same format, in the folder of the downloads', async () => {
    await launch(video);
    await expect(page.getByRole('region', { name: 'Cut a file' })).toBeVisible();
    await choose();
    await expect(page.getByText('Talk.mp4')).toBeVisible();
    await expect(page.getByText('VIDEO', { exact: true })).toBeVisible();
    await expect(page.getByText('Length: 0:12')).toBeVisible();
    await expect(page.getByText(`Saved in ${downloads}/Talk - cuts`)).toBeVisible();
    await expect(cutButton()).toBeDisabled();

    await fill(1, '0:01', '0:03');
    await page.getByRole('button', { name: '+ ADD PART' }).click();
    await fill(2, '0:05', '0:08.5');
    await expect(page.getByText('Length 0:02')).toBeVisible();
    await expect(page.getByText('Length 0:03.5')).toBeVisible();
    await cutButton().click();

    await expect(page.getByText('Done: 2 file(s) saved.')).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId('cut-part').getByText('DONE')).toHaveCount(2);
    const folder = join(downloads, 'Talk - cuts');
    expect(readdirSync(folder).sort()).toEqual(['Talk - 01 (0m01s-0m03s).mp4', 'Talk - 02 (0m05s-0m08s).mp4']);
    const first = probe(join(folder, 'Talk - 01 (0m01s-0m03s).mp4'));
    const second = probe(join(folder, 'Talk - 02 (0m05s-0m08s).mp4'));
    expect(first.hasVideo && first.hasAudio).toBe(true);
    expect(second.hasVideo && second.hasAudio).toBe(true);
    // The cut is exact (the parts are encoded again), not on the keyframe before the start.
    expect(first.seconds).toBeGreaterThan(1.8);
    expect(first.seconds).toBeLessThan(2.3);
    expect(second.seconds).toBeGreaterThan(3.2);
    expect(second.seconds).toBeLessThan(3.8);
    // The original is not touched.
    expect(probe(video).seconds).toBeGreaterThan(11.5);
});

test('turns the parts of a video into audio files, in the audio format of the settings, when only the audio is wanted', async () => {
    await launch(video, 'mp3');
    await choose();
    await expect(page.getByText('Each part is saved as an audio file (mp3, the audio format of the settings) instead of a video.')).toBeVisible();
    await page.getByRole('switch', { name: 'Only the audio' }).check();
    await fill(1, '0:02', '0:05');
    await cutButton().click();

    await expect(page.getByText('Done: 1 file(s) saved.')).toBeVisible({ timeout: 60000 });
    const folder = join(downloads, 'Talk - cuts');
    expect(readdirSync(folder)).toEqual(['Talk - 01 (0m02s-0m05s).mp3']);
    const audio = probe(join(folder, 'Talk - 01 (0m02s-0m05s).mp3'));
    expect(audio.hasAudio).toBe(true);
    expect(audio.hasVideo).toBe(false);
    expect(audio.seconds).toBeGreaterThan(2.8);
    expect(audio.seconds).toBeLessThan(3.4);
});

test('cuts an audio file into audio files of the same format, without the choice of only the audio', async () => {
    await launch(song);
    await choose();
    await expect(page.getByText('AUDIO', { exact: true })).toBeVisible();
    await expect(page.getByText('Length: 0:20')).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Only the audio' })).toHaveCount(0);
    await fill(1, '0:03', '0:06');
    await page.getByRole('button', { name: '+ ADD PART' }).click();
    await fill(2, '0:10', '0:12');
    await cutButton().click();

    await expect(page.getByText('Done: 2 file(s) saved.')).toBeVisible({ timeout: 60000 });
    const folder = join(downloads, 'Song - cuts');
    expect(readdirSync(folder).sort()).toEqual(['Song - 01 (0m03s-0m06s).mp3', 'Song - 02 (0m10s-0m12s).mp3']);
    expect(probe(join(folder, 'Song - 01 (0m03s-0m06s).mp3')).seconds).toBeGreaterThan(2.8);
    expect(probe(join(folder, 'Song - 02 (0m10s-0m12s).mp3')).seconds).toBeLessThan(2.4);
});

test('does not write over the files of an earlier cut: the next free name is used', async () => {
    await launch(video);
    await choose();
    await fill(1, '0:01', '0:03');
    await cutButton().click();
    await expect(page.getByText('Done: 1 file(s) saved.')).toBeVisible({ timeout: 60000 });
    await cutButton().click();
    // The result of the first cut is still on the screen: the second one is over when its file is there.
    await expect.poll(() => { return readdirSync(join(downloads, 'Talk - cuts')).length; }, { timeout: 60000 }).toBe(2);
    await expect(cutButton()).toBeEnabled();
    expect(readdirSync(join(downloads, 'Talk - cuts')).sort()).toEqual(['Talk - 01 (0m01s-0m03s) (2).mp4', 'Talk - 01 (0m01s-0m03s).mp4']);
});

test('says what is wrong with a part before the cut, and does not make it', async () => {
    await launch(video);
    await choose();
    await fill(1, '0:08', '0:03');
    await expect(page.getByRole('alert')).toHaveText('The end has to be after the start.');
    await expect(cutButton()).toBeDisabled();
    await fill(1, '0:08', '0:30');
    await expect(page.getByRole('alert')).toHaveText('The end is after the end of the file (0:12).');
    await fill(1, 'abc', '0:03');
    await expect(page.getByRole('alert')).toHaveText('The start of the part is not a time (write it as m:ss or h:mm:ss).');
    expect(existsSync(join(downloads, 'Talk - cuts'))).toBe(false);
});

test('says a file that is not a video or an audio cannot be read', async () => {
    const notes = join(workDir, 'notes.txt');
    writeFileSync(notes, 'just text');
    await launch(notes);
    await page.getByRole('button', { name: 'CHOOSE FILE' }).click();
    await expect(page.getByRole('alert')).toHaveText('That file has no video or audio that can be read.');
    await expect(page.getByTestId('cut-segment')).toHaveCount(0);
});

test('shows that it is working, part by part, and ends the cut when it is cancelled, deleting the part that was being made', async () => {
    await launch(longVideo);
    await choose();
    await fill(1, '0:00', '0:30');
    for (const number of [2, 3, 4, 5]) {
        await page.getByRole('button', { name: '+ ADD PART' }).click();
        await fill(number, `${number * 10 - 10}`, `${number * 10 + 20}`);
    }
    await cutButton().click();

    // There is always a sign that it is working: the parts waiting have a bar of their own and the one being cut has its bar and its badge.
    await expect(page.getByText('CUTTING', { exact: true }).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('progressbar', { name: 'Part 5 is waiting' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'CANCEL' })).toBeVisible();
    await page.getByRole('button', { name: 'CANCEL' }).click();

    await expect(page.getByText(/^Cancelled: \d of 5 parts were made\.$/)).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('button', { name: 'CANCEL' })).toHaveCount(0);
    await expect(cutButton()).toBeEnabled();
    const folder = join(downloads, 'Long - cuts');
    const files = existsSync(folder) ? readdirSync(folder) : [];
    expect(files.length).toBeLessThan(5);
    files.forEach((name) => {
        expect(statSync(join(folder, name)).size).toBeGreaterThan(0);
    });
    const done = await page.getByTestId('cut-part').getByText('DONE', { exact: true }).count();
    expect(files).toHaveLength(done);
});

test('keeps the window alive while it cuts: the interface answers and the ring and the bars keep moving', async () => {
    await launch(longVideo);
    await choose();
    await fill(1, '0:00', '0:45');
    await cutButton().click();
    await expect(page.getByText('CUTTING', { exact: true })).toBeVisible({ timeout: 20000 });
    // The page answers a question while ffmpeg works on another process.
    const answered = await page.evaluate(() => {
        return new Promise<boolean>((resolve) => {
            const started = performance.now();
            requestAnimationFrame(() => {
                resolve(performance.now() - started < 1000);
            });
        });
    });
    expect(answered).toBe(true);
    // The bar of the part is the neon wave that flows, turned by the style sheet.
    const bar = page.getByRole('progressbar', { name: 'Cutting part 1' }).locator('.progress__bar');
    const animation = await bar.evaluate((element) => {
        return getComputedStyle(element).animationName;
    });
    expect(animation).toBe('bar-wave-flow');
    await expect(page.getByText(/^Done: 1 file\(s\) saved\.$/)).toBeVisible({ timeout: 120000 });
});

// A drag from the file manager, as the system makes it: Chromium is told the paths of the files that are dragged (a File made in the page
// would have no path).
async function dragFile(path: string, type: 'dragEnter' | 'dragOver' | 'drop' | 'dragCancel', x: number, y: number): Promise<void> {
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchDragEvent', { type, x, y, data: { items: [], files: [path], dragOperationsMask: 1 } });
    await session.detach();
}

async function panelCentre(): Promise<{ x: number; y: number }> {
    const box = (await page.getByRole('region', { name: 'Cut a file' }).boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + 40 };
}

test('takes a file dragged from the system and dropped on the panel: it lights up, reads the file and shows it, ready to be cut', async () => {
    await launch(video);
    const { x, y } = await panelCentre();
    await dragFile(song, 'dragEnter', x, y);
    await dragFile(song, 'dragOver', x, y);
    await expect(page.getByTestId('cut-drop')).toHaveText('DROP THE FILE HERE');
    await expect(page.getByRole('region', { name: 'Cut a file' })).toHaveClass(/cut--dragging/);
    await dragFile(song, 'drop', x, y);

    await expect(page.getByText('Song.mp3')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('AUDIO', { exact: true })).toBeVisible();
    await expect(page.getByText('Length: 0:20')).toBeVisible();
    await expect(page.getByTestId('cut-drop')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Cut a file' })).not.toHaveClass(/cut--dragging/);
    await fill(1, '0:02', '0:04');
    await cutButton().click();
    await expect(page.getByText('Done: 1 file(s) saved.')).toBeVisible({ timeout: 60000 });
    expect(readdirSync(join(downloads, 'Song - cuts'))).toEqual(['Song - 01 (0m02s-0m04s).mp3']);
});

test('takes the dropped file in place of the one that was chosen, and says when the dropped file is not a video or an audio', async () => {
    await launch(video);
    await choose();
    await expect(page.getByText('Talk.mp4')).toBeVisible();
    const notes = join(workDir, 'dropped-notes.txt');
    writeFileSync(notes, 'just text');
    const { x, y } = await panelCentre();
    await dragFile(notes, 'dragEnter', x, y);
    await dragFile(notes, 'drop', x, y);
    await expect(page.getByRole('alert')).toHaveText('That file has no video or audio that can be read.');
    // The file that was chosen stays while the dropped one is refused.
    await expect(page.getByText('Talk.mp4')).toBeVisible();
    await dragFile(song, 'dragEnter', x, y);
    await dragFile(song, 'drop', x, y);
    await expect(page.getByText('Song.mp3')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Talk.mp4')).toHaveCount(0);
    await expect(page.getByLabel('Start of part 1')).toHaveValue('');
});

test('turns the light off when the drag leaves without dropping, and does not take a file while a cut goes on', async () => {
    await launch(longVideo);
    const { x, y } = await panelCentre();
    await dragFile(song, 'dragEnter', x, y);
    await expect(page.getByTestId('cut-drop')).toBeVisible();
    // The drag goes on to the logo, outside the panel.
    const logo = (await page.locator('.logo').boundingBox())!;
    await dragFile(song, 'dragEnter', logo.x + 5, logo.y + 5);
    await dragFile(song, 'dragOver', logo.x + 5, logo.y + 5);
    await expect(page.getByTestId('cut-drop')).toHaveCount(0);
    await dragFile(song, 'dragCancel', logo.x + 5, logo.y + 5);
    // And it comes back.
    await dragFile(song, 'dragEnter', x, y);
    await expect(page.getByTestId('cut-drop')).toBeVisible();
    await dragFile(song, 'dragEnter', logo.x + 5, logo.y + 5);
    await expect(page.getByTestId('cut-drop')).toHaveCount(0);

    await choose();
    await fill(1, '0:00', '0:45');
    await cutButton().click();
    await expect(page.getByText('CUTTING', { exact: true })).toBeVisible({ timeout: 20000 });
    await dragFile(song, 'dragEnter', x, y);
    await expect(page.getByTestId('cut-drop')).toHaveText('WAIT FOR THE CUT TO END');
    await dragFile(song, 'drop', x, y);
    await expect(page.getByText('Song.mp3')).toHaveCount(0);
    await expect(page.getByText('Long.mp4')).toBeVisible();
    await expect(page.getByText(/^Done: 1 file\(s\) saved\.$/)).toBeVisible({ timeout: 120000 });
});
