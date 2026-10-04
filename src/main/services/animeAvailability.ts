import type { AniRunResult, AnimeAudio, AnimeAvailability, AnimeAvailabilityTarget, AnimeSearchResult } from '@shared/anime';
import { foldSeries } from '@shared/series';

// Whether the source (ani-cli) has the anime of the schedule: it is searched by its english name and then by its romaji one, and it is there
// when a result has that title (and, when ani-cli lists nothing else, it has episodes). What was found is kept for an hour.

export const AVAILABILITY_CACHE_MS = 60 * 60 * 1000;
// How many anime are looked up at once: each look-up runs ani-cli.
export const AVAILABILITY_CONCURRENCY = 2;

const BRACKETS = /\s*[([][^)\]]*[)\]]/g;
const NOT_A_LETTER_OR_NUMBER = /[^\p{L}\p{N}]/gu;

// A title as it is compared: without case, accents, what is between brackets (the source adds "(12 episodes)" and qualifiers) or anything
// that is not a letter or a number.
export function comparableTitle(title: string): string {
    return foldSeries(title).replace(BRACKETS, '').replace(NOT_A_LETTER_OR_NUMBER, '');
}

// The names the anime is looked up by, in order: the english one, then the romaji one, once each.
export function namesToTry(target: AnimeAvailabilityTarget): string[] {
    const seen = new Set<string>();
    const names: string[] = [];
    [target.english, target.romaji].forEach((name) => {
        const cleaned = name?.trim() ?? '';
        const key = comparableTitle(cleaned);
        if (key.length > 0 && !seen.has(key)) {
            seen.add(key);
            names.push(cleaned);
        }
    });
    return names;
}

export interface AvailabilityDependencies {
    search: (query: string, audio: AnimeAudio) => Promise<AniRunResult<AnimeSearchResult[]>>;
    // Where what was found is kept between runs (see AnimeDb): what was checked at `since` or later.
    store: {
        find: (anilistId: number, audio: AnimeAudio, since: number) => AnimeAvailability | null;
        save: (availability: AnimeAvailability, audio: AnimeAudio) => void;
        forgetBefore: (since: number) => void;
    };
    audio: () => AnimeAudio;
    // Tells each answer as soon as it is known.
    onResult: (availability: AnimeAvailability) => void;
    now?: () => number;
    concurrency?: number;
}

// Checks, a few at a time and in the background, which anime of the schedule the source has. A look-up that fails (ani-cli is missing, no
// network, the source refused) is told as `unknown` and not kept, so the next ask tries again; an anime nothing was found for is `unavailable`.
export class AnimeAvailabilityService {
    private readonly waiting: AnimeAvailabilityTarget[] = [];
    private readonly queued = new Set<number>();
    private running = 0;

    constructor(private readonly deps: AvailabilityDependencies) {}

    // What is known for these anime (checked in the last hour); the others are put in line to be checked and told one by one.
    request(targets: readonly AnimeAvailabilityTarget[]): AnimeAvailability[] {
        const audio = this.deps.audio();
        const now = (this.deps.now ?? Date.now)();
        this.deps.store.forgetBefore(now - AVAILABILITY_CACHE_MS);
        const known: AnimeAvailability[] = [];
        targets.forEach((target) => {
            const kept = this.deps.store.find(target.anilistId, audio, now - AVAILABILITY_CACHE_MS);
            if (kept !== null) {
                known.push(kept);
            } else if (!this.queued.has(target.anilistId)) {
                this.queued.add(target.anilistId);
                this.waiting.push(target);
            }
        });
        this.pump();
        return known;
    }

    private pump(): void {
        const limit = this.deps.concurrency ?? AVAILABILITY_CONCURRENCY;
        while (this.running < limit && this.waiting.length > 0) {
            const target = this.waiting.shift() as AnimeAvailabilityTarget;
            this.running += 1;
            void this.check(target).finally(() => {
                this.running -= 1;
                this.queued.delete(target.anilistId);
                this.pump();
            });
        }
    }

    private async check(target: AnimeAvailabilityTarget): Promise<void> {
        const audio = this.deps.audio();
        const names = namesToTry(target);
        const wanted = names.map(comparableTitle);
        let outcome: AnimeAvailability = { anilistId: target.anilistId, state: 'unavailable' };
        let failed = names.length === 0;
        for (const name of names) {
            const result = await this.deps.search(name, audio).catch((): AniRunResult<AnimeSearchResult[]> => {
                return { status: 'cancelled' };
            });
            if (result.status === 'error' && result.error.code === 'NO_RESULTS') {
                continue;
            }
            // When a name has a single match ani-cli goes on by itself to its episodes, and a title that has none yet (an anime that is not
            // released) ends with "Invalid episode selection": the source lists it but there is nothing to watch, so it is not available. The
            // other name is not tried: it could list the same empty title among others, and only its episodes could tell.
            if (result.status === 'error' && result.error.code === 'INVALID_SELECTION') {
                break;
            }
            if (result.status !== 'done') {
                failed = true;
                break;
            }
            const match = result.value.find((entry) => {
                return wanted.includes(comparableTitle(entry.title));
            });
            if (match !== undefined) {
                outcome = { anilistId: target.anilistId, state: 'available', query: name, index: match.index, title: match.title };
                failed = false;
                break;
            }
        }
        if (failed && outcome.state !== 'available') {
            this.deps.onResult({ anilistId: target.anilistId, state: 'unknown' });
            return;
        }
        this.deps.store.save(outcome, audio);
        this.deps.onResult(outcome);
    }
}
