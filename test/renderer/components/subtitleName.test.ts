import type { LanguageCode } from '@shared/types';
import { cleanSubtitleName, subtitleDisplayName, subtitleDisplayNames } from '@renderer/components/subtitleName';

const LANGUAGES: readonly LanguageCode[] = ['en', 'pt', 'es', 'ja', 'zh'];

// The names the source wrote for one anime, and how each language of the app writes them.
const REAL_NAMES: ReadonlyArray<readonly [string, Record<LanguageCode, string>]> = [
    ['Arabic', { en: 'Arabic', pt: 'Árabe', es: 'Árabe', ja: 'アラビア語', zh: '阿拉伯语' }],
    ['English', { en: 'English', pt: 'Inglês', es: 'Inglés', ja: '英語', zh: '英语' }],
    ['French', { en: 'French', pt: 'Francês', es: 'Francés', ja: 'フランス語', zh: '法语' }],
    ['German', { en: 'German', pt: 'Alemão', es: 'Alemán', ja: 'ドイツ語', zh: '德语' }],
    ['Italian', { en: 'Italian', pt: 'Italiano', es: 'Italiano', ja: 'イタリア語', zh: '意大利语' }],
    [
        'Portuguese (- Portuguese(Brazil))',
        { en: 'Portuguese (Brazil)', pt: 'Português (Brasil)', es: 'Portugués (Brasil)', ja: 'ポルトガル語 (ブラジル)', zh: '葡萄牙语（巴西）' }
    ],
    ['Russian', { en: 'Russian', pt: 'Russo', es: 'Ruso', ja: 'ロシア語', zh: '俄语' }],
    ['Spanish', { en: 'Spanish', pt: 'Espanhol', es: 'Español', ja: 'スペイン語', zh: '西班牙语' }],
    [
        'Spanish (- Spanish(Latin America))',
        { en: 'Spanish (Latin America)', pt: 'Espanhol (América Latina)', es: 'Español (Latinoamérica)', ja: 'スペイン語 (ラテンアメリカ)', zh: '西班牙语（拉丁美洲）' }
    ]
];

describe('subtitleDisplayName', () => {
    describe.each(REAL_NAMES)('%s', (label, written) => {
        it.each(LANGUAGES)('is written in "%s"', (language) => {
            expect(subtitleDisplayName(label, language)).toBe(written[language]);
        });
    });

    it('starts with a capital letter, as the names of languages do in the lists of the app', () => {
        expect(subtitleDisplayName('English', 'pt')).toBe('Inglês');
        expect(subtitleDisplayName('Portuguese (- Portuguese(Brazil))', 'es')).toBe('Portugués (Brasil)');
    });

    it('reads a region written with a country that is not the language, and a plain one', () => {
        expect(subtitleDisplayName('Portuguese (Portugal)', 'pt')).toBe('Português (Portugal)');
        expect(subtitleDisplayName('Portuguese (- Portuguese(Portugal))', 'en')).toBe('Portuguese (Portugal)');
        expect(subtitleDisplayName('Spanish (- Spanish(Mexico))', 'pt')).toBe('Espanhol (México)');
    });

    it('reads a region written after the dash, without a second pair of parentheses', () => {
        expect(subtitleDisplayName('Portuguese (- Brazil)', 'pt')).toBe('Português (Brasil)');
    });

    it('does not repeat the language as if it were a region', () => {
        expect(subtitleDisplayName('Spanish (- Spanish)', 'pt')).toBe('Espanhol');
        expect(subtitleDisplayName('Spanish (Spanish)', 'en')).toBe('Spanish');
    });

    it('knows a language by its English name whatever the case and the spaces around it', () => {
        expect(subtitleDisplayName(' english ', 'pt')).toBe('Inglês');
        expect(subtitleDisplayName('ENGLISH', 'es')).toBe('Inglés');
    });

    it('keeps a region it does not know as it was written, with the language in the language of the app', () => {
        expect(subtitleDisplayName('Portuguese (- Portuguese(Narnia))', 'pt')).toBe('Português (Narnia)');
        expect(subtitleDisplayName('Portuguese - Narnia', 'pt')).toBe('Português (Narnia)');
    });

    it('reads the way of writing of Chinese in both forms of names', () => {
        expect(subtitleDisplayName('Chinese (- Chinese(Simplified))', 'es')).toBe('Chino (simplificado)');
        expect(subtitleDisplayName('Chinese - Traditional', 'pt')).toBe('Chinês (tradicional)');
    });

    it('shows a language it does not know clean and in English', () => {
        expect(subtitleDisplayName('Klingon', 'pt')).toBe('Klingon');
        expect(subtitleDisplayName('Klingon (- Klingon(Qo))', 'pt')).toBe('Klingon (Qo)');
    });

    it('leaves alone what is not the name of a language of the source', () => {
        ['Default', 'Subtitles', 'aula', 'Português'].forEach((label) => {
            expect(subtitleDisplayName(label, 'pt')).toBe(label);
        });
    });

    it('gives back what it cannot read as it came', () => {
        ['', '___', 'English (', 'English 2', '(English)', 'English / CC', 'English -', 'Engl1sh - SDH', 'Portugu_s - Brasil'].forEach((label) => {
            expect(subtitleDisplayName(label, 'pt')).toBe(label);
        });
    });
});

// The names other sources write, "Language - Variant", with the tags of the subtitles for the deaf (SDH), the closed captions (CC) and the
// forced ones, and how each language of the app writes them.
const DASHED_NAMES: ReadonlyArray<readonly [string, Record<LanguageCode, string>]> = [
    ['Portuguese - Brazilian', { en: 'Portuguese (Brazil)', pt: 'Português (Brasil)', es: 'Portugués (Brasil)', ja: 'ポルトガル語 (ブラジル)', zh: '葡萄牙语（巴西）' }],
    [
        'Portuguese - Brazilian (SDH)',
        { en: 'Portuguese (Brazil) · SDH', pt: 'Português (Brasil) · SDH', es: 'Portugués (Brasil) · SDH', ja: 'ポルトガル語 (ブラジル) · SDH', zh: '葡萄牙语（巴西） · SDH' }
    ],
    ['English - SDH', { en: 'English · SDH', pt: 'Inglês · SDH', es: 'Inglés · SDH', ja: '英語 · SDH', zh: '英语 · SDH' }],
    ['English - Forced', { en: 'English · Forced', pt: 'Inglês · Forçada', es: 'Inglés · Forzado', ja: '英語 · 強制', zh: '英语 · 强制' }],
    ['English (CC)', { en: 'English · CC', pt: 'Inglês · CC', es: 'Inglés · CC', ja: '英語 · CC', zh: '英语 · CC' }],
    ['English - SDH - Forced', { en: 'English · SDH · Forced', pt: 'Inglês · SDH · Forçada', es: 'Inglés · SDH · Forzado', ja: '英語 · SDH · 強制', zh: '英语 · SDH · 强制' }],
    ['Spanish - Latin American', { en: 'Spanish (Latin America)', pt: 'Espanhol (América Latina)', es: 'Español (Latinoamérica)', ja: 'スペイン語 (ラテンアメリカ)', zh: '西班牙语（拉丁美洲）' }],
    ['Spanish - European', { en: 'Spanish (Spain)', pt: 'Espanhol (Espanha)', es: 'Español (España)', ja: 'スペイン語 (スペイン)', zh: '西班牙语（西班牙）' }],
    [
        'French - European (SDH)',
        { en: 'French (France) · SDH', pt: 'Francês (França) · SDH', es: 'Francés (Francia) · SDH', ja: 'フランス語 (フランス) · SDH', zh: '法语（法国） · SDH' }
    ],
    ['Chinese - Simplified', { en: 'Chinese (Simplified)', pt: 'Chinês (simplificado)', es: 'Chino (simplificado)', ja: '中国語 (簡体字)', zh: '中文（简体）' }],
    ['Arabic - Saudi Arabia', { en: 'Arabic (Saudi Arabia)', pt: 'Árabe (Arábia Saudita)', es: 'Árabe (Arabia Saudí)', ja: 'アラビア語 (サウジアラビア)', zh: '阿拉伯语（沙特阿拉伯）' }],
    ['German - SDH', { en: 'German · SDH', pt: 'Alemão · SDH', es: 'Alemán · SDH', ja: 'ドイツ語 · SDH', zh: '德语 · SDH' }]
];

describe('subtitleDisplayName of the names "Language - Variant"', () => {
    describe.each(DASHED_NAMES)('%s', (label, written) => {
        it.each(LANGUAGES)('is written in "%s"', (language) => {
            expect(subtitleDisplayName(label, language)).toBe(written[language]);
        });
    });

    it('takes "European" for the country of the language', () => {
        expect(subtitleDisplayName('Portuguese - European', 'pt')).toBe('Português (Portugal)');
        expect(subtitleDisplayName('English - European', 'en')).toBe('English (United Kingdom)');
    });

    it('keeps "European" as it was written for a language that has no country of its own here', () => {
        expect(subtitleDisplayName('German - European', 'pt')).toBe('Alemão (European)');
    });

    it('does not repeat the language as if it were a region', () => {
        expect(subtitleDisplayName('Spanish - Spanish', 'pt')).toBe('Espanhol');
    });

    it('takes a tag between parentheses only when it is one it knows', () => {
        expect(subtitleDisplayName('English (Forced)', 'pt')).toBe('Inglês · Forçada');
        expect(subtitleDisplayName('English (Signs)', 'pt')).toBe('Inglês (Signs)');
    });

    it('shows a language it does not know clean and in English, with its tags', () => {
        expect(subtitleDisplayName('Klingon - Qo', 'pt')).toBe('Klingon (Qo)');
        expect(subtitleDisplayName('Klingon - SDH', 'pt')).toBe('Klingon · SDH');
    });
});

describe('cleanSubtitleName', () => {
    it('takes the noise out and keeps the language and the region in English', () => {
        expect(cleanSubtitleName('Portuguese (- Portuguese(Brazil))')).toBe('Portuguese (Brazil)');
        expect(cleanSubtitleName('Spanish (- Spanish(Latin America))')).toBe('Spanish (Latin America)');
        expect(cleanSubtitleName('Portuguese (- Brazil)')).toBe('Portuguese (Brazil)');
        expect(cleanSubtitleName('Spanish (- Spanish)')).toBe('Spanish');
    });

    it('leaves a name without noise, and what it cannot read, as it is', () => {
        expect(cleanSubtitleName('English')).toBe('English');
        expect(cleanSubtitleName('Portuguese (Brazil)')).toBe('Portuguese (Brazil)');
        expect(cleanSubtitleName('___')).toBe('___');
    });

    it('writes the names "Language - Variant" with the variant between parentheses and the tags after it, in English', () => {
        expect(cleanSubtitleName('Portuguese - Brazilian')).toBe('Portuguese (Brazilian)');
        expect(cleanSubtitleName('Portuguese - Brazilian (SDH)')).toBe('Portuguese (Brazilian) · SDH');
        expect(cleanSubtitleName('English - SDH')).toBe('English · SDH');
        expect(cleanSubtitleName('English - Forced')).toBe('English · Forced');
        expect(cleanSubtitleName('English (CC)')).toBe('English · CC');
    });
});

describe('subtitleDisplayNames', () => {
    it('writes every name of the list, in order', () => {
        expect(subtitleDisplayNames(REAL_NAMES.map((entry) => {
            return entry[0];
        }), 'pt')).toEqual(REAL_NAMES.map((entry) => {
            return entry[1].pt;
        }));
    });

    it('tells apart two names that would be written the same: the second is shown clean, in English', () => {
        expect(subtitleDisplayNames(['Portuguese (- Portuguese(Brazil))', 'Portuguese (Brazil)'], 'pt')).toEqual(['Português (Brasil)', 'Portuguese (Brazil)']);
        expect(subtitleDisplayNames(['Spanish', 'spanish'], 'pt')).toEqual(['Espanhol', 'spanish']);
    });

    it('shows the second as it came when even the clean name is taken', () => {
        expect(subtitleDisplayNames(['Spanish', 'Portuguese', 'Spanish'], 'en')).toEqual(['Spanish', 'Portuguese', 'Spanish']);
        expect(subtitleDisplayNames(['English', 'english', 'English '], 'en')).toEqual(['English', 'english', 'English ']);
    });

    it('writes every track of an episode whose source names them "Language - Variant", each told apart', () => {
        const labels = ['Portuguese - Brazilian', 'Portuguese - Brazilian (SDH)', 'English', 'English - SDH', 'English - Forced', 'Spanish - European', 'Spanish - Latin American', 'Spanish - Latin American (SDH)'];
        expect(subtitleDisplayNames(labels, 'pt')).toEqual([
            'Português (Brasil)',
            'Português (Brasil) · SDH',
            'Inglês',
            'Inglês · SDH',
            'Inglês · Forçada',
            'Espanhol (Espanha)',
            'Espanhol (América Latina)',
            'Espanhol (América Latina) · SDH'
        ]);
    });

    it('is empty for an empty list', () => {
        expect(subtitleDisplayNames([], 'pt')).toEqual([]);
    });
});
