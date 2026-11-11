import { join } from 'node:path';
import { MAX_SUBTITLE_BYTES, type AniRunResult, type AnimeSearchResult } from '@shared/anime';
import type { ResolvedSubtitles } from '@main/services/aniStream';
import { checkSubtitles, type SubtitleCheckDependencies } from '@main/services/subtitleCheck';
import type { SubtitleFileSystem } from '@main/services/subtitleFiles';
import { makeAnime, makeEpisode } from '../../helpers/animeFixtures';

const DIR = join('/lib', 'Naruto');
const VIDEO = join(DIR, 'Naruto Episode 1.mp4');
const anime = makeAnime([], { id: 3, title: 'Naruto', query: 'naruto', searchIndex: 2 });
const episode = makeEpisode({ id: 7, animeId: 3, number: '1', filePath: VIDEO });
const REFERER = 'https://embed.example/';
const VTT = 'WEBVTT\n\n00:00.000 --> 00:01.000\nhello\n';

function memory(contents: Record<string, string> = {}): SubtitleFileSystem & { written: Record<string, string> } {
    const written: Record<string, string> = {};
    return {
        written,
        list: (directory) => {
            return Object.keys({ ...contents, ...written })
                .filter((path) => {
                    return path.startsWith(`${directory}/`) || path.startsWith(`${directory}\\`);
                })
                .map((path) => {
                    return path.slice(directory.length + 1);
                });
        },
        read: (path) => {
            return { ...contents, ...written }[path] ?? null;
        },
        size: (path) => {
            const text = { ...contents, ...written }[path];
            return text === undefined ? null : Buffer.byteLength(text);
        },
        write: (path, content) => {
            written[path] = content;
        }
    };
}

function offered(...labels: string[]): AniRunResult<ResolvedSubtitles> {
    return {
        status: 'done',
        value: {
            referer: REFERER,
            subtitles: labels.map((label) => {
                return { label, src: `https://s.example/${label.replace(/\W/g, '')}.vtt` };
            })
        }
    };
}

interface Setup {
    dependencies: SubtitleCheckDependencies;
    files: ReturnType<typeof memory>;
    resolveSubtitles: ReturnType<typeof vi.fn>;
    search: ReturnType<typeof vi.fn>;
    fetchText: ReturnType<typeof vi.fn>;
}

function setup(contents: Record<string, string>, answer: AniRunResult<ResolvedSubtitles>, texts: Record<string, string | null> = {}): Setup {
    const files = memory(contents);
    const resolveSubtitles = vi.fn(async () => {
        return answer;
    });
    const search = vi.fn(async (): Promise<AniRunResult<AnimeSearchResult[]>> => {
        return { status: 'done', value: [{ index: 1, title: 'Naruto Shippuden' }, { index: 5, title: 'Naruto' }] };
    });
    const fetchText = vi.fn(async (url: string) => {
        return url in texts ? (texts[url] ?? null) : VTT;
    });
    return {
        dependencies: {
            resolveSubtitles,
            search,
            quality: () => {
                return '720p';
            },
            fetchText,
            files
        },
        files,
        resolveSubtitles,
        search,
        fetchText
    };
}

const file = (name: string): string => {
    return join(DIR, name);
};

describe('checkSubtitles', () => {
    it('asks the source about the episode with what the library keeps, and the quality of the settings', async () => {
        const { dependencies, resolveSubtitles } = setup({}, offered());
        await checkSubtitles(anime, episode, dependencies);
        expect(resolveSubtitles).toHaveBeenCalledTimes(1);
        expect(resolveSubtitles).toHaveBeenCalledWith({ query: 'naruto', index: 2, episode: '1', quality: '720p' });
    });

    it('saves next to the video the subtitles the source offers that the episode does not have, and says which', async () => {
        const { dependencies, files, fetchText } = setup({ [VIDEO]: 'video', [file('Naruto Episode 1.subtitle-English.vtt')]: VTT }, offered('English', 'Portuguese', 'Spanish'));
        const response = await checkSubtitles(anime, episode, dependencies);

        expect(files.written).toEqual({
            [file('Naruto Episode 1.subtitle-Portuguese.vtt')]: VTT,
            [file('Naruto Episode 1.subtitle-Spanish.vtt')]: VTT
        });
        expect(fetchText).toHaveBeenCalledTimes(2);
        expect(fetchText).toHaveBeenNthCalledWith(1, 'https://s.example/Portuguese.vtt', REFERER);
        expect(fetchText).toHaveBeenNthCalledWith(2, 'https://s.example/Spanish.vtt', REFERER);
        expect(response).toEqual({
            ok: true,
            added: ['Portuguese', 'Spanish'],
            tracks: [
                { id: 'subtitle-English', label: 'English', kind: 'source' },
                { id: 'subtitle-Portuguese', label: 'Portuguese', kind: 'source' },
                { id: 'subtitle-Spanish', label: 'Spanish', kind: 'source' }
            ]
        });
    });

    it('adds nothing, and does not download anything, when the episode has every subtitle the source offers', async () => {
        const { dependencies, files, fetchText } = setup(
            { [file('Naruto Episode 1.subtitle-English.vtt')]: VTT, [file('Naruto Episode 1.subtitle-Spanish.vtt')]: VTT },
            offered('english', 'Spanish')
        );
        expect(await checkSubtitles(anime, episode, dependencies)).toEqual({
            ok: true,
            added: [],
            tracks: [
                { id: 'subtitle-English', label: 'English', kind: 'source' },
                { id: 'subtitle-Spanish', label: 'Spanish', kind: 'source' }
            ]
        });
        expect(fetchText).not.toHaveBeenCalled();
        expect(files.written).toEqual({});
    });

    it('adds nothing when the source offers no subtitles at all', async () => {
        const { dependencies, fetchText } = setup({}, offered());
        expect(await checkSubtitles(anime, episode, dependencies)).toEqual({ ok: true, added: [], tracks: [] });
        expect(fetchText).not.toHaveBeenCalled();
    });

    it('counts the one ani-cli picked under the name of the source subtitle that is the same text', async () => {
        const { dependencies, files } = setup({ [file('Naruto Episode 1.vtt')]: VTT }, offered('English', 'Portuguese'), { 'https://s.example/Portuguese.vtt': 'WEBVTT\n\nother' });
        const response = await checkSubtitles(anime, episode, dependencies);
        expect(Object.keys(files.written)).toEqual([file('Naruto Episode 1.subtitle-English.vtt'), file('Naruto Episode 1.subtitle-Portuguese.vtt')]);
        expect(response).toEqual({
            ok: true,
            added: ['English', 'Portuguese'],
            tracks: [
                { id: '', label: 'English', kind: 'default' },
                { id: 'subtitle-Portuguese', label: 'Portuguese', kind: 'source' }
            ]
        });
    });

    it('does not take a subtitle the user loaded for one of the source', async () => {
        const { dependencies, files } = setup({ [file('Naruto Episode 1.import-English.vtt')]: VTT }, offered('English'));
        const response = await checkSubtitles(anime, episode, dependencies);
        expect(Object.keys(files.written)).toEqual([file('Naruto Episode 1.subtitle-English.vtt')]);
        expect(response).toMatchObject({ ok: true, added: ['English'] });
    });

    it('saves a language the source lists twice only once', async () => {
        const { dependencies, files, fetchText } = setup({}, offered('English', 'English', 'english'));
        expect(await checkSubtitles(anime, episode, dependencies)).toMatchObject({ ok: true, added: ['English'] });
        expect(fetchText).toHaveBeenCalledTimes(1);
        expect(Object.keys(files.written)).toEqual([file('Naruto Episode 1.subtitle-English.vtt')]);
    });

    it('names the file with the label cleaned as the patch of ani-cli does', async () => {
        const { dependencies, files } = setup({}, offered('Portuguese - Brazil / CC  '));
        const response = await checkSubtitles(anime, episode, dependencies);
        expect(Object.keys(files.written)).toEqual([file('Naruto Episode 1.subtitle-Portuguese - Brazil _ CC.vtt')]);
        expect(response).toMatchObject({ ok: true, added: ['Portuguese - Brazil _ CC'] });
    });

    it('turns a SubRip subtitle into WebVTT and leaves out what is neither', async () => {
        const srt = '1\n00:00:01,000 --> 00:00:02,500\nhello\n';
        const { dependencies, files } = setup({}, offered('English', 'Spanish', 'French'), {
            'https://s.example/English.vtt': srt,
            'https://s.example/Spanish.vtt': '<html>not a subtitle</html>',
            'https://s.example/French.vtt': VTT
        });
        const response = await checkSubtitles(anime, episode, dependencies);
        expect(files.written).toEqual({
            [file('Naruto Episode 1.subtitle-English.vtt')]: 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.500\nhello\n',
            [file('Naruto Episode 1.subtitle-French.vtt')]: VTT
        });
        expect(response).toMatchObject({ ok: true, added: ['English', 'French'] });
    });

    it('leaves out a subtitle that is too big or that could not be fetched, and keeps the others', async () => {
        const { dependencies, files } = setup({}, offered('English', 'Spanish', 'French'), {
            'https://s.example/English.vtt': `WEBVTT\n${'x'.repeat(MAX_SUBTITLE_BYTES)}`,
            'https://s.example/Spanish.vtt': null,
            'https://s.example/French.vtt': VTT
        });
        const response = await checkSubtitles(anime, episode, dependencies);
        expect(Object.keys(files.written)).toEqual([file('Naruto Episode 1.subtitle-French.vtt')]);
        expect(response).toMatchObject({ ok: true, added: ['French'] });
    });

    it('fails when there were subtitles to add and none could be had', async () => {
        const { dependencies, files } = setup({}, offered('English', 'Spanish'), { 'https://s.example/English.vtt': null, 'https://s.example/Spanish.vtt': 'nothing' });
        expect(await checkSubtitles(anime, episode, dependencies)).toEqual({
            ok: false,
            reason: 'failed',
            error: { code: 'NETWORK', raw: 'The subtitles could not be downloaded.' }
        });
        expect(files.written).toEqual({});
    });

    it('says the episode is missing when it is not downloaded or has no video, without asking the source', async () => {
        const { dependencies, resolveSubtitles } = setup({}, offered('English'));
        expect(await checkSubtitles(anime, { ...episode, status: 'error' }, dependencies)).toEqual({ ok: false, reason: 'missing' });
        expect(await checkSubtitles(anime, { ...episode, filePath: null }, dependencies)).toEqual({ ok: false, reason: 'missing' });
        expect(resolveSubtitles).not.toHaveBeenCalled();
    });

    it('passes on what went wrong with the source', async () => {
        const error = { code: 'NO_SOURCES' as const, raw: 'No sources found for dub!' };
        expect(await checkSubtitles(anime, episode, setup({}, { status: 'error', error }).dependencies)).toEqual({ ok: false, reason: 'failed', error });
        expect(await checkSubtitles(anime, episode, setup({}, { status: 'cancelled' }).dependencies)).toEqual({
            ok: false,
            reason: 'failed',
            error: { code: 'UNKNOWN', raw: 'The request was cancelled.' }
        });
    });

    describe('an anime whose place in the search is not known', () => {
        const unknown = { ...anime, searchIndex: 0 };

        it('is looked for by its title, and the position of the result with that title is used', async () => {
            const { dependencies, search, resolveSubtitles } = setup({}, offered());
            await checkSubtitles(unknown, episode, dependencies);
            expect(search).toHaveBeenCalledTimes(1);
            expect(search).toHaveBeenCalledWith('naruto');
            expect(resolveSubtitles).toHaveBeenCalledWith({ query: 'naruto', index: 5, episode: '1', quality: '720p' });
        });

        it('does not search when the position is kept', async () => {
            const { dependencies, search } = setup({}, offered());
            await checkSubtitles(anime, episode, dependencies);
            expect(search).not.toHaveBeenCalled();
        });

        it('fails when no result has its title', async () => {
            const { dependencies, search, resolveSubtitles } = setup({}, offered());
            search.mockResolvedValue({ status: 'done', value: [{ index: 1, title: 'Bleach' }] });
            expect(await checkSubtitles(unknown, episode, dependencies)).toEqual({
                ok: false,
                reason: 'failed',
                error: { code: 'NO_RESULTS', raw: 'The anime was not found in the search.' }
            });
            expect(resolveSubtitles).not.toHaveBeenCalled();
        });

        it('passes on a search that failed, and treats a cancelled one as not found', async () => {
            const error = { code: 'NETWORK' as const, raw: 'timeout' };
            const failedSearch = setup({}, offered());
            failedSearch.search.mockResolvedValue({ status: 'error', error });
            expect(await checkSubtitles(unknown, episode, failedSearch.dependencies)).toEqual({ ok: false, reason: 'failed', error });

            const cancelled = setup({}, offered());
            cancelled.search.mockResolvedValue({ status: 'cancelled' });
            expect(await checkSubtitles(unknown, episode, cancelled.dependencies)).toMatchObject({ ok: false, reason: 'failed', error: { code: 'NO_RESULTS' } });
            expect(cancelled.resolveSubtitles).not.toHaveBeenCalled();
        });
    });
});
