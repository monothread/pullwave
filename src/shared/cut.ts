export type CutMediaKind = 'video' | 'audio';

export interface CutMedia {
    path: string;
    name: string;
    extension: string;
    kind: CutMediaKind;
    durationSeconds: number;
}

export type CutChooseResponse = { ok: true; media: CutMedia } | { ok: false; reason: CutChooseFailure };

export type CutChooseFailure = 'cancelled' | 'unreadable' | 'no-ffmpeg';

export interface CutSegment {
    start: number;
    end: number;
}

export interface CutRequest {
    path: string;
    segments: CutSegment[];
    audioOnly: boolean;
}

export const MAX_CUT_SEGMENTS = 200;

export type CutSegmentStatus = 'waiting' | 'cutting' | 'done' | 'error' | 'cancelled';

export interface CutSegmentState {
    segment: CutSegment;
    status: CutSegmentStatus;
    percent: number;
    outputPath: string | null;
    error: string | null;
}

export type CutRunStatus = 'running' | 'done' | 'cancelled';

export interface CutRun {
    id: number;
    mediaName: string;
    outputDirectory: string;
    audioOnly: boolean;
    status: CutRunStatus;
    segments: CutSegmentState[];
}

export type CutStartFailure = 'busy' | 'invalid' | 'unreadable' | 'no-ffmpeg' | 'folder';

export type CutStartResponse = { ok: true; run: CutRun } | { ok: false; reason: CutStartFailure };

export const CUT_MEDIA_SCHEME = 'pullwave-cut';

export type CutMediaRoute = 'media' | 'preview' | 'thumbnail';

export interface CutPreviewRequest {
    segment: CutSegment;
    convert: boolean;
}

export type CutPreviewResponse = { ok: true; url: string; start: number; end: number; converted: boolean } | { ok: false; reason: CutPreviewFailure };

export type CutPreviewFailure = 'no-file' | 'invalid' | 'no-ffmpeg' | 'failed' | 'cancelled';

export interface CutApi {
    choose: () => Promise<CutChooseResponse>;
    probe: (path: string) => Promise<CutChooseResponse>;
    pathForFile: (file: File) => string;
    start: (request: CutRequest) => Promise<CutStartResponse>;
    cancel: () => Promise<void>;
    current: () => Promise<CutRun | null>;
    onProgress: (listener: (run: CutRun) => void) => () => void;
    thumbnail: () => Promise<string | null>;
    preview: (request: CutPreviewRequest) => Promise<CutPreviewResponse>;
    clear: () => Promise<void>;
}
