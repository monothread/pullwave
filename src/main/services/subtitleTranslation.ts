import {
    MAX_SUBTITLE_BYTES,
    type SubtitleEstimateRequest,
    type SubtitleEstimateResponse,
    type SubtitleTranslateRequest,
    type SubtitleTranslateResponse,
    type TranslationLanguage
} from '@shared/anime';
import type { LlmCompletionResult } from '@shared/llm';
import { defaultSubtitleFileSystem, listSubtitleFiles, toWebVtt, translatedSubtitlePath, type SubtitleFile, type SubtitleFileSystem } from './subtitleFiles';
import { estimateTranslation, translateTexts } from './subtitleTranslator';
import { parseVtt, serializeVtt, type ParsedVtt } from './vttCues';

const ENGLISH = /english/i;

// What the model is asked with: where it is, which model, and the token. `reason` says what the settings lack when it cannot be asked.
export type LlmAccess = { ok: true; ask: (system: string, user: string, signal?: AbortSignal) => Promise<LlmCompletionResult> } | { ok: false; reason: 'no-token' | 'no-model' | 'no-address' };

export interface SubtitleTranslationDependencies {
    llm: () => LlmAccess;
    files?: SubtitleFileSystem;
    sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

type SourceFailure = Extract<SubtitleTranslateResponse, { ok: false; reason: string }>['reason'];
type Source = { ok: true; file: SubtitleFile; parsed: ParsedVtt } | { ok: false; reason: Extract<SourceFailure, 'no-source' | 'unreadable' | 'too-large' | 'empty'> };

// The subtitle to start from: the one asked for, or, when none was, the English one (the one models know best) and otherwise the one
// ani-cli picked, never one that is a translation already.
function pickSource(files: readonly SubtitleFile[], trackId: string | null): SubtitleFile | null {
    if (trackId !== null) {
        return files.find((file) => {
            return file.track.id === trackId;
        }) ?? null;
    }
    const originals = files.filter((file) => {
        return file.track.kind !== 'translated';
    });
    return originals.find((file) => {
        return ENGLISH.test(file.track.label);
    }) ?? originals.find((file) => {
        return file.track.kind === 'default';
    }) ?? originals[0] ?? null;
}

function readSource(videoPath: string, trackId: string | null, files: SubtitleFileSystem): Source {
    const file = pickSource(listSubtitleFiles(videoPath, files), trackId);
    if (file === null) {
        return { ok: false, reason: 'no-source' };
    }
    const size = files.size(file.path);
    if (size === null) {
        return { ok: false, reason: 'unreadable' };
    }
    if (size > MAX_SUBTITLE_BYTES) {
        return { ok: false, reason: 'too-large' };
    }
    const text = files.read(file.path);
    const vtt = text === null ? null : toWebVtt(text);
    if (vtt === null) {
        return { ok: false, reason: 'unreadable' };
    }
    const parsed = parseVtt(vtt);
    return parsed.cues.length === 0 ? { ok: false, reason: 'empty' } : { ok: true, file, parsed };
}

function textsOf(parsed: ParsedVtt): string[] {
    return parsed.cues.map((cue) => {
        return cue.text;
    });
}

// What translating the subtitle of an episode takes, without asking the model anything.
export function estimateSubtitleTranslation(videoPath: string, request: Pick<SubtitleEstimateRequest, 'trackId'>, files: SubtitleFileSystem = defaultSubtitleFileSystem): SubtitleEstimateResponse {
    const source = readSource(videoPath, request.trackId, files);
    if (!source.ok) {
        return { ok: false, reason: source.reason };
    }
    const estimate = estimateTranslation(textsOf(source.parsed));
    return { ok: true, cues: source.parsed.cues.length, batches: estimate.batches, approxTokens: estimate.approxTokens };
}

export type TranslationProgress = (done: number, total: number) => void;

// Translates a subtitle of an episode into a language and saves it next to the video, as a subtitle of its own: what was there for
// that language is replaced.
export async function translateEpisodeSubtitle(
    videoPath: string,
    request: Pick<SubtitleTranslateRequest, 'trackId'> & { language: TranslationLanguage },
    dependencies: SubtitleTranslationDependencies,
    onProgress: TranslationProgress,
    signal?: AbortSignal
): Promise<SubtitleTranslateResponse> {
    const files = dependencies.files ?? defaultSubtitleFileSystem;
    const access = dependencies.llm();
    if (!access.ok) {
        return { ok: false, reason: access.reason };
    }
    const source = readSource(videoPath, request.trackId, files);
    if (!source.ok) {
        return { ok: false, reason: source.reason };
    }
    const result = await translateTexts(textsOf(source.parsed), request.language, {
        complete: (system, user) => {
            return access.ask(system, user, signal);
        },
        sleep: dependencies.sleep,
        signal,
        onProgress
    });
    if (!result.ok) {
        return result.error.code === 'CANCELLED' ? { ok: false, reason: 'cancelled' } : { ok: false, reason: 'failed', error: result.error };
    }
    const target = translatedSubtitlePath(videoPath, request.language);
    const translated: ParsedVtt = {
        preamble: source.parsed.preamble,
        cues: source.parsed.cues.map((cue, index) => {
            return { ...cue, text: result.texts[index] as string };
        })
    };
    try {
        files.write(target, serializeVtt(translated));
    } catch {
        return { ok: false, reason: 'unreadable' };
    }
    const tracks = listSubtitleFiles(videoPath, files);
    const saved = tracks.find((file) => {
        return file.path === target;
    });
    if (!saved) {
        return { ok: false, reason: 'unreadable' };
    }
    return {
        ok: true,
        tracks: tracks.map((file) => {
            return file.track;
        }),
        translated: saved.track
    };
}
