import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { patchAniCli, patchReport, REQUIRED_PATCHES } from '@main/services/aniPatches';

const SUBTITLES = [
    '# header',
    'hianime_m3u8() {',
    `    sub_link="$(printf "%s" "$_json" | sed 's|.*"subtitles":\\[||; s|}\\].*||; s|},{|}\\n{|g' | grep -m 1 '"default":true' | sed -nE 's|.*"src":"([^"]*)".*|\\1|p')"`,
    '}'
].join('\n');
const ALL_SUBTITLES = [
    '    # quality variants are relative to the master playlist',
    '    command -v "yt-dlp" >/dev/null && yt-dlp --referer "$refr" "$1" -o x'
].join('\n');
const MENU = `    _line=$(printf "%s" "$_stdin" | cut -f 1,3 | tr '\\t' ' ' | menu "$_prompt" "$_multi_flag" "$menu_extra_flags" | cut -d " " -f 1)`;
const SINGLE_RESULT = '    [ "$_line_count" -eq 1 ] && printf "%s" "$_stdin" | cut -f 2,3 && return 0';
const DEBUG = '        debug) printf "All links:\\n%s\\nSelected link:\\n%s\\nSubtitles:\\n%s\\n" "$links" "$video_link" "$sub_link" ;;';

describe('patchAniCli', () => {
    it('applies both changes when both fit', () => {
        const patched = patchAniCli(`${SUBTITLES}\n${DEBUG}`) as string;
        expect(patched).toContain('pullwave_pick_subtitle "$_json"');
        expect(patched).toContain('Referer:\\n%s\\n');
    });

    it('makes the debug output carry the subtitles the patch kept, and works without that patch', () => {
        const withList = patchAniCli(`${SUBTITLES}\n${ALL_SUBTITLES}\n${DEBUG}`) as string;
        expect(withList).toContain('pullwave_all_subs=');
        expect(withList).toContain('Subtitle list:\\n%s\\n" "$links" "$video_link" "$sub_link" "$refr" "${pullwave_all_subs:-}"');
        expect(patchAniCli(DEBUG)).toContain('"${pullwave_all_subs:-}"');
    });

    it('applies the one that fits when the other does not', () => {
        expect(patchAniCli(SUBTITLES)).toContain('pullwave_pick_subtitle "$_json"');
        expect(patchAniCli(SUBTITLES)).not.toContain('Referer:');
        expect(patchAniCli(DEBUG)).toContain('Referer:\\n%s\\n');
        expect(patchAniCli(DEBUG)).not.toContain('pullwave_pick_subtitle');
    });

    it('saves all the subtitles when that part of the script fits', () => {
        const script = `${SUBTITLES}\n${ALL_SUBTITLES}`;
        const patched = patchAniCli(script) as string;
        expect(patched).toContain('pullwave_save_subtitles "$download_dir/$_name"');
        expect(patched).toContain('pullwave_all_subs=');
        expect(patched).toContain('pullwave_pick_subtitle "$_json"');
        expect(patchAniCli(ALL_SUBTITLES)).toBeNull();
    });

    it('gives null when nothing fits', () => {
        expect(patchAniCli('a different script')).toBeNull();
        expect(patchAniCli('')).toBeNull();
    });
});

describe('patchReport', () => {
    it('says which of the changes fit a script', () => {
        expect(patchReport(`${SUBTITLES}\n${ALL_SUBTITLES}\n${DEBUG}`)).toEqual({ subtitleSelection: true, allSubtitles: true, debugReferer: true, menuIds: false, singleResult: false, searchPages: false, separateAudio: false });
    });

    it('says the choice of the subtitle language does not fit when that line changed, and the others still do', () => {
        const changed = SUBTITLES.replace('s|}\\].*||', 's|\\].*||');
        expect(changed).not.toBe(SUBTITLES);
        expect(patchReport(`${changed}\n${ALL_SUBTITLES}\n${DEBUG}`)).toEqual({ subtitleSelection: false, allSubtitles: true, debugReferer: true, menuIds: false, singleResult: false, searchPages: false, separateAudio: false });
    });

    it('says the saving of every subtitle does not fit without its two lines or without the function it hooks into', () => {
        expect(patchReport(`${SUBTITLES}\n${DEBUG}`)).toEqual({ subtitleSelection: true, allSubtitles: false, debugReferer: true, menuIds: false, singleResult: false, searchPages: false, separateAudio: false });
        expect(patchReport(`${ALL_SUBTITLES}\n${DEBUG}`)).toEqual({ subtitleSelection: false, allSubtitles: false, debugReferer: true, menuIds: false, singleResult: false, searchPages: false, separateAudio: false });
    });

    it('says the address of the stream does not fit when its line changed', () => {
        expect(patchReport(`${SUBTITLES}\n${ALL_SUBTITLES}\n${DEBUG.replace('Subtitles:', 'Subs:')}`)).toEqual({ subtitleSelection: true, allSubtitles: true, debugReferer: false, menuIds: false, singleResult: false, searchPages: false, separateAudio: false });
    });

    it('says none of them fit a script it knows nothing about, even an empty one', () => {
        expect(patchReport('a different script')).toEqual({ subtitleSelection: false, allSubtitles: false, debugReferer: false, menuIds: false, singleResult: false, searchPages: false, separateAudio: false });
        expect(patchReport('')).toEqual({ subtitleSelection: false, allSubtitles: false, debugReferer: false, menuIds: false, singleResult: false, searchPages: false, separateAudio: false });
    });

    it('agrees with what patchAniCli does: it gives null exactly when none fit', () => {
        ['', SUBTITLES, ALL_SUBTITLES, DEBUG, MENU, SINGLE_RESULT, `${SUBTITLES}\n${DEBUG}`].forEach((script) => {
            const report = patchReport(script);
            expect(patchAniCli(script) === null).toBe(!report.subtitleSelection && !report.allSubtitles && !report.debugReferer && !report.menuIds && !report.singleResult && !report.searchPages && !report.separateAudio);
        });
    });
});

describe('the id of the source in the lists of the menu', () => {
    it('lets the id through, between the number and the title, when that part of the script fits', () => {
        const patched = patchAniCli(MENU) as string;
        expect(patched).toContain(`cut -f 1,2,3 | sed -E 's/^([^\\t]*)\\t([^\\t]*)\\t/\\1 pwid:\\2 /' | tr '\\t' ' ' | menu "$_prompt"`);
        expect(patched).not.toContain('cut -f 1,3');
        expect(patchReport(MENU)).toEqual({ subtitleSelection: false, allSubtitles: false, debugReferer: false, menuIds: true, singleResult: false, searchPages: false, separateAudio: false });
    });

    it('is applied with the others, each on its own', () => {
        const patched = patchAniCli(`${SUBTITLES}\n${DEBUG}\n${MENU}`) as string;
        expect(patched).toContain('pullwave_pick_subtitle "$_json"');
        expect(patched).toContain('Referer:\\n%s\\n');
        expect(patched).toContain('cut -f 1,2,3');
    });

    it('does not fit a script whose line changed', () => {
        expect(patchReport(MENU.replace('cut -f 1,3', 'cut -f 1,4')).menuIds).toBe(false);
        expect(patchAniCli(MENU.replace('cut -f 1,3', 'cut -f 1,4'))).toBeNull();
    });

    it.skipIf(process.platform === 'win32')('gives every line of the list with its id marked, also the last one that has no new line after it', () => {
        const patched = patchAniCli(MENU) as string;
        const pipeline = /\| (cut -f 1,2,3 \| sed -E '[^']*' \| tr '\\t' ' ')/.exec(patched)?.[1] as string;
        const list = "1\\tnisekoi-false-love-603\\tNisekoi: False Love\\n2\\tnisekoi-false-love-season-2-605\\tNisekoi: False Love\\n3\\tReooPAxPMsHM4KPMY\\tOne Piece";
        const output = execFileSync('sh', ['-c', `printf '${list}' | ${pipeline}`]).toString();
        expect(output).toBe('1 pwid:nisekoi-false-love-603 Nisekoi: False Love\n2 pwid:nisekoi-false-love-season-2-605 Nisekoi: False Love\n3 pwid:ReooPAxPMsHM4KPMY One Piece\n');
    });

    it('leaves a list that has a single column, like the episodes, as it is', () => {
        const pipeline = `cut -f 1,2,3 | sed -E 's/^([^\\t]*)\\t([^\\t]*)\\t/\\1 pwid:\\2 /' | tr '\\t' ' '`;
        if (process.platform !== 'win32') {
            expect(execFileSync('sh', ['-c', `printf '1\\n2\\n3' | ${pipeline}`]).toString()).toBe('1\n2\n3\n');
        }
    });

    it('fits the script of ani-cli that comes with the tests, when it is there', () => {
        const script = join(process.cwd(), 'resources', 'bin', 'ani', 'ani-cli');
        if (existsSync(script)) {
            expect(patchReport(readFileSync(script, 'utf-8')).menuIds).toBe(true);
        }
    });

    it('is not one the app cannot do without', () => {
        expect(REQUIRED_PATCHES).not.toContain('menuIds');
    });
});

describe('REQUIRED_PATCHES', () => {
    it('is only the address of the stream: without it the app cannot play or download an episode', () => {
        expect(REQUIRED_PATCHES).toEqual(['debugReferer']);
    });
});

describe('the lone result shown in the menu', () => {
    const SHOWN = '[ "$_line_count" -eq 1 ] && [ "$1" != "Select anime: " ] && printf "%s" "$_stdin" | cut -f 2,3 && return 0';
    const bundled = join(process.cwd(), 'resources', 'bin', 'ani', 'ani-cli');

    it('stops the shortcut of a single line only for the list of the anime, when that part of the script fits', () => {
        const patched = patchAniCli(SINGLE_RESULT) as string;
        expect(patched).toContain(SHOWN);
        expect(patched).not.toBe(SINGLE_RESULT);
        expect(patchReport(SINGLE_RESULT)).toEqual({ subtitleSelection: false, allSubtitles: false, debugReferer: false, menuIds: false, singleResult: true, searchPages: false, separateAudio: false });
    });

    it('is applied with the others, each on its own', () => {
        const patched = patchAniCli(`${SUBTITLES}\n${DEBUG}\n${MENU}\n${SINGLE_RESULT}`) as string;
        expect(patched).toContain('pullwave_pick_subtitle "$_json"');
        expect(patched).toContain('Referer:\\n%s\\n');
        expect(patched).toContain('cut -f 1,2,3');
        expect(patched).toContain(SHOWN);
    });

    it('does not fit a script whose line changed', () => {
        const changed = SINGLE_RESULT.replace('-eq 1', '-le 1');
        expect(patchReport(changed).singleResult).toBe(false);
        expect(patchAniCli(changed)).toBeNull();
    });

    it('is not one the app cannot do without', () => {
        expect(REQUIRED_PATCHES).not.toContain('singleResult');
    });

    it('fits the script of ani-cli that comes with the tests, when it is there', () => {
        if (existsSync(bundled)) {
            expect(patchReport(readFileSync(bundled, 'utf-8')).singleResult).toBe(true);
        }
    });

    describe.skipIf(process.platform === 'win32' || !existsSync(bundled))('in the function nth of the script that comes with the tests', () => {
        // The function as the script has it, patched, run with a stand-in for the menu that prints what it was asked and fails (as the one of the
        // app does, so ani-cli stops after listing).
        function runNth(prompt: string, list: string): string {
            const patched = patchAniCli(readFileSync(bundled, 'utf-8')) as string;
            const start = patched.indexOf('nth() {');
            const nth = patched.slice(start, patched.indexOf('\n}\n', start) + 3);
            const script = `menu() { printf 'MENU:%s\\n' "$1" >&2; cat >&2; return 1; }\n${nth}\nprintf '${list}' | nth '${prompt}' 2>&1 || true`;
            return execFileSync('sh', ['-c', script]).toString();
        }

        it('hands a single anime to the menu, so its title is told', () => {
            expect(runNth('Select anime: ', '1\\tnisekoi-603\\tNisekoi: False Love')).toBe('MENU:Select anime: \n1 pwid:nisekoi-603 Nisekoi: False Love\n');
        });

        it('still hands several anime to the menu', () => {
            expect(runNth('Select anime: ', '1\\ta\\tOne\\n2\\tb\\tTwo')).toBe('MENU:Select anime: \n1 pwid:a One\n2 pwid:b Two\n');
        });

        it('still picks a single episode by itself, without the menu', () => {
            expect(runNth('Select episode: ', '1\\tep-1-id\\tEpisode 1')).toBe('ep-1-id\tEpisode 1\n');
        });
    });
});
