import { patchAllSubtitles, patchSubtitleSelection } from './aniSubtitles';
import { patchMenuIds } from './aniMenuIds';
import { patchSearchPages } from './aniSearchPages';
import { patchSingleResult } from './aniSingleResult';
import { patchDebugReferer } from './aniStream';

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

// The change without which the app cannot find the stream of an episode: the referer the host of the stream wants. The others only give
// more subtitles (their language, and all of them), tell apart the anime that have the same title (the id in the lists), show the anime the source
// picked on its own and read the pages of the search after the first, so a script they do not fit is still worth using.
export const REQUIRED_PATCHES: readonly PatchName[] = ['debugReferer'];

export function patchReport(source: string): PatchReport {
    return {
        subtitleSelection: patchSubtitleSelection(source) !== null,
        allSubtitles: patchAllSubtitles(source) !== null,
        debugReferer: patchDebugReferer(source) !== null,
        menuIds: patchMenuIds(source) !== null,
        singleResult: patchSingleResult(source) !== null,
        searchPages: patchSearchPages(source) !== null
    };
}

// Everything Pullwave changes in the script it runs: the choice of subtitles, saving all of them, the referer in the debug output, the id and the lone result in the lists, the pages of the search. Each change
// is made on its own, so a version of ani-cli that only fits one of them still gets that one. Null when none fits.
export function patchAniCli(source: string): string | null {
    const patches = [patchSubtitleSelection, patchAllSubtitles, patchDebugReferer, patchMenuIds, patchSingleResult, patchSearchPages];
    let result = source;
    patches.forEach((patch) => {
        result = patch(result) ?? result;
    });
    return result === source ? null : result;
}
