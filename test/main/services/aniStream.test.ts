import { execFileSync } from 'node:child_process';
import { buildStreamArgs, parseStreamOutput, parseSubtitleList, patchDebugReferer } from '@main/services/aniStream';

const ORIGINAL = [
    'case "$player_function" in',
    '        debug) printf "All links:\\n%s\\nSelected link:\\n%s\\nSubtitles:\\n%s\\n" "$links" "$video_link" "$sub_link" ;;',
    '        android_mpv) android_mpv ;;',
    'esac'
].join('\n');

describe('patchDebugReferer', () => {
    it('adds the referer to what the debug player prints', () => {
        const patched = patchDebugReferer(ORIGINAL) as string;
        expect(patched).toContain(
            'debug) printf "All links:\\n%s\\nSelected link:\\n%s\\nSubtitles:\\n%s\\nReferer:\\n%s\\nSubtitle list:\\n%s\\n" "$links" "${pullwave_audio_master:-$video_link}" "$sub_link" "$refr" "${pullwave_all_subs:-}" ;;'
        );
        expect(patched).not.toContain('Subtitles:\\n%s\\n" "$links"');
        expect(patched.startsWith('case "$player_function" in\n')).toBe(true);
        expect(patched.endsWith('        android_mpv) android_mpv ;;\nesac')).toBe(true);
    });

    it('gives null for a script it does not know', () => {
        expect(patchDebugReferer('nothing here')).toBeNull();
        expect(patchDebugReferer(ORIGINAL.replace('Subtitles', 'Subs'))).toBeNull();
    });
});

describe('buildStreamArgs', () => {
    it('picks the anime and the episode and the quality, without downloading', () => {
        expect(buildStreamArgs('cyberpunk edgerunners', 2, '5', '720p')).toEqual(['-S', '2', '-e', '5', '-q', '720p', 'cyberpunk edgerunners']);
    });

    it('cleans the query', () => {
        expect(buildStreamArgs('-d naruto &', 1, '1', 'best')).toEqual(['-S', '1', '-e', '1', '-q', 'best', 'd naruto']);
    });
});

describe('parseStreamOutput', () => {
    const LINK = 'https://hls.example.top/v/abc/1080/index.m3u8';

    it('reads the address, the subtitles and the referer', () => {
        const output = [
            'Checking dependencies...',
            'hianime.at links fetched',
            'All links:',
            `1080 >${LINK}`,
            'Selected link:',
            LINK,
            'Subtitles:',
            'https://hls.example.top/v/abc/subs/pt.vtt',
            'Referer:',
            'https://embed.example/'
        ].join('\n');
        expect(parseStreamOutput(output)).toEqual({ url: LINK, subtitleUrl: 'https://hls.example.top/v/abc/subs/pt.vtt', referer: 'https://embed.example/', subtitles: [] });
    });

    it('reads a stream without subtitles, which are not printed at all', () => {
        const output = ['All links:', `720 >${LINK}`, 'Selected link:', LINK, 'Subtitles:', 'Referer:', 'https://embed.example/'].join('\n');
        expect(parseStreamOutput(output)).toEqual({ url: LINK, subtitleUrl: null, referer: 'https://embed.example/', subtitles: [] });
    });

    it('reads a stream from a script that does not print the referer', () => {
        expect(parseStreamOutput(['Selected link:', LINK, 'Subtitles:', 'https://s/en.vtt'].join('\n'))).toEqual({ url: LINK, subtitleUrl: 'https://s/en.vtt', referer: null, subtitles: [] });
        expect(parseStreamOutput(['Selected link:', LINK, 'Subtitles:'].join('\n'))).toEqual({ url: LINK, subtitleUrl: null, referer: null, subtitles: [] });
    });

    it('ignores spaces around the lines and blank lines', () => {
        expect(parseStreamOutput(`  Selected link:  \n\n  ${LINK}  \n`)).toEqual({ url: LINK, subtitleUrl: null, referer: null, subtitles: [] });
    });

    it('reads every subtitle the source offers, in the order it gives them, besides the one ani-cli picked', () => {
        const output = [
            'Selected link:',
            LINK,
            'Subtitles:',
            'https://s.example/en.vtt',
            'Referer:',
            'https://embed.example/',
            'Subtitle list:',
            '{"lang":"en","label":"Arabic","default":false,"src":"https://s.example/ar.vtt"}',
            '{"lang":"en","label":"English","default":true,"src":"https://s.example/en.vtt"}',
            '{"lang":"en","label":"Portuguese (- Portuguese(Brazil))","default":false,"src":"https://s.example/pt.vtt"}'
        ].join('\n');
        expect(parseStreamOutput(output)).toEqual({
            url: LINK,
            subtitleUrl: 'https://s.example/en.vtt',
            referer: 'https://embed.example/',
            subtitles: [
                { label: 'Arabic', src: 'https://s.example/ar.vtt' },
                { label: 'English', src: 'https://s.example/en.vtt' },
                { label: 'Portuguese (- Portuguese(Brazil))', src: 'https://s.example/pt.vtt' }
            ]
        });
    });

    it('has no subtitles in the list when the script did not print one', () => {
        expect(parseStreamOutput(['Selected link:', LINK, 'Subtitles:', 'https://s.example/en.vtt', 'Referer:', 'https://embed.example/', 'Subtitle list:'].join('\n'))?.subtitles).toEqual([]);
    });

    it('gives null when there is no address', () => {
        expect(parseStreamOutput('')).toBeNull();
        expect(parseStreamOutput('No sources found for sub!')).toBeNull();
        expect(parseStreamOutput('Selected link:')).toBeNull();
        expect(parseStreamOutput('Selected link:\nnot an address')).toBeNull();
        expect(parseStreamOutput(`Selected link:\nftp://x/y`)).toBeNull();
    });

    it('does not take an address that follows a different marker', () => {
        expect(parseStreamOutput(`All links:\n720 >${LINK}\nSubtitles:\nhttps://s/en.vtt`)).toBeNull();
    });
});

describe('patchDebugReferer and the subtitles of the source', () => {
    it('prints the list of the subtitles last, and an empty one when the script did not keep it', () => {
        const patched = patchDebugReferer(ORIGINAL) as string;
        expect(patched.indexOf('Referer:')).toBeLessThan(patched.indexOf('Subtitle list:'));
        // Read with a default, so a script that kept no list does not fail on an unset variable.
        expect(patched).toContain('"${pullwave_all_subs:-}"');
    });
});

describe('patchDebugReferer and the audio of the source', () => {
    const VARIANT = 'https://hls.example.top/v/abc/1080/index.m3u8';
    const MASTER = 'https://hls.example.top/v/abc/master.m3u8';

    // Runs the debug line the patch writes, the way the script runs it, and reads what the app would read.
    const printedWith = (assignment: string): ReturnType<typeof parseStreamOutput> => {
        const patched = patchDebugReferer(ORIGINAL) as string;
        const line = patched.split('\n').find((candidate) => {
            return candidate.includes('debug)');
        }) as string;
        const statement = line.trim().replace(/^debug\) /, '').replace(/ ;;$/, '');
        const script = [assignment, 'links="1080 >' + VARIANT + '"', `video_link="${VARIANT}"`, 'sub_link=""', 'refr="https://embed.example/"', statement].join('\n');
        return parseStreamOutput(execFileSync('sh', ['-c', script], { encoding: 'utf-8' }));
    };

    it('hands the player the master when the audio patch kept it, so the audio tracks come with the picture', () => {
        expect(printedWith(`pullwave_audio_master="${MASTER}"`)).toEqual({ url: MASTER, subtitleUrl: null, referer: 'https://embed.example/', subtitles: [] });
    });

    it('hands the player the selected link when the master has no separate audio', () => {
        expect(printedWith('pullwave_audio_master=""')?.url).toBe(VARIANT);
    });

    it('hands the player the selected link when the script has no audio patch and does not set the variable', () => {
        expect(printedWith(':')?.url).toBe(VARIANT);
    });

    it('keeps the variant in the list of all links, which is what the quality choice reads', () => {
        const patched = patchDebugReferer(ORIGINAL) as string;
        expect(patched).toContain('"$links" "${pullwave_audio_master:-$video_link}"');
    });
});

describe('parseSubtitleList', () => {
    const LINK = 'https://hls.example.top/v/abc/1080/index.m3u8';
    const ENGLISH = '{"lang":"en","label":"English","src":"https://s.example/en.vtt","default":true}';
    const PORTUGUESE = '{"lang":"pt","label":"Portuguese - Brazil","src":"https://s.example/pt.vtt"}';
    const printed = (...subtitles: string[]): string => {
        return ['All links:', `1080 >${LINK}`, 'Selected link:', LINK, 'Subtitles:', 'https://s.example/en.vtt', 'Referer:', 'https://embed.example/', 'Subtitle list:', ...subtitles].join('\n');
    };

    it('reads every subtitle the source offers, with the referer', () => {
        expect(parseSubtitleList(printed(ENGLISH, PORTUGUESE))).toEqual({
            referer: 'https://embed.example/',
            subtitles: [
                { label: 'English', src: 'https://s.example/en.vtt' },
                { label: 'Portuguese - Brazil', src: 'https://s.example/pt.vtt' }
            ]
        });
    });

    it('reads a list whose fields come in another order', () => {
        expect(parseSubtitleList(printed('{"src":"https://s.example/es.vtt","default":false,"label":"Spanish"}')).subtitles).toEqual([{ label: 'Spanish', src: 'https://s.example/es.vtt' }]);
    });

    it('puts back the slashes the source escaped', () => {
        expect(parseSubtitleList(printed('{"label":"French","src":"https:\\/\\/s.example\\/fr.vtt"}')).subtitles).toEqual([{ label: 'French', src: 'https://s.example/fr.vtt' }]);
    });

    it('leaves out a line without a label, without an address or with an address that is not http(s)', () => {
        const lines = ['{"src":"https://s.example/a.vtt"}', '{"label":"No address"}', '{"label":"","src":"https://s.example/b.vtt"}', '{"label":"Local","src":"file:///etc/passwd"}', 'not json at all', ENGLISH];
        expect(parseSubtitleList(printed(...lines)).subtitles).toEqual([{ label: 'English', src: 'https://s.example/en.vtt' }]);
    });

    it('gives an empty list when none was printed, or when the script does not print the list at all', () => {
        expect(parseSubtitleList(printed()).subtitles).toEqual([]);
        expect(parseSubtitleList(['Selected link:', LINK, 'Subtitles:', 'Referer:', 'https://embed.example/'].join('\n'))).toEqual({ referer: 'https://embed.example/', subtitles: [] });
        expect(parseSubtitleList('')).toEqual({ referer: null, subtitles: [] });
    });

    it('does not take what comes before the marker for a subtitle, and ignores blank lines and spaces', () => {
        const output = `  ${ENGLISH}  \nSubtitle list:\n\n   ${PORTUGUESE}   \n`;
        expect(parseSubtitleList(output).subtitles).toEqual([{ label: 'Portuguese - Brazil', src: 'https://s.example/pt.vtt' }]);
    });

    it('does not mistake the list for a referer when the referer is empty', () => {
        const output = ['Selected link:', LINK, 'Subtitles:', 'Referer:', 'Subtitle list:', ENGLISH].join('\n');
        expect(parseSubtitleList(output)).toEqual({ referer: null, subtitles: [{ label: 'English', src: 'https://s.example/en.vtt' }] });
        expect(parseStreamOutput(output)).toEqual({ url: LINK, subtitleUrl: null, referer: null, subtitles: [{ label: 'English', src: 'https://s.example/en.vtt' }] });
    });
});

