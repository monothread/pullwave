import { patchAllSubtitles, patchSubtitleSelection } from './aniSubtitles';
import { patchDebugReferer } from './aniStream';

// Which of the changes Pullwave makes to ani-cli fit a script (see patchAniCli).
export interface PatchReport {
    subtitleSelection: boolean;
    allSubtitles: boolean;
    debugReferer: boolean;
}

export type PatchName = keyof PatchReport;

// The change without which the app cannot find the stream of an episode: the referer the host of the stream wants. The others only give
// more subtitles (their language, and all of them), so a script they do not fit is still worth using.
export const REQUIRED_PATCHES: readonly PatchName[] = ['debugReferer'];

export function patchReport(source: string): PatchReport {
    return {
        subtitleSelection: patchSubtitleSelection(source) !== null,
        allSubtitles: patchAllSubtitles(source) !== null,
        debugReferer: patchDebugReferer(source) !== null
    };
}

// Everything Pullwave changes in the script it runs: the choice of subtitles, saving all of them and the referer in the debug output. Each change
// is made on its own, so a version of ani-cli that only fits one of them still gets that one. Null when none fits.
export function patchAniCli(source: string): string | null {
    const patches = [patchSubtitleSelection, patchAllSubtitles, patchDebugReferer];
    let result = source;
    patches.forEach((patch) => {
        result = patch(result) ?? result;
    });
    return result === source ? null : result;
}
