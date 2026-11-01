// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnimeStream } from '@shared/anime';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { AnimeStreamPlayer, STREAM_BUFFER_SECONDS } from '@renderer/components/AnimeStreamPlayer';
import { INITIAL_SEARCH, UNSUPPORTED_STATUS, useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';
import { openedSubtitleMenu } from '../../helpers/playerSettings';
import { openErrorDialog } from '../../helpers/errorDialog';

const hls = vi.hoisted(() => {
    type Listener = (event: string, data: { fatal: boolean }) => void;
    const state = {
        supported: true,
        instances: [] as Array<{
            options: unknown;
            source: string | null;
            media: HTMLVideoElement | null;
            destroyed: boolean;
            listeners: Record<string, Listener>;
        }>
    };
    class FakeHls {
        static Events = { ERROR: 'hlsError' };
        static isSupported(): boolean {
            return state.supported;
        }
        readonly record: (typeof state.instances)[number];
        constructor(options: unknown) {
            this.record = { options, source: null, media: null, destroyed: false, listeners: {} };
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
});

function stream(overrides: Partial<NonNullable<ReturnType<typeof useAnimeStore.getState>['streaming']>> = {}): void {
    useAnimeStore.setState({ streaming: { title: 'The Apothecary Diaries', episode: '3', status: 'ready', stream: STREAM, error: null, ...overrides } });
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
