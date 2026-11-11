#!/bin/sh
version_number="0.0.0-fake"
# Stands in for ani-cli in the end-to-end tests. It is run by the busybox that ships with the app, with the same PATH,
# menu program and environment ani-cli would get.
#   search:    <words>                       lists "1 Fake Anime" and "2 Fake Anime 2" (words with "zzz": nothing found; with "turtle": two seconds before it answers, here and in the episodes;
#                                            with "twin": two anime with the same title that only differ by the id the source gives them, as the patched ani-cli lists them,
#                                            "1 pwid:twin-anime-10 Twin Anime" and "2 pwid:twin-anime-season-2-11 Twin Anime", the first with 3 episodes and the second with 2)
#                                            with "many": 70 results and with "endless": 300, "Many Anime 1" and so on, as the source gives them: 30 to a page, and as many pages as
#                                            PULLWAVE_SEARCH_MIN asks for (the number of results to read at least); when there are more pages it says so on stderr
#   episodes:  -S <n> <words>                lists episodes 1 to 3, or 1 to 4 once a test wrote more-episodes in the history folder (words with "single": the one episode is picked silently)
#   stream:    -S <n> -e <ep> -q <q> ...     (with the debug player) prints the address of the episode, the subtitle and the list of subtitles
#   download:  -d -S <n> -e <ep> -q <q> ...  writes "<title> Episode <ep>.mp4" and ".vtt" (words with "fail": no sources, "slow": five seconds before the file exists,
#                                            "flaky": a connection error the first time each episode is asked for, and the video the next time;
#                                            when a test wrote download-subtitle in the history folder, its text is also saved as a subtitle of the source,
#                                            English unless download-subtitle-label holds another label, written in the file name as the patch writes it)
# Every call is appended to $ANI_CLI_HIST_DIR/calls.log as "<mode> | <arguments>", and the subtitle languages it was
# asked to try to subtitle-labels.log.
mkdir -p "$ANI_CLI_HIST_DIR"
printf '%s | %s\n' "$ANI_CLI_MODE" "$*" >> "$ANI_CLI_HIST_DIR/calls.log"
printf '%s\n' "$PULLWAVE_SUB_LABELS" >> "$ANI_CLI_HIST_DIR/subtitle-labels.log"
printf '%s\n' "$ANI_CLI_PLAYER" >> "$ANI_CLI_HIST_DIR/players.log"
# The least number of results it was asked to read (PULLWAVE_SEARCH_MIN, "-" when none), with the arguments of the call.
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
            # The first call of each episode fails like a connection that dropped; the next ones work.
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
    printf '[download] Destination: %s\n' "$file"
    printf '[download]  25.0%% of ~  19.00B at  1.00MiB/s ETA 00:01 (frag 1/4)\n'
    # A "slow" download takes long enough to be cancelled; its file only exists if nobody ended it.
    case "$query" in
        *slow*) printf 'unfinished' > "$file.part"; sleep 5 ;;
    esac
    printf '[download] 100%% of   19.00B in 00:00:01 at 1.00MiB/s\n'
    # A test can give the file the source would write: the one named in hidden-video is copied as the episode (a video behind pictures).
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
    fi
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

# A "turtle" search and a "turtle" list of episodes take two seconds to answer (to have a look for new episodes that lasts).
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
    # The source has only one anime for the words searched: the script of the app lists it, with its own title (the title is not the words).
    *loneshown*)
        printf '1 pwid:picked-anime-12 Picked Anime\n' | "$ANI_CLI_MENU" 'Select anime: '
        exit 1
        ;;
    # The same, with a script the change of the app does not fit: ani-cli picks the anime itself and lists only its episodes.
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
