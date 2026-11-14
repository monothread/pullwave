import { MAX_SEARCH_RESULTS, type AniCliInfo, type AniRunResult, type AnimeSearchListing, type AnimeSearchResult } from '@shared/anime';
import type { ResolvedBinary } from './binaryResolver';
import { AniCliLocator, type AniTools } from './aniCliLocator';
import {
    buildDownloadArgs,
    buildEpisodesArgs,
    buildSearchArgs,
    sanitizeQuery,
    validateDownloadRequest,
    type AniDownloadRequest
} from './aniArgsBuilder';
import { buildStreamArgs, parseStreamOutput, parseSubtitleList, type ResolvedStream, type ResolvedSubtitles } from './aniStream';
import { tellResultsApart } from '@shared/animeSource';
import { ANIME_PROMPT, EPISODE_PROMPT, mapAniError, parseAnimeChoice } from './aniOutputParser';
import { asDownloadResult, runAniCli, type AniRunHandle, type AniRunOptions, type AniRunOutcome, type MenuChoice } from './aniCliRunner';

export interface AniServiceDependencies {
    locator: AniCliLocator;
    // The ani-cli path chosen in the settings ("" for the one that ships with the app).
    customScriptPath: () => string;
    tools: () => AniTools;
    // The languages of the subtitles to try, in order; none leaves the choice to ani-cli.
    subtitleLabels?: () => readonly string[];
    run?: (options: AniRunOptions) => AniRunHandle;
}

export interface AniDownloadOptions extends AniDownloadRequest {
    downloadDir: string;
    onProgress?: AniRunOptions['onProgress'];
    onPart?: AniRunOptions['onPart'];
    onJoin?: AniRunOptions['onJoin'];
    onDestination?: AniRunOptions['onDestination'];
}

export type AniStreamOptions = AniDownloadRequest;

export interface AniDownloadHandle {
    result: Promise<AniRunResult<{ filePath: string | null }>>;
    cancel: () => void;
}

function doNothing(): void {
    return undefined;
}

const SINGLE_EPISODE = '1';
const FIRST_RESULT = 1;
const MISSING_SCRIPT = 'ani-cli is not installed.';

function choicesFor(outcome: AniRunOutcome, prompt: string): string[] {
    return outcome.menuChoices
        .filter((entry: MenuChoice) => {
            return entry.prompt === prompt;
        })
        .map((entry) => {
            return entry.choice;
        });
}

// The part of the results the screen can list: no more than MAX_SEARCH_RESULTS, and what is left out says the list is limited (not that the
// source has no more).
function listingOf(results: AnimeSearchResult[], moreResults: boolean): AnimeSearchListing {
    const limited = results.length > MAX_SEARCH_RESULTS || (results.length === MAX_SEARCH_RESULTS && moreResults);
    return { results: results.slice(0, MAX_SEARCH_RESULTS), hasNextPage: moreResults && !limited, limited };
}

function failure<T>(raw: string): AniRunResult<T> {
    return { status: 'error', error: { code: 'UNKNOWN', raw } };
}

export class AniCliService {
    private readonly run: (options: AniRunOptions) => AniRunHandle;

    constructor(private readonly deps: AniServiceDependencies) {
        this.run = deps.run ?? runAniCli;
    }

    // Which ani-cli is in use and its version.
    info(): AniCliInfo {
        return this.deps.locator.info(this.deps.customScriptPath());
    }

    // Whether the copy of ani-cli to use exists.
    isAvailable(): boolean {
        return this.deps.locator.isReady(this.deps.customScriptPath());
    }

    private start(args: string[], downloadDir: string, extra: Partial<AniRunOptions> = {}, player?: string, searchMin?: number): AniRunHandle | null {
        const script: ResolvedBinary | null = this.deps.locator.script(this.deps.customScriptPath());
        if (script === null) {
            return null;
        }
        const tools = this.deps.tools();
        this.deps.locator.prepareTools(tools);
        const command = this.deps.locator.command(this.deps.locator.withPatches(script));
        return this.run({
            binary: command.binary,
            args: [...command.args, ...args],
            env: this.deps.locator.env({ downloadDir, subtitleLabels: this.deps.subtitleLabels?.() ?? [], player, tools, searchMin }),
            ...extra
        });
    }

    // The site ani-cli reads the anime from, as the last run found it.
    get provider(): string | null {
        return this.deps.locator.provider;
    }

    // The results of the search from the first one up to at least the position `atLeast` (the source gives them a page at a time, and the
    // positions are the ones ani-cli takes to open an anime), never more than MAX_SEARCH_RESULTS.
    async search(query: string, atLeast = FIRST_RESULT): Promise<AniRunResult<AnimeSearchResult[]>> {
        const listing = await this.searchListing(query, atLeast);
        return listing.status === 'done' ? { status: 'done', value: listing.value.results } : listing;
    }

    // The same, with whether the source has more results after the ones listed.
    async searchListing(query: string, atLeast = FIRST_RESULT): Promise<AniRunResult<AnimeSearchListing>> {
        if (sanitizeQuery(query).length === 0) {
            return failure('The search is empty.');
        }
        const handle = this.start(buildSearchArgs(query), '.', {}, undefined, Math.min(Math.max(FIRST_RESULT, Math.floor(atLeast)), MAX_SEARCH_RESULTS));
        if (handle === null) {
            return failure(MISSING_SCRIPT);
        }
        const outcome = await handle.result;
        if (outcome.status !== 'done') {
            return outcome;
        }
        const results = choicesFor(outcome.value, ANIME_PROMPT)
            .map(parseAnimeChoice)
            .filter((entry): entry is AnimeSearchResult => {
                return entry !== null;
            });
        if (results.length > 0) {
            // The results that share a title are told apart by what the id of the source says (see tellResultsApart).
            return { status: 'done', value: listingOf(tellResultsApart(results), outcome.value.moreResults) };
        }
        // A single result is picked by ani-cli itself, without asking, so all that shows is the list of its episodes (or,
        // when it has just one, nothing at all: ani-cli goes on to fetch it and ends cleanly). The script of the app lists it too (see
        // aniSingleResult.ts); this is a script it does not fit, where the anime the source picked is not known: the title is only what was
        // searched, and the result says so.
        if (choicesFor(outcome.value, EPISODE_PROMPT).length > 0 || outcome.value.exitCode === 0) {
            return { status: 'done', value: { results: [{ index: 1, title: sanitizeQuery(query), unconfirmed: true }], hasNextPage: false, limited: false } };
        }
        return { status: 'error', error: mapAniError(outcome.value.output, outcome.value.exitCode, { operation: 'Searching for the anime with ani-cli' }) };
    }

    async episodes(query: string, index: number): Promise<AniRunResult<string[]>> {
        const handle = this.start(buildEpisodesArgs(query, index), '.', {}, undefined, index);
        if (handle === null) {
            return failure(MISSING_SCRIPT);
        }
        const outcome = await handle.result;
        if (outcome.status !== 'done') {
            return outcome;
        }
        const episodes = choicesFor(outcome.value, EPISODE_PROMPT);
        if (episodes.length > 0) {
            return { status: 'done', value: episodes };
        }
        if (outcome.value.exitCode === 0) {
            return this.singleEpisode(query, index);
        }
        return { status: 'error', error: mapAniError(outcome.value.output, outcome.value.exitCode, { operation: 'Listing the episodes of an anime with ani-cli' }) };
    }

    // An anime with one episode (a film) is not listed: ani-cli picks it on its own. Its number is not shown either, so
    // episode 1 is tried; the answer is only trusted if ani-cli accepts it.
    private async singleEpisode(query: string, index: number): Promise<AniRunResult<string[]>> {
        const handle = this.start([...buildEpisodesArgs(query, index).slice(0, 2), '-e', SINGLE_EPISODE, sanitizeQuery(query)], '.', {}, undefined, index);
        if (handle === null) {
            return failure(MISSING_SCRIPT);
        }
        const outcome = await handle.result;
        if (outcome.status !== 'done') {
            return outcome;
        }
        if (outcome.value.exitCode === 0) {
            return { status: 'done', value: [SINGLE_EPISODE] };
        }
        return { status: 'error', error: mapAniError(outcome.value.output, outcome.value.exitCode, { operation: 'Listing the episodes of an anime with ani-cli' }) };
    }

    // What ani-cli prints about an episode instead of playing it (the "debug" player), read by `parse`; null from `parse` is the
    // error ani-cli reported.
    private async askAboutEpisode<T>(request: AniStreamOptions, parse: (output: string) => T | null): Promise<AniRunResult<T>> {
        const invalid = validateDownloadRequest(request);
        if (invalid !== null) {
            return failure(invalid);
        }
        const handle = this.start(buildStreamArgs(request.query, request.index, request.episode, request.quality), '.', {}, 'debug', request.index);
        if (handle === null) {
            return failure(MISSING_SCRIPT);
        }
        const outcome = await handle.result;
        if (outcome.status !== 'done') {
            return outcome;
        }
        const answer = outcome.value.exitCode === 0 ? parse(outcome.value.output) : null;
        if (answer === null) {
            return { status: 'error', error: mapAniError(outcome.value.output, outcome.value.exitCode, { operation: 'Asking ani-cli for the stream of an episode' }) };
        }
        return { status: 'done', value: answer };
    }

    // The address of an episode to watch it without downloading it. ani-cli prints it instead of playing it.
    async resolveStream(request: AniStreamOptions): Promise<AniRunResult<ResolvedStream>> {
        return this.askAboutEpisode(request, parseStreamOutput);
    }

    // The subtitles the source offers for an episode, asked the same way (they are empty when this copy of ani-cli does not report
    // them). An episode the source cannot play is an error, as it is for watching it.
    async resolveSubtitles(request: AniStreamOptions): Promise<AniRunResult<ResolvedSubtitles>> {
        return this.askAboutEpisode(request, (output) => {
            return parseStreamOutput(output) === null ? null : parseSubtitleList(output);
        });
    }

    download(options: AniDownloadOptions): AniDownloadHandle {
        const invalid = validateDownloadRequest(options);
        if (invalid !== null) {
            return { result: Promise.resolve(failure(invalid)), cancel: doNothing };
        }
        const handle = this.start(
            buildDownloadArgs(options),
            options.downloadDir,
            {
                onProgress: options.onProgress,
                onPart: options.onPart,
                onJoin: options.onJoin,
                onDestination: options.onDestination
            },
            undefined,
            options.index
        );
        if (handle === null) {
            return { result: Promise.resolve(failure(MISSING_SCRIPT)), cancel: doNothing };
        }
        const result = handle.result.then((outcome): AniRunResult<{ filePath: string | null }> => {
            if (outcome.status !== 'done') {
                return outcome;
            }
            const checked = asDownloadResult(outcome.value);
            if (checked.status !== 'done') {
                return checked;
            }
            return { status: 'done', value: { filePath: checked.value.destination } };
        });
        return { result, cancel: handle.cancel };
    }
}
