import { ALL_SUBTITLES_NEEDS, patchAllSubtitles, patchSubtitleSelection, SUBTITLE_SELECTION_NEEDS } from './aniSubtitles';
import { patchMenuIds } from './aniMenuIds';
import { patchSearchPages, SEARCH_PAGES_NEEDS } from './aniSearchPages';
import { patchSingleResult } from './aniSingleResult';
import { DEBUG_REFERER_NEEDS, patchDebugReferer } from './aniStream';

// Which of the changes Pullwave makes to ani-cli fit a script (see patchAniCli).
export interface PatchReport {
    subtitleSelection: boolean;
    allSubtitles: boolean;
    debugReferer: boolean;
    menuIds: boolean;
    singleResult: boolean;
    searchPages: boolean;
}

export type PatchName = keyof PatchReport;

interface PatchDefinition {
    apply: (source: string) => string | null;
    // The variables and functions the code the change adds reads from the script (beyond the text it looks for, which has to be there for
    // it to fit at all): a script that no longer sets one of them would take the change and fail when it runs.
    needs: readonly string[];
}

// Every change, in the order they are made: the choice of subtitles, saving all of them, the referer in the debug output, the id and the lone
// result in the lists, the pages of the search. Each one is made on its own (none depends on another having fit).
export const PATCHES: Readonly<Record<PatchName, PatchDefinition>> = {
    subtitleSelection: { apply: patchSubtitleSelection, needs: SUBTITLE_SELECTION_NEEDS },
    allSubtitles: { apply: patchAllSubtitles, needs: ALL_SUBTITLES_NEEDS },
    debugReferer: { apply: patchDebugReferer, needs: DEBUG_REFERER_NEEDS },
    menuIds: { apply: patchMenuIds, needs: ['menu'] },
    singleResult: { apply: patchSingleResult, needs: ['nth'] },
    searchPages: { apply: patchSearchPages, needs: SEARCH_PAGES_NEEDS }
};

export const PATCH_NAMES = Object.keys(PATCHES) as PatchName[];

export function patchReport(source: string): PatchReport {
    return {
        subtitleSelection: PATCHES.subtitleSelection.apply(source) !== null,
        allSubtitles: PATCHES.allSubtitles.apply(source) !== null,
        debugReferer: PATCHES.debugReferer.apply(source) !== null,
        menuIds: PATCHES.menuIds.apply(source) !== null,
        singleResult: PATCHES.singleResult.apply(source) !== null,
        searchPages: PATCHES.searchPages.apply(source) !== null
    };
}

// Everything Pullwave changes in the script it runs. Each change is made on its own, so a script that only fits some of them (one the user
// chose) still gets those; the script the app installs fits them all (an update that does not is refused, see aniCompatibility.ts). Null
// when none fits.
export function patchAniCli(source: string): string | null {
    let result = source;
    PATCH_NAMES.forEach((name) => {
        result = PATCHES[name].apply(result) ?? result;
    });
    return result === source ? null : result;
}
