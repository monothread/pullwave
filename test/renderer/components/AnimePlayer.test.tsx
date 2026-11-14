// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnimeSubtitleTrack } from '@shared/anime';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { AnimePlayer, SAVE_INTERVAL_SECONDS } from '@renderer/components/AnimePlayer';
import { INFO_NOTICE_MS, Toast } from '@renderer/components/Toast';
import { INITIAL_SEARCH, UNSUPPORTED_STATUS, useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { AUTO_NEXT_STORAGE_KEY, useUiPrefsStore } from '@renderer/store/uiPrefsStore';
import { AUTO_NEXT_DELAY_MS } from '@renderer/components/AutoNextPanel';
import { makeAnime, makeEpisode } from '../../helpers/animeFixtures';
import { openedPlayerSettings, openedSubtitleMenu, openPlayerSettings, subtitleMenu, subtitleOption } from '../../helpers/playerSettings';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialAnime = useAnimeStore.getState();

const FIRST = makeEpisode({ id: 1, number: '1', positionSeconds: 600, durationSeconds: 1440 });
const SECOND = makeEpisode({ id: 2, number: '2' });
const THIRD = makeEpisode({ id: 3, number: '3', status: 'queued', filePath: null });
const ANIME = makeAnime([FIRST, SECOND, THIRD], { id: 5, title: 'Naruto' });

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS });
    useAnimeStore.setState({ ...initialAnime, status: UNSUPPORTED_STATUS, jobs: [], library: [ANIME], search: INITIAL_SEARCH, selection: null, playing: { animeId: 5, episodeId: 1 } });
    mock.api.listAnimeLibrary.mockResolvedValue([ANIME]);
    mock.api.listAnimeSubtitles.mockResolvedValue([{ id: '', label: 'English', kind: 'default' }]);
    window.localStorage.clear();
    useUiPrefsStore.setState({ autoNext: true });
});

const JAPANESE: AnimeSubtitleTrack = { id: 'subtitle-Japanese', label: 'Japanese', kind: 'source' };
const IMPORTED: AnimeSubtitleTrack = { id: 'import-aula', label: 'aula', kind: 'imported' };
const ENGLISH: AnimeSubtitleTrack = { id: '', label: 'English', kind: 'default' };

function trackElements(): HTMLTrackElement[] {
    return Array.from(document.querySelectorAll('track'));
}

function getVideo(): HTMLVideoElement {
    const video = document.querySelector('video');
    if (!video) {
        throw new Error('No video');
    }
    return video;
}

interface ManagerNames {
    gear: string;
    manage: string;
    dialog: string;
}

const ENGLISH_MANAGER: ManagerNames = { gear: 'Settings', manage: 'MANAGE SUBTITLES', dialog: 'Manage subtitles' };

// Opens the window of the subtitles from the gear of the player (the list of the subtitles of the episode is waited for first). The buttons
// that load, translate, create and check subtitles are in it; the menu of the subtitles and their size are in the gear.
async function openManager(names: ManagerNames = ENGLISH_MANAGER): Promise<HTMLElement> {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
    await openPlayerSettings({ gear: names.gear, menu: 'Subtitles' });
    fireEvent.click(await screen.findByRole('button', { name: names.manage }));
    return screen.findByRole('dialog', { name: names.dialog });
}

function setPlayback(video: HTMLVideoElement, currentTime: number, duration: number): void {
    Object.defineProperty(video, 'duration', { value: duration, configurable: true });
    video.currentTime = currentTime;
}

describe('AnimePlayer', () => {
    it('renders nothing when nothing is playing', () => {
        useAnimeStore.setState({ playing: null });
        const { container } = render(<AnimePlayer />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing when the episode is no longer in the library', () => {
        useAnimeStore.setState({ playing: { animeId: 5, episodeId: 99 } });
        const { container } = render(<AnimePlayer />);
        expect(container).toBeEmptyDOMElement();
        useAnimeStore.setState({ playing: { animeId: 77, episodeId: 1 } });
        expect(container).toBeEmptyDOMElement();
    });

    it('opens a dialog with the video of the episode and its subtitles', () => {
        render(<AnimePlayer />);
        const dialog = screen.getByRole('dialog', { name: 'Naruto · EP 1' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(screen.getByRole('heading', { name: 'Naruto · EP 1' })).toBeInTheDocument();

        const video = getVideo();
        expect(video).toHaveAttribute('src', expect.stringMatching(/^pullwave-media:\/\/episode\/1\?v=\d+$/));
        expect(video).toHaveAttribute('crossorigin', 'anonymous');
        expect(video.controls).toBe(false);
        expect(video.autoplay).toBe(true);
        expect(video.parentElement).toHaveClass('player__stage');
        expect(video.nextElementSibling).toHaveClass('player__controls');
        expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
        expect(screen.getByRole('slider', { name: 'Seek' })).toBeInTheDocument();
        expect(screen.getByRole('slider', { name: 'Volume' })).toBeInTheDocument();
        expect(openedSubtitleMenu()).toHaveValue('default');
        expect(screen.getByRole('button', { name: 'Fullscreen' })).toBeInTheDocument();
        const track = video.querySelector('track');
        expect(track).toHaveAttribute('src', 'pullwave-media://subtitle/1');
        expect(track).toHaveAttribute('kind', 'subtitles');
        expect(track).toHaveAttribute('label', 'Subtitles');
        expect(track).toHaveAttribute('id', 'default');
        expect(track?.hasAttribute('default')).toBe(true);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('gives the video an address of its own each time the player is opened, so the browser cannot mistake it for an earlier opening of a file that was not a video yet', () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(1_000);
            const first = render(<AnimePlayer />);
            expect(getVideo()).toHaveAttribute('src', 'pullwave-media://episode/1?v=1000');
            first.unmount();

            vi.setSystemTime(2_000);
            render(<AnimePlayer />);
            expect(getVideo()).toHaveAttribute('src', 'pullwave-media://episode/1?v=2000');
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps the address of the video while the player stays open, whatever happens to the screen around it', () => {
        render(<AnimePlayer />);
        const before = getVideo().getAttribute('src');

        act(() => {
            useAnimeStore.setState({ library: [{ ...ANIME }] });
        });

        expect(getVideo().getAttribute('src')).toBe(before);
    });

    it('focuses the close button', () => {
        render(<AnimePlayer />);
        expect(screen.getByRole('button', { name: 'CLOSE' })).toHaveFocus();
    });

    it('resumes where the episode stopped', () => {
        render(<AnimePlayer />);
        const video = getVideo();
        fireEvent.loadedMetadata(video);
        expect(video.currentTime).toBe(600);
    });

    it('says for a moment where the episode picked up, over the video', () => {
        render(<AnimePlayer />);
        const chip = screen.getByTestId('player-resumed');
        expect(chip).toHaveClass('player__resumed');
        expect(chip).toHaveTextContent('Resumed at 10:00');
        expect(chip.parentElement).toHaveClass('player__stage');
    });

    it('says nothing about resuming when the episode starts from the beginning', () => {
        useAnimeStore.setState({ playing: { animeId: 5, episodeId: 2 } });
        render(<AnimePlayer />);
        expect(screen.queryByTestId('player-resumed')).toBeNull();
    });

    it('starts from the beginning when there is nothing to resume', () => {
        useAnimeStore.setState({ playing: { animeId: 5, episodeId: 2 } });
        render(<AnimePlayer />);
        const video = getVideo();
        fireEvent.loadedMetadata(video);
        expect(video.currentTime).toBe(0);
    });

    describe('saving the progress', () => {
        it('saves every few seconds while it plays', () => {
            render(<AnimePlayer />);
            const video = getVideo();
            setPlayback(video, 100, 1440);
            fireEvent.timeUpdate(video);
            expect(mock.api.saveAnimeProgress).toHaveBeenCalledTimes(1);
            expect(mock.api.saveAnimeProgress).toHaveBeenLastCalledWith({ episodeId: 1, positionSeconds: 100, durationSeconds: 1440, watched: false });

            setPlayback(video, 100 + SAVE_INTERVAL_SECONDS - 1, 1440);
            fireEvent.timeUpdate(video);
            expect(mock.api.saveAnimeProgress).toHaveBeenCalledTimes(1);

            setPlayback(video, 100 + SAVE_INTERVAL_SECONDS, 1440);
            fireEvent.timeUpdate(video);
            expect(mock.api.saveAnimeProgress).toHaveBeenCalledTimes(2);
            expect(mock.api.saveAnimeProgress).toHaveBeenLastCalledWith({ episodeId: 1, positionSeconds: 105, durationSeconds: 1440, watched: false });
        });

        it('also saves when it is paused and when it ends, marking it watched near the end', () => {
            render(<AnimePlayer />);
            const video = getVideo();
            setPlayback(video, 300, 1440);
            fireEvent.pause(video);
            expect(mock.api.saveAnimeProgress).toHaveBeenLastCalledWith({ episodeId: 1, positionSeconds: 300, durationSeconds: 1440, watched: false });

            setPlayback(video, 1440, 1440);
            fireEvent.ended(video);
            expect(mock.api.saveAnimeProgress).toHaveBeenLastCalledWith({ episodeId: 1, positionSeconds: 1440, durationSeconds: 1440, watched: true });
        });

        it('counts the episode as watched once 75 percent of it was seen, and not before', () => {
            render(<AnimePlayer />);
            const video = getVideo();
            setPlayback(video, 1079, 1440);
            fireEvent.pause(video);
            expect(mock.api.saveAnimeProgress).toHaveBeenLastCalledWith({ episodeId: 1, positionSeconds: 1079, durationSeconds: 1440, watched: false });

            setPlayback(video, 1080, 1440);
            fireEvent.pause(video);
            expect(mock.api.saveAnimeProgress).toHaveBeenLastCalledWith({ episodeId: 1, positionSeconds: 1080, durationSeconds: 1440, watched: true });
        });

        it('keeps an episode that was already watched as watched when it is watched again from the start', () => {
            useAnimeStore.setState({ library: [makeAnime([makeEpisode({ id: 1, number: '1', watched: true, positionSeconds: 1400, durationSeconds: 1440 })], { id: 5, title: 'Naruto' })] });
            render(<AnimePlayer />);
            const video = getVideo();
            setPlayback(video, 100, 1440);
            fireEvent.pause(video);
            expect(mock.api.saveAnimeProgress).toHaveBeenLastCalledWith({ episodeId: 1, positionSeconds: 100, durationSeconds: 1440, watched: true });
        });

        it('does not save before the duration is known', () => {
            render(<AnimePlayer />);
            const video = getVideo();
            Object.defineProperty(video, 'duration', { value: Number.NaN, configurable: true });
            fireEvent.pause(video);
            expect(mock.api.saveAnimeProgress).not.toHaveBeenCalled();
        });
    });

    describe('closing', () => {
        it('saves, closes and refreshes the library', async () => {
            const user = userEvent.setup();
            render(<AnimePlayer />);
            setPlayback(getVideo(), 700, 1440);

            await user.click(screen.getByRole('button', { name: 'CLOSE' }));

            expect(mock.api.saveAnimeProgress).toHaveBeenCalledWith({ episodeId: 1, positionSeconds: 700, durationSeconds: 1440, watched: false });
            expect(useAnimeStore.getState().playing).toBeNull();
            expect(mock.api.listAnimeLibrary).toHaveBeenCalledTimes(1);
        });

        it('closes with Escape and ignores other keys', () => {
            render(<AnimePlayer />);
            setPlayback(getVideo(), 10, 1440);
            fireEvent.keyDown(window, { key: 'Enter' });
            expect(useAnimeStore.getState().playing).not.toBeNull();

            act(() => {
                fireEvent.keyDown(window, { key: 'Escape' });
            });
            expect(useAnimeStore.getState().playing).toBeNull();
            expect(mock.api.saveAnimeProgress).toHaveBeenCalledTimes(1);
        });

        it('stops listening for Escape once it is gone', () => {
            const { unmount } = render(<AnimePlayer />);
            unmount();
            fireEvent.keyDown(window, { key: 'Escape' });
            expect(mock.api.saveAnimeProgress).not.toHaveBeenCalled();
        });
    });

    describe('next episode', () => {
        it('offers the next one when it is downloaded and plays it', async () => {
            const user = userEvent.setup();
            render(<AnimePlayer />);
            setPlayback(getVideo(), 900, 1440);

            await user.click(screen.getByRole('button', { name: 'NEXT EPISODE' }));

            expect(mock.api.saveAnimeProgress).toHaveBeenCalledWith({ episodeId: 1, positionSeconds: 900, durationSeconds: 1440, watched: false });
            expect(useAnimeStore.getState().playing).toEqual({ animeId: 5, episodeId: 2 });
        });

        it('starts the new episode on a fresh video', async () => {
            const user = userEvent.setup();
            render(<AnimePlayer />);
            const first = getVideo();
            await user.click(screen.getByRole('button', { name: 'NEXT EPISODE' }));
            const second = getVideo();
            expect(second).not.toBe(first);
            expect(second).toHaveAttribute('src', expect.stringMatching(/^pullwave-media:\/\/episode\/2\?v=\d+$/));
            expect(screen.getByRole('dialog', { name: 'Naruto · EP 2' })).toBeInTheDocument();
        });

        it('keeps the stage that goes to fullscreen in the page when the episode changes, so the browser does not leave fullscreen', async () => {
            const user = userEvent.setup();
            render(<AnimePlayer />);
            const stage = getVideo().parentElement as HTMLElement;
            const dialog = screen.getByRole('dialog');
            expect(stage).toHaveClass('player__stage');

            await user.click(screen.getByRole('button', { name: 'NEXT EPISODE' }));

            expect(stage.isConnected).toBe(true);
            expect(getVideo().parentElement).toBe(stage);
            expect(screen.getByRole('dialog', { name: 'Naruto · EP 2' })).toBe(dialog);
            expect(within(stage).getByRole('button', { name: 'Fullscreen' })).toBeInTheDocument();
            expect(within(stage).queryByRole('button', { name: 'NEXT EPISODE' })).not.toBeInTheDocument();
            expect(within(dialog).getByRole('heading', { name: 'Naruto · EP 2' })).toBeInTheDocument();
        });

        it('keeps the stage in the page when the previous episode is played too', async () => {
            const user = userEvent.setup();
            useAnimeStore.setState({ playing: { animeId: 5, episodeId: 2 } });
            render(<AnimePlayer />);
            const stage = getVideo().parentElement as HTMLElement;

            await user.click(screen.getByRole('button', { name: 'PREVIOUS EPISODE' }));

            expect(useAnimeStore.getState().playing).toEqual({ animeId: 5, episodeId: 1 });
            expect(stage.isConnected).toBe(true);
            expect(getVideo().parentElement).toBe(stage);
            expect(getVideo()).toHaveAttribute('src', expect.stringMatching(/^pullwave-media:\/\/episode\/1\?v=\d+$/));
        });

        it('does not offer it when the next episode is not downloaded or there is none', () => {
            useAnimeStore.setState({ playing: { animeId: 5, episodeId: 2 } });
            const { unmount } = render(<AnimePlayer />);
            expect(screen.queryByRole('button', { name: 'NEXT EPISODE' })).not.toBeInTheDocument();
            unmount();

            useAnimeStore.setState({ library: [makeAnime([SECOND], { id: 5 })], playing: { animeId: 5, episodeId: 2 } });
            render(<AnimePlayer />);
            expect(screen.queryByRole('button', { name: 'NEXT EPISODE' })).not.toBeInTheDocument();
        });
    });

    describe('the next episode that starts by itself', () => {
        function endEpisode(): void {
            const video = getVideo();
            setPlayback(video, 1440, 1440);
            act(() => {
                fireEvent.ended(video);
            });
        }

        it('shows no panel while the episode plays', () => {
            render(<AnimePlayer />);
            expect(screen.queryByRole('region', { name: 'NEXT EPISODE' })).not.toBeInTheDocument();
        });

        it('shows the panel of the next episode over the video when the episode ends, after saving it as watched', () => {
            render(<AnimePlayer />);
            endEpisode();
            expect(mock.api.saveAnimeProgress).toHaveBeenLastCalledWith({ episodeId: 1, positionSeconds: 1440, durationSeconds: 1440, watched: true });
            const panel = screen.getByRole('region', { name: 'NEXT EPISODE' });
            expect(panel.parentElement).toHaveClass('player__stage');
            expect(within(panel).getByText('Naruto · EP 2')).toBeInTheDocument();
            expect(within(panel).getByText('Starts in 10s')).toBeInTheDocument();
        });

        it('shows the cover of the anime beside the name of the next episode', () => {
            render(<AnimePlayer />);
            endEpisode();
            const panel = screen.getByRole('region', { name: 'NEXT EPISODE' });
            expect(panel).toHaveClass('player__auto-next--cover');
            expect(panel.querySelector('.player__auto-next-cover')).toHaveAttribute('aria-hidden', 'true');
        });

        it('plays the next episode by itself when the count is over', () => {
            vi.useFakeTimers();
            try {
                render(<AnimePlayer />);
                endEpisode();
                act(() => {
                    vi.advanceTimersByTime(AUTO_NEXT_DELAY_MS);
                });
                expect(useAnimeStore.getState().playing).toEqual({ animeId: 5, episodeId: 2 });
                expect(screen.getByRole('dialog', { name: 'Naruto · EP 2' })).toBeInTheDocument();
                expect(screen.queryByRole('region', { name: 'NEXT EPISODE' })).not.toBeInTheDocument();
            } finally {
                vi.useRealTimers();
            }
        });

        it('keeps the stage in the page when the next episode starts by itself, so a viewer in fullscreen stays in it', () => {
            vi.useFakeTimers();
            try {
                render(<AnimePlayer />);
                const stage = getVideo().parentElement as HTMLElement;
                const first = getVideo();
                Object.defineProperty(document, 'fullscreenElement', { value: stage, configurable: true });
                endEpisode();
                act(() => {
                    vi.advanceTimersByTime(AUTO_NEXT_DELAY_MS);
                });
                expect(useAnimeStore.getState().playing).toEqual({ animeId: 5, episodeId: 2 });
                expect(stage.isConnected).toBe(true);
                expect(document.fullscreenElement).toBe(stage);
                expect(getVideo()).not.toBe(first);
                expect(getVideo().parentElement).toBe(stage);
                expect(getVideo()).toHaveAttribute('src', expect.stringMatching(/^pullwave-media:\/\/episode\/2\?v=\d+$/));
            } finally {
                Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
                vi.useRealTimers();
            }
        });

        it('plays the next episode at once with PLAY NOW', async () => {
            const user = userEvent.setup();
            render(<AnimePlayer />);
            endEpisode();
            await user.click(screen.getByRole('button', { name: 'PLAY NOW' }));
            expect(useAnimeStore.getState().playing).toEqual({ animeId: 5, episodeId: 2 });
        });

        it('stays on the episode, with no panel, when the user cancels', () => {
            vi.useFakeTimers();
            try {
                render(<AnimePlayer />);
                endEpisode();
                fireEvent.click(screen.getByRole('button', { name: 'CANCEL' }));
                expect(screen.queryByRole('region', { name: 'NEXT EPISODE' })).not.toBeInTheDocument();
                act(() => {
                    vi.advanceTimersByTime(AUTO_NEXT_DELAY_MS);
                });
                expect(useAnimeStore.getState().playing).toEqual({ animeId: 5, episodeId: 1 });
            } finally {
                vi.useRealTimers();
            }
        });

        it('stays on the episode when the user plays it again before the count is over', () => {
            render(<AnimePlayer />);
            endEpisode();
            act(() => {
                fireEvent.play(getVideo());
            });
            expect(screen.queryByRole('region', { name: 'NEXT EPISODE' })).not.toBeInTheDocument();
            expect(useAnimeStore.getState().playing).toEqual({ animeId: 5, episodeId: 1 });
        });

        it('shows no panel when there is no next episode downloaded', () => {
            useAnimeStore.setState({ playing: { animeId: 5, episodeId: 2 } });
            render(<AnimePlayer />);
            endEpisode();
            expect(screen.queryByRole('region', { name: 'NEXT EPISODE' })).not.toBeInTheDocument();
        });

        it('shows no panel when it was turned off', () => {
            useUiPrefsStore.setState({ autoNext: false });
            render(<AnimePlayer />);
            endEpisode();
            expect(screen.queryByRole('region', { name: 'NEXT EPISODE' })).not.toBeInTheDocument();
        });

        it('is turned off and on from the settings of the player, and the choice is kept', async () => {
            const user = userEvent.setup();
            mock.api.listAnimeSubtitles.mockResolvedValue([]);
            render(<AnimePlayer />);
            await user.click(screen.getByRole('button', { name: 'Settings' }));
            const toggle = screen.getByRole('switch', { name: 'Next episode automatically' });
            expect(toggle).toHaveProperty('checked', true);
            await user.click(toggle);
            expect(useUiPrefsStore.getState().autoNext).toBe(false);
            expect(window.localStorage.getItem(AUTO_NEXT_STORAGE_KEY)).toBe('off');
            expect(screen.getByRole('switch', { name: 'Next episode automatically' })).toHaveProperty('checked', false);
            endEpisode();
            expect(screen.queryByRole('region', { name: 'NEXT EPISODE' })).not.toBeInTheDocument();
        });
    });

    describe('across the seasons of a series', () => {
        const seasonOne = makeAnime([makeEpisode({ id: 1, number: '1' }), makeEpisode({ id: 2, number: '2' })], { id: 5, title: 'Frieren', series: 'Frieren', season: 1 });
        const seasonTwo = makeAnime([makeEpisode({ id: 3, number: '1' }), makeEpisode({ id: 4, number: '2' })], { id: 6, title: 'Frieren Season 2', series: 'Frieren', season: 2 });

        beforeEach(() => {
            useAnimeStore.setState({ library: [seasonTwo, seasonOne] });
        });

        it('plays the first episode of the next season from the last one of the season', async () => {
            const user = userEvent.setup();
            useAnimeStore.setState({ playing: { animeId: 5, episodeId: 2 } });
            render(<AnimePlayer />);

            await user.click(screen.getByRole('button', { name: 'NEXT EPISODE' }));

            expect(useAnimeStore.getState().playing).toEqual({ animeId: 6, episodeId: 3 });
            expect(screen.getByRole('dialog', { name: 'Frieren Season 2 · EP 1' })).toBeInTheDocument();
        });

        it('plays the last episode of the previous season from the first one of the season', async () => {
            const user = userEvent.setup();
            useAnimeStore.setState({ playing: { animeId: 6, episodeId: 3 } });
            render(<AnimePlayer />);

            await user.click(screen.getByRole('button', { name: 'PREVIOUS EPISODE' }));

            expect(useAnimeStore.getState().playing).toEqual({ animeId: 5, episodeId: 2 });
            expect(screen.getByRole('dialog', { name: 'Frieren · EP 2' })).toBeInTheDocument();
        });

        it('does not offer a way out of the first and last seasons', () => {
            useAnimeStore.setState({ playing: { animeId: 6, episodeId: 4 } });
            const { unmount } = render(<AnimePlayer />);
            expect(screen.queryByRole('button', { name: 'NEXT EPISODE' })).not.toBeInTheDocument();
            unmount();

            useAnimeStore.setState({ playing: { animeId: 5, episodeId: 1 } });
            render(<AnimePlayer />);
            expect(screen.queryByRole('button', { name: 'PREVIOUS EPISODE' })).not.toBeInTheDocument();
        });
    });

    describe('previous episode', () => {
        it('offers the previous one when it is downloaded, saves and plays it', async () => {
            const user = userEvent.setup();
            useAnimeStore.setState({ playing: { animeId: 5, episodeId: 2 } });
            render(<AnimePlayer />);
            setPlayback(getVideo(), 300, 1440);

            await user.click(screen.getByRole('button', { name: 'PREVIOUS EPISODE' }));

            expect(mock.api.saveAnimeProgress).toHaveBeenCalledTimes(1);
            expect(mock.api.saveAnimeProgress).toHaveBeenCalledWith({ episodeId: 2, positionSeconds: 300, durationSeconds: 1440, watched: false });
            expect(useAnimeStore.getState().playing).toEqual({ animeId: 5, episodeId: 1 });
            expect(getVideo()).toHaveAttribute('src', expect.stringMatching(/^pullwave-media:\/\/episode\/1\?v=\d+$/));
            expect(screen.getByRole('dialog', { name: 'Naruto · EP 1' })).toBeInTheDocument();
        });

        it('offers both the previous and the next episode when both are downloaded, previous first', () => {
            const third = makeEpisode({ id: 3, number: '3', filePath: '/lib/Naruto/Naruto Episode 3.mp4' });
            useAnimeStore.setState({ library: [makeAnime([FIRST, SECOND, third], { id: 5, title: 'Naruto' })], playing: { animeId: 5, episodeId: 2 } });
            render(<AnimePlayer />);
            const labels = screen.getAllByRole('button').map((button) => {
                return button.textContent;
            });
            expect(labels.indexOf('PREVIOUS EPISODE')).toBeGreaterThanOrEqual(0);
            expect(labels.indexOf('PREVIOUS EPISODE')).toBeLessThan(labels.indexOf('NEXT EPISODE'));
        });

        it('does not offer it on the first episode, when the previous is not downloaded or is not there', () => {
            const { unmount } = render(<AnimePlayer />);
            expect(screen.queryByRole('button', { name: 'PREVIOUS EPISODE' })).not.toBeInTheDocument();
            unmount();

            const missing = makeEpisode({ id: 1, number: '1', status: 'queued', filePath: null });
            useAnimeStore.setState({ library: [makeAnime([missing, SECOND], { id: 5 })], playing: { animeId: 5, episodeId: 2 } });
            render(<AnimePlayer />);
            expect(screen.queryByRole('button', { name: 'PREVIOUS EPISODE' })).not.toBeInTheDocument();
        });
    });

    it('tells the user when the video cannot be played', () => {
        render(<AnimePlayer />);
        fireEvent.error(getVideo());
        expect(screen.getByRole('alert')).toHaveTextContent('This video could not be played. Its format may not be supported by the app.');
    });

    it('forgets the error when another episode starts', async () => {
        const user = userEvent.setup();
        render(<AnimePlayer />);
        fireEvent.error(getVideo());
        await user.click(screen.getByRole('button', { name: 'NEXT EPISODE' }));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    describe('subtitles', () => {
        it('asks for the subtitles of the episode', async () => {
            render(<AnimePlayer />);
            await subtitleMenu();
            expect(mock.api.listAnimeSubtitles).toHaveBeenCalledTimes(1);
            expect(mock.api.listAnimeSubtitles).toHaveBeenCalledWith(1);
        });

        it('adds a track for each subtitle of the episode, the first one showing', async () => {
            mock.api.listAnimeSubtitles.mockResolvedValue([ENGLISH, JAPANESE, IMPORTED]);
            render(<AnimePlayer />);
            await subtitleOption('Japanese');

            expect(
                trackElements().map((track) => {
                    return [track.id, track.getAttribute('src'), track.getAttribute('label'), track.hasAttribute('default')];
                })
            ).toEqual([
                ['default', 'pullwave-media://subtitle/1', 'English', true],
                ['subtitle-Japanese', 'pullwave-media://subtitle/1/subtitle-Japanese', 'Japanese', false],
                ['import-aula', 'pullwave-media://subtitle/1/import-aula', 'aula', false]
            ]);
            expect(openedSubtitleMenu()).toHaveValue('default');
        });

        it('has no track and no subtitle control when the episode has no subtitles', async () => {
            mock.api.listAnimeSubtitles.mockResolvedValue([]);
            render(<AnimePlayer />);
            await act(async () => {
                await Promise.resolve();
            });
            expect(trackElements()).toEqual([]);
            expect(screen.queryByRole('combobox', { name: 'Subtitles' })).not.toBeInTheDocument();
        });

        it('shows the subtitle the viewer picks and remembers it for the episode', async () => {
            mock.api.listAnimeSubtitles.mockResolvedValue([ENGLISH, JAPANESE]);
            const user = userEvent.setup();
            render(<AnimePlayer />);
            await subtitleOption('Japanese');

            await user.selectOptions(openedSubtitleMenu(), 'subtitle-Japanese');
            expect(openedSubtitleMenu()).toHaveValue('subtitle-Japanese');
            expect(
                trackElements().map((track) => {
                    return track.hasAttribute('default');
                })
            ).toEqual([false, true]);
            expect(window.localStorage.getItem('pullwave-subtitle-1')).toBe('subtitle-Japanese');

            await user.selectOptions(openedSubtitleMenu(), 'off');
            expect(window.localStorage.getItem('pullwave-subtitle-1')).toBe('off');
        });

        it('uses what the viewer chose the last time they watched the episode', async () => {
            window.localStorage.setItem('pullwave-subtitle-1', 'subtitle-Japanese');
            mock.api.listAnimeSubtitles.mockResolvedValue([ENGLISH, JAPANESE]);
            render(<AnimePlayer />);
            await subtitleOption('Japanese');
            expect(openedSubtitleMenu()).toHaveValue('subtitle-Japanese');
        });

        it('keeps the subtitles off when the viewer turned them off before', async () => {
            window.localStorage.setItem('pullwave-subtitle-1', 'off');
            mock.api.listAnimeSubtitles.mockResolvedValue([ENGLISH, JAPANESE]);
            render(<AnimePlayer />);
            await subtitleOption('Japanese');
            expect(openedSubtitleMenu()).toHaveValue('off');
        });

        it('falls back to the first subtitle when the one chosen before is gone', async () => {
            window.localStorage.setItem('pullwave-subtitle-1', 'subtitle-Korean');
            mock.api.listAnimeSubtitles.mockResolvedValue([ENGLISH, JAPANESE]);
            render(<AnimePlayer />);
            await subtitleOption('Japanese');
            expect(openedSubtitleMenu()).toHaveValue('default');
        });

        it('does not use a list that arrives after the player was closed', async () => {
            let resolve: (tracks: AnimeSubtitleTrack[]) => void = () => {
                return undefined;
            };
            mock.api.listAnimeSubtitles.mockReturnValue(
                new Promise<AnimeSubtitleTrack[]>((done) => {
                    resolve = done;
                })
            );
            const { unmount } = render(<AnimePlayer />);
            unmount();
            await act(async () => {
                resolve([ENGLISH, JAPANESE]);
                await Promise.resolve();
            });
            expect(document.querySelector('track')).toBeNull();
        });

        it('asks again for the subtitles of the next episode', async () => {
            const user = userEvent.setup();
            render(<AnimePlayer />);
            await subtitleMenu();
            await user.click(screen.getByRole('button', { name: 'NEXT EPISODE' }));
            expect(mock.api.listAnimeSubtitles).toHaveBeenLastCalledWith(2);
        });
    });

    describe('loading a subtitle', () => {
        it('asks the app to load a file for this episode, and shows the new subtitle', async () => {
            mock.api.listAnimeSubtitles.mockResolvedValue([ENGLISH]);
            mock.api.importAnimeSubtitle.mockResolvedValue({ ok: true, tracks: [ENGLISH, IMPORTED], imported: IMPORTED });
            const user = userEvent.setup();
            render(<AnimePlayer />);
            await openManager();

            await user.click(screen.getByRole('button', { name: 'LOAD SUBTITLE' }));

            expect(mock.api.importAnimeSubtitle).toHaveBeenCalledTimes(1);
            expect(mock.api.importAnimeSubtitle).toHaveBeenCalledWith(1);
            expect(await subtitleOption('aula')).toBeInTheDocument();
            expect(openedSubtitleMenu()).toHaveValue('import-aula');
            expect(window.localStorage.getItem('pullwave-subtitle-1')).toBe('import-aula');
            expect(document.querySelector('track[id="import-aula"]')).toHaveAttribute('src', 'pullwave-media://subtitle/1/import-aula');
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });

        it('shows the subtitle loaded for an episode that had none', async () => {
            mock.api.listAnimeSubtitles.mockResolvedValue([]);
            mock.api.importAnimeSubtitle.mockResolvedValue({ ok: true, tracks: [IMPORTED], imported: IMPORTED });
            const user = userEvent.setup();
            render(<AnimePlayer />);
            await openManager();
            await user.click(screen.getByRole('button', { name: 'LOAD SUBTITLE' }));
            expect(await subtitleMenu()).toHaveValue('import-aula');
        });

        it('does nothing when the user gives up', async () => {
            mock.api.importAnimeSubtitle.mockResolvedValue({ ok: false, reason: 'cancelled' });
            const user = userEvent.setup();
            render(<AnimePlayer />);
            await openManager();
            await user.click(screen.getByRole('button', { name: 'LOAD SUBTITLE' }));
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
            expect(openedSubtitleMenu()).toHaveValue('default');
            expect(window.localStorage.getItem('pullwave-subtitle-1')).toBeNull();
        });

        it.each([
            ['unsupported', 'This file is not a subtitle the player understands. Use a .vtt or .srt file.'],
            ['too-large', 'This subtitle file is too large.'],
            ['unreadable', 'The subtitle file could not be read.'],
            ['missing', 'This episode is no longer in the library.']
        ] as const)('says why it could not load the file (%s)', async (reason, message) => {
            mock.api.importAnimeSubtitle.mockResolvedValue({ ok: false, reason });
            const user = userEvent.setup();
            render(<AnimePlayer />);
            await openManager();
            await user.click(screen.getByRole('button', { name: 'LOAD SUBTITLE' }));
            expect(screen.getByRole('alert')).toHaveTextContent(message);
        });

        it('forgets the message after a file loads', async () => {
            mock.api.importAnimeSubtitle.mockResolvedValueOnce({ ok: false, reason: 'unsupported' });
            mock.api.importAnimeSubtitle.mockResolvedValueOnce({ ok: true, tracks: [ENGLISH, IMPORTED], imported: IMPORTED });
            const user = userEvent.setup();
            render(<AnimePlayer />);
            await openManager();
            await user.click(screen.getByRole('button', { name: 'LOAD SUBTITLE' }));
            expect(screen.getByRole('alert')).toBeInTheDocument();
            await user.click(screen.getByRole('button', { name: 'LOAD SUBTITLE' }));
            await subtitleOption('aula');
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });
    });

    describe('checking for subtitles the source offers', () => {
        const PORTUGUESE: AnimeSubtitleTrack = { id: 'subtitle-Portuguese', label: 'Portuguese', kind: 'source' };

        async function ready() {
            const user = userEvent.setup();
            render(<AnimePlayer />);
            await openManager();
            return user;
        }

        it('has a button next to LOAD SUBTITLE, in the window of the subtitles', async () => {
            await ready();
            expect(screen.getByRole('dialog', { name: 'Manage subtitles' })).toContainElement(screen.getByRole('button', { name: 'CHECK SUBTITLES' }));
            expect(screen.getByRole('button', { name: 'CHECK SUBTITLES' })).toBeEnabled();
            expect(screen.getByRole('button', { name: 'LOAD SUBTITLE' })).toBeInTheDocument();
            expect(mock.api.checkAnimeSubtitles).not.toHaveBeenCalled();
        });

        it('asks about the episode that is playing and shows the subtitles that came in its list', async () => {
            mock.api.checkAnimeSubtitles.mockResolvedValue({ ok: true, added: ['Portuguese'], tracks: [ENGLISH, PORTUGUESE] });
            const user = await ready();

            await user.click(screen.getByRole('button', { name: 'CHECK SUBTITLES' }));

            expect(mock.api.checkAnimeSubtitles).toHaveBeenCalledTimes(1);
            expect(mock.api.checkAnimeSubtitles).toHaveBeenCalledWith(1);
            expect(await subtitleOption('Portuguese')).toBeInTheDocument();
            expect(document.querySelector('track[id="subtitle-Portuguese"]')).toHaveAttribute('src', 'pullwave-media://subtitle/1/subtitle-Portuguese');
            // What the viewer was watching with stays as it was.
            expect(openedSubtitleMenu()).toHaveValue('default');
        });

        it('says which subtitles came with a notice of the app, not with a message in the player', async () => {
            mock.api.checkAnimeSubtitles.mockResolvedValue({ ok: true, added: ['Portuguese'], tracks: [ENGLISH, PORTUGUESE] });
            const user = await ready();
            await user.click(screen.getByRole('button', { name: 'CHECK SUBTITLES' }));
            await subtitleOption('Portuguese');

            expect(useAppStore.getState().notice).toEqual({ kind: 'info', message: 'NEW SUBTITLES ADDED (1): Portuguese' });
            expect(screen.queryByRole('status')).not.toBeInTheDocument();
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });

        it('lists the names of every subtitle that came', async () => {
            mock.api.checkAnimeSubtitles.mockResolvedValue({ ok: true, added: ['Portuguese', 'Spanish'], tracks: [ENGLISH, PORTUGUESE, { id: 'subtitle-Spanish', label: 'Spanish', kind: 'source' }] });
            const user = await ready();
            await user.click(screen.getByRole('button', { name: 'CHECK SUBTITLES' }));
            await subtitleOption('Spanish');
            expect(useAppStore.getState().notice).toEqual({ kind: 'info', message: 'NEW SUBTITLES ADDED (2): Portuguese, Spanish' });
        });

        it('says there is nothing new when the source offers no others, and keeps the list', async () => {
            mock.api.checkAnimeSubtitles.mockResolvedValue({ ok: true, added: [], tracks: [ENGLISH, JAPANESE] });
            const user = await ready();
            await user.click(screen.getByRole('button', { name: 'CHECK SUBTITLES' }));
            await vi.waitFor(() => {
                expect(useAppStore.getState().notice).toEqual({ kind: 'info', message: 'NO NEW SUBTITLES: THE SOURCE OFFERS NO OTHERS.' });
            });
            expect(await subtitleOption('Japanese')).toBeInTheDocument();
        });

        it('shows that it is checking, with the button off, until the answer comes', async () => {
            let answer: (value: { ok: true; added: string[]; tracks: AnimeSubtitleTrack[] }) => void = () => {
                return undefined;
            };
            mock.api.checkAnimeSubtitles.mockReturnValue(
                new Promise((resolve) => {
                    answer = resolve;
                })
            );
            const user = await ready();
            await user.click(screen.getByRole('button', { name: 'CHECK SUBTITLES' }));
            expect(screen.getByRole('button', { name: 'CHECKING…' })).toBeDisabled();
            expect(useAppStore.getState().notice).toBeNull();

            await act(async () => {
                answer({ ok: true, added: [], tracks: [ENGLISH] });
            });
            expect(screen.getByRole('button', { name: 'CHECK SUBTITLES' })).toBeEnabled();
            expect(useAppStore.getState().notice).toEqual({ kind: 'info', message: 'NO NEW SUBTITLES: THE SOURCE OFFERS NO OTHERS.' });
        });

        it('says why it could not check, as an error notice in the words used for the errors of the section', async () => {
            mock.api.checkAnimeSubtitles.mockResolvedValue({ ok: false, reason: 'failed', error: { code: 'BLOCKED', raw: '403' } });
            const user = await ready();
            await user.click(screen.getByRole('button', { name: 'CHECK SUBTITLES' }));
            await vi.waitFor(() => {
                expect(useAppStore.getState().notice).toEqual({ kind: 'error', message: 'Could not check the subtitles. The source blocked the request. Try again later.' });
            });
            expect(screen.getByRole('button', { name: 'CHECK SUBTITLES' })).toBeEnabled();
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });

        it('says when the video of the episode is not on the disk', async () => {
            mock.api.checkAnimeSubtitles.mockResolvedValue({ ok: false, reason: 'missing' });
            const user = await ready();
            await user.click(screen.getByRole('button', { name: 'CHECK SUBTITLES' }));
            await vi.waitFor(() => {
                expect(useAppStore.getState().notice).toEqual({ kind: 'error', message: 'The video of this episode is not on the disk, so there is nothing to add subtitles to.' });
            });
        });

        it('puts the message of a new check in place of the last one', async () => {
            mock.api.checkAnimeSubtitles.mockResolvedValueOnce({ ok: false, reason: 'missing' });
            mock.api.checkAnimeSubtitles.mockResolvedValueOnce({ ok: true, added: [], tracks: [ENGLISH] });
            const user = await ready();
            await user.click(screen.getByRole('button', { name: 'CHECK SUBTITLES' }));
            await vi.waitFor(() => {
                expect(useAppStore.getState().notice?.kind).toBe('error');
            });
            await user.click(screen.getByRole('button', { name: 'CHECK SUBTITLES' }));
            await vi.waitFor(() => {
                expect(useAppStore.getState().notice).toEqual({ kind: 'info', message: 'NO NEW SUBTITLES: THE SOURCE OFFERS NO OTHERS.' });
            });
            expect(useAppStore.getState().toasts).toEqual([]);
        });

        describe('in another language', () => {
            const BRAZIL: AnimeSubtitleTrack = { id: 'subtitle-Portuguese (- Portuguese(Brazil))', label: 'Portuguese (- Portuguese(Brazil))', kind: 'source' };
            const LATIN: AnimeSubtitleTrack = { id: 'subtitle-Spanish (- Spanish(Latin America))', label: 'Spanish (- Spanish(Latin America))', kind: 'source' };

            beforeEach(() => {
                useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, language: 'pt' } });
            });

            it('writes the names of the subtitles of the source in the language of the app, in the menu of the player', async () => {
                mock.api.listAnimeSubtitles.mockResolvedValue([ENGLISH, BRAZIL, LATIN, IMPORTED]);
                render(<AnimePlayer />);
                const menu = await subtitleMenu({ gear: 'Configurações', menu: 'Legendas' });
                expect(Array.from(menu.querySelectorAll('option')).map((option) => {
                    return option.textContent;
                })).toEqual(expect.arrayContaining(['Inglês', 'Português (Brasil)', 'Espanhol (América Latina)', 'aula']));
                expect(screen.queryByRole('option', { name: 'Portuguese (- Portuguese(Brazil))' })).not.toBeInTheDocument();
            });

            it('keeps the name the file has in the <track> and writes the new ones with the same names in the notice', async () => {
                mock.api.listAnimeSubtitles.mockResolvedValue([ENGLISH]);
                mock.api.checkAnimeSubtitles.mockResolvedValue({ ok: true, added: ['Portuguese (- Portuguese(Brazil))', 'Spanish (- Spanish(Latin America))'], tracks: [ENGLISH, BRAZIL, LATIN] });
                const user = userEvent.setup();
                render(<AnimePlayer />);
                await openManager({ gear: 'Configurações', manage: 'GERENCIAR LEGENDAS', dialog: 'Gerenciar legendas' });
                await user.click(screen.getByRole('button', { name: 'VERIFICAR LEGENDAS' }));

                await vi.waitFor(() => {
                    expect(useAppStore.getState().notice).toEqual({ kind: 'info', message: 'NOVAS LEGENDAS ADICIONADAS (2): Português (Brasil), Espanhol (América Latina)' });
                });
                // What the player asks the app for is the file, by its id, not by the name that is shown.
                expect(document.querySelector('track[id="subtitle-Portuguese (- Portuguese(Brazil))"]')).toHaveAttribute('label', 'Portuguese (- Portuguese(Brazil))');
                expect(document.querySelector('track[id="subtitle-Portuguese (- Portuguese(Brazil))"]')).toHaveAttribute(
                    'src',
                    'pullwave-media://subtitle/1/subtitle-Portuguese%20(-%20Portuguese(Brazil))'
                );
            });
        });

        describe('how long the notice stays on the screen', () => {
            afterEach(() => {
                vi.useRealTimers();
            });

            async function checkWithToast(response: Parameters<typeof mock.api.checkAnimeSubtitles.mockResolvedValue>[0]) {
                mock.api.checkAnimeSubtitles.mockResolvedValue(response);
                render(
                    <>
                        <AnimePlayer />
                        <Toast />
                    </>
                );
                await openManager();
                vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
                await act(async () => {
                    fireEvent.click(screen.getByRole('button', { name: 'CHECK SUBTITLES' }));
                });
            }

            it('is the toast of the app, and an information goes away by itself after 5 seconds', async () => {
                expect(INFO_NOTICE_MS).toBe(5000);
                await checkWithToast({ ok: true, added: [], tracks: [ENGLISH] });
                const toast = screen.getByRole('status');
                expect(toast).toHaveClass('toast', 'toast--info');
                expect(toast).toHaveTextContent('NO NEW SUBTITLES: THE SOURCE OFFERS NO OTHERS.');
                act(() => {
                    vi.advanceTimersByTime(INFO_NOTICE_MS - 1);
                });
                expect(screen.getByRole('status')).toBeInTheDocument();
                act(() => {
                    vi.advanceTimersByTime(1);
                });
                expect(screen.queryByRole('status')).not.toBeInTheDocument();
                expect(useAppStore.getState().notice).toBeNull();
            });

            it('keeps an error until it is dismissed', async () => {
                await checkWithToast({ ok: false, reason: 'missing' });
                act(() => {
                    vi.advanceTimersByTime(INFO_NOTICE_MS * 10);
                });
                const toast = screen.getByRole('alert');
                expect(toast).toHaveClass('toast', 'toast--error');
                expect(toast).toHaveTextContent('The video of this episode is not on the disk, so there is nothing to add subtitles to.');
                fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
                expect(screen.queryByRole('alert')).not.toBeInTheDocument();
            });
        });
    });
});

describe('AnimePlayer and the window of the subtitles', () => {
    const SPANISH: AnimeSubtitleTrack = { id: 'translated-Spanish', label: 'Spanish', kind: 'translated' };
    const SUBTITLE_BUTTONS = ['LOAD SUBTITLE', 'CHECK SUBTITLES', 'TRANSLATE SUBTITLE', 'CREATE SUBTITLE'];

    beforeEach(() => {
        mock.api.listAnimeSubtitles.mockResolvedValue([ENGLISH, JAPANESE]);
        mock.api.estimateAnimeSubtitleTranslation.mockResolvedValue({ ok: true, cues: 12, batches: 1, approxTokens: 350 });
    });

    it('has no subtitle button in the header, only the ones of the episodes and the one that closes', async () => {
        render(<AnimePlayer />);
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
        SUBTITLE_BUTTONS.forEach((name) => {
            expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
        });
        const header = screen.getByRole('heading', { name: 'Naruto · EP 1' }).closest('header') as HTMLElement;
        expect(within(header).getAllByRole('button').map((button) => {
            return button.textContent;
        })).toEqual(['NEXT EPISODE', 'CLOSE']);
    });

    it('has the way into the window in the gear of the player, also for an episode with no subtitles', async () => {
        mock.api.listAnimeSubtitles.mockResolvedValue([]);
        render(<AnimePlayer />);
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
        const panel = openedPlayerSettings();
        expect(within(panel).getByRole('button', { name: 'MANAGE SUBTITLES' })).toBeInTheDocument();
        expect(within(panel).queryByRole('combobox', { name: 'Subtitles' })).not.toBeInTheDocument();
    });

    it('opens from the gear, which closes its panel, and is not there before', async () => {
        render(<AnimePlayer />);
        expect(screen.queryByRole('dialog', { name: 'Manage subtitles' })).not.toBeInTheDocument();
        await openManager();
        expect(screen.getByRole('dialog', { name: 'Manage subtitles' })).toBeInTheDocument();
        expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-expanded', 'false');
    });

    it('is in the part of the player that goes to fullscreen, with the video and the bar, so it shows there too', async () => {
        render(<AnimePlayer />);
        const manager = await openManager();
        const stage = getVideo().parentElement as HTMLElement;
        expect(stage).toContainElement(manager);
        expect(stage).toContainElement(screen.getByRole('button', { name: 'Fullscreen' }));
    });

    it('has only the buttons that get more subtitles: the menu of the subtitles and their size stay in the gear', async () => {
        render(<AnimePlayer />);
        const manager = await openManager();
        expect(within(manager).queryByRole('combobox')).not.toBeInTheDocument();
        expect(within(manager).queryByRole('group', { name: 'Subtitle size' })).not.toBeInTheDocument();
        expect(within(manager).getAllByRole('button').map((button) => {
            return button.textContent;
        })).toEqual(['LOAD SUBTITLE', 'TRANSLATE SUBTITLE', 'CHECK SUBTITLES', 'CLOSE']);

        fireEvent.click(within(manager).getByRole('button', { name: 'CLOSE' }));
        const panel = openedPlayerSettings();
        expect(within(panel).getByRole('combobox', { name: 'Subtitles' })).toHaveValue('default');
        expect(within(panel).getByRole('group', { name: 'Subtitle size' })).toHaveTextContent('100%');
    });

    it('shows the subtitle chosen in the gear, turns them off, and remembers the choice for the episode', async () => {
        const user = userEvent.setup();
        render(<AnimePlayer />);
        await subtitleMenu();
        await user.selectOptions(openedSubtitleMenu(), 'subtitle-Japanese');
        expect(trackElements().map((track) => {
            return track.hasAttribute('default');
        })).toEqual([false, true]);
        expect(window.localStorage.getItem('pullwave-subtitle-1')).toBe('subtitle-Japanese');
        await user.selectOptions(openedSubtitleMenu(), 'off');
        expect(window.localStorage.getItem('pullwave-subtitle-1')).toBe('off');
    });

    it('changes the size of the subtitles of the video from the gear, and remembers it', async () => {
        const user = userEvent.setup();
        render(<AnimePlayer />);
        await subtitleMenu();
        const panel = openedPlayerSettings();
        expect(getVideo().style.getPropertyValue('--subtitle-scale')).toBe('1');
        await user.click(within(panel).getByRole('button', { name: 'Larger subtitles' }));
        expect(getVideo().style.getPropertyValue('--subtitle-scale')).toBe('1.25');
        expect(window.localStorage.getItem('pullwave-subtitle-scale')).toBe('1.25');
        await user.click(within(panel).getByRole('button', { name: 'Smaller subtitles' }));
        await user.click(within(panel).getByRole('button', { name: 'Smaller subtitles' }));
        expect(getVideo().style.getPropertyValue('--subtitle-scale')).toBe('0.75');
        expect(within(panel).getByRole('group', { name: 'Subtitle size' })).toHaveTextContent('75%');
    });

    it('closes with its button and with Esc, and the player goes on', async () => {
        const user = userEvent.setup();
        render(<AnimePlayer />);
        const manager = await openManager();
        await user.click(within(manager).getByRole('button', { name: 'CLOSE' }));
        expect(screen.queryByRole('dialog', { name: 'Manage subtitles' })).not.toBeInTheDocument();
        expect(useAnimeStore.getState().playing).toEqual({ animeId: 5, episodeId: 1 });

        const again = await openManager();
        fireEvent.keyDown(again, { key: 'Escape' });
        expect(screen.queryByRole('dialog', { name: 'Manage subtitles' })).not.toBeInTheDocument();
        expect(useAnimeStore.getState().playing).toEqual({ animeId: 5, episodeId: 1 });
        expect(mock.api.saveAnimeProgress).not.toHaveBeenCalled();
    });

    it('does not seek the video with the arrows pressed in the window', async () => {
        render(<AnimePlayer />);
        const manager = await openManager();
        const video = getVideo();
        setPlayback(video, 100, 1440);
        fireEvent.keyDown(within(manager).getByRole('button', { name: 'LOAD SUBTITLE' }), { key: 'ArrowRight' });
        expect(video.currentTime).toBe(100);
    });

    it('keeps the window open under the dialog of the translation, which is in the same part of the player and above it', async () => {
        const user = userEvent.setup();
        render(<AnimePlayer />);
        await openManager();
        await user.click(screen.getByRole('button', { name: 'TRANSLATE SUBTITLE' }));
        const translate = await screen.findByRole('dialog', { name: 'Translate a subtitle' });
        const manager = screen.getByRole('dialog', { name: 'Manage subtitles' });
        const stage = getVideo().parentElement as HTMLElement;
        expect(stage).toContainElement(translate);
        expect(stage).toContainElement(manager);
        expect(manager.compareDocumentPosition(translate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('goes back to the window when the dialog of the translation closes, with the new subtitle chosen in the gear', async () => {
        const user = userEvent.setup();
        mock.api.translateAnimeSubtitle.mockResolvedValue({ ok: true, tracks: [ENGLISH, JAPANESE, SPANISH], translated: SPANISH });
        render(<AnimePlayer />);
        await openManager();
        await user.click(screen.getByRole('button', { name: 'TRANSLATE SUBTITLE' }));
        await screen.findByText('12 lines, 1 requests, about 350 tokens of your account.');
        await user.click(screen.getByRole('button', { name: 'TRANSLATE' }));
        await vi.waitFor(() => {
            expect(screen.queryByRole('dialog', { name: 'Translate a subtitle' })).not.toBeInTheDocument();
        });
        expect(screen.getByRole('dialog', { name: 'Manage subtitles' })).toBeInTheDocument();
        expect(openedSubtitleMenu()).toHaveValue('translated-Spanish');
        expect(await subtitleOption('Spanish')).toBeInTheDocument();
        expect(window.localStorage.getItem('pullwave-subtitle-1')).toBe('translated-Spanish');
    });

    it('closes only the dialog of the translation with Esc, and the window stays', async () => {
        const user = userEvent.setup();
        render(<AnimePlayer />);
        await openManager();
        await user.click(screen.getByRole('button', { name: 'TRANSLATE SUBTITLE' }));
        fireEvent.keyDown(await screen.findByRole('dialog', { name: 'Translate a subtitle' }), { key: 'Escape' });
        expect(screen.queryByRole('dialog', { name: 'Translate a subtitle' })).not.toBeInTheDocument();
        expect(screen.getByRole('dialog', { name: 'Manage subtitles' })).toBeInTheDocument();
        expect(useAnimeStore.getState().playing).toEqual({ animeId: 5, episodeId: 1 });
    });

    it('opens the dialog to create the subtitle in the same part of the player, over the window', async () => {
        const user = userEvent.setup();
        mock.api.listAnimeSubtitles.mockResolvedValue([]);
        mock.api.estimateAnimeSubtitleGeneration.mockResolvedValue({ ok: true, seconds: 1500, parts: 3, approxBytes: 6_000_000 });
        render(<AnimePlayer />);
        await openManager();
        await user.click(screen.getByRole('button', { name: 'CREATE SUBTITLE' }));
        const create = await screen.findByRole('dialog', { name: 'Create a subtitle' });
        const manager = screen.getByRole('dialog', { name: 'Manage subtitles' });
        expect(getVideo().parentElement).toContainElement(create);
        expect(manager.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('says why a file could not be loaded inside the window, and not in the header', async () => {
        const user = userEvent.setup();
        mock.api.importAnimeSubtitle.mockResolvedValue({ ok: false, reason: 'unreadable' });
        render(<AnimePlayer />);
        const manager = await openManager();
        await user.click(within(manager).getByRole('button', { name: 'LOAD SUBTITLE' }));
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('The subtitle file could not be read.');
        expect(manager).toContainElement(alert);
        const header = screen.getByRole('heading', { name: 'Naruto · EP 1' }).closest('header') as HTMLElement;
        expect(header).not.toContainElement(alert);
    });

    it('goes on saying a video that does not play in the header, with the window closed', () => {
        render(<AnimePlayer />);
        fireEvent.error(getVideo());
        const header = screen.getByRole('heading', { name: 'Naruto · EP 1' }).closest('header')?.parentElement as HTMLElement;
        expect(within(header).getByRole('alert')).toHaveTextContent('This video could not be played. Its format may not be supported by the app.');
        expect(screen.queryByRole('dialog', { name: 'Manage subtitles' })).not.toBeInTheDocument();
    });
});

describe('AnimePlayer translating subtitles', () => {
    const SPANISH: AnimeSubtitleTrack = { id: 'translated-Spanish', label: 'Spanish', kind: 'translated' };

    beforeEach(() => {
        mock.api.estimateAnimeSubtitleTranslation.mockResolvedValue({ ok: true, cues: 12, batches: 1, approxTokens: 350 });
    });

    async function opened() {
        const user = userEvent.setup();
        render(<AnimePlayer />);
        await openManager();
        await user.click(await screen.findByRole('button', { name: 'TRANSLATE SUBTITLE' }));
        await screen.findByText('12 lines, 1 requests, about 350 tokens of your account.');
        return user;
    }

    it('has a button between LOAD SUBTITLE and CHECK SUBTITLES in the window of the subtitles, and no dialog until it is pressed', async () => {
        render(<AnimePlayer />);
        const manager = await openManager();
        await within(manager).findByRole('button', { name: 'TRANSLATE SUBTITLE' });
        const labels = within(manager).getAllByRole('button').map((button) => {
            return button.textContent;
        });
        expect(labels.indexOf('LOAD SUBTITLE')).toBeLessThan(labels.indexOf('TRANSLATE SUBTITLE'));
        expect(labels.indexOf('TRANSLATE SUBTITLE')).toBeLessThan(labels.indexOf('CHECK SUBTITLES'));
        expect(screen.queryByRole('dialog', { name: 'Translate a subtitle' })).not.toBeInTheDocument();
        expect(mock.api.estimateAnimeSubtitleTranslation).not.toHaveBeenCalled();
    });

    it('opens the dialog for the episode that is playing, with the subtitles it has', async () => {
        mock.api.listAnimeSubtitles.mockResolvedValue([ENGLISH, JAPANESE]);
        await opened();
        expect(screen.getByRole('dialog', { name: 'Translate a subtitle' })).toBeInTheDocument();
        expect(mock.api.estimateAnimeSubtitleTranslation).toHaveBeenCalledWith({ episodeId: 1, trackId: null });
        expect(Array.from(screen.getByLabelText('Translate from').querySelectorAll('option')).map((option) => {
            return option.textContent;
        })).toEqual(['Automatic (English when there is one)', 'English', 'Japanese']);
    });

    it('closes the dialog and goes on playing', async () => {
        const user = await opened();
        await user.click(within(screen.getByRole('dialog', { name: 'Translate a subtitle' })).getByRole('button', { name: 'CLOSE' }));
        expect(screen.queryByRole('dialog', { name: 'Translate a subtitle' })).not.toBeInTheDocument();
        expect(screen.getByRole('dialog', { name: 'Naruto · EP 1' })).toBeInTheDocument();
        expect(useAnimeStore.getState().playing).toEqual({ animeId: 5, episodeId: 1 });
    });

    it('does not close the player when Esc closes the dialog', async () => {
        await opened();
        fireEvent.keyDown(screen.getByRole('dialog', { name: 'Translate a subtitle' }), { key: 'Escape' });
        expect(screen.queryByRole('dialog', { name: 'Translate a subtitle' })).not.toBeInTheDocument();
        expect(useAnimeStore.getState().playing).toEqual({ animeId: 5, episodeId: 1 });
    });

    describe('when the translation is done', () => {
        async function translated() {
            mock.api.translateAnimeSubtitle.mockResolvedValue({ ok: true, tracks: [ENGLISH, SPANISH], translated: SPANISH });
            const user = await opened();
            await user.click(screen.getByRole('button', { name: 'TRANSLATE' }));
            await vi.waitFor(() => {
                expect(screen.queryByRole('dialog', { name: 'Translate a subtitle' })).not.toBeInTheDocument();
            });
            return user;
        }

        it('puts the new subtitle in the list of the player and shows it', async () => {
            await translated();
            // The default settings: the anime subtitles follow the language of the app, English here.
            expect(mock.api.translateAnimeSubtitle).toHaveBeenCalledWith({ episodeId: 1, trackId: null, language: 'English' });
            expect(await subtitleOption('Spanish')).toBeInTheDocument();
            expect(document.querySelector('track[id="translated-Spanish"]')).toHaveAttribute('src', 'pullwave-media://subtitle/1/translated-Spanish');
            expect(openedSubtitleMenu()).toHaveValue('translated-Spanish');
        });

        it('remembers the new subtitle as the choice of the episode', async () => {
            await translated();
            expect(window.localStorage.getItem('pullwave-subtitle-1')).toBe('translated-Spanish');
        });

        it('says it was translated with a notice of the app', async () => {
            await translated();
            expect(useAppStore.getState().notice).toEqual({ kind: 'info', message: 'SUBTITLE TRANSLATED INTO Spanish.' });
        });
    });

    it('keeps the dialog open, with the reason, when the translation fails', async () => {
        mock.api.translateAnimeSubtitle.mockResolvedValue({ ok: false, reason: 'no-token' });
        const user = await opened();
        await user.click(screen.getByRole('button', { name: 'TRANSLATE' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('There is no token for this provider. Add one in the anime settings.');
        expect(screen.getByRole('dialog', { name: 'Translate a subtitle' })).toBeInTheDocument();
        expect(useAppStore.getState().notice).toBeNull();
        expect(document.querySelector('track[id="translated-Spanish"]')).toBeNull();
    });
});

describe('AnimePlayer creating the subtitle of an episode that has none', () => {
    const JAPANESE_TRACK: AnimeSubtitleTrack = { id: 'generated-Japanese', label: 'Japanese', kind: 'generated' };

    const AUDIO_TEXT = '25 min · about 5.7 MiB · 3 requests';

    beforeEach(() => {
        // The window starts on the language of the anime subtitles (English); the subtitle is then wanted in the language of the audio,
        // chosen in the window, so the audio is only transcribed.
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, animeSubtitles: 'English' } });
        mock.api.listAnimeSubtitles.mockResolvedValue([]);
        mock.api.estimateAnimeSubtitleGeneration.mockResolvedValue({ ok: true, seconds: 1500, parts: 3, approxBytes: 6_000_000 });
    });

    async function withoutSubtitles() {
        const user = userEvent.setup();
        render(<AnimePlayer />);
        await openManager();
        const button = await screen.findByRole('button', { name: 'CREATE SUBTITLE' });
        return { user, button };
    }

    it('offers CREATE SUBTITLE instead of TRANSLATE SUBTITLE when the list of subtitles comes empty', async () => {
        await withoutSubtitles();
        expect(screen.queryByRole('button', { name: 'TRANSLATE SUBTITLE' })).not.toBeInTheDocument();
        expect(screen.queryByRole('dialog', { name: 'Create a subtitle' })).not.toBeInTheDocument();
        expect(mock.api.estimateAnimeSubtitleGeneration).not.toHaveBeenCalled();
    });

    it('offers neither of them until the list of subtitles arrives, since it is not known yet whether there is one', async () => {
        mock.api.listAnimeSubtitles.mockReturnValue(new Promise(() => {
            return undefined;
        }));
        render(<AnimePlayer />);
        await openManager();
        expect(screen.getByRole('button', { name: 'LOAD SUBTITLE' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'CREATE SUBTITLE' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'TRANSLATE SUBTITLE' })).not.toBeInTheDocument();
    });

    it('offers TRANSLATE SUBTITLE, not CREATE SUBTITLE, when the episode has a subtitle', async () => {
        mock.api.listAnimeSubtitles.mockResolvedValue([ENGLISH]);
        render(<AnimePlayer />);
        await openManager();
        expect(await screen.findByRole('button', { name: 'TRANSLATE SUBTITLE' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'CREATE SUBTITLE' })).not.toBeInTheDocument();
    });

    it('opens the dialog for the episode that is playing, and measures its audio', async () => {
        const { user, button } = await withoutSubtitles();
        await user.click(button);
        expect(screen.getByRole('dialog', { name: 'Create a subtitle' })).toBeInTheDocument();
        expect(await screen.findByText(AUDIO_TEXT)).toBeInTheDocument();
        expect(mock.api.estimateAnimeSubtitleGeneration).toHaveBeenCalledTimes(1);
        expect(mock.api.estimateAnimeSubtitleGeneration).toHaveBeenCalledWith(1);
        expect(mock.api.estimateAnimeSubtitleTranslation).not.toHaveBeenCalled();
    });

    it('closes the dialog and goes on playing', async () => {
        const { user, button } = await withoutSubtitles();
        await user.click(button);
        await user.click(within(await screen.findByRole('dialog', { name: 'Create a subtitle' })).getByRole('button', { name: 'CLOSE' }));
        expect(screen.queryByRole('dialog', { name: 'Create a subtitle' })).not.toBeInTheDocument();
        expect(screen.getByRole('dialog', { name: 'Naruto · EP 1' })).toBeInTheDocument();
    });

    describe('when the subtitle is made', () => {
        async function created() {
            mock.api.generateAnimeSubtitle.mockResolvedValue({ ok: true, tracks: [JAPANESE_TRACK], generated: JAPANESE_TRACK });
            const { user, button } = await withoutSubtitles();
            await user.click(button);
            await screen.findByText(AUDIO_TEXT);
            expect(screen.getByLabelText('Language of the subtitle')).toHaveValue('English');
            await user.selectOptions(screen.getByLabelText('Language of the subtitle'), 'Japanese');
            await user.click(screen.getByRole('button', { name: 'CREATE' }));
            await vi.waitFor(() => {
                expect(screen.queryByRole('dialog', { name: 'Create a subtitle' })).not.toBeInTheDocument();
            });
            return user;
        }

        it('asks for it with the languages chosen in the window, and puts it in the list of the player, showing it', async () => {
            await created();
            expect(mock.api.generateAnimeSubtitle).toHaveBeenCalledWith({ episodeId: 1, audioLanguage: 'Japanese', language: 'Japanese' });
            expect(await subtitleOption('Japanese')).toBeInTheDocument();
            expect(document.querySelector('track[id="generated-Japanese"]')).toHaveAttribute('src', 'pullwave-media://subtitle/1/generated-Japanese');
            expect(openedSubtitleMenu()).toHaveValue('generated-Japanese');
        });

        it('remembers it as the choice of the episode and says so with a notice of the app', async () => {
            await created();
            expect(window.localStorage.getItem('pullwave-subtitle-1')).toBe('generated-Japanese');
            expect(useAppStore.getState().notice).toEqual({ kind: 'info', message: 'SUBTITLE CREATED IN Japanese.' });
        });

        it('turns the button into TRANSLATE SUBTITLE, since the episode has a subtitle now', async () => {
            await created();
            expect(screen.getByRole('button', { name: 'TRANSLATE SUBTITLE' })).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'CREATE SUBTITLE' })).not.toBeInTheDocument();
        });
    });

    it('keeps the dialog open, with the reason, when the subtitle could not be made', async () => {
        mock.api.generateAnimeSubtitle.mockResolvedValue({ ok: false, reason: 'no-token' });
        const { user, button } = await withoutSubtitles();
        await user.click(button);
        await screen.findByText(AUDIO_TEXT);
        await user.click(screen.getByRole('button', { name: 'CREATE' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('There is no token for this service. Add one in the anime settings.');
        expect(screen.getByRole('dialog', { name: 'Create a subtitle' })).toBeInTheDocument();
        expect(useAppStore.getState().notice).toBeNull();
        expect(screen.getByRole('button', { name: 'CREATE SUBTITLE' })).toBeInTheDocument();
    });
});
