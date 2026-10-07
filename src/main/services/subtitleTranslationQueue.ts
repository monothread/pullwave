import type { SubtitleTranslateRequest, SubtitleTranslateResponse } from '@shared/anime';
import { SubtitleJobQueue, type SubtitleJobQueueDependencies } from './subtitleJobQueue';

export type SubtitleTranslationQueueDependencies = SubtitleJobQueueDependencies<SubtitleTranslateRequest, SubtitleTranslateResponse>;

// The episodes whose subtitle is waiting to be translated or being translated (see `SubtitleJobQueue`).
export class SubtitleTranslationQueue extends SubtitleJobQueue<SubtitleTranslateRequest, SubtitleTranslateResponse> {}
