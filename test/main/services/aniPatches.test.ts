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
        expect(patchReport(`${SUBTITLES}\n${ALL_SUBTITLES}\n${DEBUG}`)).toEqual({ subtitleSelection: true, allSubtitles: true, debugReferer: true });
    });

    it('says the choice of the subtitle language does not fit when that line changed, and the others still do', () => {
        const changed = SUBTITLES.replace('s|}\\].*||', 's|\\].*||');
        expect(changed).not.toBe(SUBTITLES);
        expect(patchReport(`${changed}\n${ALL_SUBTITLES}\n${DEBUG}`)).toEqual({ subtitleSelection: false, allSubtitles: true, debugReferer: true });
    });

    it('says the saving of every subtitle does not fit without its two lines or without the function it hooks into', () => {
        expect(patchReport(`${SUBTITLES}\n${DEBUG}`)).toEqual({ subtitleSelection: true, allSubtitles: false, debugReferer: true });
        expect(patchReport(`${ALL_SUBTITLES}\n${DEBUG}`)).toEqual({ subtitleSelection: false, allSubtitles: false, debugReferer: true });
    });

    it('says the address of the stream does not fit when its line changed', () => {
        expect(patchReport(`${SUBTITLES}\n${ALL_SUBTITLES}\n${DEBUG.replace('Subtitles:', 'Subs:')}`)).toEqual({ subtitleSelection: true, allSubtitles: true, debugReferer: false });
    });

    it('says none of them fit a script it knows nothing about, even an empty one', () => {
        expect(patchReport('a different script')).toEqual({ subtitleSelection: false, allSubtitles: false, debugReferer: false });
        expect(patchReport('')).toEqual({ subtitleSelection: false, allSubtitles: false, debugReferer: false });
    });

    it('agrees with what patchAniCli does: it gives null exactly when none fit', () => {
        ['', SUBTITLES, ALL_SUBTITLES, DEBUG, `${SUBTITLES}\n${DEBUG}`].forEach((script) => {
            const report = patchReport(script);
            expect(patchAniCli(script) === null).toBe(!report.subtitleSelection && !report.allSubtitles && !report.debugReferer);
        });
    });
});

describe('REQUIRED_PATCHES', () => {
    it('is only the address of the stream: without it the app cannot play or download an episode', () => {
        expect(REQUIRED_PATCHES).toEqual(['debugReferer']);
    });
});
