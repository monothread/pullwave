import { PATCH_NAMES, PATCHES, type PatchName } from './aniPatches';
import { providerOf } from './aniProvider';
import { compareVersions, parseAniCliVersion } from './aniVersion';
import { ANIME_PROMPT, EPISODE_PROMPT } from './aniOutputParser';

export const MAX_SCRIPT_BYTES = 500_000;

export const ENVIRONMENT_VARIABLES = ['ANI_CLI_MENU', 'ANI_CLI_PLAYER', 'ANI_CLI_LOG', 'ANI_CLI_MODE', 'ANI_CLI_HIST_DIR', 'ANI_CLI_DOWNLOAD_DIR', 'ANI_CLI_TMP_DIR'] as const;

export const OPTIONS = ['-S', '-e', '-q', '-d'] as const;

export const PROMPTS = [`${ANIME_PROMPT} `, `${EPISODE_PROMPT} `] as const;

export const MESSAGES = ['No results found', 'Episode not released', 'Blocked by cloudflare'] as const;

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
    version: string;
    provider: string;
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function setsName(source: string, name: string): boolean {
    const escaped = escapeRegExp(name);
    return new RegExp(`(^|[\\s;&|({])${escaped}=`, 'm').test(source) || new RegExp(`^${escaped}\\(\\)\\s*\\{`, 'm').test(source);
}

export function readsVariable(source: string, name: string): boolean {
    return new RegExp(`\\$\\{${escapeRegExp(name)}[:}-]`).test(source);
}

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
