#!/bin/sh
version_number="0.0.0-fake"
# Stands in for ani-cli in the end-to-end tests. It is run by the busybox that ships with the app, with the same PATH,
# menu program and environment ani-cli would get.
#   search:    <words>                       lists "1 Fake Anime" and "2 Fake Anime 2" (words with "zzz": nothing found)
#   episodes:  -S <n> <words>                lists episodes 1 to 3, or 1 to 4 once a test wrote more-episodes in the history folder (words with "single": the one episode is picked silently)
#   stream:    -S <n> -e <ep> -q <q> ...     (with the debug player) prints the address of the episode, the subtitle and the list of subtitles
#   download:  -d -S <n> -e <ep> -q <q> ...  writes "<title> Episode <ep>.mp4" and ".vtt" (words with "fail": no sources, "slow": five seconds before the file exists)
# Every call is appended to $ANI_CLI_HIST_DIR/calls.log as "<mode> | <arguments>", and the subtitle languages it was
# asked to try to subtitle-labels.log.
mkdir -p "$ANI_CLI_HIST_DIR"
printf '%s | %s\n' "$ANI_CLI_MODE" "$*" >> "$ANI_CLI_HIST_DIR/calls.log"
printf '%s\n' "$PULLWAVE_SUB_LABELS" >> "$ANI_CLI_HIST_DIR/subtitle-labels.log"
printf '%s\n' "$ANI_CLI_PLAYER" >> "$ANI_CLI_HIST_DIR/players.log"

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

case "$query" in
    *zzz*)
        printf '\033[2K\r\033[1;31mNo results found!\033[0m\n' >&2
        exit 1
        ;;
esac

if [ "$download" = 1 ]; then
    case "$query" in
        *fail*)
            printf '\033[2K\r\033[1;31mNo sources found for %s!\033[0m\n' "$ANI_CLI_MODE" >&2
            exit 1
            ;;
    esac
    title="Fake Anime"
    [ "$index" = 2 ] && title="Fake Anime 2"
    file="$ANI_CLI_DOWNLOAD_DIR/$title Episode $episode.mp4"
    printf '[download] Destination: %s\n' "$file"
    printf '[download]  25.0%% of ~  19.00B at  1.00MiB/s ETA 00:01 (frag 1/4)\n'
    # A "slow" download takes long enough to be cancelled; its file only exists if nobody ended it.
    case "$query" in
        *slow*) printf 'unfinished' > "$file.part"; sleep 5 ;;
    esac
    printf '[download] 100%% of   19.00B in 00:00:01 at 1.00MiB/s\n'
    printf 'FAKEVIDEO0123456789' > "$file"
    rm -f "$file.part"
    printf 'WEBVTT\n' > "$ANI_CLI_DOWNLOAD_DIR/$title Episode $episode.vtt"
    exit 0
fi

# With the debug player ani-cli prints the address of the episode instead of playing it. The address (and the subtitles) are
# the ones the test wrote to stream-url and stream-subtitles in the history folder.
if [ "$ANI_CLI_PLAYER" = debug ] && [ -n "$index" ] && [ -n "$episode" ]; then
    case "$query" in
        *nosource*)
            printf '\033[2K\r\033[1;31mNo sources found for %s!\033[0m\n' "$ANI_CLI_MODE" >&2
            exit 1
            ;;
    esac
    url="$(cat "$ANI_CLI_HIST_DIR/stream-url")"
    subtitles="$(cat "$ANI_CLI_HIST_DIR/stream-subtitles" 2>/dev/null)"
    # Every subtitle the source offers, one per line as it writes them (the patched ani-cli prints them after the referer).
    list="$(cat "$ANI_CLI_HIST_DIR/stream-subtitle-list" 2>/dev/null)"
    printf 'All links:\n1080 >%s\nSelected link:\n%s\nSubtitles:\n%s\nReferer:\nhttps://embed.example/\nSubtitle list:\n%s\n' "$url" "$url" "$subtitles" "$list"
    exit 0
fi

if [ -n "$index" ]; then
    case "$query" in
        *single*) exit 0 ;;
    esac
    if [ -f "$ANI_CLI_HIST_DIR/more-episodes" ]; then
        printf '1\n2\n3\n4\n' | "$ANI_CLI_MENU" 'Select episode: '
        exit 1
    fi
    printf '1\n2\n3\n' | "$ANI_CLI_MENU" 'Select episode: '
    exit 1
fi

printf '1 Fake Anime\n2 Fake Anime 2\n' | "$ANI_CLI_MENU" 'Select anime: '
exit 1
