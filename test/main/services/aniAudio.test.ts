import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ORIGINAL_MASTER_FETCH, ORIGINAL_YTDLP, patchSeparateAudio } from '@main/services/aniAudio';
import { parseDestinationLine } from '@main/services/aniOutputParser';
import { patchAniCli, patchReport, REQUIRED_PATCHES } from '@main/services/aniPatches';
import { aniCliScript, aniCliScriptWithout, SEPARATE_AUDIO_PART } from '../../helpers/aniCliScripts';

// The line of ani-cli that reads the master playlist and makes the list of qualities from it, as upstream has it.
const MASTER_LINE = `    ${ORIGINAL_MASTER_FETCH}sed 's|^#EXT-X-STREAM.*x||g; s|,.*|p|g; /^#/d; $!N; s|\\n| >|;/EXT-X-I-FRAME/d' | sed "\\|>https*://|!s|>|>\${_m3u8_master%/*}/|" | sort -g -r -s)"`;
const DOWNLOAD_LINE = `    ${ORIGINAL_YTDLP}`;
const FRAGMENT = `${MASTER_LINE}\n${DOWNLOAD_LINE}`;
const DOWNLOAD_START = '\n    command -v "yt-dlp"';
const VARIANT = 'https://h.example/p/abc/720/index.m3u8';
const MASTER = 'https://h.example/p/abc/master.m3u8';

const MASTER_WITH_AUDIO = [
    '#EXTM3U',
    '#EXT-X-VERSION:4',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Japanese",LANGUAGE="ja",DEFAULT=YES,AUTOSELECT=YES,URI="aud/a0/index.m3u8"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",DEFAULT=NO,AUTOSELECT=YES,URI="aud/a1/index.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360,AUDIO="aud"',
    '360/index.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=5300000,RESOLUTION=1920x1080,AUDIO="aud"',
    '1080/index.m3u8'
].join('\n');
// A master whose pictures carry their sound: no track of audio is listed.
const MASTER_WITHOUT_AUDIO = ['#EXTM3U', '#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360,FRAME-RATE=24', '360/index.m3u8', '#EXT-X-STREAM-INF:BANDWIDTH=5300000,RESOLUTION=1920x1080,FRAME-RATE=24', '1080/index.m3u8'].join('\n');

function patchedParts(): { master: string; download: string } {
    const patched = patchSeparateAudio(FRAGMENT) as string;
    const split = patched.indexOf(DOWNLOAD_START);
    return { master: patched.slice(0, split), download: patched.slice(split + 1) };
}

describe('patchSeparateAudio', () => {
    it('keeps the master and joins the audio track to the picture when both places of the script fit', () => {
        const patched = patchSeparateAudio(FRAGMENT) as string;

        expect(patched).toContain(`_pullwave_master="$(hianime_curl "$_m3u8_master" -e "$refr")"`);
        expect(patched).toContain(`printf "%s" "$_pullwave_master" | grep -q 'TYPE=AUDIO' && pullwave_audio_master="$_m3u8_master"`);
        expect(patched).toContain('links="$(printf "%s\\n" "$_pullwave_master" | sed ');
        expect(patched).not.toContain(ORIGINAL_MASTER_FETCH);
        expect(patched).not.toContain(ORIGINAL_YTDLP);
        expect(patched).toContain('ba[language=${_pullwave_lang}]/ba');
        expect(patched).toContain('-map 0:v:0 -map 1:a:0');
    });

    it('keeps the download of the picture exactly as it was, and only adds what comes after it worked', () => {
        const patched = patchSeparateAudio(FRAGMENT) as string;
        const start = ORIGINAL_YTDLP.slice(0, ORIGINAL_YTDLP.length - ' && return 0'.length);

        expect(patched).toContain(`${start} && {`);
        expect(patched).toContain('        return 0\n    }');
        expect(patched.split('return 0')).toHaveLength(2);
    });

    it('does not fit a script without the line that reads the master, or without the command that downloads', () => {
        expect(patchSeparateAudio(MASTER_LINE)).toBeNull();
        expect(patchSeparateAudio(DOWNLOAD_LINE)).toBeNull();
        expect(patchSeparateAudio('a different script')).toBeNull();
        expect(patchSeparateAudio('')).toBeNull();
    });

    it('does not fit a script whose line changed', () => {
        expect(patchSeparateAudio(FRAGMENT.replace('-N 16', '-N 8'))).toBeNull();
        expect(patchSeparateAudio(FRAGMENT.replace('-e "$refr"', '-e "$referer"'))).toBeNull();
    });

    it('is applied once: a script that has it does not fit it again', () => {
        const once = patchSeparateAudio(FRAGMENT) as string;

        expect(patchSeparateAudio(once)).toBeNull();
    });

    it('is reported on its own, and is not one the app cannot do without', () => {
        expect(patchReport(FRAGMENT)).toEqual({ subtitleSelection: false, allSubtitles: false, debugReferer: false, menuIds: false, singleResult: false, searchPages: false, separateAudio: true });
        expect(patchReport(MASTER_LINE).separateAudio).toBe(false);
        expect(patchReport(DOWNLOAD_LINE).separateAudio).toBe(false);
        expect(REQUIRED_PATCHES).not.toContain('separateAudio');
    });

    it('is applied with the others, each on its own', () => {
        const patched = patchAniCli(aniCliScript('5.1.4')) as string;

        expect(patched).toContain('pullwave_audio_master=""');
        expect(patched).toContain('pullwave_pick_subtitle "$_json"');
        expect(patched).toContain('Referer:\\n%s\\n');
        expect(patchReport(aniCliScript('5.1.4')).separateAudio).toBe(true);
        expect(patchReport(aniCliScriptWithout('5.1.4', SEPARATE_AUDIO_PART)).separateAudio).toBe(false);
        expect(patchAniCli(aniCliScriptWithout('5.1.4', SEPARATE_AUDIO_PART))).not.toContain('pullwave_audio_master');
    });

    it('saves the subtitles before the picture is downloaded and the audio joined', () => {
        const patched = patchAniCli(aniCliScript('5.1.4')) as string;

        const subtitles = patched.indexOf('pullwave_save_subtitles "$download_dir/$_name"');
        const picture = patched.indexOf('yt-dlp --referer "$refr" "$1"');
        const audio = patched.indexOf('yt-dlp --referer "$refr" "$pullwave_audio_master"');
        expect(subtitles).toBeGreaterThan(-1);
        expect(subtitles).toBeLessThan(picture);
        expect(picture).toBeLessThan(audio);
    });

    it('fits the script of ani-cli that comes with the tests, when it is there', () => {
        const script = join(process.cwd(), 'resources', 'bin', 'ani', 'ani-cli');
        if (existsSync(script)) {
            expect(patchReport(readFileSync(script, 'utf-8')).separateAudio).toBe(true);
        }
    });
});

describe.skipIf(process.platform === 'win32')('the master of the source in the shell', () => {
    function run(body: string): string {
        const script = [
            `hianime_curl() { printf '%s\\n' "$MASTER_BODY"; }`,
            `_m3u8_master="${MASTER}"`,
            'refr="https://r.example/"',
            'fetch() {',
            patchedParts().master,
            '}',
            'fetch',
            'printf "AUDIO_MASTER=%s\\n" "$pullwave_audio_master"',
            'printf "%s\\n" "$links"'
        ].join('\n');
        return execFileSync('sh', ['-c', script], { env: { PATH: process.env.PATH ?? '', MASTER_BODY: body } }).toString();
    }

    it('keeps the address of the master when it lists audio tracks, and makes the list of qualities as before, the best first', () => {
        expect(run(MASTER_WITH_AUDIO)).toBe(`AUDIO_MASTER=${MASTER}\n1080p >https://h.example/p/abc/1080/index.m3u8\n360p >https://h.example/p/abc/360/index.m3u8\n`);
    });

    it('keeps nothing when the pictures carry their sound, and the list of qualities is the same', () => {
        expect(run(MASTER_WITHOUT_AUDIO)).toBe('AUDIO_MASTER=\n1080p >https://h.example/p/abc/1080/index.m3u8\n360p >https://h.example/p/abc/360/index.m3u8\n');
    });
});

describe.skipIf(process.platform === 'win32')('the download in the shell', () => {
    let directory: string;
    let tools: string;

    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), 'pullwave-audio-'));
        tools = mkdtempSync(join(tmpdir(), 'pullwave-audio-tools-'));
        // yt-dlp and ffmpeg are stand-ins that log what they were asked and write the file they were asked for: "VIDEO" for the address of a variant,
        // "AUDIO" for the master, "JOINED" for what ffmpeg makes. FAIL_YTDLP makes the call that has that text in it fail.
        writeFileSync(
            join(tools, 'yt-dlp'),
            [
                '#!/bin/sh',
                'printf "yt-dlp %s\\n" "$*" >> "$CALLS_LOG"',
                'out=""; prev=""',
                'for a in "$@"; do [ "$prev" = "-o" ] && out="$a"; prev="$a"; done',
                'printf "[download] Destination: %s\\n" "$out"',
                'if [ -n "$FAIL_YTDLP" ]; then case "$*" in *"$FAIL_YTDLP"*) exit 1 ;; esac; fi',
                'case "$*" in *master*) printf AUDIO > "$out" ;; *) printf VIDEO > "$out" ;; esac'
            ].join('\n')
        );
        writeFileSync(join(tools, 'ffmpeg'), ['#!/bin/sh', 'printf "ffmpeg %s\\n" "$*" >> "$CALLS_LOG"', '[ -n "$FAIL_FFMPEG" ] && exit 1', 'for a in "$@"; do last="$a"; done', 'printf JOINED > "$last"'].join('\n'));
        chmodSync(join(tools, 'yt-dlp'), 0o755);
        chmodSync(join(tools, 'ffmpeg'), 0o755);
    });

    afterEach(() => {
        rmSync(directory, { recursive: true, force: true });
        rmSync(tools, { recursive: true, force: true });
    });

    interface Outcome {
        // The file the app takes as the one of the episode: the last "Destination" line of the output, read the way the app reads it.
        destination: string | null;
        log: string[];
        files: string[];
        video: string;
        status: string;
    }

    // Runs the download of ani-cli as the patch leaves it (the function around it is the only thing added).
    function download(options: { audioMaster: boolean; mode: 'sub' | 'dub'; failYtDlp?: string; failFfmpeg?: boolean }): Outcome {
        const logFile = join(tools, 'calls.log');
        const script = [
            'refr="https://r.example/"',
            `mode="${options.mode}"`,
            `download_dir="${directory}"`,
            '_name="Ep 1"',
            options.audioMaster ? `pullwave_audio_master="${MASTER}"` : 'pullwave_audio_master=""',
            'download_fn() {',
            patchedParts().download,
            '}',
            `download_fn "${VARIANT}" "Ep 1" ""`,
            'printf "%s" "$?" > "$STATUS_FILE"'
        ].join('\n');
        const output = execFileSync('sh', ['-c', script], {
            env: { PATH: `${tools}:${process.env.PATH ?? ''}`, CALLS_LOG: logFile, FAIL_YTDLP: options.failYtDlp ?? '', FAIL_FFMPEG: options.failFfmpeg ? '1' : '', STATUS_FILE: join(tools, 'status') }
        });
        const log = existsSync(logFile)
            ? readFileSync(logFile, 'utf-8')
                  .split('\n')
                  .filter((line) => {
                      return line.length > 0;
                  })
            : [];
        const videoPath = join(directory, 'Ep 1.mp4');
        const destinations = output
            .toString()
            .split('\n')
            .map((line) => {
                return parseDestinationLine(line);
            })
            .filter((path): path is string => {
                return path !== null;
            });
        return { destination: destinations.at(-1) ?? null, log, files: readdirSync(directory).sort(), video: existsSync(videoPath) ? readFileSync(videoPath, 'utf-8') : '', status: readFileSync(join(tools, 'status'), 'utf-8') };
    }

    const PICTURE_CALL = `yt-dlp --referer https://r.example/ ${VARIANT} --no-skip-unavailable-fragments --fragment-retries infinite -N 16 -o `;

    it('downloads the picture as it always did, then the audio track of the master, and joins them into the file of the episode', () => {
        const outcome = download({ audioMaster: true, mode: 'sub' });

        expect(outcome.log).toEqual([
            `${PICTURE_CALL}${directory}/Ep 1.mp4`,
            `yt-dlp --referer https://r.example/ ${MASTER} -f ba[language=ja]/ba --fragment-retries infinite -N 16 -o ${directory}/Ep 1.audio.mp4`,
            `ffmpeg -y -loglevel error -i ${directory}/Ep 1.mp4 -i ${directory}/Ep 1.audio.mp4 -c copy -map 0:v:0 -map 1:a:0 -movflags +faststart -f mp4 ${directory}/Ep 1.joined.mp4`
        ]);
        expect(outcome.files).toEqual(['Ep 1.mp4']);
        expect(outcome.video).toBe('JOINED');
        expect(outcome.status).toBe('0');
    });

    it('tells the app the file of the episode, and not the audio track that is deleted, as the file that was downloaded', () => {
        const outcome = download({ audioMaster: true, mode: 'sub' });

        // The last "Destination" line is the one the app reads: the audio track went through one before it, and is not there any more.
        expect(outcome.destination).toBe(`${directory}/Ep 1.mp4`);
        expect(existsSync(outcome.destination as string)).toBe(true);
        expect(outcome.destination).not.toContain('.audio.');
    });

    it.each([
        ['the audio could not be downloaded', { failYtDlp: 'master' }],
        ['ffmpeg could not join them', { failFfmpeg: true }]
    ])('tells the app the file of the episode, which is there, when %s', (_name, failure) => {
        const outcome = download({ audioMaster: true, mode: 'sub', ...failure });

        expect(outcome.destination).toBe(`${directory}/Ep 1.mp4`);
        expect(existsSync(outcome.destination as string)).toBe(true);
    });

    it('asks for the English track of a dubbed episode, and for the first one when there is none of the language', () => {
        const outcome = download({ audioMaster: true, mode: 'dub' });

        expect(outcome.log[1]).toBe(`yt-dlp --referer https://r.example/ ${MASTER} -f ba[language=en]/ba --fragment-retries infinite -N 16 -o ${directory}/Ep 1.audio.mp4`);
        expect(outcome.video).toBe('JOINED');
    });

    it('downloads only the picture, as it always did, when the master lists no audio track', () => {
        const outcome = download({ audioMaster: false, mode: 'sub' });

        expect(outcome.log).toEqual([`${PICTURE_CALL}${directory}/Ep 1.mp4`]);
        expect(outcome.files).toEqual(['Ep 1.mp4']);
        expect(outcome.video).toBe('VIDEO');
        expect(outcome.status).toBe('0');
        // Nothing is added to what yt-dlp printed: the picture is the file of the episode.
        expect(outcome.destination).toBe(`${directory}/Ep 1.mp4`);
    });

    it('keeps the episode with the picture only, and no file left over, when the audio could not be downloaded', () => {
        const outcome = download({ audioMaster: true, mode: 'sub', failYtDlp: 'master' });

        expect(outcome.log).toHaveLength(2);
        expect(
            outcome.log.some((call) => {
                return call.startsWith('ffmpeg');
            })
        ).toBe(false);
        expect(outcome.files).toEqual(['Ep 1.mp4']);
        expect(outcome.video).toBe('VIDEO');
        expect(outcome.status).toBe('0');
    });

    it('keeps the episode with the picture only, and no file left over, when ffmpeg could not join them', () => {
        const outcome = download({ audioMaster: true, mode: 'sub', failFfmpeg: true });

        expect(outcome.log).toHaveLength(3);
        expect(outcome.files).toEqual(['Ep 1.mp4']);
        expect(outcome.video).toBe('VIDEO');
        expect(outcome.status).toBe('0');
    });

    it('does not look for the audio when the picture could not be downloaded, and does not say it worked', () => {
        const outcome = download({ audioMaster: true, mode: 'sub', failYtDlp: 'index.m3u8' });

        expect(outcome.log).toEqual([`${PICTURE_CALL}${directory}/Ep 1.mp4`]);
        expect(outcome.files).toEqual([]);
        expect(outcome.status).toBe('1');
    });
});
