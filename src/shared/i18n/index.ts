import type { LanguageCode } from '../types';
import { en } from './en';
import { es } from './es';
import { ja } from './ja';
import { pt } from './pt';
import { zh } from './zh';
import { translatorFor, type Messages, type Translator } from './core';

export * from './core';

export const CATALOGS: Record<LanguageCode, Messages> = { en, pt, es, zh, ja };

export function createTranslator(language: LanguageCode): Translator {
    return translatorFor(CATALOGS[language]);
}
