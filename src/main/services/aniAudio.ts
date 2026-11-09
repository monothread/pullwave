// Some sources give the audio of an episode as tracks of their own: the master playlist lists them (#EXT-X-MEDIA:TYPE=AUDIO) and each picture
// (a variant, like .../1080/index.m3u8) points at them. ani-cli reads the list of qualities from the master and hands yt-dlp the address of one
// variant, which has the picture only: the episode is downloaded with no sound. This keeps the master when it has such tracks, and once the picture is
// downloaded (as it always was) it downloads the audio track of the language from the master (Japanese for the subtitled, English for the dubbed, the
// first one there is when the source has no track of that language) and joins the two with ffmpeg. yt-dlp is not left to join them: the pictures of such
// a master have an unknown codec, so it takes them for pictures that already have their sound and asks ffmpeg for an audio stream the file does not have.
// When the audio cannot be had the episode stays as it was, with the picture only. The app finds the file of the episode in the last "Destination" line that
// yt-dlp printed, so the script prints one for the file of the episode when it is done. When the master gives no separate audio nothing changes.
// The same master is what the stream of the app is given (see the debug output in aniStream.ts), so streamed episodes have their sound too.

// Where ani-cli reads the master playlist (the start of the line that builds the list of qualities).
export const ORIGINAL_MASTER_FETCH = 'links="$(hianime_curl "$_m3u8_master" -e "$refr" | ';
// The command that downloads with yt-dlp, up to what it does when it worked.
export const ORIGINAL_YTDLP = 'command -v "yt-dlp" >/dev/null && yt-dlp --referer "$refr" "$1" --no-skip-unavailable-fragments --fragment-retries infinite -N 16 -o "$download_dir/$_name.mp4" $3 && return 0';
// What it does as it was: the part that comes before `return 0`.
const ORIGINAL_YTDLP_START = ORIGINAL_YTDLP.slice(0, ORIGINAL_YTDLP.length - ' && return 0'.length);

// The master is read once, kept to look for audio tracks, and the list of qualities is made from it as before.
const PATCHED_MASTER_FETCH = [
    '_pullwave_master="$(hianime_curl "$_m3u8_master" -e "$refr")"',
    '    # Added by Pullwave: the address of the master when the audio is a track of its own (the address of a variant has the picture only).',
    '    pullwave_audio_master=""',
    `    printf "%s" "$_pullwave_master" | grep -q 'TYPE=AUDIO' && pullwave_audio_master="$_m3u8_master"`,
    '    links="$(printf "%s\\n" "$_pullwave_master" | '
].join('\n');

// Once the picture is downloaded: with a master that has audio tracks, the track of the language is downloaded (the first one when there is none of the
// language) and joined to the picture. The joined file takes the place of the picture only when everything worked; the temporary files always go.
const PATCHED_YTDLP = [
    `${ORIGINAL_YTDLP_START} && {`,
    '        # Added by Pullwave: the master has the audio as tracks of their own, which the picture downloaded above has not; they are joined here.',
    '        if [ -n "${pullwave_audio_master:-}" ]; then',
    '            case "$mode" in dub) _pullwave_lang=en ;; *) _pullwave_lang=ja ;; esac',
    '            _pullwave_audio="$download_dir/$_name.audio.mp4"',
    '            _pullwave_joined="$download_dir/$_name.joined.mp4"',
    '            if yt-dlp --referer "$refr" "$pullwave_audio_master" -f "ba[language=${_pullwave_lang}]/ba" --fragment-retries infinite -N 16 -o "$_pullwave_audio" \\',
    '                && ffmpeg -y -loglevel error -i "$download_dir/$_name.mp4" -i "$_pullwave_audio" -c copy -map 0:v:0 -map 1:a:0 -movflags +faststart -f mp4 "$_pullwave_joined"; then',
    '                mv "$_pullwave_joined" "$download_dir/$_name.mp4"',
    '            fi',
    '            rm -f "$_pullwave_audio" "$_pullwave_joined"',
    '            # The app takes the file of the episode from the last "Destination" line of the output: the last one now is the audio track, which is gone.',
    "            printf '[download] Destination: %s\\n' \"$download_dir/$_name.mp4\"",
    '        fi',
    '        return 0',
    '    }'
].join('\n');

// The script with the audio tracks of the master kept and joined to the picture, or null when this is not a version it knows how to change. Both
// places have to be there: one without the other would do nothing.
export function patchSeparateAudio(source: string): string | null {
    if (!source.includes(ORIGINAL_MASTER_FETCH) || !source.includes(ORIGINAL_YTDLP)) {
        return null;
    }
    return source
        .replace(ORIGINAL_MASTER_FETCH, () => {
            return PATCHED_MASTER_FETCH;
        })
        .replace(ORIGINAL_YTDLP, () => {
            return PATCHED_YTDLP;
        });
}
