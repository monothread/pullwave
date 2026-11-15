import type { SubtitleGenerateRequest, SubtitleGenerateResponse } from '@shared/anime';
import { SubtitleJobQueue, type SubtitleJobQueueDependencies } from './subtitleJobQueue';

export type SubtitleGenerationQueueDependencies = SubtitleJobQueueDependencies<SubtitleGenerateRequest, SubtitleGenerateResponse>;

export class SubtitleGenerationQueue extends SubtitleJobQueue<SubtitleGenerateRequest, SubtitleGenerateResponse> {}
