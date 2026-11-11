import type { AnimeSubtitleTrack, TranslationLanguage } from '@shared/anime';
import { sourceLabelKey } from './subtitleFiles';

// The names a subtitle in each language can have in its label: in English, in the language itself, and the usual variants (the source names
// the Brazilian one "Portuguese - Brazilian Portuguese", others "Brasil"). Both kinds of Portuguese count as Portuguese.
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

// The codes of each language (ISO 639-1 and 639-2), which only count when the label is a code and nothing else ("pt-BR", "es-419", "eng"):
// inside other words they are too short to be told apart ("de" is also a word of Spanish and Portuguese).
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

// A label that is only a code: two or three letters, and maybe a region after a dash, an underscore or a space ("pt-BR", "es_419", "zh Hans").
const CODE_LABEL = /^([a-z]{2,3})(?:[-_ ][a-z0-9]{2,4})?$/;

// A name with the least letters of the alphabet that is still told apart from other names once the file name took its accents away.
const MIN_ASCII_LETTERS = 3;

function withoutAccents(text: string): string {
    return text.normalize('NFD').replace(/\p{Mn}/gu, '');
}

function asciiLetters(text: string): number {
    return (text.match(/[a-z]/g) ?? []).length;
}

// The ways a name can be written in a label: as it is (an imported or a generated subtitle keeps the letters), without its accents, and as the
// patch of ani-cli writes it in a file name, where every letter outside A to Z became "_" ("Español" is "Espa_ol"). A name the file name turns
// into almost nothing ("Русский" is "_") is not looked for that way, or it would be found in any label.
function formsOf(name: string): string[] {
    const forms = new Set([name, withoutAccents(name)]);
    const fileForm = sourceLabelKey(name);
    if (asciiLetters(fileForm) >= MIN_ASCII_LETTERS) {
        forms.add(fileForm);
    }
    return [...forms];
}

// The forms of the names of each language, worked out once.
const FORMS = new Map<TranslationLanguage, readonly string[]>();

function formsOfLanguage(language: TranslationLanguage): readonly string[] {
    let forms = FORMS.get(language);
    if (forms === undefined) {
        forms = NAMES[language].flatMap(formsOf);
        FORMS.set(language, forms);
    }
    return forms;
}

// Whether the label of a subtitle says it is in the language: one of the names of the language is in it (in any of the ways it can be written),
// or the label is a code of the language.
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

// Whether one of the subtitles of the episode is in the language, whatever its kind (one of the source, the one ani-cli picked, an imported one,
// one made from the audio or a translation). It leans to yes: an episode taken for one that has the subtitle is left as it is, which costs
// nothing, while one translated for nothing spends the user's token.
export function hasSubtitleIn(tracks: readonly AnimeSubtitleTrack[], language: TranslationLanguage): boolean {
    return tracks.some((track) => {
        return labelIsInLanguage(track.label, language);
    });
}
