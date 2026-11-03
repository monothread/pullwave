#!/bin/sh
version_number="0.0.0-screenshots"
# Stands in for ani-cli in the screenshots, run by the busybox that comes with the app. The anime it knows are the lines "<n> <title>" of
# the file @ANIME_LIST@, every one with @EPISODES@ episodes; a download copies the file @VIDEO@ as the episode, and the stream is the
# address the file stream-url (in the history folder) holds.
mkdir -p "$ANI_CLI_HIST_DIR"

download=0
index=""
episode=""
query=""
while [ $# -gt 0 ]; do
    case "$1" in
        -d) download=1 ;;
        -S) index="$2"; shift ;;
        -e) episode="$2"; shift ;;
        -q) shift ;;
        *) query="$query $1" ;;
    esac
    shift
done

title_of() {
    sed -n "${1}p" "@ANIME_LIST@" | cut -d' ' -f2-
}

if [ "$download" = 1 ]; then
    file="$ANI_CLI_DOWNLOAD_DIR/$(title_of "$index") Episode $episode.mp4"
    printf '[download] Destination: %s\n' "$file"
    printf '[download]  25.0%% of ~  19.00B at  1.00MiB/s ETA 00:01 (frag 1/4)\n'
    cp "@VIDEO@" "$file"
    printf '[download] 100%% of   19.00B in 00:00:01 at 1.00MiB/s\n'
    printf 'WEBVTT\n\n00:00:01.000 --> 00:00:05.000\nThe harbor lights wake up one by one.\n\n00:00:06.000 --> 00:00:10.000\nSomeone is waiting at the last pier.\n' > "$ANI_CLI_DOWNLOAD_DIR/$(title_of "$index") Episode $episode.vtt"
    exit 0
fi

if [ "$ANI_CLI_PLAYER" = debug ] && [ -n "$index" ] && [ -n "$episode" ]; then
    url="$(cat "$ANI_CLI_HIST_DIR/stream-url")"
    printf 'All links:\n1080 >%s\nSelected link:\n%s\nSubtitles:\n\nReferer:\nhttps://embed.example/\nSubtitle list:\n\n' "$url" "$url"
    exit 0
fi

if [ -n "$index" ]; then
    number=1
    while [ "$number" -le @EPISODES@ ]; do
        printf '%s\n' "$number"
        number=$((number + 1))
    done | "$ANI_CLI_MENU" 'Select episode: '
    exit 1
fi

# The source lists the anime it has, whatever the words are.
"$ANI_CLI_MENU" 'Select anime: ' < "@ANIME_LIST@"
exit 1
