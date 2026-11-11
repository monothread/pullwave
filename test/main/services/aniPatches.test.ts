import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATCH_NAMES, PATCHES, patchAniCli, patchReport, type PatchReport } from '@main/services/aniPatches';
import { DEBUG_PART, MENU_PART, SEARCH_PART, SINGLE_RESULT_PART, SUBTITLE_SAVE_LINE } from '../../helpers/aniCliScripts';

const SUBTITLES = [
    '# header',
    'hianime_m3u8() {',
    `    sub_link="$(printf "%s" "$_json" | sed 's|.*"subtitles":\\[||; s|}\\].*||; s|},{|}\\n{|g' | grep -m 1 '"default":true' | sed -nE 's|.*"src":"([^"]*)".*|\\1|p')"`,
    '}'
].join('\n');
const ALL_SUBTITLES = ['    # quality variants are relative to the master playlist', SUBTITLE_SAVE_LINE, '    yt-dlp x'].join('\n');
const MENU = MENU_PART;
const SINGLE_RESULT = SINGLE_RESULT_PART;
const DEBUG = DEBUG_PART;
const NONE: PatchReport = { subtitleSelection: false, allSubtitles: false, debugReferer: false, menuIds: false, singleResult: false, searchPages: false };

function only(...names: Array<keyof PatchReport>): PatchReport {
    return names.reduce((report, name) => {
        return { ...report, [name]: true };
    }, NONE);
}

const PATCHED_DEBUG = [
    'debug)',
    '            [ -n "$audio_link" ] && video_link="$_m3u8_master"',
    '            printf "All links:\\n%s\\nSelected link:\\n%s\\nAudio:\\n%s\\nSubtitles:\\n%s\\nReferer:\\n%s\\nSubtitle list:\\n%s\\n" "$links" "$video_link" "$audio_link" "$sub_link" "$refr" "${pullwave_all_subs:-}"',
    '            ;;'
].join('\n');

describe('PATCHES', () => {
    it('lists every change in the order they are made', () => {
        expect(PATCH_NAMES).toEqual(['subtitleSelection', 'allSubtitles', 'debugReferer', 'menuIds', 'singleResult', 'searchPages']);
    });

    it('says what the code of each change reads from the script', () => {
        expect(PATCHES.subtitleSelection.needs).toEqual(['_json', 'sub_link']);
        expect(PATCHES.allSubtitles.needs).toEqual(['_json', 'curl_exe', 'agent', 'refr', 'cipher_flag', 'download_dir', '_name']);
        expect(PATCHES.debugReferer.needs).toEqual(['links', 'video_link', 'audio_link', 'sub_link', 'refr', '_m3u8_master']);
        expect(PATCHES.menuIds.needs).toEqual(['menu']);
        expect(PATCHES.singleResult.needs).toEqual(['nth']);
        expect(PATCHES.searchPages.needs).toEqual(['hianime_curl', 'search_api', 'curl_exe', 'die']);
    });

    it('makes each change with its own function, which gives null for a script it does not fit', () => {
        PATCH_NAMES.forEach((name) => {
            expect(PATCHES[name].apply('a different script')).toBeNull();
        });
        expect(PATCHES.subtitleSelection.apply(SUBTITLES)).toContain('pullwave_pick_subtitle "$_json"');
        expect(PATCHES.allSubtitles.apply(`${SUBTITLES}\n${ALL_SUBTITLES}`)).toContain('pullwave_save_subtitles "$download_dir/$_name"');
        expect(PATCHES.debugReferer.apply(DEBUG)).toBe(PATCHED_DEBUG.replace(/^/, '        '));
        expect(PATCHES.menuIds.apply(MENU)).toContain('cut -f 1,2,3');
        expect(PATCHES.singleResult.apply(SINGLE_RESULT)).toContain('[ "$1" != "Select anime: " ]');
        expect(PATCHES.searchPages.apply(SEARCH_PART)).toContain('hianime_search_fetch()');
    });
});

describe('patchAniCli', () => {
    it('applies both changes when both fit', () => {
        const patched = patchAniCli(`${SUBTITLES}\n${DEBUG}`) as string;
        expect(patched).toContain('pullwave_pick_subtitle "$_json"');
        expect(patched).toContain(PATCHED_DEBUG);
    });

    it('makes the debug output print the master when the audio is a track of its own, with the referer and every subtitle', () => {
        const patched = patchAniCli(DEBUG) as string;
        expect(patched).toBe(`        ${PATCHED_DEBUG}`);
        expect(patched).toContain('"${pullwave_all_subs:-}"');
    });

    it('applies the one that fits when the other does not', () => {
        expect(patchAniCli(SUBTITLES)).toContain('pullwave_pick_subtitle "$_json"');
        expect(patchAniCli(SUBTITLES)).not.toContain('Referer:');
        expect(patchAniCli(DEBUG)).toContain('Referer:\\n%s\\n');
        expect(patchAniCli(DEBUG)).not.toContain('pullwave_pick_subtitle');
    });

    it('saves all the subtitles right after the one ani-cli picked, when that part of the script fits', () => {
        const patched = patchAniCli(`${SUBTITLES}\n${ALL_SUBTITLES}`) as string;
        expect(patched).toContain(`${SUBTITLE_SAVE_LINE}\n    pullwave_save_subtitles "$download_dir/$_name"\n    yt-dlp x`);
        expect(patched).toContain('pullwave_all_subs=');
        expect(patched).toContain('pullwave_pick_subtitle "$_json"');
        expect(patchAniCli(ALL_SUBTITLES)).toBeNull();
    });

    it('gives null when nothing fits', () => {
        expect(patchAniCli('a different script')).toBeNull();
        expect(patchAniCli('')).toBeNull();
    });
});

describe.skipIf(process.platform === 'win32')('the debug output, run by the shell', () => {
    function runDebug(audioLink: string): string {
        const script = [
            'links="1080 >https://cdn.example/1080/index.m3u8"',
            'video_link="https://cdn.example/1080/index.m3u8"',
            `audio_link="${audioLink}"`,
            'sub_link="https://cdn.example/en.vtt"',
            'refr="https://site.example/"',
            '_m3u8_master="https://cdn.example/master.m3u8"',
            'pullwave_all_subs=\'{"src":"https://cdn.example/en.vtt","label":"English"}\'',
            'case debug in',
            `        ${PATCHED_DEBUG}`,
            'esac'
        ].join('\n');
        return execFileSync('sh', ['-c', script]).toString();
    }

    it('prints the master as the selected link when the source gives the audio as a track of its own', () => {
        expect(runDebug('https://cdn.example/aud/a0/index.m3u8')).toBe(
            [
                'All links:',
                '1080 >https://cdn.example/1080/index.m3u8',
                'Selected link:',
                'https://cdn.example/master.m3u8',
                'Audio:',
                'https://cdn.example/aud/a0/index.m3u8',
                'Subtitles:',
                'https://cdn.example/en.vtt',
                'Referer:',
                'https://site.example/',
                'Subtitle list:',
                '{"src":"https://cdn.example/en.vtt","label":"English"}',
                ''
            ].join('\n')
        );
    });

    it('prints the selected picture as it is when the audio comes with it', () => {
        const output = runDebug('');
        expect(output).toContain('Selected link:\nhttps://cdn.example/1080/index.m3u8\nAudio:\n\nSubtitles:');
        expect(output).not.toContain('master.m3u8');
    });
});

describe('patchReport', () => {
    it('says which of the changes fit a script', () => {
        expect(patchReport(`${SUBTITLES}\n${ALL_SUBTITLES}\n${DEBUG}`)).toEqual(only('subtitleSelection', 'allSubtitles', 'debugReferer'));
    });

    it('says the choice of the subtitle language does not fit when that line changed, and the others still do', () => {
        const changed = SUBTITLES.replace('s|}\\].*||', 's|\\].*||');
        expect(changed).not.toBe(SUBTITLES);
        expect(patchReport(`${changed}\n${ALL_SUBTITLES}\n${DEBUG}`)).toEqual(only('allSubtitles', 'debugReferer'));
    });

    it('says the saving of every subtitle does not fit without its lines or without the function it hooks into', () => {
        expect(patchReport(`${SUBTITLES}\n${DEBUG}`)).toEqual(only('subtitleSelection', 'debugReferer'));
        expect(patchReport(`${ALL_SUBTITLES}\n${DEBUG}`)).toEqual(only('debugReferer'));
        expect(patchReport(`${SUBTITLES}\n${ALL_SUBTITLES.replace(SUBTITLE_SAVE_LINE, '    true')}`)).toEqual(only('subtitleSelection'));
    });

    it('says the address of the stream does not fit when its line changed, as in the ani-cli before the audio track (5.1.4)', () => {
        const before = '        debug) printf "All links:\\n%s\\nSelected link:\\n%s\\nSubtitles:\\n%s\\n" "$links" "$video_link" "$sub_link" ;;';
        expect(patchReport(`${SUBTITLES}\n${ALL_SUBTITLES}\n${DEBUG.replace('Subtitles:', 'Subs:')}`)).toEqual(only('subtitleSelection', 'allSubtitles'));
        expect(patchReport(before)).toEqual(NONE);
    });

    it('says none of them fit a script it knows nothing about, even an empty one', () => {
        expect(patchReport('a different script')).toEqual(NONE);
        expect(patchReport('')).toEqual(NONE);
    });

    it('agrees with what patchAniCli does: it gives null exactly when none fit', () => {
        ['', SUBTITLES, ALL_SUBTITLES, DEBUG, MENU, SINGLE_RESULT, SEARCH_PART, `${SUBTITLES}\n${DEBUG}`].forEach((script) => {
            const report = patchReport(script);
            expect(patchAniCli(script) === null).toBe(Object.values(report).every((fits) => {
                return !fits;
            }));
        });
    });
});

describe('the id of the source in the lists of the menu', () => {
    it('lets the id through, between the number and the title, when that part of the script fits', () => {
        const patched = patchAniCli(MENU) as string;
        expect(patched).toContain(`cut -f 1,2,3 | sed -E 's/^([^\\t]*)\\t([^\\t]*)\\t/\\1 pwid:\\2 /' | tr '\\t' ' ' | menu "$_prompt"`);
        expect(patched).not.toContain('cut -f 1,3');
        expect(patchReport(MENU)).toEqual(only('menuIds'));
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

    it.skipIf(process.platform === 'win32')('leaves a list that has a single column, like the episodes, as it is', () => {
        const pipeline = `cut -f 1,2,3 | sed -E 's/^([^\\t]*)\\t([^\\t]*)\\t/\\1 pwid:\\2 /' | tr '\\t' ' '`;
        expect(execFileSync('sh', ['-c', `printf '1\\n2\\n3' | ${pipeline}`]).toString()).toBe('1\n2\n3\n');
    });
});

describe('the lone result shown in the menu', () => {
    const SHOWN = '[ "$_line_count" -eq 1 ] && [ "$1" != "Select anime: " ] && printf "%s" "$_stdin" | cut -f 2,3 && return 0';

    it('stops the shortcut of a single line only for the list of the anime, when that part of the script fits', () => {
        const patched = patchAniCli(SINGLE_RESULT) as string;
        expect(patched).toContain(SHOWN);
        expect(patched).not.toBe(SINGLE_RESULT);
        expect(patchReport(SINGLE_RESULT)).toEqual(only('singleResult'));
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
});

// The script of ani-cli the app pins (scripts/fetch-binaries.mjs puts it in resources/bin for the tests that run it).
describe.skipIf(!existsSync(join(process.cwd(), 'resources', 'bin', 'ani', 'ani-cli')))('the script of ani-cli the app pins', () => {
    const bundled = join(process.cwd(), 'resources', 'bin', 'ani', 'ani-cli');

    it('fits every change of the app', () => {
        expect(patchReport(readFileSync(bundled, 'utf-8'))).toEqual({ subtitleSelection: true, allSubtitles: true, debugReferer: true, menuIds: true, singleResult: true, searchPages: true });
    });

    it.skipIf(process.platform === 'win32')('stays a script the shell accepts once it is changed', () => {
        const patched = patchAniCli(readFileSync(bundled, 'utf-8')) as string;
        expect(() => {
            execFileSync('sh', ['-n', '-c', patched]);
        }).not.toThrow();
    });

    describe.skipIf(process.platform === 'win32')('in its function nth', () => {
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
