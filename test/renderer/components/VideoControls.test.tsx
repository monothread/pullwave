// @vitest-environment jsdom
import { createRef, type RefObject } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { openedPlayerSettings } from '../../helpers/playerSettings';
import { fakeTextTrackList, type FakeTextTrack } from '../../helpers/textTracks';
import { VideoControls, formatClock, type SubtitleOption } from '@renderer/components/VideoControls';

interface Harness {
    video: HTMLVideoElement;
    ref: RefObject<HTMLVideoElement | null>;
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    unmount: () => void;
    onSelectSubtitle: ReturnType<typeof vi.fn>;
}

const OPTIONS: SubtitleOption[] = [
    { id: 'default', label: 'English' },
    { id: 'subtitle-Japanese', label: 'Japanese' }
];

// The same, with the settings of the player open, where the subtitle controls are.
function setupOpen(subtitles: SubtitleOption[] = OPTIONS, duration = 120, selected: string | null = 'default'): Harness {
    const harness = setup(subtitles, duration, selected);
    openedPlayerSettings();
    return harness;
}

function setup(subtitles: SubtitleOption[] = OPTIONS, duration = 120, selected: string | null = 'default'): Harness {
    const video = document.createElement('video');
    Object.defineProperty(video, 'duration', { value: duration, configurable: true });
    const play = vi.fn(() => {
        Object.defineProperty(video, 'paused', { value: false, configurable: true });
        return Promise.resolve();
    });
    const pause = vi.fn(() => {
        Object.defineProperty(video, 'paused', { value: true, configurable: true });
    });
    video.play = play;
    video.pause = pause;
    const stage = document.createElement('div');
    stage.appendChild(video);
    document.body.appendChild(stage);
    const ref = createRef<HTMLVideoElement>();
    (ref as { current: HTMLVideoElement | null }).current = video;
    const onSelectSubtitle = vi.fn();
    const { unmount } = render(<VideoControls video={ref} subtitles={subtitles} selectedSubtitle={selected} onSelectSubtitle={onSelectSubtitle} />);
    return { video, ref, play, pause, unmount, onSelectSubtitle };
}

beforeEach(() => {
    window.localStorage.clear();
});

afterEach(() => {
    document.body.innerHTML = '';
});

describe('formatClock', () => {
    it.each([
        [0, '0:00'],
        [5, '0:05'],
        [65, '1:05'],
        [600, '10:00'],
        [3600, '1:00:00'],
        [3725.9, '1:02:05'],
        [Number.NaN, '0:00'],
        [Number.POSITIVE_INFINITY, '0:00'],
        [-4, '0:00']
    ])('formats %s as %s', (seconds, expected) => {
        expect(formatClock(seconds)).toBe(expected);
    });
});

describe('VideoControls', () => {
    it('starts paused at 0:00 with the duration of the video', () => {
        setup();
        expect(screen.getByRole('button', { name: 'Play' })).toHaveTextContent('▶');
        expect(screen.getAllByText('0:00')).toHaveLength(1);
        expect(screen.getByText('2:00')).toBeInTheDocument();
        expect(screen.getByRole('slider', { name: 'Seek' })).toHaveAttribute('max', '120');
        expect(screen.getByRole('slider', { name: 'Volume' })).toHaveValue('1');
    });

    it('shows a zero duration while it is unknown', () => {
        setup(OPTIONS, Number.NaN);
        expect(screen.getAllByText('0:00')).toHaveLength(2);
        expect(screen.getByRole('slider', { name: 'Seek' })).toHaveAttribute('max', '0');
    });

    it('plays and pauses the video', async () => {
        const { video, play, pause } = setup();
        const user = userEvent.setup();

        await user.click(screen.getByRole('button', { name: 'Play' }));
        expect(play).toHaveBeenCalledTimes(1);
        act(() => {
            fireEvent.play(video);
        });
        expect(screen.getByRole('button', { name: 'Pause' })).toHaveTextContent('❚❚');
        expect(document.querySelector('.player__controls')).toHaveAttribute('data-playing', 'true');

        await user.click(screen.getByRole('button', { name: 'Pause' }));
        expect(pause).toHaveBeenCalledTimes(1);
        act(() => {
            fireEvent.pause(video);
        });
        expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
        expect(document.querySelector('.player__controls')).toHaveAttribute('data-playing', 'false');
    });

    it('ignores a play request the browser refuses', async () => {
        const { video, play } = setup();
        play.mockImplementationOnce(() => {
            return Promise.reject(new Error('NotAllowedError'));
        });
        await userEvent.setup().click(screen.getByRole('button', { name: 'Play' }));
        expect(play).toHaveBeenCalledTimes(1);
        expect(video.paused).toBe(true);
    });

    it('follows the playback time', () => {
        const { video } = setup();
        video.currentTime = 75;
        act(() => {
            fireEvent.timeUpdate(video);
        });
        expect(screen.getByText('1:15')).toBeInTheDocument();
        const seek = screen.getByRole('slider', { name: 'Seek' });
        expect(seek).toHaveValue('75');
        expect(seek.style.getPropertyValue('--progress')).toBe('62.5%');
    });

    it('seeks when the slider moves', () => {
        const { video } = setup();
        fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '42' } });
        expect(video.currentTime).toBe(42);
    });

    it.each([
        ['ArrowRight', 50, 55],
        ['ArrowLeft', 50, 45],
        ['ArrowLeft', 2, 0],
        ['ArrowRight', 118, 120]
    ])('moves 5 seconds with %s from %s to %s', (key, from, to) => {
        const { video } = setup();
        video.currentTime = from;
        act(() => {
            fireEvent.timeUpdate(video);
        });
        const keyEvent = fireEvent.keyDown(screen.getByRole('slider', { name: 'Seek' }), { key });
        expect(keyEvent).toBe(false);
        expect(video.currentTime).toBe(to);
    });

    it('leaves other keys alone, so Escape still closes the dialog', () => {
        const { video } = setup();
        video.currentTime = 10;
        act(() => {
            fireEvent.timeUpdate(video);
        });
        const notPrevented = fireEvent.keyDown(screen.getByRole('slider', { name: 'Seek' }), { key: 'Escape' });
        expect(notPrevented).toBe(true);
        expect(video.currentTime).toBe(10);
    });

    describe('keyboard shortcuts', () => {
        function pressOn(target: Element, init: KeyboardEventInit): boolean {
            return fireEvent.keyDown(target, init);
        }

        function setVideoState(video: HTMLVideoElement, values: { currentTime?: number; volume?: number; muted?: boolean }): void {
            Object.assign(video, values);
        }

        it('plays and pauses with the space bar from anywhere on the page', () => {
            const { video, play, pause } = setup();

            const firstPress = pressOn(document.body, { key: ' ' });
            expect(firstPress).toBe(false);
            expect(play).toHaveBeenCalledTimes(1);
            expect(pause).not.toHaveBeenCalled();

            pressOn(document.body, { key: ' ' });
            expect(pause).toHaveBeenCalledTimes(1);
            expect(play).toHaveBeenCalledTimes(1);
            expect(video.paused).toBe(true);
        });

        it('plays with the space bar when the focus is on the video stage', () => {
            const { video, play } = setup();
            pressOn(video.parentElement as HTMLElement, { key: ' ' });
            expect(play).toHaveBeenCalledTimes(1);
        });

        it('plays with the space bar when the focus is on the seek slider', () => {
            const { play } = setup();
            pressOn(screen.getByRole('slider', { name: 'Seek' }), { key: ' ' });
            expect(play).toHaveBeenCalledTimes(1);
        });

        it('plays with the space bar even when a button of the bar has the focus, without pressing it', () => {
            const { video, play } = setup();
            const mute = screen.getByRole('button', { name: 'Mute' });
            mute.focus();
            expect(pressOn(mute, { key: ' ' })).toBe(false);
            expect(fireEvent.keyUp(mute, { key: ' ' })).toBe(false);
            expect(play).toHaveBeenCalledTimes(1);
            expect(video.muted).toBe(false);
        });

        it('plays with the space bar when a button outside the bar has the focus, like the close button of the player', () => {
            const { play } = setup();
            const close = document.createElement('button');
            document.body.appendChild(close);
            close.focus();
            expect(pressOn(close, { key: ' ' })).toBe(false);
            expect(fireEvent.keyUp(close, { key: ' ' })).toBe(false);
            expect(play).toHaveBeenCalledTimes(1);
        });

        it('leaves the space bar to a focused button of the settings, which is pressed by it', async () => {
            const { play, pause } = setup();
            openedPlayerSettings();
            const larger = screen.getByRole('button', { name: 'Larger subtitles' });
            expect(pressOn(larger, { key: ' ' })).toBe(true);
            expect(fireEvent.keyUp(larger, { key: ' ' })).toBe(true);
            expect(play).not.toHaveBeenCalled();
            expect(pause).not.toHaveBeenCalled();
        });

        it('does not hold back the release of other keys', () => {
            setup();
            expect(fireEvent.keyUp(document.body, { key: 'a' })).toBe(true);
            expect(fireEvent.keyUp(document.body, { key: ' ', ctrlKey: true })).toBe(true);
        });

        it.each([
            ['ArrowRight', 50, 55],
            ['ArrowLeft', 50, 45],
            ['ArrowLeft', 2, 0],
            ['ArrowRight', 118, 120]
        ])('moves 5 seconds with %s from %s to %s from anywhere on the page', (key, from, to) => {
            const { video } = setup();
            setVideoState(video, { currentTime: from });
            const notPrevented = pressOn(document.body, { key });
            expect(notPrevented).toBe(false);
            expect(video.currentTime).toBe(to);
        });

        it.each([
            ['ArrowUp', 0.5, 0.55],
            ['ArrowDown', 0.5, 0.45],
            ['ArrowUp', 0.98, 1],
            ['ArrowDown', 0.03, 0],
            ['ArrowUp', 1, 1],
            ['ArrowDown', 0, 0]
        ])('changes the volume with %s from %s to %s', (key, from, to) => {
            const { video } = setup();
            setVideoState(video, { volume: from });
            const notPrevented = pressOn(document.body, { key });
            expect(notPrevented).toBe(false);
            expect(video.volume).toBe(to);
            expect(video.muted).toBe(to === 0);
        });

        it('does not drift from zero after many steps down', () => {
            const { video } = setup();
            setVideoState(video, { volume: 0.15 });
            pressOn(document.body, { key: 'ArrowDown' });
            pressOn(document.body, { key: 'ArrowDown' });
            pressOn(document.body, { key: 'ArrowDown' });
            expect(video.volume).toBe(0);
            expect(video.muted).toBe(true);
        });

        it('raises the volume from silence and unmutes when the video was muted', () => {
            const { video } = setup();
            setVideoState(video, { volume: 0.8, muted: true });
            pressOn(document.body, { key: 'ArrowUp' });
            expect(video.volume).toBe(0.05);
            expect(video.muted).toBe(false);
        });

        it('moves 5 seconds with the arrows on the seek slider', () => {
            const { video } = setup();
            setVideoState(video, { currentTime: 30 });
            const notPrevented = pressOn(screen.getByRole('slider', { name: 'Seek' }), { key: 'ArrowRight' });
            expect(notPrevented).toBe(false);
            expect(video.currentTime).toBe(35);
        });

        it('leaves the arrows to the volume slider, which moves by them', () => {
            const { video } = setup();
            setVideoState(video, { currentTime: 30, volume: 0.5 });
            const notPrevented = pressOn(screen.getByRole('slider', { name: 'Volume' }), { key: 'ArrowUp' });
            expect(notPrevented).toBe(true);
            expect(video.currentTime).toBe(30);
            expect(video.volume).toBe(0.5);
        });

        it.each([' ', 'ArrowRight', 'ArrowUp'])('leaves %s to a text field', (key) => {
            const { video, play } = setup();
            setVideoState(video, { currentTime: 30, volume: 0.5 });
            const field = document.createElement('input');
            field.type = 'text';
            document.body.appendChild(field);
            const notPrevented = pressOn(field, { key });
            expect(notPrevented).toBe(true);
            expect(play).not.toHaveBeenCalled();
            expect(video.currentTime).toBe(30);
            expect(video.volume).toBe(0.5);
        });

        it('leaves the keys to a select and to a text area', () => {
            const { video, play } = setup();
            setVideoState(video, { currentTime: 30 });
            const select = document.createElement('select');
            const area = document.createElement('textarea');
            document.body.append(select, area);
            expect(pressOn(select, { key: 'ArrowRight' })).toBe(true);
            expect(pressOn(area, { key: ' ' })).toBe(true);
            expect(play).not.toHaveBeenCalled();
            expect(video.currentTime).toBe(30);
        });

        it('leaves the keys to an editable element', () => {
            const { play } = setup();
            const editable = document.createElement('div');
            Object.defineProperty(editable, 'isContentEditable', { value: true });
            document.body.appendChild(editable);
            expect(pressOn(editable, { key: ' ' })).toBe(true);
            expect(play).not.toHaveBeenCalled();
        });

        it.each([
            ['ctrlKey', 'ArrowRight'],
            ['altKey', 'ArrowLeft'],
            ['metaKey', ' '],
            ['shiftKey', 'ArrowUp']
        ])('ignores %s combined with %s', (modifier, key) => {
            const { video, play } = setup();
            setVideoState(video, { currentTime: 30, volume: 0.5 });
            const notPrevented = pressOn(document.body, { key, [modifier]: true });
            expect(notPrevented).toBe(true);
            expect(play).not.toHaveBeenCalled();
            expect(video.currentTime).toBe(30);
            expect(video.volume).toBe(0.5);
        });

        it('does nothing for a duration that is not known yet when seeking', () => {
            const { video } = setup(OPTIONS, Number.NaN);
            setVideoState(video, { currentTime: 0 });
            pressOn(document.body, { key: 'ArrowRight' });
            expect(video.currentTime).toBe(0);
        });

        it('stops listening when the controls are removed', () => {
            const { play, unmount } = setup();
            unmount();
            const notPrevented = pressOn(document.body, { key: ' ' });
            expect(notPrevented).toBe(true);
            expect(play).not.toHaveBeenCalled();
        });
    });

    it('mutes and unmutes the video', async () => {
        const { video } = setup();
        const user = userEvent.setup();

        await user.click(screen.getByRole('button', { name: 'Mute' }));
        expect(video.muted).toBe(true);
        act(() => {
            fireEvent(video, new Event('volumechange'));
        });
        expect(screen.getByRole('button', { name: 'Unmute' })).toHaveTextContent('🔇');
        expect(screen.getByRole('slider', { name: 'Volume' })).toHaveValue('0');

        await user.click(screen.getByRole('button', { name: 'Unmute' }));
        expect(video.muted).toBe(false);
        act(() => {
            fireEvent(video, new Event('volumechange'));
        });
        expect(screen.getByRole('button', { name: 'Mute' })).toHaveTextContent('🔊');
        expect(screen.getByRole('slider', { name: 'Volume' })).toHaveValue('1');
    });

    it('changes the volume and mutes at zero', () => {
        const { video } = setup();
        const volume = screen.getByRole('slider', { name: 'Volume' });

        fireEvent.change(volume, { target: { value: '0.5' } });
        expect(video.volume).toBe(0.5);
        expect(video.muted).toBe(false);
        // jsdom does not fire the event the browser fires after a volume change.
        act(() => {
            fireEvent(video, new Event('volumechange'));
        });
        expect(volume.style.getPropertyValue('--progress')).toBe('50%');

        fireEvent.change(volume, { target: { value: '0' } });
        expect(video.volume).toBe(0);
        expect(video.muted).toBe(true);
        act(() => {
            fireEvent(video, new Event('volumechange'));
        });
        expect(screen.getByRole('button', { name: 'Unmute' })).toBeInTheDocument();
    });

    describe('subtitles', () => {
        it('lists the subtitles with an option to turn them off, and shows the selected one', () => {
            setupOpen();
            const select = screen.getByRole('combobox', { name: 'Subtitles' });
            expect(select).toHaveValue('default');
            expect(
                within(select)
                    .getAllByRole('option')
                    .map((option) => {
                        return [option.getAttribute('value'), option.textContent];
                    })
            ).toEqual([
                ['off', 'Off'],
                ['default', 'English'],
                ['subtitle-Japanese', 'Japanese']
            ]);
        });

        it('shows "off" when no subtitle is selected', () => {
            setupOpen(OPTIONS, 120, null);
            expect(screen.getByRole('combobox', { name: 'Subtitles' })).toHaveValue('off');
        });

        it('tells which subtitle was chosen, and null for off', async () => {
            const { onSelectSubtitle } = setupOpen();
            const user = userEvent.setup();
            await user.selectOptions(screen.getByRole('combobox', { name: 'Subtitles' }), 'subtitle-Japanese');
            expect(onSelectSubtitle).toHaveBeenLastCalledWith('subtitle-Japanese');
            await user.selectOptions(screen.getByRole('combobox', { name: 'Subtitles' }), 'off');
            expect(onSelectSubtitle).toHaveBeenLastCalledWith(null);
            expect(onSelectSubtitle).toHaveBeenCalledTimes(2);
        });

        it('keeps the settings closed until the gear is clicked, and the sound stays on the bar', async () => {
            setup();
            const user = userEvent.setup();
            const gear = screen.getByRole('button', { name: 'Settings' });
            expect(gear).toHaveAttribute('aria-expanded', 'false');
            expect(gear).toHaveAttribute('aria-haspopup', 'dialog');
            expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
            expect(screen.queryByRole('combobox', { name: 'Subtitles' })).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Mute' })).toBeInTheDocument();
            expect(screen.getByRole('slider', { name: 'Volume' })).toBeInTheDocument();

            await user.click(gear);
            expect(gear).toHaveAttribute('aria-expanded', 'true');
            const dialog = screen.getByRole('dialog', { name: 'Settings' });
            expect(within(dialog).getByRole('combobox', { name: 'Subtitles' })).toBeInTheDocument();
            expect(within(dialog).getByRole('group', { name: 'Subtitle size' })).toBeInTheDocument();
            expect(within(dialog).getByRole('combobox', { name: 'Subtitle color' })).toBeInTheDocument();
            expect(within(dialog).getByRole('combobox', { name: 'Subtitle background' })).toBeInTheDocument();
            expect(within(dialog).queryByRole('button', { name: 'Mute' })).not.toBeInTheDocument();

            await user.click(gear);
            expect(gear).toHaveAttribute('aria-expanded', 'false');
            expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
        });

        it('closes the settings with Escape and with a click outside, but not with a click inside', async () => {
            setup();
            const user = userEvent.setup();
            const gear = screen.getByRole('button', { name: 'Settings' });

            await user.click(gear);
            await user.click(screen.getByText('Subtitle size'));
            expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
            await user.keyboard('{Escape}');
            expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();

            await user.click(gear);
            await user.click(document.body);
            expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();

            await user.click(gear);
            await user.keyboard('a');
            expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
        });

        it('does not seek the video with the arrows inside the settings', async () => {
            const { video } = setup();
            Object.defineProperty(video, 'currentTime', { value: 10, writable: true, configurable: true });
            openedPlayerSettings();
            const user = userEvent.setup();
            screen.getByRole('combobox', { name: 'Subtitle color' }).focus();
            await user.keyboard('{ArrowRight}');
            expect(video.currentTime).toBe(10);
        });

        it('has no gear when the video has no subtitles, because there is nothing to set', () => {
            setup([]);
            expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
            expect(screen.queryByRole('combobox', { name: 'Subtitles' })).not.toBeInTheDocument();
        });

        it('shows the selected track and hides the others', () => {
            const { video, ref, unmount } = setup(OPTIONS, 120, 'subtitle-Japanese');
            const tracks: FakeTextTrack[] = [{ id: 'default', mode: 'showing' }, { id: 'subtitle-Japanese', mode: 'disabled' }, { id: 'other', mode: 'showing' }];
            Object.defineProperty(video, 'textTracks', { value: fakeTextTrackList(tracks), configurable: true });
            unmount();
            render(<VideoControls video={ref} subtitles={OPTIONS} selectedSubtitle="subtitle-Japanese" onSelectSubtitle={vi.fn()} />);
            expect(
                tracks.map((track) => {
                    return [track.id, track.mode];
                })
            ).toEqual([
                ['default', 'disabled'],
                ['subtitle-Japanese', 'showing'],
                ['other', 'disabled']
            ]);
        });

        it('puts the choice back when the browser shows another track by itself afterwards', () => {
            const { video, ref, unmount } = setup(OPTIONS, 120, 'subtitle-Japanese');
            const tracks: FakeTextTrack[] = [{ id: 'default', mode: 'disabled' }, { id: 'subtitle-Japanese', mode: 'showing' }, { id: 'other', mode: 'disabled' }];
            const list = fakeTextTrackList(tracks);
            Object.defineProperty(video, 'textTracks', { value: list, configurable: true });
            unmount();
            render(<VideoControls video={ref} subtitles={OPTIONS} selectedSubtitle="subtitle-Japanese" onSelectSubtitle={vi.fn()} />);

            // The browser picks a subtitle by the language it prefers once the data of the video is there.
            (tracks[2] as FakeTextTrack).mode = 'showing';
            list.dispatchEvent(new Event('change'));

            expect(
                tracks.map((track) => {
                    return [track.id, track.mode];
                })
            ).toEqual([
                ['default', 'disabled'],
                ['subtitle-Japanese', 'showing'],
                ['other', 'disabled']
            ]);
        });

        it('puts the choice back when the chosen track is hidden by the browser', () => {
            const { video, ref, unmount } = setup(OPTIONS, 120, 'subtitle-Japanese');
            const tracks: FakeTextTrack[] = [{ id: 'default', mode: 'disabled' }, { id: 'subtitle-Japanese', mode: 'showing' }];
            const list = fakeTextTrackList(tracks);
            Object.defineProperty(video, 'textTracks', { value: list, configurable: true });
            unmount();
            render(<VideoControls video={ref} subtitles={OPTIONS} selectedSubtitle="subtitle-Japanese" onSelectSubtitle={vi.fn()} />);

            (tracks[1] as FakeTextTrack).mode = 'disabled';
            list.dispatchEvent(new Event('change'));

            expect((tracks[1] as FakeTextTrack).mode).toBe('showing');
        });

        it('applies the choice to a track that is added afterwards', () => {
            const { video, ref, unmount } = setup(OPTIONS, 120, 'subtitle-Japanese');
            const tracks: FakeTextTrack[] = [{ id: 'subtitle-Japanese', mode: 'showing' }];
            const list = fakeTextTrackList(tracks);
            Object.defineProperty(video, 'textTracks', { value: list, configurable: true });
            unmount();
            render(<VideoControls video={ref} subtitles={OPTIONS} selectedSubtitle="subtitle-Japanese" onSelectSubtitle={vi.fn()} />);

            tracks.push({ id: 'added', mode: 'showing' });
            list.dispatchEvent(new Event('addtrack'));

            expect(
                tracks.map((track) => {
                    return [track.id, track.mode];
                })
            ).toEqual([
                ['subtitle-Japanese', 'showing'],
                ['added', 'disabled']
            ]);
        });

        it('stops listening to the tracks when the controls go away', () => {
            const { video, ref, unmount } = setup(OPTIONS, 120, 'subtitle-Japanese');
            const tracks: FakeTextTrack[] = [{ id: 'default', mode: 'disabled' }, { id: 'subtitle-Japanese', mode: 'showing' }];
            const list = fakeTextTrackList(tracks);
            Object.defineProperty(video, 'textTracks', { value: list, configurable: true });
            unmount();
            const { unmount: unmountAgain } = render(<VideoControls video={ref} subtitles={OPTIONS} selectedSubtitle="subtitle-Japanese" onSelectSubtitle={vi.fn()} />);
            unmountAgain();

            (tracks[0] as FakeTextTrack).mode = 'showing';
            list.dispatchEvent(new Event('change'));

            expect((tracks[0] as FakeTextTrack).mode).toBe('showing');
        });

        it('makes the subtitles bigger and smaller, remembers it and shows it on the video', async () => {
            const { video } = setupOpen();
            const user = userEvent.setup();
            expect(video.style.getPropertyValue('--subtitle-scale')).toBe('1');
            expect(within(screen.getByRole('group', { name: 'Subtitle size' })).getByText('100%')).toBeInTheDocument();

            await user.click(screen.getByRole('button', { name: 'Larger subtitles' }));
            await user.click(screen.getByRole('button', { name: 'Larger subtitles' }));
            expect(video.style.getPropertyValue('--subtitle-scale')).toBe('1.5');
            expect(screen.getByText('150%')).toBeInTheDocument();
            expect(window.localStorage.getItem('pullwave-subtitle-scale')).toBe('1.5');

            await user.click(screen.getByRole('button', { name: 'Smaller subtitles' }));
            expect(video.style.getPropertyValue('--subtitle-scale')).toBe('1.25');
            expect(screen.getByText('125%')).toBeInTheDocument();
            expect(window.localStorage.getItem('pullwave-subtitle-scale')).toBe('1.25');
        });

        it('starts at the size the viewer chose before', () => {
            window.localStorage.setItem('pullwave-subtitle-scale', '2');
            const { video } = setupOpen();
            expect(video.style.getPropertyValue('--subtitle-scale')).toBe('2');
            expect(screen.getByText('200%')).toBeInTheDocument();
        });

        it('stops at the smallest and the largest size', async () => {
            const user = userEvent.setup();
            window.localStorage.setItem('pullwave-subtitle-scale', '0.5');
            const { unmount } = setupOpen();
            expect(screen.getByRole('button', { name: 'Smaller subtitles' })).toBeDisabled();
            expect(screen.getByRole('button', { name: 'Larger subtitles' })).toBeEnabled();
            unmount();
            document.body.innerHTML = '';

            window.localStorage.setItem('pullwave-subtitle-scale', '3');
            setupOpen();
            expect(screen.getByRole('button', { name: 'Larger subtitles' })).toBeDisabled();
            expect(screen.getByRole('button', { name: 'Smaller subtitles' })).toBeEnabled();
            await user.click(screen.getByRole('button', { name: 'Larger subtitles' }));
            expect(screen.getByText('300%')).toBeInTheDocument();
        });

        it('changes the color of the subtitles, remembers it and shows it on the video', async () => {
            const { video } = setupOpen();
            const user = userEvent.setup();
            const select = screen.getByRole('combobox', { name: 'Subtitle color' });
            expect(select).toHaveValue('theme');
            expect(Array.from(select.querySelectorAll('option')).map((option) => {
                return [option.value, option.textContent];
            })).toEqual([
                ['theme', 'Theme color'],
                ['white', 'White'],
                ['yellow', 'Yellow'],
                ['cyan', 'Cyan'],
                ['green', 'Green']
            ]);
            expect(video.style.getPropertyValue('--subtitle-color')).toBe('');

            await user.selectOptions(select, 'yellow');
            expect(video.style.getPropertyValue('--subtitle-color')).toBe('#ffeb3b');
            expect(window.localStorage.getItem('pullwave-subtitle-color')).toBe('yellow');

            await user.selectOptions(select, 'theme');
            expect(video.style.getPropertyValue('--subtitle-color')).toBe('');
            expect(window.localStorage.getItem('pullwave-subtitle-color')).toBe('theme');
        });

        it('changes the background of the subtitles, remembers it and shows it on the video', async () => {
            const { video } = setupOpen();
            const user = userEvent.setup();
            const select = screen.getByRole('combobox', { name: 'Subtitle background' });
            expect(select).toHaveValue('dim');
            expect(Array.from(select.querySelectorAll('option')).map((option) => {
                return [option.value, option.textContent];
            })).toEqual([
                ['dim', 'Dim'],
                ['solid', 'Solid black'],
                ['none', 'None']
            ]);
            expect(video.style.getPropertyValue('--subtitle-background')).toBe('');

            await user.selectOptions(select, 'solid');
            expect(video.style.getPropertyValue('--subtitle-background')).toBe('#000000');
            expect(window.localStorage.getItem('pullwave-subtitle-background')).toBe('solid');

            await user.selectOptions(select, 'none');
            expect(video.style.getPropertyValue('--subtitle-background')).toBe('transparent');
            expect(window.localStorage.getItem('pullwave-subtitle-background')).toBe('none');

            await user.selectOptions(select, 'dim');
            expect(video.style.getPropertyValue('--subtitle-background')).toBe('');
        });

        it('starts with the colors the viewer chose before', () => {
            window.localStorage.setItem('pullwave-subtitle-color', 'green');
            window.localStorage.setItem('pullwave-subtitle-background', 'none');
            const { video } = setupOpen();
            expect(screen.getByRole('combobox', { name: 'Subtitle color' })).toHaveValue('green');
            expect(screen.getByRole('combobox', { name: 'Subtitle background' })).toHaveValue('none');
            expect(video.style.getPropertyValue('--subtitle-color')).toBe('#69f0ae');
            expect(video.style.getPropertyValue('--subtitle-background')).toBe('transparent');
        });

        it('has no color control when the video has no subtitles', () => {
            setup([]);
            expect(screen.queryByRole('combobox', { name: 'Subtitle color' })).not.toBeInTheDocument();
            expect(screen.queryByRole('combobox', { name: 'Subtitle background' })).not.toBeInTheDocument();
        });

        it('has no size control when the video has no subtitles', () => {
            setup([]);
            expect(screen.queryByRole('group', { name: 'Subtitle size' })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Larger subtitles' })).not.toBeInTheDocument();
        });

        it('hides every track when the subtitles are off', () => {
            const { video, ref, unmount } = setupOpen();
            const tracks: FakeTextTrack[] = [{ id: 'default', mode: 'showing' }, { id: 'subtitle-Japanese', mode: 'showing' }];
            Object.defineProperty(video, 'textTracks', { value: fakeTextTrackList(tracks), configurable: true });
            unmount();
            render(<VideoControls video={ref} subtitles={OPTIONS} selectedSubtitle={null} onSelectSubtitle={vi.fn()} />);
            expect(
                tracks.map((track) => {
                    return track.mode;
                })
            ).toEqual(['disabled', 'disabled']);
        });
    });

    it('enters and leaves fullscreen with the stage that holds the video and the controls', async () => {
        const { video } = setup();
        const stage = video.parentElement as HTMLElement;
        const requestFullscreen = vi.fn(() => {
            return Promise.resolve();
        });
        const exitFullscreen = vi.fn(() => {
            return Promise.resolve();
        });
        stage.requestFullscreen = requestFullscreen;
        document.exitFullscreen = exitFullscreen;
        const user = userEvent.setup();

        await user.click(screen.getByRole('button', { name: 'Fullscreen' }));
        expect(requestFullscreen).toHaveBeenCalledTimes(1);
        expect(exitFullscreen).not.toHaveBeenCalled();

        Object.defineProperty(document, 'fullscreenElement', { value: stage, configurable: true });
        await user.click(screen.getByRole('button', { name: 'Fullscreen' }));
        expect(exitFullscreen).toHaveBeenCalledTimes(1);
        expect(requestFullscreen).toHaveBeenCalledTimes(1);
        Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
    });

    describe('loading after a jump', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        function emit(video: HTMLVideoElement, name: string): void {
            act(() => {
                video.dispatchEvent(new Event(name));
            });
        }

        function wait(ms: number): void {
            act(() => {
                vi.advanceTimersByTime(ms);
            });
        }

        it('shows a loading mark over the video when the data takes a moment, and takes it away when it arrives', () => {
            const { video } = setup();
            expect(screen.queryByRole('status', { name: 'Loading…' })).not.toBeInTheDocument();
            emit(video, 'seeking');
            emit(video, 'waiting');
            expect(screen.queryByRole('status', { name: 'Loading…' })).not.toBeInTheDocument();
            wait(150);
            expect(screen.getByRole('status', { name: 'Loading…' })).toBeInTheDocument();
            emit(video, 'playing');
            expect(screen.queryByRole('status', { name: 'Loading…' })).not.toBeInTheDocument();
        });

        it('shows nothing when the jump is answered at once', () => {
            const { video } = setup();
            emit(video, 'seeking');
            wait(100);
            emit(video, 'seeked');
            wait(500);
            expect(screen.queryByRole('status', { name: 'Loading…' })).not.toBeInTheDocument();
        });
    });

    describe('the timeline', () => {
        function timeline(): HTMLInputElement {
            return screen.getByRole('slider', { name: 'Seek' }) as HTMLInputElement;
        }

        function measure(bar: HTMLInputElement): void {
            bar.getBoundingClientRect = () => {
                return { left: 100, width: 200, right: 300, top: 0, bottom: 6, height: 6, x: 100, y: 0, toJSON: () => { return {}; } };
            };
            Object.defineProperty(bar, 'offsetLeft', { value: 60, configurable: true });
        }

        it('shows the time under the mouse above the timeline, following the mouse, and hides it when the mouse leaves', () => {
            setup([], 200);
            const bar = timeline();
            measure(bar);
            expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

            fireEvent.mouseMove(bar, { clientX: 150 });
            const tooltip = screen.getByRole('tooltip');
            expect(tooltip).toHaveTextContent('0:50');
            expect(tooltip).toHaveStyle({ left: '110px' });

            fireEvent.mouseMove(bar, { clientX: 300 });
            expect(screen.getByRole('tooltip')).toHaveTextContent('3:20');
            expect(screen.getByRole('tooltip')).toHaveStyle({ left: '260px' });

            fireEvent.mouseLeave(bar);
            expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
        });

        it('shows nothing under the mouse while the length of the video is not known', () => {
            setup([], 0);
            const bar = timeline();
            measure(bar);
            fireEvent.mouseMove(bar, { clientX: 150 });
            expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
        });

        it('paints how far the video is loaded after the part already watched', () => {
            const { video } = setup([], 200);
            Object.defineProperty(video, 'currentTime', { value: 20, configurable: true });
            Object.defineProperty(video, 'buffered', {
                value: { length: 1, start: () => { return 0; }, end: () => { return 100; } },
                configurable: true
            });
            act(() => {
                video.dispatchEvent(new Event('progress'));
                video.dispatchEvent(new Event('timeupdate'));
            });
            expect(timeline().style.getPropertyValue('--progress')).toBe('10%');
            expect(timeline().style.getPropertyValue('--buffered')).toBe('50%');
        });
    });

    describe('in fullscreen', () => {
        function controls(): HTMLElement {
            return document.querySelector('.player__controls') as HTMLElement;
        }

        afterEach(() => {
            Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
            vi.useRealTimers();
        });

        it('shows the controls and hides them after 3 seconds without mouse movement, showing them again on movement', () => {
            vi.useFakeTimers();
            const { video } = setup();
            const stage = video.parentElement as HTMLElement;
            expect(controls()).toHaveAttribute('data-hidden', 'false');

            Object.defineProperty(document, 'fullscreenElement', { value: stage, configurable: true });
            act(() => {
                document.dispatchEvent(new Event('fullscreenchange'));
            });
            expect(controls()).toHaveAttribute('data-hidden', 'false');
            act(() => {
                vi.advanceTimersByTime(3000);
            });
            expect(controls()).toHaveAttribute('data-hidden', 'true');

            act(() => {
                stage.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
            });
            expect(controls()).toHaveAttribute('data-hidden', 'false');
        });

        it('keeps the controls while the settings are open and hides them 3 seconds after they close', () => {
            vi.useFakeTimers();
            const { video } = setup();
            const stage = video.parentElement as HTMLElement;
            Object.defineProperty(document, 'fullscreenElement', { value: stage, configurable: true });
            act(() => {
                document.dispatchEvent(new Event('fullscreenchange'));
            });
            openedPlayerSettings();
            act(() => {
                vi.advanceTimersByTime(10000);
            });
            expect(controls()).toHaveAttribute('data-hidden', 'false');
            expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();

            fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
            expect(controls()).toHaveAttribute('data-hidden', 'true');
        });

        it('keeps the controls visible outside of fullscreen', () => {
            vi.useFakeTimers();
            setup();
            act(() => {
                vi.advanceTimersByTime(10000);
            });
            expect(controls()).toHaveAttribute('data-hidden', 'false');
        });
    });

    describe('clicking the video', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('plays or pauses after a single click', () => {
            const { video, play, pause } = setup();
            fireEvent.click(video);
            expect(play).not.toHaveBeenCalled();
            act(() => {
                vi.advanceTimersByTime(250);
            });
            expect(play).toHaveBeenCalledTimes(1);

            fireEvent.click(video);
            act(() => {
                vi.advanceTimersByTime(250);
            });
            expect(pause).toHaveBeenCalledTimes(1);
        });

        it('enters fullscreen on a double click without pausing or playing', () => {
            const { video, play, pause } = setup();
            const requestFullscreen = vi.fn(() => {
                return Promise.resolve();
            });
            (video.parentElement as HTMLElement).requestFullscreen = requestFullscreen;

            fireEvent.click(video);
            fireEvent.click(video);
            fireEvent.doubleClick(video);
            act(() => {
                vi.advanceTimersByTime(1000);
            });
            expect(requestFullscreen).toHaveBeenCalledTimes(1);
            expect(play).not.toHaveBeenCalled();
            expect(pause).not.toHaveBeenCalled();
        });

        it('leaves fullscreen on a double click while in fullscreen', () => {
            const { video } = setup();
            const exitFullscreen = vi.fn(() => {
                return Promise.resolve();
            });
            document.exitFullscreen = exitFullscreen;
            Object.defineProperty(document, 'fullscreenElement', { value: video.parentElement, configurable: true });
            fireEvent.doubleClick(video);
            expect(exitFullscreen).toHaveBeenCalledTimes(1);
            Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
        });

        it('drops a pending click when the controls are removed', () => {
            const { video, play, unmount } = setup();
            fireEvent.click(video);
            unmount();
            act(() => {
                vi.advanceTimersByTime(1000);
            });
            expect(play).not.toHaveBeenCalled();
        });
    });

    it('does nothing when the video is gone', async () => {
        const { ref } = setup();
        (ref as { current: HTMLVideoElement | null }).current = null;
        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: 'Play' }));
        await user.click(screen.getByRole('button', { name: 'Mute' }));
        await user.click(screen.getByRole('button', { name: 'Fullscreen' }));
        fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '10' } });
        fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '0.2' } });
        expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    });

    it('stops listening to the video when it is removed', () => {
        const { video, unmount } = setup();
        const add = vi.spyOn(video, 'addEventListener');
        const remove = vi.spyOn(video, 'removeEventListener');
        unmount();
        expect(remove.mock.calls.map((call) => {
            return call[0];
        })).toEqual([
            'seeking', 'waiting', 'playing', 'seeked', 'canplay', 'emptied', 'error',
            'progress', 'timeupdate', 'seeked', 'loadedmetadata', 'durationchange', 'emptied',
            'play', 'pause', 'timeupdate', 'durationchange', 'loadedmetadata', 'volumechange', 'seeked', 'ended', 'click', 'dblclick'
        ]);
        expect(add).not.toHaveBeenCalled();
    });
});
