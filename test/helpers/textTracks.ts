export interface FakeTextTrack {
    id: string;
    mode: TextTrackMode;
}

export type FakeTextTrackList = FakeTextTrack[] & Pick<EventTarget, 'addEventListener' | 'removeEventListener' | 'dispatchEvent'>;

export function fakeTextTrackList(tracks: FakeTextTrack[] = []): FakeTextTrackList {
    const target = new EventTarget();
    return Object.assign(tracks, {
        addEventListener: target.addEventListener.bind(target),
        removeEventListener: target.removeEventListener.bind(target),
        dispatchEvent: target.dispatchEvent.bind(target)
    });
}
