#!/bin/sh
version_number="0.0.0-fake"
mkdir -p "$ANI_CLI_HIST_DIR"
printf '%s | %s\n' "$ANI_CLI_MODE" "$*" >> "$ANI_CLI_HIST_DIR/calls.log"
printf '%s\n' "$PULLWAVE_SUB_LABELS" >> "$ANI_CLI_HIST_DIR/subtitle-labels.log"
printf '%s\n' "$ANI_CLI_PLAYER" >> "$ANI_CLI_HIST_DIR/players.log"
printf '%s | %s\n' "${PULLWAVE_SEARCH_MIN:--}" "$*" >> "$ANI_CLI_HIST_DIR/search-min.log"

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
    case "$query" in
        *flaky*)
            marker="$ANI_CLI_HIST_DIR/flaky-$index-$episode"
            if [ ! -f "$marker" ]; then
                : > "$marker"
                printf '\033[2K\r\033[1;31mConnection error: could not resolve host\033[0m\n' >&2
                exit 1
            fi
            ;;
    esac
    title="Fake Anime"
    [ "$index" = 2 ] && title="Fake Anime 2"
    file="$ANI_CLI_DOWNLOAD_DIR/$title Episode $episode.mp4"
    case "$query" in
        *split*)
            printf 'PULLWAVE_PART\t0\tvideo,audio\n'
            printf '[download] Destination: %s\n' "$file.video.mp4"
            printf '[download]  40.0%% of ~  19.00B at  1.00MiB/s ETA 00:01 (frag 2/5)\n'
            sleep 3
            printf '[download] 100%% of   19.00B in 00:00:01 at 1.00MiB/s\n'
            printf 'PULLWAVE_PART\t1\tvideo,audio\n'
            printf '[download] Destination: %s\n' "$file.audio.mp4"
            printf '[download]  30.0%% of ~  10.00B at  1.00MiB/s ETA 00:01 (frag 3/10)\n'
            sleep 3
            printf '[download] 100%% of   10.00B in 00:00:01 at 1.00MiB/s\n'
            printf 'PULLWAVE_JOIN\n'
            sleep 4
            printf '[download] Destination: %s\n' "$file"
            ;;
        *)
            printf '[download] Destination: %s\n' "$file"
            printf '[download]  25.0%% of ~  19.00B at  1.00MiB/s ETA 00:01 (frag 1/4)\n'
            case "$query" in
                *slow*) printf 'unfinished' > "$file.part"; sleep 5 ;;
            esac
            printf '[download] 100%% of   19.00B in 00:00:01 at 1.00MiB/s\n'
            ;;
    esac
    if [ -f "$ANI_CLI_HIST_DIR/hidden-video" ]; then
        cp "$(cat "$ANI_CLI_HIST_DIR/hidden-video")" "$file"
    else
        printf 'FAKEVIDEO0123456789' > "$file"
    fi
    rm -f "$file.part"
    printf 'WEBVTT\n' > "$ANI_CLI_DOWNLOAD_DIR/$title Episode $episode.vtt"
    if [ -f "$ANI_CLI_HIST_DIR/download-subtitle" ]; then
        label="English"
        [ -f "$ANI_CLI_HIST_DIR/download-subtitle-label" ] && label="$(cat "$ANI_CLI_HIST_DIR/download-subtitle-label" | sed 's|[^A-Za-z0-9 ._()-]|_|g')"
        cp "$ANI_CLI_HIST_DIR/download-subtitle" "$ANI_CLI_DOWNLOAD_DIR/$title Episode $episode.subtitle-$label.vtt"
        [ -f "$ANI_CLI_HIST_DIR/download-subtitle-is-default" ] && cp "$ANI_CLI_HIST_DIR/download-subtitle" "$ANI_CLI_DOWNLOAD_DIR/$title Episode $episode.vtt"
    fi
    exit 0
fi

if [ "$ANI_CLI_PLAYER" = debug ] && [ -n "$index" ] && [ -n "$episode" ]; then
    case "$query" in
        *nosource*)
            printf '\033[2K\r\033[1;31mNo sources found for %s!\033[0m\n' "$ANI_CLI_MODE" >&2
            exit 1
            ;;
    esac
    url="$(cat "$ANI_CLI_HIST_DIR/stream-url")"
    subtitles="$(cat "$ANI_CLI_HIST_DIR/stream-subtitles" 2>/dev/null)"
    list="$(cat "$ANI_CLI_HIST_DIR/stream-subtitle-list" 2>/dev/null)"
    printf 'All links:\n1080 >%s\nSelected link:\n%s\nSubtitles:\n%s\nReferer:\nhttps://embed.example/\nSubtitle list:\n%s\n' "$url" "$url" "$subtitles" "$list"
    exit 0
fi

case "$query" in
    *turtle*) sleep 2 ;;
esac

if [ -n "$index" ]; then
    case "$query" in
        *single*) exit 0 ;;
        *twin*)
            if [ "$index" = 2 ]; then printf '1\n2\n' | "$ANI_CLI_MENU" 'Select episode: '; else printf '1\n2\n3\n' | "$ANI_CLI_MENU" 'Select episode: '; fi
            exit 1
            ;;
    esac
    if [ -f "$ANI_CLI_HIST_DIR/more-episodes" ]; then
        printf '1\n2\n3\n4\n' | "$ANI_CLI_MENU" 'Select episode: '
        exit 1
    fi
    printf '1\n2\n3\n' | "$ANI_CLI_MENU" 'Select episode: '
    exit 1
fi

case "$query" in
    *many*|*endless*)
        total=70
        case "$query" in *endless*) total=300 ;; esac
        listed=$(( ( ${PULLWAVE_SEARCH_MIN:-1} + 29 ) / 30 * 30 ))
        [ "$listed" -gt "$total" ] && listed=$total
        n=1
        while [ "$n" -le "$listed" ]; do
            printf '%s Many Anime %s\n' "$n" "$n"
            n=$((n + 1))
        done | "$ANI_CLI_MENU" 'Select anime: '
        [ "$listed" -lt "$total" ] && printf 'PULLWAVE_SEARCH_MORE\n' >&2
        exit 1
        ;;
    *loneshown*)
        printf '1 pwid:picked-anime-12 Picked Anime\n' | "$ANI_CLI_MENU" 'Select anime: '
        exit 1
        ;;
    *loneunlisted*)
        printf '1\n2\n3\n' | "$ANI_CLI_MENU" 'Select episode: '
        exit 1
        ;;
    *twin*)
        printf '1 pwid:twin-anime-10 Twin Anime\n2 pwid:twin-anime-season-2-11 Twin Anime\n' | "$ANI_CLI_MENU" 'Select anime: '
        exit 1
        ;;
esac

printf '1 Fake Anime\n2 Fake Anime 2\n' | "$ANI_CLI_MENU" 'Select anime: '
exit 1
