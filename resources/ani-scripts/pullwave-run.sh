#!/bin/sh
pullwave_menu() {
    for prompt; do :; done
    while IFS= read -r line; do
        printf 'PULLWAVE_MENU\t%s\t%s\n' "$prompt" "$line" >&2
    done
    return 1
}

pullwave_noplayer() {
    return 0
}

tput() {
    return 0
}

PULLWAVE_DOWNLOAD_FAILED=PULLWAVE_DOWNLOAD_FAILED

pullwave_fetch() {
    yt-dlp --referer "$1" "$2" --no-skip-unavailable-fragments --fragment-retries infinite --retries 20 --retry-sleep http:exp=1:10 --retry-sleep fragment:exp=1:10 -N 16 -o "$3"
}

pullwave_part() {
    printf 'PULLWAVE_PART\t%s\tvideo,audio\n' "$1"
}

pullwave_join() {
    printf 'PULLWAVE_JOIN\n'
}

pullwave_download() {
    if [ -z "$3" ]; then
        pullwave_fetch "$1" "$2" "$4"
        return
    fi
    _pw_joined="$4.joined.mp4"
    if pullwave_part 0 && pullwave_fetch "$1" "$2" "$4.video.mp4" &&
        pullwave_part 1 && pullwave_fetch "$1" "$3" "$4.audio.mp4" &&
        pullwave_join && command ffmpeg -nostdin -y -loglevel error -i "$4.video.mp4" -i "$4.audio.mp4" -map 0:v:0 -map 1:a:0 -c copy -movflags +faststart -f mp4 "$_pw_joined" &&
        mv -f "$_pw_joined" "$4"; then
        rm -f "$4.video.mp4" "$4.audio.mp4"
        return 0
    fi
    rm -f "$_pw_joined"
    return 1
}

ffmpeg() {
    case " $* " in
        *" -stats "*) ;;
        *)
            command ffmpeg "$@"
            return
            ;;
    esac
    _pw_previous=""
    _pw_referer=""
    _pw_picture=""
    _pw_audio=""
    for _pw_argument; do
        case "$_pw_previous" in
            -referer) [ -z "$_pw_picture" ] && _pw_referer="$_pw_argument" ;;
            -i) if [ -z "$_pw_picture" ]; then _pw_picture="$_pw_argument"; else _pw_audio="$_pw_argument"; fi ;;
        esac
        _pw_previous="$_pw_argument"
    done
    if pullwave_download "$_pw_referer" "$_pw_picture" "$_pw_audio" "$_pw_previous"; then
        printf '[download] Destination: %s\n' "$_pw_previous"
        return 0
    fi
    printf '%s\n' "$PULLWAVE_DOWNLOAD_FAILED" >&2
    return 1
}

script="$1"
shift
. "$script"
