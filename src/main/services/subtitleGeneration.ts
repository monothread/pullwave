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
import { AUDIO_BYTES_PER_SECOND, defaultAudioFiles, extractAudioParts, probeAudio, type AudioFiles, type FfmpegRunner } from './audioExtractor';
import type { SpeechTask } from './speechProviders';
import { defaultSubtitleFileSystem, generatedSubtitlePath, listSubtitleFiles, type SubtitleFileSystem } from './subtitleFiles';
import type { LlmAccess } from './subtitleTranslation';
import { defaultSleep, MAX_RATE_LIMIT_WAITS, translateTexts, waitSecondsOf } from './subtitleTranslator';
import { parseVtt, serializeVtt, shiftCues, type VttCue } from './vttCues';

// What a part of the audio is sent with: what to do with it, the audio, a name for the file, the language that is spoken (its two letters and its
// name) and the one of the subtitle (its name), and the signal.
export interface SpeechInput {
    task: SpeechTask;
    audio: Uint8Array;
    fileName: string;
    languageCode: string;
    audioLanguage: TranscriptionLanguage;
    language: TranslationLanguage;
    signal?: AbortSignal;
}

// What the service of speech to text is asked with: where it is, which model, and the token. `reason` says what the settings lack when it
// cannot be asked. `ask` writes what is said in a part of the audio (`transcribe`) or writes it at once in the language that is wanted
// (`translate`: only in English for the service that speaks the protocol of OpenAI, in any language for Gemini, which `translatesTo` says).
export type SpeechAccess =
    | { ok: true; translatesTo: SpeechTranslatesTo; ask: (input: SpeechInput) => Promise<LlmCompletionResult> }
    | { ok: false; reason: 'no-token' | 'no-model' | 'no-address' };

export interface SubtitleGenerationDependencies {
    speech: () => SpeechAccess;
    // What translates the text, for the plans that need it: the language model of the settings.
    translation: () => LlmAccess;
    ffmpeg: FfmpegRunner;
    audio?: AudioFiles;
    files?: SubtitleFileSystem;
    sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

// What a report of progress says besides how far it is: the phase, the plan (which can change while it goes) and, while the parts are sent,
// how many bytes of audio were sent out of all of them.
export interface GenerationProgressExtra {
    phase: SubtitleGenerationPhase;
    plan: SubtitleGeneratePlan;
    sentBytes?: number;
    totalBytes?: number;
}

export type GenerationProgress = (done: number, total: number, extra: GenerationProgressExtra) => void;

// Read again every time: the signal can be aborted while an await is going on.
function isAborted(signal?: AbortSignal): boolean {
    return signal?.aborted === true;
}

const TRANSLATION_FAILURES: Record<'no-token' | 'no-model' | 'no-address', SubtitleGenerateFailure> = {
    'no-token': 'no-translation-token',
    'no-model': 'no-translation-model',
    'no-address': 'no-translation-address'
};

// How long the audio of the video is, in how many parts (requests) it goes and about how many bytes that is, without asking the service
// anything.
export async function estimateSubtitleGeneration(videoPath: string, ffmpeg: FfmpegRunner): Promise<SubtitleGenerateEstimateResponse> {
    const probe = await probeAudio(videoPath, ffmpeg);
    if (!probe.ok) {
        return { ok: false, reason: probe.reason };
    }
    return {
        ok: true,
        seconds: probe.seconds,
        parts: Math.max(1, Math.ceil(probe.seconds / SPEECH_PART_SECONDS)),
        approxBytes: Math.round(probe.seconds * AUDIO_BYTES_PER_SECOND)
    };
}

// Asks for the subtitle of one part. When the service asks to slow down the request waits and goes on, up to a few times.
async function askPart(input: Omit<SpeechInput, 'signal'>, access: Extract<SpeechAccess, { ok: true }>, dependencies: SubtitleGenerationDependencies, signal?: AbortSignal): Promise<LlmCompletionResult> {
    const sleep = dependencies.sleep ?? defaultSleep;
    let waits = 0;
    for (;;) {
        if (isAborted(signal)) {
            return { ok: false, error: { code: 'CANCELLED', raw: 'The subtitle was cancelled.' } };
        }
        const result = await access.ask({ ...input, signal });
        if (result.ok || result.error.code !== 'RATE_LIMITED' || waits >= MAX_RATE_LIMIT_WAITS) {
            return result;
        }
        waits += 1;
        await sleep(waitSecondsOf(result.error) * 1000, signal);
    }
}

type PartsResult =
    | { ok: true; cues: VttCue[] }
    // `refused` is set when the very first part was answered with something that is not a subtitle: the service does not do what was asked.
    | { ok: false; response: SubtitleGenerateResponse; refused: boolean };

interface SendContext {
    task: SpeechTask;
    audioLanguage: TranscriptionLanguage;
    language: TranslationLanguage;
    access: Extract<SpeechAccess, { ok: true }>;
    dependencies: SubtitleGenerationDependencies;
    audio: AudioFiles;
    report: (done: number, total: number, sentBytes: number) => void;
    signal?: AbortSignal;
}

// Sends the parts one after the other, and puts what comes back together: the times of each part are moved to where it starts.
async function sendParts(paths: readonly string[], context: SendContext): Promise<PartsResult> {
    const cues: VttCue[] = [];
    let sentBytes = 0;
    context.report(0, paths.length, 0);
    for (const [index, path] of paths.entries()) {
        const input = {
            task: context.task,
            audio: context.audio.read(path),
            fileName: `part-${index}.mp3`,
            languageCode: TRANSCRIPTION_LANGUAGE_CODES[context.audioLanguage],
            audioLanguage: context.audioLanguage,
            language: context.language
        };
        const result = await askPart(input, context.access, context.dependencies, context.signal);
        if (!result.ok) {
            const response: SubtitleGenerateResponse = result.error.code === 'CANCELLED' ? { ok: false, reason: 'cancelled' } : { ok: false, reason: 'failed', error: result.error };
            return { ok: false, response, refused: index === 0 && result.error.code === 'BAD_RESPONSE' };
        }
        cues.push(...shiftCues(parseVtt(result.text).cues, index * SPEECH_PART_SECONDS));
        sentBytes += context.audio.size(path);
        context.report(index + 1, paths.length, sentBytes);
    }
    return { ok: true, cues };
}

type Translated = { ok: true; cues: VttCue[] } | { ok: false; response: SubtitleGenerateResponse };

// Translates what is said in the cues into a language, keeping their times.
async function translateCues(
    cues: readonly VttCue[],
    language: TranslationLanguage,
    translation: Extract<LlmAccess, { ok: true }>,
    dependencies: SubtitleGenerationDependencies,
    report: (done: number, total: number) => void,
    signal?: AbortSignal
): Promise<Translated> {
    const result = await translateTexts(
        cues.map((cue) => {
            return cue.text;
        }),
        language,
        {
            complete: (system, user) => {
                return translation.ask(system, user, signal);
            },
            sleep: dependencies.sleep,
            signal,
            onProgress: report
        }
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

// What the plan needs before anything is sent: the service of speech to text, and the language model when the text has to be translated.
type Access = { ok: true; speech: Extract<SpeechAccess, { ok: true }>; translation: LlmAccess | null } | { ok: false; reason: SubtitleGenerateFailure };

function accessFor(request: { audioLanguage: TranscriptionLanguage; language: TranslationLanguage }, dependencies: SubtitleGenerationDependencies): Access & { plan: SubtitleGeneratePlan } {
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

// Makes the subtitle of an episode from its audio, in the language that is wanted: the audio is taken out of the video in parts, each one
// goes to the service of speech to text (which writes what is said, or writes it in English at once), the text is translated when the plan
// needs it, and the result is saved next to the video as a subtitle of its own, in the language that is wanted. What was there for that
// language is replaced. Nothing is checked or sent before everything the plan needs is in the settings; when the direct translation into
// English is refused by the service, the audio goes again as a transcription, to be translated afterwards.
export async function generateEpisodeSubtitle(
    videoPath: string,
    request: { audioLanguage: TranscriptionLanguage; language: TranslationLanguage },
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
    let { plan } = access;
    if (isAborted(signal)) {
        return { ok: false, reason: 'cancelled' };
    }
    const directory = audio.makeDirectory();
    try {
        onProgress(0, 1, { phase: 'extracting', plan });
        const parts = await extractAudioParts(videoPath, directory, dependencies.ffmpeg, audio, signal);
        if (isAborted(signal)) {
            return { ok: false, reason: 'cancelled' };
        }
        if (!parts.ok) {
            return { ok: false, reason: parts.reason };
        }
        const totalBytes = parts.paths.reduce((total, path) => {
            return total + audio.size(path);
        }, 0);
        const send = (task: SpeechTask): Promise<PartsResult> => {
            return sendParts(parts.paths, {
                task,
                audioLanguage: request.audioLanguage,
                language: request.language,
                access: access.speech,
                dependencies,
                audio,
                report: (done, total, sentBytes) => {
                    onProgress(done, total, { phase: 'sending', plan, sentBytes, totalBytes });
                },
                signal
            });
        };
        let translation = access.translation;
        let sent = await send(plan === 'direct' ? 'translate' : 'transcribe');
        if (!sent.ok && plan === 'direct' && sent.refused) {
            const fallback = dependencies.translation();
            if (!fallback.ok) {
                return { ok: false, reason: TRANSLATION_FAILURES[fallback.reason] };
            }
            translation = fallback;
            plan = 'transcribe-translate';
            sent = await send('transcribe');
        }
        if (!sent.ok) {
            return sent.response;
        }
        if (sent.cues.length === 0) {
            return { ok: false, reason: 'no-speech' };
        }
        let cues = sent.cues;
        if (plan === 'transcribe-translate' && translation?.ok === true) {
            onProgress(0, cues.length, { phase: 'translating', plan });
            const translated = await translateCues(
                cues,
                request.language,
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
        const target = generatedSubtitlePath(videoPath, request.language);
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
    } finally {
        audio.remove(directory);
    }
}
