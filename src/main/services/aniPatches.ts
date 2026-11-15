import { ALL_SUBTITLES_NEEDS, patchAllSubtitles, patchSubtitleSelection, SUBTITLE_SELECTION_NEEDS } from './aniSubtitles';
import { patchMenuIds } from './aniMenuIds';
import { patchSearchPages, SEARCH_PAGES_NEEDS } from './aniSearchPages';
import { patchSingleResult } from './aniSingleResult';
import { DEBUG_REFERER_NEEDS, patchDebugReferer } from './aniStream';

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
    needs: readonly string[];
}

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

export function patchAniCli(source: string): string | null {
    let result = source;
    PATCH_NAMES.forEach((name) => {
        result = PATCHES[name].apply(result) ?? result;
    });
    return result === source ? null : result;
}
