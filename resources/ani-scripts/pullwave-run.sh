#!/bin/sh
# Runs ani-cli with stand-ins for what it expects to find on a desktop: a menu program, a player and tput. They are shell
# functions instead of files, so nothing has to be on PATH or executable, which is what makes this work the same under
# BusyBox on Linux and on Windows.
#
#   busybox sh pullwave-run.sh <path of ani-cli> [ani-cli arguments...]
#
# pullwave_menu: ani-cli hands the choices to its menu program on stdin, one per line, with the prompt as the last
# argument. Each choice is reported on stderr (ani-cli captures stdout, not stderr) as PULLWAVE_MENU<TAB>prompt<TAB>line,
# and the function fails so ani-cli stops right after listing.
pullwave_menu() {
    for prompt; do :; done
    while IFS= read -r line; do
        printf 'PULLWAVE_MENU\t%s\t%s\n' "$prompt" "$line" >&2
    done
    return 1
}

# ani-cli refuses to start without a player (mpv or vlc), even to download. Pullwave never plays through it.
pullwave_noplayer() {
    return 0
}

# ani-cli moves the cursor with tput for cosmetic reasons; there is no terminal here.
tput() {
    return 0
}

# ani-cli downloads with ffmpeg the episodes whose audio is a track of its own: ffmpeg ... -stats -i <picture> -i <audio> ... <file>. ffmpeg
# cannot go on with a file a download left half way (it asks whether to overwrite it, and waits), leaves out a piece of the stream that keeps
# failing, and says neither where the file goes nor how far it is. So that download (the call with -stats) is done the way the app always did
# it: yt-dlp downloads the picture and the audio, each to a file of its own (it goes on from where a download stopped, asks again for a piece
# that fails as often as it takes and never leaves one out, and shows its progress), and ffmpeg only joins the two. The file of the episode is
# printed as yt-dlp prints it ("[download] Destination: <file>", the last line of the kind) once it is complete. When anything fails nothing
# takes the place of the file, the pieces stay for the next try, and PULLWAVE_DOWNLOAD_FAILED is printed: ani-cli ends well whatever its
# download did, so that line is how the app knows. Every other call of ffmpeg is left as it is.
PULLWAVE_DOWNLOAD_FAILED=PULLWAVE_DOWNLOAD_FAILED

# $1 = the site the stream expects the request from, $2 = the address, $3 = the file. A request the server refuses is asked again after a
# pause that grows (1 s, 2 s, 4 s... up to 10 s, at most 20 times), so a hiccup of the server does not end the download; one that goes on
# for longer ends it, and the queue of the app tries again from where it stopped.
pullwave_fetch() {
    yt-dlp --referer "$1" "$2" --no-skip-unavailable-fragments --fragment-retries infinite --retries 20 --retry-sleep http:exp=1:10 --retry-sleep fragment:exp=1:10 -N 16 -o "$3"
}

# Before each part of an episode whose picture and audio come apart, the app is told which part starts (from 0) and which parts the episode
# has, so it shows a bar for each one: PULLWAVE_PART<TAB>index<TAB>video,audio. It goes to stdout, where yt-dlp writes its progress, so the
# app reads it before the first line of progress of that part.
pullwave_part() {
    printf 'PULLWAVE_PART\t%s\tvideo,audio\n' "$1"
}

# Once the two parts are downloaded, before ffmpeg joins them, the app is told so (PULLWAVE_JOIN on stdout): it joins the two bars into one and
# shows the step that goes on.
pullwave_join() {
    printf 'PULLWAVE_JOIN\n'
}

# $1 = the referer, $2 = the picture, $3 = the audio (empty when it comes with the picture), $4 = the file of the episode.
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
