import { formatVttTime, parseVtt, serializeVtt, shiftCues, shiftTiming } from '@main/services/vttCues';

const VTT = [
    'WEBVTT',
    '',
    '1',
    '00:00:01.000 --> 00:00:03.000',
    'Hello',
    '',
    '00:00:04.000 --> 00:00:06.000 align:start',
    'Two lines',
    'of text',
    ''
].join('\n');

describe('parseVtt', () => {
    it('reads the cues with and without an identifier, keeping the line breaks of what is said', () => {
        expect(parseVtt(VTT)).toEqual({
            preamble: 'WEBVTT',
            cues: [
                { id: '1', timing: '00:00:01.000 --> 00:00:03.000', text: 'Hello' },
                { id: null, timing: '00:00:04.000 --> 00:00:06.000 align:start', text: 'Two lines\nof text' }
            ]
        });
    });

    it('keeps the blocks before the first cue in the preamble', () => {
        const parsed = parseVtt('WEBVTT - title\n\nSTYLE\n::cue { color: red }\n\n00:00:01.000 --> 00:00:02.000\nHi\n');
        expect(parsed.preamble).toBe('WEBVTT - title\n\nSTYLE\n::cue { color: red }');
        expect(parsed.cues).toEqual([{ id: null, timing: '00:00:01.000 --> 00:00:02.000', text: 'Hi' }]);
    });

    it('drops the notes that sit between the cues', () => {
        const parsed = parseVtt('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nA\n\nNOTE a comment\n\n00:00:03.000 --> 00:00:04.000\nB\n');
        expect(parsed.cues.map((cue) => {
            return cue.text;
        })).toEqual(['A', 'B']);
    });

    it('accepts windows line endings, a byte order mark and lines with only spaces between blocks', () => {
        const parsed = parseVtt('﻿WEBVTT\r\n\r\n00:00:01.000 --> 00:00:02.000\r\nA\r\n \r\n00:00:03.000 --> 00:00:04.000\r\nB\r\n');
        expect(parsed).toEqual({
            preamble: 'WEBVTT',
            cues: [
                { id: null, timing: '00:00:01.000 --> 00:00:02.000', text: 'A' },
                { id: null, timing: '00:00:03.000 --> 00:00:04.000', text: 'B' }
            ]
        });
    });

    it('keeps a cue with no text', () => {
        expect(parseVtt('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n').cues).toEqual([
            { id: null, timing: '00:00:01.000 --> 00:00:02.000', text: '' }
        ]);
    });

    it('does not take a block with the arrow after the second line for a cue', () => {
        const parsed = parseVtt('WEBVTT\n\na\nb\n00:00:01.000 --> 00:00:02.000\nc\n');
        expect(parsed).toEqual({ preamble: 'WEBVTT\n\na\nb\n00:00:01.000 --> 00:00:02.000\nc', cues: [] });
    });

    it('gives no cues for an empty text', () => {
        expect(parseVtt('')).toEqual({ preamble: '', cues: [] });
    });
});

describe('serializeVtt', () => {
    it('writes back what parseVtt read', () => {
        expect(serializeVtt(parseVtt(VTT))).toBe(`${VTT}`);
    });

    it('writes the cues in blocks, with the identifier before the times', () => {
        expect(serializeVtt({
            preamble: 'WEBVTT',
            cues: [
                { id: 'a', timing: '00:00:01.000 --> 00:00:02.000', text: 'Olá' },
                { id: null, timing: '00:00:03.000 --> 00:00:04.000', text: 'Tchau\nagora' }
            ]
        })).toBe('WEBVTT\n\na\n00:00:01.000 --> 00:00:02.000\nOlá\n\n00:00:03.000 --> 00:00:04.000\nTchau\nagora\n');
    });

    it('starts with WEBVTT when the preamble is empty', () => {
        expect(serializeVtt({ preamble: '', cues: [] })).toBe('WEBVTT\n');
    });
});

describe('shiftTiming', () => {
    it('moves both times later, and writes them with the hours', () => {
        expect(shiftTiming('00:01.000 --> 00:03.500', 600)).toBe('00:10:01.000 --> 00:10:03.500');
    });

    it('reads times that have the hours', () => {
        expect(shiftTiming('01:02:03.004 --> 01:02:04.000', 1)).toBe('01:02:04.004 --> 01:02:05.000');
    });

    it('keeps the settings of the cue as they are', () => {
        expect(shiftTiming('00:00.000 --> 00:02.000 align:start position:10%', 60)).toBe('00:01:00.000 --> 00:01:02.000 align:start position:10%');
    });

    it('writes the hours even when it does not move anything', () => {
        expect(shiftTiming('00:01.000 --> 00:02.000', 0)).toBe('00:00:01.000 --> 00:00:02.000');
    });

    it('carries the minutes into the hours', () => {
        expect(shiftTiming('59:59.000 --> 59:59.500', 600)).toBe('01:09:59.000 --> 01:09:59.500');
    });

    it('moves by a part of a second and rounds to the millisecond', () => {
        expect(shiftTiming('00:01.000 --> 00:02.250', 0.5)).toBe('00:00:01.500 --> 00:00:02.750');
        expect(shiftTiming('00:00.000 --> 00:00.001', 0.0004)).toBe('00:00:00.000 --> 00:00:00.001');
    });

    it('leaves a line with no time as it is', () => {
        expect(shiftTiming('not a timing', 600)).toBe('not a timing');
    });
});

describe('shiftCues', () => {
    const CUES = [
        { id: '1', timing: '00:01.000 --> 00:03.000', text: 'Hello' },
        { id: null, timing: '00:04.000 --> 00:06.000 align:start', text: 'Two lines\nof text' }
    ];

    it('moves the times, keeps what is said and drops the identifiers (the ones of other parts would repeat)', () => {
        expect(shiftCues(CUES, 600)).toEqual([
            { id: null, timing: '00:10:01.000 --> 00:10:03.000', text: 'Hello' },
            { id: null, timing: '00:10:04.000 --> 00:10:06.000 align:start', text: 'Two lines\nof text' }
        ]);
    });

    it('does not change the cues it was given', () => {
        shiftCues(CUES, 600);
        expect(CUES[0]).toEqual({ id: '1', timing: '00:01.000 --> 00:03.000', text: 'Hello' });
    });

    it('gives nothing for no cues', () => {
        expect(shiftCues([], 600)).toEqual([]);
    });
});

describe('formatVttTime', () => {
    it.each([
        [0, '00:00:00.000'],
        [1.5, '00:00:01.500'],
        [59.999, '00:00:59.999'],
        [60, '00:01:00.000'],
        [602.25, '00:10:02.250'],
        [3661.007, '01:01:01.007'],
        [36000, '10:00:00.000']
    ])('writes %s seconds as %s', (seconds, text) => {
        expect(formatVttTime(seconds)).toBe(text);
    });

    it('rounds to the millisecond', () => {
        expect(formatVttTime(1.0004)).toBe('00:00:01.000');
        expect(formatVttTime(1.0006)).toBe('00:00:01.001');
    });
});
