// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnimeStream } from '@shared/anime';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { AnimeStreamPlayer, STREAM_BUFFER_SECONDS } from '@renderer/components/AnimeStreamPlayer';
import { INITIAL_SEARCH, UNSUPPORTED_STATUS, useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { readAutoNextPref, useUiPrefsStore } from '@renderer/store/uiPrefsStore';
import { AUTO_NEXT_DELAY_MS } from '@renderer/components/AutoNextPanel';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';
import { openedSubtitleMenu } from '../../helpers/playerSettings';
import { openErrorDialog } from '../../helpers/errorDialog';

const hls = vi.hoisted(() => {
    type Listener = (event: string, data: { fatal?: boolean; levels?: Array<{ height: number; bitrate: number }> }) => void;
    const state = {
        supported: true,
        instances: [] as Array<{
            options: unknown;
            source: string | null;
            media: HTMLVideoElement | null;
            destroyed: boolean;
            listeners: Record<string, Listener>;
            currentLevel: number;
        }>
    };
    class FakeHls {
        static Events = { ERROR: 'hlsError', MANIFEST_PARSED: 'hlsManifestParsed' };
        static isSupported(): boolean {
            return state.supported;
        }
        readonly record: (typeof state.instances)[number];
        constructor(options: unknown) {
            this.record = { options, source: null, media: null, destroyed: false, listeners: {}, currentLevel: -1 };
            state.instances.push(this.record);
        }
        on(event: string, listener: Listener): void {
            this.record.listeners[event] = listener;
        }
        loadSource(url: string): void {
            this.record.source = url;
        }
        attachMedia(media: HTMLVideoElement): void {
            this.record.media = media;
        }
        destroy(): void {
            this.record.destroyed = true;
        }
        // The quality hls.js was told to stay on (-1 is its automatic choice).
        set currentLevel(level: number) {
            this.record.currentLevel = level;
        }
        get currentLevel(): number {
            return this.record.currentLevel;
        }
    }
    return { state, FakeHls };
});

vi.mock('hls.js', () => {
    return { default: hls.FakeHls };
});

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialAnime = useAnimeStore.getState();

const STREAM: AnimeStream = { sessionId: 's1', url: 'pullwave-stream://p/s1/abc', subtitleUrl: 'pullwave-stream://p/s1/def', subtitles: [] };

// A stream whose source lists its subtitles, as the one of Frieren does: every one is named in English and the first of the list is
// not the one ani-cli picked.
const LISTED: AnimeStream = {
    sessionId: 's1',
    url: 'pullwave-stream://p/s1/abc',
    subtitleUrl: 'pullwave-stream://p/s1/english',
    subtitles: [
        { id: 'stream-1', label: 'Arabic', url: 'pullwave-stream://p/s1/arabic' },
        { id: 'stream-2', label: 'English', url: 'pullwave-stream://p/s1/english' },
        { id: 'stream-3', label: 'Portuguese (- Portuguese(Brazil))', url: 'pullwave-stream://p/s1/portuguese' },
        { id: 'stream-4', label: 'Spanish (- Spanish(Latin America))', url: 'pullwave-stream://p/s1/spanish' }
    ]
};

beforeEach(() => {
    mock = installMockApi();
    hls.state.supported = true;
    hls.state.instances.length = 0;
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS });
    useAnimeStore.setState({ ...initialAnime, status: UNSUPPORTED_STATUS, jobs: [], library: [], search: INITIAL_SEARCH, selection: null, playing: null, streaming: null });
    window.localStorage.clear();
    useUiPrefsStore.setState({ autoNext: true });
});

function stream(overrides: Partial<NonNullable<ReturnType<typeof useAnimeStore.getState>['streaming']>> = {}): void {
    useAnimeStore.setState({ streaming: { title: 'The Apothecary Diaries', episode: '3', status: 'ready', stream: STREAM, error: null, nextEpisode: null, ...overrides } });
}

describe('AnimeStreamPlayer', () => {
    it('renders nothing when nothing is being watched', () => {
        const { container } = render(<AnimeStreamPlayer />);
        expect(container).toBeEmptyDOMElement();
    });

    it('opens a dialog named after the episode and focuses the close button', () => {
        stream();
        render(<AnimeStreamPlayer />);
        const dialog = screen.getByRole('dialog', { name: 'The Apothecary Diaries · EP 3' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(screen.getByRole('heading', { name: 'The Apothecary Diaries · EP 3' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'CLOSE' })).toHaveFocus();
    });

    it('says the video is being found', () => {
        stream({ status: 'loading', stream: null });
        render(<AnimeStreamPlayer />);
        expect(screen.getByText('FINDING THE VIDEO…')).toBeInTheDocument();
        expect(document.querySelector('video')).toBeNull();
    });

    it('explains why the video could not be found, and opens the window with the raw text when it is clicked', async () => {
        const user = userEvent.setup();
        stream({ status: 'error', stream: null, error: { code: 'NO_SOURCES', raw: 'No sources found for sub!' } });
        render(<AnimeStreamPlayer />);
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('No video source was found for this episode.');
        expect(alert).not.toHaveAttribute('title');
        expect(document.querySelector('video')).toBeNull();
        const dialog = await openErrorDialog(user, 'No video source was found for this episode.');
        expect(within(dialog).getByTestId('error-message')).toHaveTextContent('No sources found for sub!');
        expect(within(dialog).getByText('NO_SOURCES')).toBeInTheDocument();
    });

    it('does not show an error without one', () => {
        stream({ status: 'error', stream: null, error: null });
        render(<AnimeStreamPlayer />);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    describe('the video', () => {
        it('feeds hls.js with the playlist and attaches it to the video, without a worker', () => {
            stream();
            render(<AnimeStreamPlayer />);

            const video = document.querySelector('video') as HTMLVideoElement;
            expect(video.controls).toBe(false);
            expect(video.autoplay).toBe(true);
            expect(video.parentElement).toHaveClass('player__stage');
            expect(video.nextElementSibling).toHaveClass('player__controls');
            expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
            expect(screen.getByRole('slider', { name: 'Seek' })).toBeInTheDocument();
            expect(screen.getByRole('slider', { name: 'Volume' })).toBeInTheDocument();
            expect(openedSubtitleMenu()).toHaveValue('stream');
            expect(screen.getByRole('button', { name: 'Fullscreen' })).toBeInTheDocument();
            expect(video).toHaveAttribute('crossorigin', 'anonymous');
            expect(hls.state.instances).toHaveLength(1);
            expect(hls.state.instances[0]).toMatchObject({ options: { enableWorker: false, maxBufferLength: 60 }, source: STREAM.url, destroyed: false });
            expect(hls.state.instances[0]?.media).toBe(video);
        });

        it('lets hls.js load a minute of the episode ahead of what is playing', () => {
            expect(STREAM_BUFFER_SECONDS).toBe(60);
            stream();
            render(<AnimeStreamPlayer />);
            expect(hls.state.instances[0]?.options).toEqual({ enableWorker: false, maxBufferLength: STREAM_BUFFER_SECONDS });
        });

        it('shows the subtitles when there are some', () => {
            stream();
            render(<AnimeStreamPlayer />);
            const track = document.querySelector('track');
            expect(track).toHaveAttribute('src', STREAM.subtitleUrl as string);
            expect(track).toHaveAttribute('kind', 'subtitles');
            expect(track).toHaveAttribute('label', 'Subtitles');
            expect(track?.hasAttribute('default')).toBe(true);
            expect(track).toHaveAttribute('id', 'stream');
        });

        it('lets the viewer turn the subtitles off and on', async () => {
            stream();
            const user = userEvent.setup();
            render(<AnimeStreamPlayer />);
            const select = openedSubtitleMenu();
            await user.selectOptions(select, 'off');
            expect(select).toHaveValue('off');
            await user.selectOptions(select, 'stream');
            expect(select).toHaveValue('stream');
        });

        it('has no subtitle track without subtitles', () => {
            stream({ stream: { ...STREAM, subtitleUrl: null } });
            render(<AnimeStreamPlayer />);
            expect(document.querySelector('track')).toBeNull();
            expect(screen.queryByRole('combobox', { name: 'Subtitles' })).not.toBeInTheDocument();
        });

        describe('with the subtitles the source lists', () => {
            function tracks(): HTMLTrackElement[] {
                return Array.from(document.querySelectorAll('track'));
            }

            it('has a track for every language, the one ani-cli picked first, each with its own address through the app', () => {
                stream({ stream: LISTED });
                render(<AnimeStreamPlayer />);

                expect(
                    tracks().map((track) => {
                        return [track.id, track.getAttribute('src'), track.getAttribute('label'), track.getAttribute('kind')];
                    })
                ).toEqual([
                    ['stream-2', 'pullwave-stream://p/s1/english', 'English', 'subtitles'],
                    ['stream-1', 'pullwave-stream://p/s1/arabic', 'Arabic', 'subtitles'],
                    ['stream-3', 'pullwave-stream://p/s1/portuguese', 'Portuguese (- Portuguese(Brazil))', 'subtitles'],
                    ['stream-4', 'pullwave-stream://p/s1/spanish', 'Spanish (- Spanish(Latin America))', 'subtitles']
                ]);
            });

            it('shows the one ani-cli picked at first, and only that one is the default', () => {
                stream({ stream: LISTED });
                render(<AnimeStreamPlayer />);

                expect(openedSubtitleMenu()).toHaveValue('stream-2');
                expect(
                    tracks()
                        .filter((track) => {
                            return track.hasAttribute('default');
                        })
                        .map((track) => {
                            return track.id;
                        })
                ).toEqual(['stream-2']);
            });

            it('names the languages in the menu as the language of the app does, and keeps "off" in it', () => {
                stream({ stream: LISTED });
                render(<AnimeStreamPlayer />);
                const menu = openedSubtitleMenu();

                expect(
                    Array.from(menu.querySelectorAll('option')).map((option) => {
                        return [option.value, option.textContent];
                    })
                ).toEqual([
                    ['off', 'Off'],
                    ['stream-2', 'English'],
                    ['stream-1', 'Arabic'],
                    ['stream-3', 'Portuguese (Brazil)'],
                    ['stream-4', 'Spanish (Latin America)']
                ]);
            });

            it('writes the names in Portuguese when the app is in Portuguese', () => {
                useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, language: 'pt' } });
                stream({ stream: LISTED });
                render(<AnimeStreamPlayer />);
                const menu = openedSubtitleMenu({ gear: 'Configurações', menu: 'Legendas' });

                expect(
                    Array.from(menu.querySelectorAll('option')).map((option) => {
                        return [option.value, option.textContent];
                    })
                ).toEqual([
                    ['off', 'Desativadas'],
                    ['stream-2', 'Inglês'],
                    ['stream-1', 'Árabe'],
                    ['stream-3', 'Português (Brasil)'],
                    ['stream-4', 'Espanhol (América Latina)']
                ]);
            });

            it('lets the viewer pick a language: the menu follows, and the track of that language is the one that shows', async () => {
                stream({ stream: LISTED });
                const user = userEvent.setup();
                render(<AnimeStreamPlayer />);
                const menu = openedSubtitleMenu();

                await user.selectOptions(menu, 'stream-3');

                expect(menu).toHaveValue('stream-3');
                expect(tracks().find((track) => {
                    return track.id === 'stream-3';
                })?.hasAttribute('default')).toBe(true);
            });

            it('turns the subtitles off and on again, back to the language that was picked', async () => {
                stream({ stream: LISTED });
                const user = userEvent.setup();
                render(<AnimeStreamPlayer />);
                const menu = openedSubtitleMenu();

                await user.selectOptions(menu, 'stream-4');
                await user.selectOptions(menu, 'off');
                expect(menu).toHaveValue('off');
                await user.selectOptions(menu, 'stream-4');

                expect(menu).toHaveValue('stream-4');
            });

            it('keeps the tracks apart from the ones of another stream', () => {
                stream({ stream: LISTED });
                render(<AnimeStreamPlayer />);
                act(() => {
                    stream({ stream: { ...LISTED, sessionId: 's2', subtitleUrl: 'pullwave-stream://p/s2/arabic', subtitles: [{ id: 'stream-1', label: 'Arabic', url: 'pullwave-stream://p/s2/arabic' }] } });
                });

                expect(tracks().map((track) => {
                    return track.getAttribute('src');
                })).toEqual(['pullwave-stream://p/s2/arabic']);
                expect(openedSubtitleMenu()).toHaveValue('stream-1');
            });

            it('shows the first of the list when the one ani-cli picked is not in it', () => {
                stream({ stream: { ...LISTED, subtitleUrl: 'pullwave-stream://p/s1/not-listed' } });
                render(<AnimeStreamPlayer />);

                expect(openedSubtitleMenu()).toHaveValue('stream-1');
                expect(tracks()[0]?.id).toBe('stream-1');
            });

            it('shows no subtitle at first when ani-cli picked none and the source lists some: the first of the list', () => {
                stream({ stream: { ...LISTED, subtitleUrl: null } });
                render(<AnimeStreamPlayer />);

                expect(openedSubtitleMenu()).toHaveValue('stream-1');
            });

            it('keeps the one generic subtitle, named as before, when the source does not list them', () => {
                stream();
                render(<AnimeStreamPlayer />);

                const menu = openedSubtitleMenu();
                expect(
                    Array.from(menu.querySelectorAll('option')).map((option) => {
                        return option.textContent;
                    })
                ).toEqual(['Off', 'Subtitles']);
            });
        });

        it('says so when hls.js reports a failure it cannot recover from', () => {
            stream();
            render(<AnimeStreamPlayer />);
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();

            act(() => {
                hls.state.instances[0]?.listeners.hlsError?.('hlsError', { fatal: false });
            });
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();

            act(() => {
                hls.state.instances[0]?.listeners.hlsError?.('hlsError', { fatal: true });
            });
            expect(screen.getByRole('alert')).toHaveTextContent('This video could not be played. Its format may not be supported by the app.');
        });

        it('says so when the browser cannot play this kind of stream', () => {
            hls.state.supported = false;
            stream();
            render(<AnimeStreamPlayer />);
            expect(screen.getByRole('alert')).toHaveTextContent('This video could not be played.');
            expect(hls.state.instances).toHaveLength(0);
        });

        it('stays on the best quality of the master, and does not leave it to the speed of the connection', () => {
            stream();
            render(<AnimeStreamPlayer />);
            const instance = hls.state.instances[0];
            expect(instance?.currentLevel).toBe(-1);

            act(() => {
                instance?.listeners.hlsManifestParsed?.('hlsManifestParsed', {
                    levels: [
                        { height: 360, bitrate: 900_000 },
                        { height: 480, bitrate: 1_500_000 },
                        { height: 720, bitrate: 3_000_000 },
                        { height: 1080, bitrate: 5_300_000 }
                    ]
                });
            });
            expect(instance?.currentLevel).toBe(3);
        });

        it('picks the tallest quality even when the master lists them from the best to the worst', () => {
            stream();
            render(<AnimeStreamPlayer />);
            act(() => {
                hls.state.instances[0]?.listeners.hlsManifestParsed?.('hlsManifestParsed', {
                    levels: [
                        { height: 1080, bitrate: 5_300_000 },
                        { height: 720, bitrate: 3_000_000 }
                    ]
                });
            });
            expect(hls.state.instances[0]?.currentLevel).toBe(0);
        });

        it('stays on the only quality of a stream that has one, and leaves the choice alone when there is none', () => {
            stream();
            render(<AnimeStreamPlayer />);
            act(() => {
                hls.state.instances[0]?.listeners.hlsManifestParsed?.('hlsManifestParsed', { levels: [{ height: 1080, bitrate: 5_300_000 }] });
            });
            expect(hls.state.instances[0]?.currentLevel).toBe(0);

            act(() => {
                stream({ stream: { sessionId: 's2', url: 'pullwave-stream://p/s2/xyz', subtitleUrl: null, subtitles: [] } });
            });
            act(() => {
                hls.state.instances[1]?.listeners.hlsManifestParsed?.('hlsManifestParsed', { levels: [] });
            });
            expect(hls.state.instances[1]?.currentLevel).toBe(-1);
        });

        it('chooses the quality again for the next episode', () => {
            stream();
            render(<AnimeStreamPlayer />);
            act(() => {
                stream({ stream: { sessionId: 's2', url: 'pullwave-stream://p/s2/xyz', subtitleUrl: null, subtitles: [] } });
            });
            act(() => {
                hls.state.instances[1]?.listeners.hlsManifestParsed?.('hlsManifestParsed', {
                    levels: [
                        { height: 480, bitrate: 1_500_000 },
                        { height: 1080, bitrate: 5_300_000 }
                    ]
                });
            });
            expect(hls.state.instances[1]?.currentLevel).toBe(1);
            expect(hls.state.instances[0]?.currentLevel).toBe(-1);
        });

        it('lets go of hls.js when it is closed', () => {
            stream();
            const { unmount } = render(<AnimeStreamPlayer />);
            unmount();
            expect(hls.state.instances[0]?.destroyed).toBe(true);
        });

        it('starts over with a new video when another stream is opened', () => {
            stream();
            render(<AnimeStreamPlayer />);
            act(() => {
                stream({ stream: { sessionId: 's2', url: 'pullwave-stream://p/s2/xyz', subtitleUrl: null, subtitles: [] } });
            });
            expect(hls.state.instances).toHaveLength(2);
            expect(hls.state.instances[0]?.destroyed).toBe(true);
            expect(hls.state.instances[1]?.source).toBe('pullwave-stream://p/s2/xyz');
        });
    });

    describe('the next episode that starts by itself', () => {
        const SECOND_STREAM: AnimeStream = { sessionId: 's2', url: 'pullwave-stream://p/s2/xyz', subtitleUrl: null, subtitles: [] };

        // The source lists episodes 3 and 4: the one playing is the 3rd.
        function withNextEpisode(overrides: Partial<NonNullable<ReturnType<typeof useAnimeStore.getState>['streaming']>> = {}): void {
            useAnimeStore.setState({
                selection: { result: { index: 2, title: 'The Apothecary Diaries' }, query: 'apothecary', status: 'ready', episodes: ['2', '3', '4'], error: null }
            });
            stream({ nextEpisode: '4', ...overrides });
        }

        function endEpisode(): void {
            act(() => {
                fireEvent.ended(document.querySelector('video') as HTMLVideoElement);
            });
        }

        it('shows no panel while the episode plays', () => {
            withNextEpisode();
            render(<AnimeStreamPlayer />);
            expect(screen.queryByRole('region', { name: 'NEXT EPISODE' })).not.toBeInTheDocument();
        });

        it('shows the panel of the next episode over the video when the episode ends', () => {
            withNextEpisode();
            render(<AnimeStreamPlayer />);
            endEpisode();

            const panel = screen.getByRole('region', { name: 'NEXT EPISODE' });
            expect(panel).toHaveTextContent('The Apothecary Diaries · EP 4');
            expect(document.querySelector('.player__stage')).toContainElement(panel);
            expect(within(panel).getByRole('button', { name: 'PLAY NOW' })).toBeInTheDocument();
            expect(within(panel).getByRole('button', { name: 'CANCEL' })).toBeInTheDocument();
        });

        it('shows no panel when the episode is the last one the source lists', () => {
            withNextEpisode({ nextEpisode: null });
            render(<AnimeStreamPlayer />);
            endEpisode();
            expect(screen.queryByRole('region', { name: 'NEXT EPISODE' })).not.toBeInTheDocument();
        });

        it('is on by default: with no choice saved the panel shows when the episode ends', () => {
            window.localStorage.clear();
            useUiPrefsStore.setState({ autoNext: readAutoNextPref() });
            expect(useUiPrefsStore.getState().autoNext).toBe(true);
            withNextEpisode();
            render(<AnimeStreamPlayer />);
            endEpisode();
            expect(screen.getByRole('region', { name: 'NEXT EPISODE' })).toBeInTheDocument();
        });

        it('shows no panel when it was turned off', () => {
            useUiPrefsStore.setState({ autoNext: false });
            withNextEpisode();
            render(<AnimeStreamPlayer />);
            endEpisode();
            expect(screen.queryByRole('region', { name: 'NEXT EPISODE' })).not.toBeInTheDocument();
        });

        it('opens the next episode when the count is over', async () => {
            vi.useFakeTimers();
            try {
                mock.api.openAnimeStream.mockResolvedValue({ ok: true, stream: SECOND_STREAM });
                withNextEpisode();
                render(<AnimeStreamPlayer />);
                endEpisode();
                await act(async () => {
                    await vi.advanceTimersByTimeAsync(AUTO_NEXT_DELAY_MS);
                });

                expect(mock.api.openAnimeStream).toHaveBeenCalledTimes(1);
                expect(mock.api.openAnimeStream).toHaveBeenCalledWith({ query: 'apothecary', index: 2, episode: '4' });
                expect(screen.getByRole('dialog', { name: 'The Apothecary Diaries · EP 4' })).toBeInTheDocument();
                expect(mock.api.closeAnimeStream).toHaveBeenCalledWith('s1');
                expect(hls.state.instances[1]?.source).toBe('pullwave-stream://p/s2/xyz');
                expect(screen.queryByRole('region', { name: 'NEXT EPISODE' })).not.toBeInTheDocument();
            } finally {
                vi.useRealTimers();
            }
        });

        it('opens the next episode at once with PLAY NOW', async () => {
            const user = userEvent.setup();
            mock.api.openAnimeStream.mockResolvedValue({ ok: true, stream: SECOND_STREAM });
            withNextEpisode();
            render(<AnimeStreamPlayer />);
            endEpisode();

            await user.click(screen.getByRole('button', { name: 'PLAY NOW' }));

            expect(mock.api.openAnimeStream).toHaveBeenCalledWith({ query: 'apothecary', index: 2, episode: '4' });
            expect(await screen.findByRole('dialog', { name: 'The Apothecary Diaries · EP 4' })).toBeInTheDocument();
            expect(useAnimeStore.getState().streaming).toEqual({
                title: 'The Apothecary Diaries',
                episode: '4',
                status: 'ready',
                stream: SECOND_STREAM,
                error: null,
                nextEpisode: null
            });
        });

        it('stays on the episode, with no panel, when the viewer cancels', async () => {
            const user = userEvent.setup();
            withNextEpisode();
            render(<AnimeStreamPlayer />);
            endEpisode();
            await user.click(screen.getByRole('button', { name: 'CANCEL' }));

            expect(screen.queryByRole('region', { name: 'NEXT EPISODE' })).not.toBeInTheDocument();
            expect(mock.api.openAnimeStream).not.toHaveBeenCalled();
            expect(screen.getByRole('dialog', { name: 'The Apothecary Diaries · EP 3' })).toBeInTheDocument();
        });

        it('stays on the episode when the viewer plays it again before the count is over', () => {
            withNextEpisode();
            render(<AnimeStreamPlayer />);
            endEpisode();
            expect(screen.getByRole('region', { name: 'NEXT EPISODE' })).toBeInTheDocument();

            act(() => {
                fireEvent.play(document.querySelector('video') as HTMLVideoElement);
            });
            expect(screen.queryByRole('region', { name: 'NEXT EPISODE' })).not.toBeInTheDocument();
        });

        it('is turned off and on from the settings of the player, which have it even when the episode has no subtitles', async () => {
            const user = userEvent.setup();
            withNextEpisode();
            render(<AnimeStreamPlayer />);
            await user.click(screen.getByRole('button', { name: 'Settings' }));

            const toggle = screen.getByRole('switch', { name: 'Next episode automatically' });
            expect(toggle).toHaveProperty('checked', true);
            await user.click(toggle);
            expect(useUiPrefsStore.getState().autoNext).toBe(false);
            expect(screen.getByRole('switch', { name: 'Next episode automatically' })).toHaveProperty('checked', false);
        });
    });

    describe('the stage that goes to fullscreen', () => {
        const SECOND_STREAM: AnimeStream = { sessionId: 's2', url: 'pullwave-stream://p/s2/xyz', subtitleUrl: null, subtitles: [] };

        function stageOf(): HTMLElement {
            return document.querySelector('.player__stage') as HTMLElement;
        }

        it('has no stage while the first video is being found, and gets it with the video', () => {
            stream({ status: 'loading', stream: null });
            render(<AnimeStreamPlayer />);
            expect(stageOf()).toBeNull();
            expect(screen.getByText('FINDING THE VIDEO…')).toBeInTheDocument();

            act(() => {
                stream();
            });
            expect(stageOf()).not.toBeNull();
            expect(stageOf()).toContainElement(document.querySelector('video'));
            expect(screen.queryByText('FINDING THE VIDEO…')).not.toBeInTheDocument();
        });

        it('keeps the very same stage in the page while the next episode is found and after it comes, so the browser does not leave fullscreen', () => {
            stream({ nextEpisode: '4' });
            render(<AnimeStreamPlayer />);
            const stage = stageOf();
            const first = document.querySelector('video') as HTMLVideoElement;
            Object.defineProperty(document, 'fullscreenElement', { value: stage, configurable: true });
            try {
                act(() => {
                    stream({ episode: '4', status: 'loading', stream: null, nextEpisode: null });
                });
                expect(stageOf()).toBe(stage);
                expect(stage.isConnected).toBe(true);
                expect(first.isConnected).toBe(false);
                expect(within(stage).getByText('FINDING THE VIDEO…')).toBeInTheDocument();
                expect(screen.getByRole('dialog', { name: 'The Apothecary Diaries · EP 4' })).toBeInTheDocument();

                act(() => {
                    stream({ episode: '4', stream: SECOND_STREAM, nextEpisode: null });
                });
                expect(stageOf()).toBe(stage);
                expect(document.fullscreenElement).toBe(stage);
                expect(stage.isConnected).toBe(true);
                expect(within(stage).queryByText('FINDING THE VIDEO…')).not.toBeInTheDocument();
                expect(stage).toContainElement(document.querySelector('video'));
                expect(document.querySelector('video')).not.toBe(first);
                expect(hls.state.instances[1]?.source).toBe('pullwave-stream://p/s2/xyz');
                expect(within(stage).getByRole('button', { name: 'Fullscreen' })).toBeInTheDocument();
            } finally {
                Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
            }
        });

        it('takes the stage away and shows the error when the next episode cannot be found', () => {
            stream();
            render(<AnimeStreamPlayer />);
            expect(stageOf()).not.toBeNull();

            act(() => {
                stream({ episode: '4', status: 'error', stream: null, error: { code: 'NO_SOURCES', raw: 'No sources found for sub!' } });
            });
            expect(stageOf()).toBeNull();
            expect(screen.getByRole('alert')).toHaveTextContent('No video source was found for this episode.');
            expect(screen.getByRole('dialog', { name: 'The Apothecary Diaries · EP 4' })).toBeInTheDocument();
        });

        it('does not keep a stage for the loading of another episode after an error', () => {
            stream();
            render(<AnimeStreamPlayer />);
            act(() => {
                stream({ episode: '4', status: 'error', stream: null, error: { code: 'NO_SOURCES', raw: 'x' } });
            });
            act(() => {
                stream({ episode: '5', status: 'loading', stream: null });
            });
            expect(stageOf()).toBeNull();
            expect(screen.getByText('FINDING THE VIDEO…')).toBeInTheDocument();
        });
    });

    describe('closing', () => {
        it('closes with the button and lets the main process drop the stream', async () => {
            const user = userEvent.setup();
            stream();
            render(<AnimeStreamPlayer />);
            await user.click(screen.getByRole('button', { name: 'CLOSE' }));
            expect(useAnimeStore.getState().streaming).toBeNull();
            expect(mock.api.closeAnimeStream).toHaveBeenCalledWith('s1');
        });

        it('closes with Escape and ignores other keys', () => {
            stream();
            render(<AnimeStreamPlayer />);
            fireEvent.keyDown(window, { key: 'Enter' });
            expect(useAnimeStore.getState().streaming).not.toBeNull();
            fireEvent.keyDown(window, { key: 'Escape' });
            expect(useAnimeStore.getState().streaming).toBeNull();
            expect(mock.api.closeAnimeStream).toHaveBeenCalledWith('s1');
        });

        it('can be closed while the video is still being found', async () => {
            const user = userEvent.setup();
            stream({ status: 'loading', stream: null });
            render(<AnimeStreamPlayer />);
            await user.click(screen.getByRole('button', { name: 'CLOSE' }));
            expect(useAnimeStore.getState().streaming).toBeNull();
            expect(mock.api.closeAnimeStream).not.toHaveBeenCalled();
        });

        it('stops listening for Escape once it is gone', () => {
            stream();
            const { unmount } = render(<AnimeStreamPlayer />);
            unmount();
            fireEvent.keyDown(window, { key: 'Escape' });
            expect(mock.api.closeAnimeStream).not.toHaveBeenCalled();
        });
    });
});
