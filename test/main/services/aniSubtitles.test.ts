import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ANIME_SUBTITLE_LANGUAGES, ANIME_SUBTITLE_SETTINGS } from '@shared/anime';
import { executableName } from '@main/services/binaryResolver';
import { ALL_SUBTITLES_NEEDS, patchAllSubtitles, patchSubtitleSelection, SAVE_SUBTITLES_FUNCTION, SUBTITLE_LABELS_VARIABLE, SUBTITLE_PICK_FUNCTION, SUBTITLE_SELECTION_NEEDS, subtitleLabels } from '@main/services/aniSubtitles';
import { cleanTempDirs, makeTempDir } from '../../helpers/tempDir';

const ROOT = join(__dirname, '../../..');
const BUSYBOX = join(ROOT, 'resources', 'bin', 'ani', executableName('busybox'));
const REAL_SCRIPT = join(ROOT, 'resources', 'bin', 'ani', 'ani-cli');
const HAS_TOOLS = existsSync(BUSYBOX) && existsSync(REAL_SCRIPT);

afterEach(() => {
    cleanTempDirs();
});

describe('constants', () => {
    it('lists the subtitle settings', () => {
        expect(ANIME_SUBTITLE_LANGUAGES).toEqual(['English', 'Portuguese', 'Spanish', 'French', 'German', 'Italian', 'Russian']);
        expect(ANIME_SUBTITLE_SETTINGS).toEqual(['auto', 'default', 'English', 'Portuguese', 'Spanish', 'French', 'German', 'Italian', 'Russian']);
        expect(SUBTITLE_LABELS_VARIABLE).toBe('PULLWAVE_SUB_LABELS');
    });
});

describe('subtitleLabels', () => {
    it('leaves ani-cli alone for "default"', () => {
        expect(subtitleLabels('default', 'pt')).toEqual([]);
    });

    it.each([
        ['en', ['English']],
        ['pt', ['Portuguese', 'English']],
        ['es', ['Spanish', 'English']],
        ['zh', ['English']],
        ['ja', ['English']]
    ] as const)('follows the language of the app (%s) for "auto"', (language, labels) => {
        expect(subtitleLabels('auto', language)).toEqual(labels);
    });

    it.each(ANIME_SUBTITLE_LANGUAGES)('takes just %s when it is chosen', (language) => {
        expect(subtitleLabels(language, 'pt')).toEqual([language]);
    });
});

describe('patchSubtitleSelection', () => {
    const original = [
        'something before',
        '',
        'hianime_m3u8() {',
        '    _x=1',
        `    sub_link="$(printf "%s" "$_json" | sed 's|.*"subtitles":\\[||; s|}\\].*||; s|},{|}\\n{|g' | grep -m 1 '"default":true' | sed -nE 's|.*"src":"([^"]*)".*|\\1|p')"`,
        '    links=2',
        '}'
    ].join('\n');

    it('swaps the selection for the function and defines it before the function that uses it', () => {
        const patched = patchSubtitleSelection(original) as string;
        expect(patched).toContain('    sub_link="$(pullwave_pick_subtitle "$_json")"');
        expect(patched).not.toContain("grep -m 1 '\"default\":true' | sed -nE");
        expect(patched.indexOf('pullwave_pick_subtitle() {')).toBeLessThan(patched.indexOf('hianime_m3u8() {'));
        expect(patched).toContain(SUBTITLE_PICK_FUNCTION);
        expect(patched.startsWith('something before\n')).toBe(true);
        expect(patched.endsWith('    links=2\n}')).toBe(true);
    });

    it('gives null when the selection is not the one it knows', () => {
        expect(patchSubtitleSelection(original.replace('"default":true', '"default":false'))).toBeNull();
        expect(patchSubtitleSelection('nothing here')).toBeNull();
    });

    it('gives null when the function it goes before is missing', () => {
        expect(patchSubtitleSelection(original.replace('hianime_m3u8() {', 'other_name() {'))).toBeNull();
    });

    describe.skipIf(!HAS_TOOLS)('with the ani-cli that ships with the app', () => {
        it('patches it and the result is still valid shell', () => {
            const patched = patchSubtitleSelection(readFileSync(REAL_SCRIPT, 'utf-8')) as string;
            expect(patched).not.toBeNull();
            const file = join(makeTempDir(), 'ani-cli');
            writeFileSync(file, patched);
            execFileSync(BUSYBOX, ['sh', '-n', file]);
        });
    });

    describe.skipIf(!HAS_TOOLS)('the function, run by the shell that ships with the app', () => {
        const json = JSON.stringify({
            src: 'https://x/master.m3u8',
            subtitles: [
                { lang: 'en', label: 'English', default: true, src: 'https://s/en.vtt' },
                { lang: 'en', label: 'French', default: false, src: 'https://s/fr.vtt' },
                { lang: 'en', label: 'Portuguese (- Portuguese(Brazil))', default: false, src: 'https://s/pt.vtt' },
                { lang: 'en', label: 'Spanish', default: false, src: 'https://s/es.vtt' }
            ],
            poster: ''
        });
        const noDefault = json.replace('"default":true', '"default":false');

        // The utilities are found through links to busybox, as Pullwave makes them for ani-cli.
        // BusyBox for Windows runs its applets itself, so there is nothing to link there.
        function toolsDirectory(): string {
            const directory = join(makeTempDir(), 'tools');
            mkdirSync(directory);
            if (process.platform !== 'win32') {
                ['sed', 'grep'].forEach((name) => {
                    symlinkSync(BUSYBOX, join(directory, name));
                });
            }
            return directory;
        }

        function pick(source: string, labels: string): string {
            const directory = makeTempDir();
            const file = join(directory, 'pick.sh');
            writeFileSync(file, `${SUBTITLE_PICK_FUNCTION}\npullwave_pick_subtitle "$JSON"\n`);
            return execFileSync(BUSYBOX, ['sh', file], { env: { JSON: source, [SUBTITLE_LABELS_VARIABLE]: labels, PATH: toolsDirectory(), ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) }, encoding: 'utf-8' });
        }

        it('takes the first language that exists, in the order given', () => {
            expect(pick(json, 'Portuguese|English')).toBe('https://s/pt.vtt');
            expect(pick(json, 'Russian|Spanish|English')).toBe('https://s/es.vtt');
        });

        it('ignores the case of the language', () => {
            expect(pick(json, 'portuguese')).toBe('https://s/pt.vtt');
        });

        it('falls back to the subtitles the source marks as default', () => {
            expect(pick(json, 'Russian')).toBe('https://s/en.vtt');
            expect(pick(json, '')).toBe('https://s/en.vtt');
        });

        it('gives nothing when no language matches and none is marked as default', () => {
            expect(pick(noDefault, 'Russian')).toBe('');
            expect(pick(noDefault, '')).toBe('');
        });

        it('finds the language even when none is marked as default', () => {
            expect(pick(noDefault, 'Portuguese|English')).toBe('https://s/pt.vtt');
        });

        it('gives nothing for a source without subtitles', () => {
            expect(pick(JSON.stringify({ src: 'https://x/master.m3u8', poster: '' }), 'English')).toBe('');
        });
    });
});

describe('patchAllSubtitles', () => {
    const original = [
        'something before',
        '',
        'hianime_m3u8() {',
        '    _json="x"',
        '    sub_link="whatever"',
        '    # quality variants are relative to the master playlist',
        '    links=2',
        '}',
        '',
        'download() {',
        '    _name="n"',
        '    [ -n "$sub_link" ] && $curl_exe -sL -A "$agent" -e "$refr" --max-time 10 $cipher_flag "$sub_link" -o "$download_dir/$_name.vtt"',
        '    [ -z "$audio_link" ] && command -v "yt-dlp" >/dev/null && yt-dlp --referer "$refr" "$1" -o "$_name.mp4" $3 && return 0',
        '}'
    ].join('\n');

    it('keeps the list of subtitles, saves them all right after the one ani-cli picked and defines the function before its use', () => {
        const patched = patchAllSubtitles(original) as string;
        expect(patched).toContain(`    pullwave_all_subs="$(printf "%s" "$_json" | sed 's|.*"subtitles":\\[||; s|}\\].*||; s|},{|}\\n{|g')"\n    # quality variants`);
        expect(patched).toContain('-o "$download_dir/$_name.vtt"\n    pullwave_save_subtitles "$download_dir/$_name"\n    [ -z "$audio_link" ] && command -v "yt-dlp"');
        expect(patched.indexOf('pullwave_save_subtitles() {')).toBeLessThan(patched.indexOf('hianime_m3u8() {'));
        expect(patched).toContain(SAVE_SUBTITLES_FUNCTION);
        expect(patched.startsWith('something before\n')).toBe(true);
        expect(patched.endsWith('&& return 0\n}')).toBe(true);
    });

    it('says what its code reads from the script', () => {
        expect(ALL_SUBTITLES_NEEDS).toEqual(['_json', 'curl_exe', 'agent', 'refr', 'cipher_flag', 'download_dir', '_name']);
        expect(SUBTITLE_SELECTION_NEEDS).toEqual(['_json', 'sub_link']);
    });

    it('gives null when a place it changes is not the one it knows', () => {
        expect(patchAllSubtitles(original.replace('# quality variants are relative to the master playlist', '# other'))).toBeNull();
        expect(patchAllSubtitles(original.replace('-o "$download_dir/$_name.vtt"', '-o "$download_dir/$_name.srt"'))).toBeNull();
        expect(patchAllSubtitles(original.replace('hianime_m3u8() {', 'other_name() {'))).toBeNull();
        expect(patchAllSubtitles('nothing here')).toBeNull();
    });

    describe.skipIf(!HAS_TOOLS)('with the ani-cli that ships with the app', () => {
        it('patches it and the result is still valid shell', () => {
            const patched = patchAllSubtitles(readFileSync(REAL_SCRIPT, 'utf-8')) as string;
            expect(patched).not.toBeNull();
            const file = join(makeTempDir(), 'ani-cli');
            writeFileSync(file, patched);
            execFileSync(BUSYBOX, ['sh', '-n', file]);
        });
    });

    describe.skipIf(!HAS_TOOLS)('the function, run by the shell that ships with the app', () => {
        const json = JSON.stringify({
            src: 'https://x/master.m3u8',
            subtitles: [
                { lang: 'en', label: 'English', default: true, src: 'https://s/en.vtt' },
                { lang: 'en', label: 'Japanese', default: false, src: 'https://s/ja.vtt' },
                { lang: 'en', label: 'Portuguese (- Portuguese(Brazil))', default: false, src: 'https://s/pt.vtt' },
                { lang: 'en', label: 'No source', default: false }
            ],
            poster: ''
        });

        function save(source: string): string[] {
            const directory = makeTempDir();
            const tools = join(directory, 'tools');
            mkdirSync(tools);
            if (process.platform !== 'win32') {
                ['sed'].forEach((name) => {
                    symlinkSync(BUSYBOX, join(tools, name));
                });
            }
            const file = join(directory, 'save.sh');
            const list = `printf "%s" "$JSON" | sed 's|.*"subtitles":\\[||; s|}\\].*||; s|},{|}\\n{|g'`;
            writeFileSync(
                file,
                `${SAVE_SUBTITLES_FUNCTION}\ncurl_exe=echo\nagent=ua\nrefr=ref\ncipher_flag=\npullwave_all_subs="$(${list})"\npullwave_save_subtitles "/dl/Naruto Episode 1"\necho "rc=$?"\n`
            );
            const output = execFileSync(BUSYBOX, ['sh', file], { env: { JSON: source, PATH: tools, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) }, encoding: 'utf-8' });
            return output.trim().split('\n');
        }

        it('saves every subtitle that has a source, named after the video and its language, and succeeds', () => {
            expect(save(json)).toEqual([
                '-sL -A ua -e ref --max-time 10 https://s/en.vtt -o /dl/Naruto Episode 1.subtitle-English.vtt',
                '-sL -A ua -e ref --max-time 10 https://s/ja.vtt -o /dl/Naruto Episode 1.subtitle-Japanese.vtt',
                '-sL -A ua -e ref --max-time 10 https://s/pt.vtt -o /dl/Naruto Episode 1.subtitle-Portuguese (- Portuguese(Brazil)).vtt',
                'rc=0'
            ]);
        });

        it('saves nothing for a source without subtitles', () => {
            expect(save(JSON.stringify({ src: 'https://x/master.m3u8', poster: '' }))).toEqual(['rc=0']);
        });
    });
});
