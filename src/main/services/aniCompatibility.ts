import { PATCH_NAMES, PATCHES, type PatchName } from './aniPatches';
import { providerOf } from './aniProvider';
import { compareVersions, parseAniCliVersion } from './aniVersion';
import { ANIME_PROMPT, EPISODE_PROMPT } from './aniOutputParser';

// What a script of ani-cli has to keep for the app to work with it, looked at before an update is downloaded: every change of the app fits it,
// what those changes read from it is still set by it, and what the app hands it and reads from it (its variables, its options, its menus, its
// messages, the way it downloads) is still there. Any of them that is missing refuses the update: the script in use stays.

export const MAX_SCRIPT_BYTES = 500_000;

// The variables of the environment the app gives ani-cli (see AniCliLocator.env): each one has to be read by the script.
export const ENVIRONMENT_VARIABLES = ['ANI_CLI_MENU', 'ANI_CLI_PLAYER', 'ANI_CLI_LOG', 'ANI_CLI_MODE', 'ANI_CLI_HIST_DIR', 'ANI_CLI_DOWNLOAD_DIR', 'ANI_CLI_TMP_DIR'] as const;

// The options the app runs ani-cli with (see aniArgsBuilder.ts), as the script lists them where it reads its arguments.
export const OPTIONS = ['-S', '-e', '-q', '-d'] as const;

// The menus the app reads the choices of (see aniOutputParser.ts): the script has to ask them with these words.
export const PROMPTS = [`${ANIME_PROMPT} `, `${EPISODE_PROMPT} `] as const;

// The messages the app tells apart (see ERROR_RULES in aniOutputParser.ts) that decide what it does, not only what it shows.
export const MESSAGES = ['No results found', 'Episode not released', 'Blocked by cloudflare'] as const;

// How the script downloads, as the stand-ins of pullwave-run.sh expect it: yt-dlp writes into the folder of the downloads (its pieces into
// ANI_CLI_TMP_DIR), and ffmpeg, which the stand-in replaces for the episodes whose audio is a track of its own, is called with -stats, the
// picture as its first input, the audio track as its second and the file of the episode as its last argument.
export const DOWNLOAD_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
    { name: 'yt-dlp download', pattern: /yt-dlp --referer "\$refr" "\$1" .*-P "\$download_dir" -P "temp:\$tmp_dir" -o "\$_name\.mp4"/ },
    { name: 'ffmpeg download', pattern: /^\s*ffmpeg .*-stats -i "\$1" .*-i "\$audio_link".* "\$download_dir\/\$_name\.mp4" \$3$/m }
];

export type CompatibilityProblem =
    | { kind: 'not-ani-cli' }
    | { kind: 'older'; version: string; base: string }
    | { kind: 'provider'; provider: string | null; base: string }
    | { kind: 'patch'; patch: PatchName }
    | { kind: 'needs'; patch: PatchName; name: string }
    | { kind: 'variable'; name: string }
    | { kind: 'option'; name: string }
    | { kind: 'prompt'; name: string }
    | { kind: 'message'; name: string }
    | { kind: 'download'; name: string };

export interface CompatibilityBase {
    // The version of the script the app is made with: an update is never older.
    version: string;
    // The site that script reads from: the ids of the anime in the library are the ones of that site.
    provider: string;
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Whether the script sets the variable (`name=`, also inside a line: `[ -n "$x" ] && name=...`) or defines the function (`name() {`).
export function setsName(source: string, name: string): boolean {
    const escaped = escapeRegExp(name);
    return new RegExp(`(^|[\\s;&|({])${escaped}=`, 'm').test(source) || new RegExp(`^${escaped}\\(\\)\\s*\\{`, 'm').test(source);
}

export function readsVariable(source: string, name: string): boolean {
    return new RegExp(`\\$\\{${escapeRegExp(name)}[:}-]`).test(source);
}

// Whether the option is one of the cases where the script reads its arguments (`-S | --select-nth)`).
export function hasOption(source: string, option: string): boolean {
    return new RegExp(`^\\s*${escapeRegExp(option)}(\\s*\\||\\))`, 'm').test(source);
}

export function looksLikeAniCli(source: string): boolean {
    return source.startsWith('#!/bin/sh') && Buffer.byteLength(source) <= MAX_SCRIPT_BYTES && parseAniCliVersion(source) !== null;
}

function patchProblems(source: string): CompatibilityProblem[] {
    return PATCH_NAMES.flatMap((patch): CompatibilityProblem[] => {
        const definition = PATCHES[patch];
        if (definition.apply(source) === null) {
            return [{ kind: 'patch', patch }];
        }
        return definition.needs
            .filter((name) => {
                return !setsName(source, name);
            })
            .map((name) => {
                return { kind: 'needs', patch, name };
            });
    });
}

function contractProblems(source: string): CompatibilityProblem[] {
    const missing = <T extends string>(names: readonly T[], present: (name: T) => boolean, kind: 'variable' | 'option' | 'prompt' | 'message'): CompatibilityProblem[] => {
        return names
            .filter((name) => {
                return !present(name);
            })
            .map((name) => {
                return { kind, name };
            });
    };
    return [
        ...missing(ENVIRONMENT_VARIABLES, (name) => {
            return readsVariable(source, name);
        }, 'variable'),
        ...missing(OPTIONS, (name) => {
            return hasOption(source, name);
        }, 'option'),
        ...missing(PROMPTS, (name) => {
            return source.includes(`"${name}"`);
        }, 'prompt'),
        ...missing(MESSAGES, (name) => {
            return source.includes(name);
        }, 'message'),
        ...DOWNLOAD_PATTERNS.filter(({ pattern }) => {
            return !pattern.test(source);
        }).map(({ name }): CompatibilityProblem => {
            return { kind: 'download', name };
        })
    ];
}

// Everything that keeps the script from being used by the app (empty when nothing does). A text that is not ani-cli is not looked at further.
export function compatibilityProblems(source: string, base: CompatibilityBase): CompatibilityProblem[] {
    if (!looksLikeAniCli(source)) {
        return [{ kind: 'not-ani-cli' }];
    }
    const problems: CompatibilityProblem[] = [];
    const version = parseAniCliVersion(source) as string;
    if (compareVersions(version, base.version) < 0) {
        problems.push({ kind: 'older', version, base: base.version });
    }
    const provider = providerOf(source);
    if (provider !== base.provider) {
        problems.push({ kind: 'provider', provider, base: base.provider });
    }
    return [...problems, ...patchProblems(source), ...contractProblems(source)];
}

// One problem in words, for the details of a refused update.
export function describeProblem(problem: CompatibilityProblem): string {
    switch (problem.kind) {
        case 'not-ani-cli':
            return 'the file is not ani-cli';
        case 'older':
            return `version ${problem.version} is older than ${problem.base}`;
        case 'provider':
            return `it reads ${problem.provider ?? 'an unknown site'} instead of ${problem.base}`;
        case 'patch':
            return `the change "${problem.patch}" does not fit`;
        case 'needs':
            return `the change "${problem.patch}" reads "${problem.name}", which the script no longer sets`;
        case 'variable':
            return `the script no longer reads ${problem.name}`;
        case 'option':
            return `the option ${problem.name} is gone`;
        case 'prompt':
            return `the menu "${problem.name.trim()}" is gone`;
        case 'message':
            return `the message "${problem.name}" is gone`;
        case 'download':
            return `the ${problem.name} is not the one the app expects`;
    }
}
