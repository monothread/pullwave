// @vitest-environment jsdom
import { createRef, type RefObject } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { openedPlayerSettings } from '../../helpers/playerSettings';
import { fakeTextTrackList, type FakeTextTrack } from '../../helpers/textTracks';
import type { PlaybackRange } from '@renderer/components/playbackRange';
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

// A player that plays only a part of the media (the preview of a cut): from 20 to 50 of a video of 120 seconds.
function setupRange(range: PlaybackRange = { start: 20, end: 50 }, readyState = 0) {
    const video = document.createElement('video');
    Object.defineProperty(video, 'duration', { value: 120, configurable: true });
    Object.defineProperty(video, 'readyState', { value: readyState, configurable: true });
    Object.defineProperty(video, 'paused', { value: true, configurable: true, writable: true });
    const play = vi.fn(() => {
        Object.defineProperty(video, 'paused', { value: false, configurable: true, writable: true });
        video.dispatchEvent(new Event('play'));
        return Promise.resolve();
    });
    const pause = vi.fn(() => {
        Object.defineProperty(video, 'paused', { value: true, configurable: true, writable: true });
    });
    video.play = play;
    video.pause = pause;
    document.body.appendChild(video);
    const ref = createRef<HTMLVideoElement>();
    (ref as { current: HTMLVideoElement | null }).current = video;
    const view = render(<VideoControls video={ref} subtitles={[]} selectedSubtitle={null} onSelectSubtitle={vi.fn()} range={range} />);
    return { video, ref, play, pause, ...view };
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

function fill(): HTMLElement {
    return document.querySelector('.player__timeline .progress__bar') as HTMLElement;
}

describe('VideoControls', () => {
    it('starts paused at 0:00 with the duration of the video', () => {
        setup();
        expect(screen.getByRole('button', { name: 'Play' })).toHaveTextContent('▶');
        expect(screen.getByRole('button', { name: 'Play' }).querySelector('.player__icon')).toHaveClass('player__icon--play');
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
        expect(screen.getByRole('button', { name: 'Pause' }).querySelector('.player__icon')).toHaveClass('player__icon--pause');
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
        expect(fill().style.width).toBe('62.5%');
    });

    it('lets the thumb of the timeline stand at any time, not only at steps', () => {
        const { video } = setup();
        const seek = screen.getByRole('slider', { name: 'Seek' });
        expect(seek).toHaveAttribute('step', 'any');
        video.currentTime = 42.437;
        act(() => {
            fireEvent.timeUpdate(video);
        });
        expect(seek).toHaveValue('42.437');
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

        it('flashes the seek over the video: forward on the right, backward on the left, and not for the other keys', () => {
            const { video } = setup();
            setVideoState(video, { currentTime: 50 });
            expect(screen.queryByTestId('player-skip')).toBeNull();
            pressOn(document.body, { key: 'ArrowRight' });
            const forward = screen.getByTestId('player-skip');
            expect(forward).toHaveClass('player__skip', 'player__skip--forward');
            expect(forward).toHaveAttribute('aria-hidden', 'true');
            expect(forward).toHaveTextContent('5s ❯❯');
            pressOn(document.body, { key: 'ArrowLeft' });
            const backward = screen.getByTestId('player-skip');
            expect(backward).toHaveClass('player__skip', 'player__skip--backward');
            expect(backward).toHaveTextContent('❮❮ 5s');
            expect(backward).not.toBe(forward);
            // jsdom has no animations: React listens for whichever name of the event the style declaration of the window knows.
            ['animationend', 'webkitAnimationEnd'].forEach((name) => {
                fireEvent(backward, new Event(name, { bubbles: true }));
            });
            expect(screen.queryByTestId('player-skip')).toBeNull();
            pressOn(document.body, { key: 'ArrowUp' });
            pressOn(document.body, { key: ' ' });
            expect(screen.queryByTestId('player-skip')).toBeNull();
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
        expect(screen.getByRole('button', { name: 'Unmute' }).querySelector('.player__icon')).toHaveClass('player__icon--mute');
        expect(screen.getByRole('slider', { name: 'Volume' })).toHaveValue('0');

        await user.click(screen.getByRole('button', { name: 'Unmute' }));
        expect(video.muted).toBe(false);
        act(() => {
            fireEvent(video, new Event('volumechange'));
        });
        expect(screen.getByRole('button', { name: 'Mute' })).toHaveTextContent('🔊');
        expect(screen.getByRole('button', { name: 'Mute' }).querySelector('.player__icon')).toHaveClass('player__icon--volume');
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
            expect(within(dialog).queryByRole('combobox', { name: 'Subtitle color' })).not.toBeInTheDocument();
            expect(within(dialog).queryByRole('combobox', { name: 'Subtitle background' })).not.toBeInTheDocument();
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
            screen.getByRole('combobox', { name: 'Subtitles' }).focus();
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

        it('is the bar of a download under the slider: a .progress with a .progress__bar as wide as what was watched, in a box with the slider', () => {
            setup([], 200);
            const box = timeline().parentElement as HTMLElement;
            expect(box).toHaveClass('player__timeline');
            expect(Array.from(box.children).map((child) => { return child.className; })).toEqual(['progress', 'player__range player__seek']);
            const bar = box.querySelector('.progress') as HTMLElement;
            expect(bar).toHaveAttribute('aria-hidden', 'true');
            expect(Array.from(bar.children).map((child) => { return child.className; })).toEqual(['player__buffered', 'progress__bar']);
            expect(fill().style.width).toBe('0%');
        });

        function measure(bar: HTMLInputElement): void {
            bar.getBoundingClientRect = () => {
                return { left: 100, width: 200, right: 300, top: 0, bottom: 6, height: 6, x: 100, y: 0, toJSON: () => { return {}; } };
            };
            Object.defineProperty(bar.parentElement as HTMLElement, 'offsetLeft', { value: 60, configurable: true });
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

        it('widens the bar of the part already watched as the video plays', () => {
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
            expect(fill().style.width).toBe('10%');
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
            'play', 'pause', 'timeupdate', 'durationchange', 'loadedmetadata', 'volumechange', 'seeked', 'ended', 'play', 'pause', 'click', 'dblclick'
        ]);
        expect(add).not.toHaveBeenCalled();
    });
});

describe('VideoControls on a part of the media', () => {
    it('goes to the start of the part as soon as the media can be played', () => {
        const { video } = setupRange();
        expect(video.currentTime).toBe(0);
        video.dispatchEvent(new Event('loadedmetadata'));
        expect(video.currentTime).toBe(20);
    });

    it('goes to the start of the part at once when the media was already loaded', () => {
        const { video } = setupRange({ start: 20, end: 50 }, 1);
        expect(video.currentTime).toBe(20);
    });

    it('shows the timeline of the part: from 0 to its length', () => {
        const { video } = setupRange();
        video.currentTime = 35;
        act(() => {
            fireEvent.timeUpdate(video);
        });
        const seek = screen.getByRole('slider', { name: 'Seek' });
        expect(seek).toHaveAttribute('max', '30');
        expect(seek).toHaveValue('15');
        expect(screen.getByText('0:15')).toBeInTheDocument();
        expect(screen.getByText('0:30')).toBeInTheDocument();
        expect(fill().style.width).toBe('50%');
    });

    it('shows the start of the part for a time before it and its end for a time after it', () => {
        const { video } = setupRange();
        video.currentTime = 5;
        act(() => {
            fireEvent.timeUpdate(video);
        });
        expect(screen.getByRole('slider', { name: 'Seek' })).toHaveValue('0');
        expect(fill().style.width).toBe('0%');
        video.currentTime = 90;
        act(() => {
            fireEvent.timeUpdate(video);
        });
        expect(screen.getByRole('slider', { name: 'Seek' })).toHaveValue('30');
        expect(fill().style.width).toBe('100%');
    });

    it('seeks inside the part when the slider moves', () => {
        const { video } = setupRange();
        fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '12' } });
        expect(video.currentTime).toBe(32);
    });

    it('stops at the end of the part, on its last moment', () => {
        const { video, pause, play } = setupRange();
        void video.play();
        expect(play).toHaveBeenCalledTimes(1);
        video.currentTime = 49.97;
        video.dispatchEvent(new Event('timeupdate'));
        expect(pause).toHaveBeenCalledTimes(1);
        expect(video.currentTime).toBe(50);
    });

    it('keeps playing before the end of the part', () => {
        const { video, pause } = setupRange();
        void video.play();
        video.currentTime = 40;
        video.dispatchEvent(new Event('timeupdate'));
        expect(pause).not.toHaveBeenCalled();
        expect(video.currentTime).toBe(40);
    });

    it('does not pause a media that is already paused at the end', () => {
        const { video, pause } = setupRange();
        video.currentTime = 50;
        video.dispatchEvent(new Event('timeupdate'));
        expect(pause).not.toHaveBeenCalled();
    });

    it.each([
        ['at the end of the part', 50, 20],
        ['before the part', 3, 20],
        ['inside the part', 33, 33]
    ])('plays from the start of the part when played %s', (_where, from, to) => {
        const { video } = setupRange();
        video.currentTime = from;
        void video.play();
        expect(video.currentTime).toBe(to);
    });

    it.each([
        ['ArrowRight', 47, 50],
        ['ArrowLeft', 22, 20],
        ['ArrowRight', 30, 35]
    ])('moves with %s from %s to %s without leaving the part', (key, from, to) => {
        const { video } = setupRange();
        video.currentTime = from;
        fireEvent.keyDown(document.body, { key });
        expect(video.currentTime).toBe(to);
    });

    it('stops keeping the media inside the part once it is gone', () => {
        const { video, unmount } = setupRange();
        unmount();
        video.dispatchEvent(new Event('loadedmetadata'));
        expect(video.currentTime).toBe(0);
    });

    it('follows a new part', () => {
        const { video, ref, rerender } = setupRange();
        rerender(<VideoControls video={ref} subtitles={[]} selectedSubtitle={null} onSelectSubtitle={vi.fn()} range={{ start: 60, end: 70 }} />);
        video.dispatchEvent(new Event('loadedmetadata'));
        expect(video.currentTime).toBe(60);
        expect(screen.getByRole('slider', { name: 'Seek' })).toHaveAttribute('max', '10');
    });
});

describe('VideoControls following the time at every frame', () => {
    let frames: Array<FrameRequestCallback | null>;

    beforeEach(() => {
        frames = [];
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
            frames.push(callback);
            return frames.length;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
            frames[id - 1] = null;
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function nextFrame(): void {
        const callback = frames.filter((frame) => { return frame !== null; }).pop();
        act(() => {
            callback?.(performance.now());
        });
    }

    it('asks for no frame while the video is paused', () => {
        setup();
        expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    });

    it('moves the bar and the time with the video at each frame while it plays, between the events of the video', () => {
        const { video } = setup();
        Object.defineProperty(video, 'paused', { value: false, configurable: true });
        act(() => {
            fireEvent.play(video);
        });
        expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
        video.currentTime = 30.4;
        nextFrame();
        expect(fill().style.width).toBe(`${(30.4 / 120) * 100}%`);
        expect(screen.getByRole('slider', { name: 'Seek' })).toHaveValue('30.4');
        expect(screen.getByText('0:30')).toBeInTheDocument();
        video.currentTime = 31;
        nextFrame();
        expect(screen.getByRole('slider', { name: 'Seek' })).toHaveValue('31');
        expect(window.requestAnimationFrame).toHaveBeenCalledTimes(3);
    });

    it('moves the bar of a part smoothly too, from 0 to its length', () => {
        const { video } = setupRange({ start: 20, end: 30 });
        Object.defineProperty(video, 'paused', { value: false, configurable: true, writable: true });
        act(() => {
            fireEvent.play(video);
        });
        video.currentTime = 22.5;
        nextFrame();
        expect(fill().style.width).toBe('25%');
        expect(screen.getByRole('slider', { name: 'Seek' })).toHaveValue('2.5');
    });

    it('stops following the frames when the video is paused or the bar goes away', () => {
        const { video, unmount } = setup();
        Object.defineProperty(video, 'paused', { value: false, configurable: true });
        act(() => {
            fireEvent.play(video);
        });
        Object.defineProperty(video, 'paused', { value: true, configurable: true });
        act(() => {
            fireEvent.pause(video);
        });
        expect(window.cancelAnimationFrame).toHaveBeenCalledTimes(1);
        expect(window.cancelAnimationFrame).toHaveBeenCalledWith(1);
        Object.defineProperty(video, 'paused', { value: false, configurable: true });
        act(() => {
            fireEvent.play(video);
        });
        unmount();
        expect(window.cancelAnimationFrame).toHaveBeenCalledTimes(2);
        expect(window.cancelAnimationFrame).toHaveBeenLastCalledWith(2);
    });
});

describe('VideoControls: the icons and the switch of the next episode', () => {
    function renderControls(autoNext?: { enabled: boolean; onToggle: () => void }, subtitles: SubtitleOption[] = []) {
        const ref = createRef<HTMLVideoElement>();
        const video = document.createElement('video');
        document.body.appendChild(video);
        (ref as { current: HTMLVideoElement | null }).current = video;
        render(<VideoControls video={ref} subtitles={subtitles} selectedSubtitle={null} onSelectSubtitle={vi.fn()} autoNext={autoNext} />);
    }

    it('draws the fullscreen button with its icon, hidden from the screen readers', () => {
        renderControls();
        const icon = screen.getByRole('button', { name: 'Fullscreen' }).querySelector('.player__icon');
        expect(icon).toHaveClass('player__icon--fullscreen');
        expect(icon).toHaveAttribute('aria-hidden', 'true');
        expect(icon).toHaveTextContent('⛶');
    });

    it('has no gear with no subtitles and no switch of the next episode', () => {
        renderControls();
        expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
    });

    it('has the gear for the switch of the next episode, and hands it to the settings', async () => {
        const user = userEvent.setup();
        const onToggle = vi.fn();
        renderControls({ enabled: false, onToggle });
        await user.click(screen.getByRole('button', { name: 'Settings' }));
        const toggle = screen.getByRole('switch', { name: 'Next episode automatically' });
        expect(toggle).toHaveProperty('checked', false);
        await user.click(toggle);
        expect(onToggle).toHaveBeenCalledTimes(1);
    });
});

describe('VideoControls: the playful extras', () => {
    function lastPlayed(video: HTMLVideoElement, event: 'play' | 'pause'): void {
        act(() => {
            video.dispatchEvent(new Event(event));
        });
    }

    it('pops a big mark in the middle of the video when it plays or pauses, and takes it away when it is over', () => {
        const { video } = setup();
        expect(screen.queryByTestId('player-center')).toBeNull();
        lastPlayed(video, 'play');
        const played = screen.getByTestId('player-center');
        expect(played).toHaveClass('player__center', 'player__center--play');
        expect(played).toHaveAttribute('aria-hidden', 'true');
        expect(played).toHaveTextContent('▶');
        lastPlayed(video, 'pause');
        const paused = screen.getByTestId('player-center');
        expect(paused).toHaveClass('player__center', 'player__center--pause');
        expect(paused).toHaveTextContent('❚❚');
        expect(paused).not.toBe(played);
        ['animationend', 'webkitAnimationEnd'].forEach((name) => {
            fireEvent(paused, new Event(name, { bubbles: true }));
        });
        expect(screen.queryByTestId('player-center')).toBeNull();
    });

    it('says the volume in a bubble beside the slider while it changes, with the keys and with the slider', () => {
        const { video } = setup();
        expect(screen.queryByTestId('player-volume-bubble')).toBeNull();
        fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '0.55' } });
        const bubble = screen.getByTestId('player-volume-bubble');
        expect(bubble).toHaveClass('player__volume-bubble');
        expect(bubble).toHaveAttribute('aria-hidden', 'true');
        expect(bubble).toHaveTextContent('55%');
        expect(bubble.parentElement).toHaveClass('player__volume-wrap');
        fireEvent.keyDown(document.body, { key: 'ArrowDown' });
        expect(screen.getByTestId('player-volume-bubble')).toHaveTextContent('50%');
        expect(video.volume).toBe(0.5);
        ['animationend', 'webkitAnimationEnd'].forEach((name) => {
            fireEvent(screen.getByTestId('player-volume-bubble'), new Event(name, { bubbles: true }));
        });
        expect(screen.queryByTestId('player-volume-bubble')).toBeNull();
    });

    it('puts no mark over the video for the pause that comes when the episode ends, where the panel of the next one shows', () => {
        const { video } = setup();
        Object.defineProperty(video, 'ended', { configurable: true, value: true });
        lastPlayed(video, 'pause');
        expect(screen.queryByTestId('player-center')).toBeNull();
        Object.defineProperty(video, 'ended', { configurable: true, value: false });
        lastPlayed(video, 'pause');
        expect(screen.getByTestId('player-center')).toHaveClass('player__center--pause');
    });

    it('still puts the mark for a play after the episode ended', () => {
        const { video } = setup();
        Object.defineProperty(video, 'ended', { configurable: true, value: true });
        lastPlayed(video, 'play');
        expect(screen.getByTestId('player-center')).toHaveClass('player__center--play');
    });

    it('shows no bubble for a key that is not about the volume', () => {
        setup();
        fireEvent.keyDown(document.body, { key: 'ArrowRight' });
        expect(screen.queryByTestId('player-volume-bubble')).toBeNull();
    });

    it.each([
        [0.8, false, 'volume', '🔊'],
        [0.3, false, 'volume-low', '🔉'],
        [0.8, true, 'mute', '🔇'],
        [0, false, 'mute', '🔇']
    ] as const)('draws the volume %s (muted: %s) with the %s icon', (volume, muted, name, glyph) => {
        const { video } = setup();
        video.volume = volume;
        video.muted = muted;
        act(() => {
            video.dispatchEvent(new Event('volumechange'));
        });
        const button = screen.getByRole('button', { name: muted || volume === 0 ? 'Unmute' : 'Mute' });
        const icon = button.querySelector('.player__icon') as HTMLElement;
        expect(icon).toHaveClass(`player__icon--${name}`);
        expect(icon).toHaveTextContent(glyph);
    });

    it('shows how much is loaded as a lighter stretch under the part watched', () => {
        const { video } = setup([], 200);
        const stretch = document.querySelector('.player__buffered') as HTMLElement;
        expect(stretch).toHaveStyle({ width: '0%' });
        Object.defineProperty(video, 'buffered', { configurable: true, value: { length: 1, start: () => { return 0; }, end: () => { return 50; } } });
        act(() => {
            video.dispatchEvent(new Event('progress'));
        });
        expect(document.querySelector('.player__buffered')).toHaveStyle({ width: '25%' });
    });

    it('shows no loaded stretch when the timeline is of a part of the media', () => {
        setupRange();
        expect(document.querySelector('.player__buffered')).toBeNull();
    });
});
