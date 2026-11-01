import { providerOf } from '@main/services/aniProvider';

describe('providerOf', () => {
    it('gives the host of the site the script reads from', () => {
        expect(providerOf('#!/bin/sh\nbase_api="https://hianime.at"\nsearch_api="${base_api}/search"')).toBe('hianime.at');
    });

    it('reads the other names ani-cli gave its address, with or without quotes, and writes the host in lower case', () => {
        expect(providerOf('allanime_api="https://api.AllAnime.day"')).toBe('api.allanime.day');
        expect(providerOf('api=https://example.test/v1')).toBe('example.test');
        expect(providerOf("base_api='x'\nbase_api=\"http://one.example:8080/path\"")).toBe('one.example:8080');
    });

    it('is nothing when the script does not say it', () => {
        expect(providerOf('')).toBeNull();
        expect(providerOf('#!/bin/sh\necho hi')).toBeNull();
        expect(providerOf('# base_api="https://commented.example"')).toBeNull();
    });

    it('takes the first one when the script says it more than once', () => {
        expect(providerOf('base_api="https://first.example"\nbase_api="https://second.example"')).toBe('first.example');
    });
});
