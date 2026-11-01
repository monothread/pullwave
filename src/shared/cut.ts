// Types of the cutter of the video downloader: a video or audio file is cut into the parts the user marks, each part a file of its own.

export type CutMediaKind = 'video' | 'audio';

// The file the user chose, as ffmpeg read it.
export interface CutMedia {
    path: string;
    // The name without the folder and without the extension.
    name: string;
    // With the dot, in lower case (".mp4").
    extension: string;
    kind: CutMediaKind;
    durationSeconds: number;
}

export type CutChooseResponse = { ok: true; media: CutMedia } | { ok: false; reason: CutChooseFailure };

// `cancelled`: the user closed the window of the files. `unreadable`: ffmpeg did not find a video or an audio in the file.
// `no-ffmpeg`: ffmpeg could not be started.
export type CutChooseFailure = 'cancelled' | 'unreadable' | 'no-ffmpeg';

// A part to keep, in seconds from the start of the file.
export interface CutSegment {
    start: number;
    end: number;
}

export interface CutRequest {
    path: string;
    segments: CutSegment[];
    // Only for a video: each part is an audio file, in the audio format of the settings.
    audioOnly: boolean;
}

export const MAX_CUT_SEGMENTS = 200;

export type CutSegmentStatus = 'waiting' | 'cutting' | 'done' | 'error' | 'cancelled';

export interface CutSegmentState {
    segment: CutSegment;
    status: CutSegmentStatus;
    // 0 to 100.
    percent: number;
    // The file that was made (when the part is done).
    outputPath: string | null;
    // What ffmpeg said when the part failed.
    error: string | null;
}

export type CutRunStatus = 'running' | 'done' | 'cancelled';

// A cut, as the screen follows it: it is sent whole at every change.
export interface CutRun {
    id: number;
    mediaName: string;
    // The folder the parts are saved in.
    outputDirectory: string;
    audioOnly: boolean;
    status: CutRunStatus;
    segments: CutSegmentState[];
}

export type CutStartFailure = 'busy' | 'invalid' | 'unreadable' | 'no-ffmpeg' | 'folder';

export type CutStartResponse = { ok: true; run: CutRun } | { ok: false; reason: CutStartFailure };

// The scheme the cutter serves its files on: the file chosen (`media/<token>`), a part converted for the preview (`preview/<id>`) and the
// picture of the file (`thumbnail/<id>`). The address carries a number, never a path.
export const CUT_MEDIA_SCHEME = 'pullwave-cut';

export type CutMediaRoute = 'media' | 'preview' | 'thumbnail';

// A part to see in the player before it is cut. `convert`: the player could not play the file as it is, so the part is made into a file it
// plays (a video as H.264/AAC, an audio as AAC).
export interface CutPreviewRequest {
    segment: CutSegment;
    convert: boolean;
}

// What the player plays: the address and the part of it to play, in seconds (the whole file for a part that was converted).
export type CutPreviewResponse = { ok: true; url: string; start: number; end: number; converted: boolean } | { ok: false; reason: CutPreviewFailure };

// `no-file`: no file is chosen. `invalid`: the part is not inside the file. `no-ffmpeg`: ffmpeg could not be started. `failed`: ffmpeg could
// not make the part. `cancelled`: another preview was asked for before this one was ready.
export type CutPreviewFailure = 'no-file' | 'invalid' | 'no-ffmpeg' | 'failed' | 'cancelled';

export interface CutApi {
    // Opens the window of the files, and reads the one that is chosen.
    choose: () => Promise<CutChooseResponse>;
    // Reads a file that is already known by its path (a file dropped on the screen).
    probe: (path: string) => Promise<CutChooseResponse>;
    // The path of a file the user dropped on the window; empty when the system gives none for it (a file that is not on the disk).
    pathForFile: (file: File) => string;
    start: (request: CutRequest) => Promise<CutStartResponse>;
    // Ends the cut that goes on: the part being made is deleted and the rest is not made.
    cancel: () => Promise<void>;
    // The cut that goes on (or the last one), for a screen that opens later.
    current: () => Promise<CutRun | null>;
    onProgress: (listener: (run: CutRun) => void) => () => void;
    // The picture of the file chosen (a frame of a video, the cover of an audio), or null when it has none.
    thumbnail: () => Promise<string | null>;
    // Where to play a part before it is cut.
    preview: (request: CutPreviewRequest) => Promise<CutPreviewResponse>;
    // Forgets the file chosen and removes the files made for its preview and its picture (the file itself stays where it is).
    clear: () => Promise<void>;
}
