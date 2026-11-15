export const SEARCH_MIN_VARIABLE = 'PULLWAVE_SEARCH_MIN';
export const SEARCH_MORE_MARKER = 'PULLWAVE_SEARCH_MORE';
export const MAX_SEARCH_PAGES = 20;
export const SEARCH_PAGES_NEEDS = ['hianime_curl', 'search_api', 'curl_exe', 'die'] as const;

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

export function patchSearchPages(source: string): string | null {
    return source.includes(ORIGINAL_SEARCH) ? source.replace(ORIGINAL_SEARCH, () => {
        return PATCHED_SEARCH;
    }) : null;
}
