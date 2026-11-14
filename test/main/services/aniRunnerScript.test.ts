import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isJoinLine, parsePartLine } from '@main/services/aniOutputParser';
import { cleanTempDirs, makeTempDir } from '../../helpers/tempDir';

// The script that runs ani-cli with its stand-ins (resources/ani-scripts/pullwave-run.sh), run for real by the shell of the system and by the
// busybox the app installs (when the tests have it), with a fake ani-cli that calls what the test asks and fake ffmpeg and ffprobe that tell
// how they were called.

const ROOT = process.cwd();
const RUNNER = join(ROOT, 'resources', 'ani-scripts', 'pullwave-run.sh');
const BUSYBOX = join(ROOT, 'resources', 'bin', 'ani', 'busybox');

interface Run {
    status: number | null;
    stdout: string;
    stderr: string;
    // Every call of the fake yt-dlp and ffmpeg, one line per argument, the calls apart by a blank line.
    ytdlpCalls: string[][];
    ffmpegCalls: string[][];
    files: string[];
}

// A fake program that writes how it was called, makes the file it was asked to make (the argument after -o for yt-dlp, the last one for
// ffmpeg) and fails when an argument has the word given in it.
function fakeProgram(directory: string, name: string, makes: 'after-o' | 'last', failWord: string): void {
    const file = join(directory, name);
    const target = makes === 'after-o' ? 'prev=""; for a; do [ "$prev" = "-o" ] && out="$a"; prev="$a"; done' : makes === 'last' ? 'for a; do out="$a"; done' : 'out=""';
    writeFileSync(
        file,
        [
            '#!/bin/sh',
            `{ printf '%s\\n' "$@"; printf '\\n'; } >> "${join(directory, `${name}.calls`)}"`,
            target,
            `case "$*" in *${failWord}*) exit 1 ;; esac`,
            '[ -n "$out" ] && printf made > "$out"',
            `printf '${name} ran\\n' >&2`,
            'exit 0'
        ].join('\n')
    );
    chmodSync(file, 0o755);
}

function readCalls(directory: string, name: string): string[][] {
    const file = join(directory, `${name}.calls`);
    if (!existsSync(file)) {
        return [];
    }
    return readFileSync(file, 'utf-8')
        .split('\n\n')
        .filter((call) => {
            return call.length > 0;
        })
        .map((call) => {
            return call.split('\n').filter((line) => {
                return line.length > 0;
            });
        });
}

function runScript(shell: string[], body: string): Run {
    const directory = makeTempDir();
    const out = makeTempDir();
    fakeProgram(directory, 'yt-dlp', 'after-o', 'fail');
    fakeProgram(directory, 'ffmpeg', 'last', 'nojoin');
    const script = join(directory, 'ani-cli');
    writeFileSync(script, `#!/bin/sh\nOUT="${out}"\n${body}\n`);
    const [command, ...args] = shell;
    const result = spawnSync(command as string, [...args, RUNNER, script], { env: { PATH: `${directory}:/usr/bin:/bin` }, encoding: 'utf-8' });
    return {
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        ytdlpCalls: readCalls(directory, 'yt-dlp'),
        ffmpegCalls: readCalls(directory, 'ffmpeg'),
        files: readdirSync(out).sort()
    };
}

const PICTURE = 'https://cdn.example/1080/index.m3u8';
const AUDIO = 'https://cdn.example/aud/a0/index.m3u8';
const download = (picture: string, audio: string): string => {
    return `ffmpeg -extension_picky 0 -referer "https://site.example/" -loglevel error -stats -i "${picture}" -extension_picky 0 -referer "https://site.example/" -i "${audio}" -c copy "$OUT/Reborn Episode 5.mp4"`;
};
const FETCH = (address: string, file: string): string[] => {
    return ['--referer', 'https://site.example/', address, '--no-skip-unavailable-fragments', '--fragment-retries', 'infinite', '--retries', '20', '--retry-sleep', 'http:exp=1:10', '--retry-sleep', 'fragment:exp=1:10', '-N', '16', '-o', file];
};

const SHELLS: Array<[string, string[]]> = [['the shell of the system', ['sh']]];
if (existsSync(BUSYBOX)) {
    SHELLS.push(['the busybox of the app', [BUSYBOX, 'sh']]);
}

afterEach(() => {
    cleanTempDirs();
});

describe.skipIf(process.platform === 'win32').each(SHELLS)('pullwave-run.sh, run by %s', (_name, shell) => {
    describe('the menu', () => {
        it('reports every choice with its prompt on stderr, and fails so ani-cli stops after listing', () => {
            const run = runScript(shell, 'printf "1 Naruto\\n2 Bleach\\n" | pullwave_menu -i "Select anime: " || printf "menu failed\\n"');
            expect(run.stderr).toBe('PULLWAVE_MENU\tSelect anime: \t1 Naruto\nPULLWAVE_MENU\tSelect anime: \t2 Bleach\n');
            expect(run.stdout).toBe('menu failed\n');
        });
    });

    describe('the player and tput', () => {
        it('do nothing and succeed', () => {
            const run = runScript(shell, 'pullwave_noplayer x && tput cuu1 && printf "ok\\n"');
            expect(run.stdout).toBe('ok\n');
            expect(run.stderr).toBe('');
        });
    });

    describe('ffmpeg', () => {
        it('downloads the picture and the audio with yt-dlp, joins them with ffmpeg, and then tells the file of the episode', () => {
            const run = runScript(shell, `${download(PICTURE, AUDIO)}\nprintf 'exit %s\\n' "$?"`);
            const file = run.ytdlpCalls[0]?.at(-1)?.replace(/\.video\.mp4$/, '') as string;
            expect(file.endsWith('/Reborn Episode 5.mp4')).toBe(true);
            expect(run.ytdlpCalls).toEqual([FETCH(PICTURE, `${file}.video.mp4`), FETCH(AUDIO, `${file}.audio.mp4`)]);
            expect(run.ffmpegCalls).toEqual([
                ['-nostdin', '-y', '-loglevel', 'error', '-i', `${file}.video.mp4`, '-i', `${file}.audio.mp4`, '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', `${file}.joined.mp4`]
            ]);
            expect(run.stdout).toBe(`PULLWAVE_PART\t0\tvideo,audio\nPULLWAVE_PART\t1\tvideo,audio\nPULLWAVE_JOIN\n[download] Destination: ${file}\nexit 0\n`);
            expect(run.stderr).toBe('yt-dlp ran\nyt-dlp ran\nffmpeg ran\n');
            expect(run.files).toEqual(['Reborn Episode 5.mp4']);
        });

        it('tells the app which part starts before each one, on stdout with the progress, in lines its own parser reads', () => {
            const run = runScript(shell, download(PICTURE, AUDIO));
            const parts = run.stdout
                .split('\n')
                .map((line) => {
                    return parsePartLine(line);
                })
                .filter((part) => {
                    return part !== null;
                });
            expect(parts).toEqual([
                { kinds: ['video', 'audio'], index: 0 },
                { kinds: ['video', 'audio'], index: 1 }
            ]);
        });

        it('tells the app once, after both parts and before ffmpeg joins them, in a line its own parser reads', () => {
            const run = runScript(shell, download(PICTURE, AUDIO));
            const lines = run.stdout.split('\n');
            expect(lines.filter((line) => {
                return isJoinLine(line);
            })).toEqual(['PULLWAVE_JOIN']);
            expect(lines.indexOf('PULLWAVE_JOIN')).toBe(lines.indexOf('PULLWAVE_PART\t1\tvideo,audio') + 1);
            expect(lines.indexOf('PULLWAVE_JOIN')).toBeLessThan(lines.findIndex((line) => {
                return line.startsWith('[download] Destination: ');
            }));
        });

        it('does not tell of a joining when a part could not be downloaded, since nothing is joined', () => {
            const run = runScript(shell, download(PICTURE, 'https://cdn.example/fail.m3u8'));
            expect(run.stdout.split('\n').some((line) => {
                return isJoinLine(line);
            })).toBe(false);
            expect(run.ffmpegCalls).toEqual([]);
        });

        it('downloads the picture alone into the file when there is no audio track', () => {
            const run = runScript(shell, 'ffmpeg -referer "https://site.example/" -loglevel error -stats -i "https://cdn.example/v.m3u8" -c copy "$OUT/Episode 1.mp4"');
            const file = run.ytdlpCalls[0]?.at(-1) as string;
            expect(file.endsWith('/Episode 1.mp4')).toBe(true);
            expect(run.ytdlpCalls).toEqual([FETCH('https://cdn.example/v.m3u8', file)]);
            expect(run.ffmpegCalls).toEqual([]);
            expect(run.stdout).toBe(`[download] Destination: ${file}\n`);
            expect(run.stderr).toBe('yt-dlp ran\n');
            expect(run.files).toEqual(['Episode 1.mp4']);
        });

        it('says the download failed when the audio cannot be had, keeps the picture for the next try and makes no file of the episode', () => {
            const run = runScript(shell, `${download(PICTURE, 'https://cdn.example/fail.m3u8')}\nprintf 'exit %s\\n' "$?"`);
            expect(run.ytdlpCalls).toHaveLength(2);
            expect(run.ffmpegCalls).toEqual([]);
            expect(run.stdout).toBe('PULLWAVE_PART\t0\tvideo,audio\nPULLWAVE_PART\t1\tvideo,audio\nexit 1\n');
            expect(run.stderr).toBe('yt-dlp ran\nPULLWAVE_DOWNLOAD_FAILED\n');
            expect(run.files).toEqual(['Reborn Episode 5.mp4.video.mp4']);
        });

        it('says the download failed when the picture cannot be had, and asks nothing else', () => {
            const run = runScript(shell, `${download('https://cdn.example/fail.m3u8', AUDIO)}\nprintf 'exit %s\\n' "$?"`);
            expect(run.ytdlpCalls).toHaveLength(1);
            expect(run.ffmpegCalls).toEqual([]);
            expect(run.stdout).toBe('PULLWAVE_PART\t0\tvideo,audio\nexit 1\n');
            expect(run.stderr).toBe('PULLWAVE_DOWNLOAD_FAILED\n');
            expect(run.files).toEqual([]);
        });

        it('says the download failed when the two cannot be joined, and leaves no half-joined file', () => {
            const run = runScript(shell, `${download(PICTURE, AUDIO).replace('Reborn Episode 5.mp4', 'nojoin Episode 5.mp4')}\nprintf 'exit %s\\n' "$?"`);
            expect(run.ytdlpCalls).toHaveLength(2);
            expect(run.ffmpegCalls).toHaveLength(1);
            expect(run.stdout).toBe('PULLWAVE_PART\t0\tvideo,audio\nPULLWAVE_PART\t1\tvideo,audio\nPULLWAVE_JOIN\nexit 1\n');
            expect(run.stderr).toBe('yt-dlp ran\nyt-dlp ran\nPULLWAVE_DOWNLOAD_FAILED\n');
            expect(run.files).toEqual(['nojoin Episode 5.mp4.audio.mp4', 'nojoin Episode 5.mp4.video.mp4']);
        });

        it('leaves every other call of ffmpeg as it is', () => {
            const run = runScript(shell, 'ffmpeg -i "in.mkv" -map 0:v -c copy "$OUT/out.mp4"');
            expect(run.ffmpegCalls).toEqual([['-i', 'in.mkv', '-map', '0:v', '-c', 'copy', `${run.ffmpegCalls[0]?.at(-1) ?? ''}`]]);
            expect(run.ffmpegCalls[0]?.at(-1)?.endsWith('/out.mp4')).toBe(true);
            expect(run.ytdlpCalls).toEqual([]);
            expect(run.stdout).toBe('');
            expect(run.stderr).toBe('ffmpeg ran\n');
        });

        it('is found by command -v, as ani-cli looks for it', () => {
            expect(runScript(shell, 'command -v ffmpeg').stdout).toBe('ffmpeg\n');
        });
    });
});
