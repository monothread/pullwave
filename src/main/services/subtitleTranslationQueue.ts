import type { SubtitleTranslateRequest, SubtitleTranslateResponse } from '@shared/anime';
import { SubtitleJobQueue, type SubtitleJobQueueDependencies } from './subtitleJobQueue';

export type SubtitleTranslationQueueDependencies = SubtitleJobQueueDependencies<SubtitleTranslateRequest, SubtitleTranslateResponse>;

export class SubtitleTranslationQueue extends SubtitleJobQueue<SubtitleTranslateRequest, SubtitleTranslateResponse> {}
