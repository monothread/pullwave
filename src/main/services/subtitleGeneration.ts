import {
    generatePlanOf,
    SPEECH_PART_SECONDS,
    TRANSCRIPTION_LANGUAGE_CODES,
    type SubtitleGenerateEstimateResponse,
    type SubtitleGenerateFailure,
    type SubtitleGeneratePlan,
    type SubtitleGenerateResponse,
    type SubtitleGenerationPhase,
    type TranscriptionLanguage,
    type TranslationLanguage
} from '@shared/anime';
import type { LlmCompletionResult, SpeechTranslatesTo } from '@shared/llm';
import { AUDIO_BYTES_PER_SECOND, decodeSpeechAudio, defaultAudioFiles, extractAudioParts, extractAudioPieces, probeAudio, type AudioFiles, type FfmpegRunner } from './audioExtractor';
import type { SpeechTask } from './speechProviders';
import { cutTimesOf, findSpeech, loudnessOf, pcmSeconds, piecesOf, type SpeechPiece } from './speechSegmenter';
import { defaultSubtitleFileSystem, generatedSubtitlePath, listSubtitleFiles, type SubtitleFileSystem } from './subtitleFiles';
import type { LlmAccess } from './subtitleTranslation';
import { defaultSleep, MAX_RATE_LIMIT_WAITS, translateTexts, waitSecondsOf, type TranslatedBatches } from './subtitleTranslator';
import { formatVttTime, parseVtt, serializeVtt, shiftCues, type VttCue } from './vttCues';

export const PIECE_STREAMS = 6;
export const CONTEXT_PIECES = 2;
export const MAX_BAD_RESPONSE_RETRIES = 1;

export interface SpeechInput {
    task: SpeechTask;
    audio: Uint8Array;
    fileName: string;
    languageCode: string;
    audioLanguage: TranscriptionLanguage;
    language: TranslationLanguage;
    prompt?: string;
    signal?: AbortSignal;
}

export type SpeechAccess =
    | { ok: true; translatesTo: SpeechTranslatesTo; cutsAtPauses: boolean; partSeconds?: number; ask: (input: SpeechInput) => Promise<LlmCompletionResult> }
    | { ok: false; reason: 'no-token' | 'no-model' | 'no-address' };

export interface SubtitleGenerationDependencies {
    speech: () => SpeechAccess;
    translation: () => LlmAccess;
    ffmpeg: FfmpegRunner;
    audio?: AudioFiles;
    files?: SubtitleFileSystem;
    sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
    batches?: TranslatedBatches;
}

export interface GenerationRequest {
    audioLanguage: TranscriptionLanguage;
    language: TranslationLanguage;
    title: string | null;
}

export interface GenerationProgressExtra {
    phase: SubtitleGenerationPhase;
    plan: SubtitleGeneratePlan;
    sentBytes?: number;
    totalBytes?: number;
}

export type GenerationProgress = (done: number, total: number, extra: GenerationProgressExtra) => void;

function isAborted(signal?: AbortSignal): boolean {
    return signal?.aborted === true;
}

const TRANSLATION_FAILURES: Record<'no-token' | 'no-model' | 'no-address', SubtitleGenerateFailure> = {
    'no-token': 'no-translation-token',
    'no-model': 'no-translation-model',
    'no-address': 'no-translation-address'
};

type FailedRequest = Extract<LlmCompletionResult, { ok: false }>;

const CANCELLED_ERROR: FailedRequest = { ok: false, error: { code: 'CANCELLED', raw: 'The subtitle was cancelled.' } };

type SpeechPieces = { ok: true; pieces: SpeechPiece[] } | { ok: false; reason: 'no-audio' | 'extract-failed' };

async function speechPiecesOf(videoPath: string, directory: string, ffmpeg: FfmpegRunner, audio: AudioFiles, signal?: AbortSignal): Promise<SpeechPieces> {
    const decoded = await decodeSpeechAudio(videoPath, directory, ffmpeg, audio, signal);
    if (!decoded.ok) {
        return decoded;
    }
    return { ok: true, pieces: piecesOf(findSpeech(loudnessOf(decoded.pcm)), pcmSeconds(decoded.pcm)) };
}

export async function estimateSubtitleGeneration(
    videoPath: string,
    ffmpeg: FfmpegRunner,
    options: { cutsAtPauses: boolean; partSeconds?: number; audio?: AudioFiles } = { cutsAtPauses: false }
): Promise<SubtitleGenerateEstimateResponse> {
    const probe = await probeAudio(videoPath, ffmpeg);
    if (!probe.ok) {
        return { ok: false, reason: probe.reason };
    }
    const approxBytes = Math.round(probe.seconds * AUDIO_BYTES_PER_SECOND);
    if (!options.cutsAtPauses) {
        const partSeconds = options.partSeconds ?? SPEECH_PART_SECONDS;
        return { ok: true, seconds: probe.seconds, parts: Math.max(1, Math.ceil(probe.seconds / partSeconds)), approxBytes };
    }
    const audio = options.audio ?? defaultAudioFiles;
    const directory = audio.makeDirectory();
    try {
        const found = await speechPiecesOf(videoPath, directory, ffmpeg, audio);
        return found.ok ? { ok: true, seconds: probe.seconds, parts: found.pieces.length, approxBytes } : { ok: false, reason: found.reason };
    } finally {
        audio.remove(directory);
    }
}

async function askPart(input: Omit<SpeechInput, 'signal'>, access: Extract<SpeechAccess, { ok: true }>, dependencies: SubtitleGenerationDependencies, signal?: AbortSignal): Promise<LlmCompletionResult> {
    const sleep = dependencies.sleep ?? defaultSleep;
    let waits = 0;
    let badResponses = 0;
    for (;;) {
        if (isAborted(signal)) {
            return CANCELLED_ERROR;
        }
        const result = await access.ask({ ...input, signal });
        if (result.ok) {
            return result;
        }
        if (result.error.code === 'RATE_LIMITED' && waits < MAX_RATE_LIMIT_WAITS) {
            waits += 1;
            await sleep(waitSecondsOf(result.error) * 1000, signal);
            continue;
        }
        if (access.translatesTo === 'any' && result.error.code === 'BAD_RESPONSE' && badResponses < MAX_BAD_RESPONSE_RETRIES) {
            badResponses += 1;
            continue;
        }
        return result;
    }
}

type PartsResult =
    | { ok: true; cues: VttCue[] }
    | { ok: false; response: SubtitleGenerateResponse; refused: boolean };

interface SendContext {
    task: SpeechTask;
    audioLanguage: TranscriptionLanguage;
    language: TranslationLanguage;
    partSeconds?: number;
    access: Extract<SpeechAccess, { ok: true }>;
    dependencies: SubtitleGenerationDependencies;
    audio: AudioFiles;
    report: (done: number, total: number, sentBytes: number) => void;
    signal?: AbortSignal;
}

function responseOf(result: FailedRequest): SubtitleGenerateResponse {
    return result.error.code === 'CANCELLED' ? { ok: false, reason: 'cancelled' } : { ok: false, reason: 'failed', error: result.error };
}

function inputOf(context: SendContext, audio: Uint8Array, fileName: string): Omit<SpeechInput, 'signal'> {
    return {
        task: context.task,
        audio,
        fileName,
        languageCode: TRANSCRIPTION_LANGUAGE_CODES[context.audioLanguage],
        audioLanguage: context.audioLanguage,
        language: context.language
    };
}

async function sendParts(paths: readonly string[], context: SendContext): Promise<PartsResult> {
    const cues: VttCue[] = [];
    const partSeconds = context.partSeconds ?? SPEECH_PART_SECONDS;
    let sentBytes = 0;
    context.report(0, paths.length, 0);
    for (const [index, path] of paths.entries()) {
        const result = await askPart(inputOf(context, context.audio.read(path), `part-${index}.mp3`), context.access, context.dependencies, context.signal);
        if (!result.ok) {
            return { ok: false, response: responseOf(result), refused: index === 0 && result.error.code === 'BAD_RESPONSE' };
        }
        cues.push(...shiftCues(parseVtt(result.text).cues, index * partSeconds));
        sentBytes += context.audio.size(path);
        context.report(index + 1, paths.length, sentBytes);
    }
    return { ok: true, cues };
}

function isNotEmpty(text: string): boolean {
    return text.length > 0;
}

export function piecePromptOf(title: string | null, previous: readonly string[]): string {
    return [title ?? '', previous.filter(isNotEmpty).join(' ')].filter(isNotEmpty).join('\n');
}

function cuesOfPieces(pieces: readonly SpeechPiece[], texts: readonly string[]): VttCue[] {
    return pieces.flatMap((piece, index) => {
        const text = texts[index] ?? '';
        return text.length === 0 ? [] : [{ id: null, timing: `${formatVttTime(piece.start)} --> ${formatVttTime(piece.end)}`, text }];
    });
}

async function sendPieces(pieces: readonly SpeechPiece[], paths: readonly string[], context: SendContext & { title: string | null }): Promise<PartsResult> {
    const texts = paths.map(() => {
        return '';
    });
    const stop = new AbortController();
    const signal = context.signal === undefined ? stop.signal : AbortSignal.any([context.signal, stop.signal]);
    const stretch = Math.ceil(paths.length / PIECE_STREAMS);
    let failure = null as FailedRequest | null;
    let done = 0;
    let sentBytes = 0;
    context.report(0, paths.length, 0);
    const runStream = async (first: number): Promise<void> => {
        for (let index = first; index < Math.min(paths.length, first + stretch) && failure === null; index += 1) {
            const path = paths[index] as string;
            const previous = texts.slice(Math.max(first, index - CONTEXT_PIECES), index);
            const input = { ...inputOf(context, context.audio.read(path), `piece-${index}.mp3`), prompt: piecePromptOf(context.title, previous) };
            const result = await askPart(input, context.access, context.dependencies, signal);
            if (!result.ok) {
                failure ??= result;
                stop.abort();
                return;
            }
            texts[index] = result.text.trim();
            done += 1;
            sentBytes += context.audio.size(path);
            context.report(done, paths.length, sentBytes);
        }
    };
    const firsts = Array.from({ length: Math.ceil(paths.length / stretch) }, (_unused, stream) => {
        return stream * stretch;
    });
    await Promise.all(firsts.map(runStream));
    if (failure !== null) {
        return { ok: false, response: responseOf(failure), refused: false };
    }
    return { ok: true, cues: cuesOfPieces(pieces, texts) };
}

type Translated = { ok: true; cues: VttCue[] } | { ok: false; response: SubtitleGenerateResponse };

async function translateCues(
    cues: readonly VttCue[],
    request: GenerationRequest,
    translation: Extract<LlmAccess, { ok: true }>,
    dependencies: SubtitleGenerationDependencies,
    report: (done: number, total: number) => void,
    signal?: AbortSignal
): Promise<Translated> {
    const result = await translateTexts(
        cues.map((cue) => {
            return cue.text;
        }),
        request.language,
        {
            complete: (system, user) => {
                return translation.ask(system, user, signal);
            },
            sleep: dependencies.sleep,
            signal,
            onProgress: report,
            batches: dependencies.batches
        },
        { title: request.title }
    );
    if (!result.ok) {
        return { ok: false, response: result.error.code === 'CANCELLED' ? { ok: false, reason: 'cancelled' } : { ok: false, reason: 'failed', error: result.error } };
    }
    return {
        ok: true,
        cues: cues.map((cue, index) => {
            return { ...cue, text: result.texts[index] as string };
        })
    };
}

type Access = { ok: true; speech: Extract<SpeechAccess, { ok: true }>; translation: LlmAccess | null } | { ok: false; reason: SubtitleGenerateFailure };

function accessFor(request: GenerationRequest, dependencies: SubtitleGenerationDependencies): Access & { plan: SubtitleGeneratePlan } {
    const speech = dependencies.speech();
    if (!speech.ok) {
        return { ok: false, reason: speech.reason, plan: 'transcribe' };
    }
    const plan = generatePlanOf(request.audioLanguage, request.language, speech.translatesTo);
    if (plan !== 'transcribe-translate') {
        return { ok: true, speech, translation: null, plan };
    }
    const translation = dependencies.translation();
    return translation.ok ? { ok: true, speech, translation, plan } : { ok: false, reason: TRANSLATION_FAILURES[translation.reason], plan };
}

type Transcribed =
    | { ok: true; cues: VttCue[]; plan: SubtitleGeneratePlan; translation: LlmAccess | null }
    | { ok: false; response: SubtitleGenerateResponse };

interface TranscribeContext {
    videoPath: string;
    directory: string;
    request: GenerationRequest;
    access: Extract<Access, { ok: true }>;
    plan: SubtitleGeneratePlan;
    dependencies: SubtitleGenerationDependencies;
    audio: AudioFiles;
    onProgress: GenerationProgress;
    signal?: AbortSignal;
}

function totalBytesOf(paths: readonly string[], audio: AudioFiles): number {
    return paths.reduce((total, path) => {
        return total + audio.size(path);
    }, 0);
}

function sendContextOf(context: TranscribeContext, task: SpeechTask, plan: () => SubtitleGeneratePlan, totalBytes: number, partSeconds?: number): SendContext {
    return {
        task,
        audioLanguage: context.request.audioLanguage,
        language: context.request.language,
        partSeconds,
        access: context.access.speech,
        dependencies: context.dependencies,
        audio: context.audio,
        report: (done, total, sentBytes) => {
            context.onProgress(done, total, { phase: 'sending', plan: plan(), sentBytes, totalBytes });
        },
        signal: context.signal
    };
}

async function transcribeInParts(context: TranscribeContext): Promise<Transcribed> {
    const { audio, signal } = context;
    const partSeconds = context.access.speech.partSeconds ?? SPEECH_PART_SECONDS;
    const parts = await extractAudioParts(context.videoPath, context.directory, context.dependencies.ffmpeg, audio, signal, partSeconds);
    if (isAborted(signal)) {
        return { ok: false, response: { ok: false, reason: 'cancelled' } };
    }
    if (!parts.ok) {
        return { ok: false, response: { ok: false, reason: parts.reason } };
    }
    let plan = context.plan;
    const totalBytes = totalBytesOf(parts.paths, audio);
    const send = (task: SpeechTask): Promise<PartsResult> => {
        return sendParts(
            parts.paths,
            sendContextOf(
                context,
                task,
                () => {
                    return plan;
                },
                totalBytes,
                partSeconds
            )
        );
    };
    let translation = context.access.translation;
    const canFallback = plan === 'direct' && context.access.speech.translatesTo === 'english';
    let sent = await send(plan === 'direct' ? 'translate' : 'transcribe');
    if (!sent.ok && canFallback && sent.refused) {
        const fallback = context.dependencies.translation();
        if (!fallback.ok) {
            return { ok: false, response: { ok: false, reason: TRANSLATION_FAILURES[fallback.reason] } };
        }
        translation = fallback;
        plan = 'transcribe-translate';
        sent = await send('transcribe');
    }
    return sent.ok ? { ok: true, cues: sent.cues, plan, translation } : { ok: false, response: sent.response };
}

async function transcribeAtPauses(context: TranscribeContext): Promise<Transcribed> {
    const { audio, signal } = context;
    const found = await speechPiecesOf(context.videoPath, context.directory, context.dependencies.ffmpeg, audio, signal);
    if (isAborted(signal)) {
        return { ok: false, response: { ok: false, reason: 'cancelled' } };
    }
    if (!found.ok) {
        return { ok: false, response: { ok: false, reason: found.reason } };
    }
    if (found.pieces.length === 0) {
        return { ok: false, response: { ok: false, reason: 'no-speech' } };
    }
    const extracted = await extractAudioPieces(context.videoPath, context.directory, cutTimesOf(found.pieces), context.dependencies.ffmpeg, audio, signal);
    if (isAborted(signal)) {
        return { ok: false, response: { ok: false, reason: 'cancelled' } };
    }
    if (!extracted.ok) {
        return { ok: false, response: { ok: false, reason: extracted.reason } };
    }
    const plan = context.plan;
    const sendContext = sendContextOf(
        context,
        'transcribe',
        () => {
            return plan;
        },
        totalBytesOf(extracted.paths, audio)
    );
    const sent = await sendPieces(found.pieces, extracted.paths, { ...sendContext, title: context.request.title });
    return sent.ok ? { ok: true, cues: sent.cues, plan, translation: context.access.translation } : { ok: false, response: sent.response };
}

function saveSubtitle(videoPath: string, language: TranslationLanguage, cues: VttCue[], files: SubtitleFileSystem): SubtitleGenerateResponse {
    const target = generatedSubtitlePath(videoPath, language);
    try {
        files.write(target, serializeVtt({ preamble: 'WEBVTT', cues }));
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
        generated: saved.track
    };
}

export async function generateEpisodeSubtitle(
    videoPath: string,
    request: GenerationRequest,
    dependencies: SubtitleGenerationDependencies,
    onProgress: GenerationProgress,
    signal?: AbortSignal
): Promise<SubtitleGenerateResponse> {
    const files = dependencies.files ?? defaultSubtitleFileSystem;
    const audio = dependencies.audio ?? defaultAudioFiles;
    const access = accessFor(request, dependencies);
    if (!access.ok) {
        return { ok: false, reason: access.reason };
    }
    if (isAborted(signal)) {
        return { ok: false, reason: 'cancelled' };
    }
    const directory = audio.makeDirectory();
    try {
        onProgress(0, 1, { phase: 'extracting', plan: access.plan });
        const context: TranscribeContext = { videoPath, directory, request, access, plan: access.plan, dependencies, audio, onProgress, signal };
        const transcribed = access.speech.cutsAtPauses ? await transcribeAtPauses(context) : await transcribeInParts(context);
        if (!transcribed.ok) {
            return transcribed.response;
        }
        if (transcribed.cues.length === 0) {
            return { ok: false, reason: 'no-speech' };
        }
        const { plan, translation } = transcribed;
        let cues = transcribed.cues;
        if (plan === 'transcribe-translate' && translation?.ok === true) {
            onProgress(0, cues.length, { phase: 'translating', plan });
            const translated = await translateCues(
                cues,
                request,
                translation,
                dependencies,
                (done, total) => {
                    onProgress(done, total, { phase: 'translating', plan });
                },
                signal
            );
            if (!translated.ok) {
                return translated.response;
            }
            cues = translated.cues;
        }
        onProgress(0, 1, { phase: 'saving', plan });
        return saveSubtitle(videoPath, request.language, cues, files);
    } finally {
        audio.remove(directory);
    }
}
