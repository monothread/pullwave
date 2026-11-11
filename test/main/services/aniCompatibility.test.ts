import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    compatibilityProblems,
    describeProblem,
    DOWNLOAD_PATTERNS,
    ENVIRONMENT_VARIABLES,
    hasOption,
    looksLikeAniCli,
    MAX_SCRIPT_BYTES,
    MESSAGES,
    OPTIONS,
    PROMPTS,
    readsVariable,
    setsName,
    type CompatibilityProblem
} from '@main/services/aniCompatibility';
import { aniCliScript, aniCliScriptWithout, DEBUG_PART, FFMPEG_LINE, MENU_PART, PROVIDER_LINE, SEARCH_PART, SINGLE_RESULT_PART, YTDLP_LINE } from '../../helpers/aniCliScripts';

const BASE = { version: '5.1.8', provider: 'hianime.at' };
const BUNDLED = join(process.cwd(), 'resources', 'bin', 'ani', 'ani-cli');

describe('the constants of the checks', () => {
    it('lists the variables of the environment the app gives ani-cli', () => {
        expect(ENVIRONMENT_VARIABLES).toEqual(['ANI_CLI_MENU', 'ANI_CLI_PLAYER', 'ANI_CLI_LOG', 'ANI_CLI_MODE', 'ANI_CLI_HIST_DIR', 'ANI_CLI_DOWNLOAD_DIR', 'ANI_CLI_TMP_DIR']);
    });

    it('lists the options the app runs ani-cli with', () => {
        expect(OPTIONS).toEqual(['-S', '-e', '-q', '-d']);
    });

    it('lists the menus the app reads, with the space ani-cli ends them with', () => {
        expect(PROMPTS).toEqual(['Select anime: ', 'Select episode: ']);
    });

    it('lists the messages that decide what the app does', () => {
        expect(MESSAGES).toEqual(['No results found', 'Episode not released', 'Blocked by cloudflare']);
    });

    it('names the two ways the script downloads', () => {
        expect(
            DOWNLOAD_PATTERNS.map(({ name }) => {
                return name;
            })
        ).toEqual(['yt-dlp download', 'ffmpeg download']);
    });

    it('takes no script bigger than half a megabyte', () => {
        expect(MAX_SCRIPT_BYTES).toBe(500_000);
    });
});

describe('setsName', () => {
    it('finds a variable set at the start of a line, indented, or after another command on the line', () => {
        expect(setsName('agent="x"', 'agent')).toBe(true);
        expect(setsName('    links="$(a)"', 'links')).toBe(true);
        expect(setsName('[ -z "$x" ] && video_link="$(a)"', 'video_link')).toBe(true);
        expect(setsName('a; refr=1', 'refr')).toBe(true);
        expect(setsName('curl_exe=$(dep_ch_failover "curl")', 'curl_exe')).toBe(true);
    });

    it('finds a function defined at the start of a line', () => {
        expect(setsName('hianime_curl() {\n}', 'hianime_curl')).toBe(true);
        expect(setsName('die(){\n}', 'die')).toBe(true);
    });

    it('does not take a variable that is only read, or one with a longer name', () => {
        expect(setsName('printf "%s" "$agent"', 'agent')).toBe(false);
        expect(setsName('user_agent="x"', 'agent')).toBe(false);
        expect(setsName('agent_name="x"', 'agent')).toBe(false);
        expect(setsName('[ "$agent" = "x" ]', 'agent')).toBe(false);
    });

    it('does not take a function that is only called', () => {
        expect(setsName('    hianime_curl "$1"', 'hianime_curl')).toBe(false);
    });

    it('reads the name as it is, not as a pattern', () => {
        expect(setsName('_json="x"', '_json')).toBe(true);
        expect(setsName('a.b="x"', 'a.b')).toBe(true);
        expect(setsName('axb="x"', 'a.b')).toBe(false);
    });
});

describe('readsVariable', () => {
    it('finds a variable read with a default, either form', () => {
        expect(readsVariable('mode="${ANI_CLI_MODE:-sub}"', 'ANI_CLI_MODE')).toBe(true);
        expect(readsVariable('x="${ANI_CLI_LOG-1}"', 'ANI_CLI_LOG')).toBe(true);
        expect(readsVariable('x="${ANI_CLI_MENU}"', 'ANI_CLI_MENU')).toBe(true);
    });

    it('does not take one that is only named, or one with a longer name', () => {
        expect(readsVariable('# set ANI_CLI_MODE to dub', 'ANI_CLI_MODE')).toBe(false);
        expect(readsVariable('x="${ANI_CLI_MODE_OLD:-sub}"', 'ANI_CLI_MODE')).toBe(false);
    });
});

describe('hasOption', () => {
    it('finds an option among the cases the script reads its arguments with', () => {
        expect(hasOption('        -S | --select-nth)', '-S')).toBe(true);
        expect(hasOption('        -e | --episode | -r | --range)', '-e')).toBe(true);
        expect(hasOption('        -d)', '-d')).toBe(true);
    });

    it('does not take an option that is only mentioned, or a longer one', () => {
        expect(hasOption('    printf "use -S to select"', '-S')).toBe(false);
        expect(hasOption('        -Sx | --other)', '-S')).toBe(false);
        expect(hasOption('        --select-nth | -x)', '-S')).toBe(false);
    });
});

describe('looksLikeAniCli', () => {
    it('takes a shell script that says its version', () => {
        expect(looksLikeAniCli(aniCliScript('5.2.0'))).toBe(true);
    });

    it('does not take something else, a script without a version, another shell, or one too big', () => {
        expect(looksLikeAniCli('<html>')).toBe(false);
        expect(looksLikeAniCli('#!/bin/sh\necho hi')).toBe(false);
        expect(looksLikeAniCli('#!/bin/bash\nversion_number="5.2.0"')).toBe(false);
        expect(looksLikeAniCli(aniCliScript('5.2.0', 'x'.repeat(MAX_SCRIPT_BYTES)))).toBe(false);
    });
});

describe('compatibilityProblems', () => {
    it('finds none in a script that keeps everything the app relies on, of the same version or newer', () => {
        expect(compatibilityProblems(aniCliScript('5.1.8'), BASE)).toEqual([]);
        expect(compatibilityProblems(aniCliScript('5.1.10'), BASE)).toEqual([]);
        expect(compatibilityProblems(aniCliScript('6.0'), BASE)).toEqual([]);
    });

    it('looks no further at a text that is not ani-cli', () => {
        expect(compatibilityProblems('<html>', BASE)).toEqual([{ kind: 'not-ani-cli' }]);
    });

    it('finds a script older than the base', () => {
        expect(compatibilityProblems(aniCliScript('5.1.7'), BASE)).toEqual([{ kind: 'older', version: '5.1.7', base: '5.1.8' }]);
    });

    it('finds a script that reads another site, or one that does not say which', () => {
        expect(compatibilityProblems(aniCliScript('5.2.0').replace(PROVIDER_LINE, 'base_api="https://hianime.to"'), BASE)).toEqual([{ kind: 'provider', provider: 'hianime.to', base: 'hianime.at' }]);
        expect(compatibilityProblems(aniCliScriptWithout('5.2.0', PROVIDER_LINE), BASE)).toEqual([{ kind: 'provider', provider: null, base: 'hianime.at' }]);
    });

    it.each([
        ['debugReferer', DEBUG_PART],
        ['menuIds', MENU_PART],
        ['singleResult', SINGLE_RESULT_PART],
        ['searchPages', SEARCH_PART]
    ])('finds the change %s that no longer fits', (patch, part) => {
        expect(compatibilityProblems(aniCliScriptWithout('5.2.0', part), BASE)).toEqual([{ kind: 'patch', patch }]);
    });

    it.each([
        ['allSubtitles', 'agent', 'agent="Mozilla/5.0"'],
        ['allSubtitles', 'cipher_flag', '        cipher_flag="--ciphers x"'],
        ['debugReferer', 'audio_link', '    audio_link="$(printf x)"'],
        ['debugReferer', '_m3u8_master', '    _m3u8_master="$(printf x)"'],
        ['menuIds', 'menu', 'menu() {'],
        ['singleResult', 'nth', 'nth() {'],
        ['searchPages', 'search_api', 'search_api="${base_api}/search?keyword=%s"']
    ])('finds the change %s, which fits, reading %s that the script no longer sets', (patch, name, line) => {
        expect(compatibilityProblems(aniCliScriptWithout('5.2.0', line), BASE)).toEqual([{ kind: 'needs', patch, name }]);
    });

    it('finds every variable of the environment the script no longer reads', () => {
        const script = aniCliScriptWithout('5.2.0', 'menu_program="${ANI_CLI_MENU:-fzf}"', 'tmp_dir="${ANI_CLI_TMP_DIR:-.}"');
        expect(compatibilityProblems(script, BASE)).toEqual([
            { kind: 'variable', name: 'ANI_CLI_MENU' },
            { kind: 'variable', name: 'ANI_CLI_TMP_DIR' }
        ]);
    });

    it('finds an option that is gone', () => {
        expect(compatibilityProblems(aniCliScriptWithout('5.2.0', '        -S | --select-nth)'), BASE)).toEqual([{ kind: 'option', name: '-S' }]);
        expect(compatibilityProblems(aniCliScriptWithout('5.2.0', '        -d | --download)'), BASE)).toEqual([{ kind: 'option', name: '-d' }]);
    });

    it('finds a menu that asks with other words', () => {
        expect(compatibilityProblems(aniCliScript('5.2.0').replace('"Select episode: "', '"Pick an episode: "'), BASE)).toEqual([{ kind: 'prompt', name: 'Select episode: ' }]);
    });

    it('finds a message the app tells apart that is gone', () => {
        expect(compatibilityProblems(aniCliScript('5.2.0').replace('No results found!', 'Nothing found!'), BASE)).toEqual([{ kind: 'message', name: 'No results found' }]);
    });

    it('finds a download that is not done the way the stand-ins of the app expect', () => {
        expect(compatibilityProblems(aniCliScript('5.2.0').replace('-P "temp:$tmp_dir"', ''), BASE)).toEqual([{ kind: 'download', name: 'yt-dlp download' }]);
        expect(compatibilityProblems(aniCliScript('5.2.0').replace(FFMPEG_LINE, FFMPEG_LINE.replace(' -stats', '')), BASE)).toEqual([{ kind: 'download', name: 'ffmpeg download' }]);
        // The stand-in takes the picture as the first input and the audio track as the second: a call without the track is not the one it knows.
        expect(compatibilityProblems(aniCliScript('5.2.0').replace(FFMPEG_LINE, FFMPEG_LINE.replace(' -i "$audio_link"', ' -i "$audio"')), BASE)).toEqual([
            { kind: 'download', name: 'ffmpeg download' }
        ]);
        expect(compatibilityProblems(aniCliScript('5.2.0').replace(FFMPEG_LINE, FFMPEG_LINE.replace('"$download_dir/$_name.mp4" $3', '"$download_dir/$_name.mkv" $3')), BASE)).toEqual([
            { kind: 'download', name: 'ffmpeg download' }
        ]);
        expect(compatibilityProblems(aniCliScriptWithout('5.2.0', YTDLP_LINE, FFMPEG_LINE), BASE)).toEqual([
            { kind: 'download', name: 'yt-dlp download' },
            { kind: 'download', name: 'ffmpeg download' }
        ]);
    });

    it('gives every problem at once, in order: the version, the site, the changes, then the rest', () => {
        const script = aniCliScriptWithout('5.0.0', MENU_PART, 'log_episode="${ANI_CLI_LOG:-1}"').replace(PROVIDER_LINE, 'base_api="https://x.example"');
        expect(compatibilityProblems(script, BASE)).toEqual([
            { kind: 'older', version: '5.0.0', base: '5.1.8' },
            { kind: 'provider', provider: 'x.example', base: 'hianime.at' },
            { kind: 'patch', patch: 'menuIds' },
            { kind: 'variable', name: 'ANI_CLI_LOG' }
        ]);
    });

    it.skipIf(!existsSync(BUNDLED))('finds none in the script of ani-cli the app pins', () => {
        expect(compatibilityProblems(readFileSync(BUNDLED, 'utf-8'), BASE)).toEqual([]);
    });
});

describe('describeProblem', () => {
    it.each<[CompatibilityProblem, string]>([
        [{ kind: 'not-ani-cli' }, 'the file is not ani-cli'],
        [{ kind: 'older', version: '5.1.4', base: '5.1.8' }, 'version 5.1.4 is older than 5.1.8'],
        [{ kind: 'provider', provider: 'x.example', base: 'hianime.at' }, 'it reads x.example instead of hianime.at'],
        [{ kind: 'provider', provider: null, base: 'hianime.at' }, 'it reads an unknown site instead of hianime.at'],
        [{ kind: 'patch', patch: 'menuIds' }, 'the change "menuIds" does not fit'],
        [{ kind: 'needs', patch: 'allSubtitles', name: 'agent' }, 'the change "allSubtitles" reads "agent", which the script no longer sets'],
        [{ kind: 'variable', name: 'ANI_CLI_TMP_DIR' }, 'the script no longer reads ANI_CLI_TMP_DIR'],
        [{ kind: 'option', name: '-S' }, 'the option -S is gone'],
        [{ kind: 'prompt', name: 'Select anime: ' }, 'the menu "Select anime:" is gone'],
        [{ kind: 'message', name: 'No results found' }, 'the message "No results found" is gone'],
        [{ kind: 'download', name: 'ffmpeg download' }, 'the ffmpeg download is not the one the app expects']
    ])('puts %o in words', (problem, words) => {
        expect(describeProblem(problem)).toBe(words);
    });
});
