import type { AnimeSubtitleTrack, TranslationLanguage } from '@shared/anime';
import { sourceLabelKey } from './subtitleFiles';

const PORTUGUESE_NAMES = ['portuguese', 'português', 'brazil', 'brasil', 'brasileiro'];

const NAMES: Record<TranslationLanguage, readonly string[]> = {
    'Portuguese (Brazil)': PORTUGUESE_NAMES,
    Portuguese: PORTUGUESE_NAMES,
    Spanish: ['spanish', 'español', 'castellano', 'castilian', 'latino', 'latinoamérica'],
    English: ['english', 'inglés', 'anglais', 'englisch'],
    French: ['french', 'français'],
    German: ['german', 'deutsch'],
    Italian: ['italian', 'italiano'],
    Russian: ['russian', 'русский'],
    Japanese: ['japanese', '日本語'],
    Chinese: ['chinese', 'mandarin', 'cantonese', '中文', '简体', '繁體', '繁体'],
    Korean: ['korean', '한국어'],
    Arabic: ['arabic', 'العربية'],
    Turkish: ['turkish', 'türkçe'],
    Indonesian: ['indonesian', 'indonesia', 'bahasa']
};

const PORTUGUESE_CODES = ['pt', 'por'];

const CODES: Record<TranslationLanguage, readonly string[]> = {
    'Portuguese (Brazil)': PORTUGUESE_CODES,
    Portuguese: PORTUGUESE_CODES,
    Spanish: ['es', 'spa'],
    English: ['en', 'eng'],
    French: ['fr', 'fre', 'fra'],
    German: ['de', 'ger', 'deu'],
    Italian: ['it', 'ita'],
    Russian: ['ru', 'rus'],
    Japanese: ['ja', 'jp', 'jpn'],
    Chinese: ['zh', 'chi', 'zho', 'chs', 'cht'],
    Korean: ['ko', 'kor'],
    Arabic: ['ar', 'ara'],
    Turkish: ['tr', 'tur'],
    Indonesian: ['id', 'ind']
};

const CODE_LABEL = /^([a-z]{2,3})(?:[-_ ][a-z0-9]{2,4})?$/;

const MIN_ASCII_LETTERS = 3;

function withoutAccents(text: string): string {
    return text.normalize('NFD').replace(/\p{Mn}/gu, '');
}

function asciiLetters(text: string): number {
    return (text.match(/[a-z]/g) ?? []).length;
}

function formsOf(name: string): string[] {
    const forms = new Set([name, withoutAccents(name)]);
    const fileForm = sourceLabelKey(name);
    if (asciiLetters(fileForm) >= MIN_ASCII_LETTERS) {
        forms.add(fileForm);
    }
    return [...forms];
}

const FORMS = new Map<TranslationLanguage, readonly string[]>();

function formsOfLanguage(language: TranslationLanguage): readonly string[] {
    let forms = FORMS.get(language);
    if (forms === undefined) {
        forms = NAMES[language].flatMap(formsOf);
        FORMS.set(language, forms);
    }
    return forms;
}

export function labelIsInLanguage(label: string, language: TranslationLanguage): boolean {
    const lower = label.trim().toLowerCase();
    const plain = withoutAccents(lower);
    const fileForm = sourceLabelKey(lower);
    const named = formsOfLanguage(language).some((form) => {
        return lower.includes(form) || plain.includes(form) || fileForm.includes(form);
    });
    if (named) {
        return true;
    }
    const code = CODE_LABEL.exec(plain)?.[1];
    return code !== undefined && CODES[language].includes(code);
}

export function hasSubtitleIn(tracks: readonly AnimeSubtitleTrack[], language: TranslationLanguage): boolean {
    return tracks.some((track) => {
        return labelIsInLanguage(track.label, language);
    });
}
