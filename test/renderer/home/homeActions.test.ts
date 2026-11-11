// @vitest-environment jsdom
import { openActiveDownload, openAnime, openManga, openSubtitleJobs, pasteLink, showCut, showQueue } from '@renderer/home/homeActions';
import { onNavigationBatchEnd } from '@renderer/navigation/navigationBatch';
import { useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';

const initialApp = useAppStore.getState();
const initialAnime = useAnimeStore.getState();
const initialManga = useMangaStore.getState();

const app = { setTab: vi.fn(), setDownloadsView: vi.fn() };
const anime = { setView: vi.fn(), openDownloads: vi.fn(), openSubtitleJobs: vi.fn() };
const manga = { setView: vi.fn(), openDownloads: vi.fn() };

beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState(app);
    useAnimeStore.setState(anime);
    useMangaStore.setState(manga);
});

afterEach(() => {
    useAppStore.setState(initialApp, true);
    useAnimeStore.setState(initialAnime, true);
    useMangaStore.setState(initialManga, true);
    vi.useRealTimers();
    document.body.innerHTML = '';
});

describe('showQueue', () => {
    it('opens the queue of the video downloader', () => {
        showQueue();
        expect(app.setTab.mock.calls).toEqual([['downloads']]);
        expect(app.setDownloadsView.mock.calls).toEqual([['queue']]);
    });
});

describe('openSubtitleJobs', () => {
    it('opens the anime section on the screen of the subtitles being translated or made', () => {
        openSubtitleJobs();
        expect(app.setTab.mock.calls).toEqual([['anime']]);
        expect(anime.openSubtitleJobs).toHaveBeenCalledTimes(1);
        expect(anime.openSubtitleJobs).toHaveBeenCalledWith();
        expect(anime.openDownloads).not.toHaveBeenCalled();
        expect(anime.setView).not.toHaveBeenCalled();
    });
});

describe('showCut', () => {
    it('opens the cutter of the video downloader', () => {
        showCut();
        expect(app.setTab.mock.calls).toEqual([['downloads']]);
        expect(app.setDownloadsView.mock.calls).toEqual([['cut']]);
    });
});

describe('the changes of page of the home screen', () => {
    it.each([
        ['showQueue', showQueue],
        ['showCut', showCut],
        ['openAnime', () => {
            openAnime('updates');
        }],
        ['openManga', () => {
            openManga('library');
        }],
        ['openActiveDownload', () => {
            openActiveDownload('anime');
        }],
        ['openSubtitleJobs', openSubtitleJobs]
    ])('%s is one page for the buttons of the mouse: its steps end in one batch', (_name, action) => {
        const ended = vi.fn();
        const stop = onNavigationBatchEnd(ended);
        action();
        expect(ended).toHaveBeenCalledTimes(1);
        stop();
    });
});

describe('pasteLink', () => {
    it('opens the queue and puts the focus in the field of the first link once it is drawn', () => {
        vi.useFakeTimers();
        const field = document.createElement('input');
        field.className = 'link-row__input';
        document.body.appendChild(field);
        pasteLink();
        expect(app.setTab.mock.calls).toEqual([['downloads']]);
        expect(app.setDownloadsView.mock.calls).toEqual([['queue']]);
        expect(document.activeElement).not.toBe(field);
        vi.runAllTimers();
        expect(document.activeElement).toBe(field);
    });

    it('does nothing more when the field is not there', () => {
        vi.useFakeTimers();
        pasteLink();
        expect(() => {
            vi.runAllTimers();
        }).not.toThrow();
        expect(document.activeElement).toBe(document.body);
    });
});

describe('openAnime and openManga', () => {
    it.each(['library', 'updates', 'search'] as const)('open the %s of the anime', (view) => {
        openAnime(view);
        expect(app.setTab.mock.calls).toEqual([['anime']]);
        expect(anime.setView.mock.calls).toEqual([[view]]);
    });

    it.each(['library', 'updates', 'extensions', 'browse'] as const)('open the %s of the manga', (view) => {
        openManga(view);
        expect(app.setTab.mock.calls).toEqual([['manga']]);
        expect(manga.setView.mock.calls).toEqual([[view]]);
    });
});

describe('openActiveDownload', () => {
    it('opens the downloads of the section of a download', () => {
        openActiveDownload('video');
        expect(app.setTab.mock.calls).toEqual([['downloads']]);
        expect(app.setDownloadsView.mock.calls).toEqual([['queue']]);
        openActiveDownload('anime');
        expect(app.setTab.mock.calls[1]).toEqual(['anime']);
        expect(anime.openDownloads).toHaveBeenCalledTimes(1);
        openActiveDownload('manga');
        expect(app.setTab.mock.calls[2]).toEqual(['manga']);
        expect(manga.openDownloads).toHaveBeenCalledTimes(1);
    });
});
