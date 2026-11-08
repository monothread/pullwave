// ani-cli reads only the first page of the search of the source (about thirty results); the ones after it never show. This lets the search go
// on to the next pages: with PULLWAVE_SEARCH_MIN=N in the environment it reads page after page until it has N results, until a page has no
// result, or until there is no page after it (at most MAX_SEARCH_PAGES, whatever N is). The results of every page are one list, so the
// position of a result (which is what `-S` takes) is the same in the search that lists them and in the ones that open one of them. Without the
// variable it reads the first page only, as before. When there is a page after the last one it read, it says so on stderr
// (SEARCH_MORE_MARKER), which is how the app knows the list can grow.
export const SEARCH_MIN_VARIABLE = 'PULLWAVE_SEARCH_MIN';
export const SEARCH_MORE_MARKER = 'PULLWAVE_SEARCH_MORE';
// A search that matches almost everything ("a") never makes ani-cli read more pages than this.
export const MAX_SEARCH_PAGES = 20;

// The search of the script as ani-cli has it: the part the change looks for.
export const ORIGINAL_SEARCH = `hianime_search() {
    #shellcheck disable=SC2059
    _page="$(hianime_curl "$(printf "$search_api" "$1")")" || return 1
    if printf "%s" "$_page" | grep -qi "<title>Just a moment"; then
        [ "$curl_exe" = "curl" ] && die "Blocked by cloudflare. Try installing curl-impersonate"
        die "Blocked by cloudflare."
    fi
    # the top 10 sidebar repeats the result markup, cut it off before flattening the page
    printf "%s" "$_page" | sed '/id="main-sidebar"/,$d' | tr '\\n' ' ' | sed 's|<div class="film-detail">|\\n<div class="film-detail">|g' |
        sed -nE 's|.*<h3 class="film-name">[[:space:]]*<a href="[^"]*/([^"/]*)"[[:space:]]*title="([^"]*)".*|\\1\\t\\2|p' |
        sed -e "s|&#039;|'|g" -e 's|&quot;|"|g' -e "s|&amp;|\\&|g"
}`;

export const PATCHED_SEARCH = `# Added by Pullwave: reads page $2 (the first one when it is not given) of the search for $1 into _page.
hianime_search_fetch() {
    #shellcheck disable=SC2059
    _page="$(hianime_curl "$(printf "$search_api" "$1")\${2:+&page=$2}")" || return 1
    if printf "%s" "$_page" | grep -qi "<title>Just a moment"; then
        [ "$curl_exe" = "curl" ] && die "Blocked by cloudflare. Try installing curl-impersonate"
        die "Blocked by cloudflare."
    fi
}

# The results of the page in _page, one per line.
hianime_search_results() {
    # the top 10 sidebar repeats the result markup, cut it off before flattening the page
    printf "%s" "$_page" | sed '/id="main-sidebar"/,$d' | tr '\\n' ' ' | sed 's|<div class="film-detail">|\\n<div class="film-detail">|g' |
        sed -nE 's|.*<h3 class="film-name">[[:space:]]*<a href="[^"]*/([^"/]*)"[[:space:]]*title="([^"]*)".*|\\1\\t\\2|p' |
        sed -e "s|&#039;|'|g" -e 's|&quot;|"|g' -e "s|&amp;|\\&|g"
}

# Whether the pagination of the page in _page links to page $1.
hianime_search_has_page() {
    printf "%s" "$_page" | tr '\\n' ' ' | sed -n 's|.*<ul class="pagination[^>]*>\\(.*\\)|\\1|p' | sed 's|</ul>.*||' | grep -q "page=$1\\""
}

hianime_search() {
    hianime_search_fetch "$1" || return 1
    if [ -z "\${${SEARCH_MIN_VARIABLE}:-}" ]; then
        hianime_search_results
        return
    fi
    _pw_page=1
    _pw_total=0
    while :; do
        _pw_found="$(hianime_search_results)"
        [ -z "$_pw_found" ] && break
        printf "%s\\n" "$_pw_found"
        _pw_total=$((_pw_total + $(printf "%s\\n" "$_pw_found" | wc -l | tr -d '[:space:]')))
        hianime_search_has_page $((_pw_page + 1)) || break
        if [ "$_pw_total" -ge "$${SEARCH_MIN_VARIABLE}" ] || [ "$_pw_page" -ge ${MAX_SEARCH_PAGES} ]; then
            printf "${SEARCH_MORE_MARKER}\\n" >&2
            break
        fi
        _pw_page=$((_pw_page + 1))
        hianime_search_fetch "$1" "$_pw_page" || return 1
    done
}`;

// The script with the search that goes on to the next pages, or null when this is not a version it knows how to change.
export function patchSearchPages(source: string): string | null {
    return source.includes(ORIGINAL_SEARCH) ? source.replace(ORIGINAL_SEARCH, () => {
        return PATCHED_SEARCH;
    }) : null;
}
