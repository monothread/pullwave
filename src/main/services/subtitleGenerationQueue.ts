import type { SubtitleGenerateRequest, SubtitleGenerateResponse } from '@shared/anime';
import { SubtitleJobQueue, type SubtitleJobQueueDependencies } from './subtitleJobQueue';

export type SubtitleGenerationQueueDependencies = SubtitleJobQueueDependencies<SubtitleGenerateRequest, SubtitleGenerateResponse>;

// The episodes whose subtitle is waiting to be made from the audio or being made (see `SubtitleJobQueue`).
export class SubtitleGenerationQueue extends SubtitleJobQueue<SubtitleGenerateRequest, SubtitleGenerateResponse> {}
