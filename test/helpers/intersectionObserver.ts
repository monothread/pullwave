import { act } from '@testing-library/react';

export interface ObservedEnd {
    callback: IntersectionObserverCallback;
    target: Element | null;
    disconnected: boolean;
}

// An IntersectionObserver that only records what it watches: the test says when the watched element comes into view (`seeEnd`).
export function stubIntersectionObserver(): ObservedEnd[] {
    const observers: ObservedEnd[] = [];
    vi.stubGlobal(
        'IntersectionObserver',
        class {
            private readonly record: ObservedEnd;
            constructor(callback: IntersectionObserverCallback) {
                this.record = { callback, target: null, disconnected: false };
                observers.push(this.record);
            }
            observe(target: Element): void {
                this.record.target = target;
            }
            // The cards of a list are watched too (see useOffscreenPause): one that goes away is let go.
            unobserve(): void {
                return undefined;
            }
            disconnect(): void {
                this.record.disconnected = true;
            }
        }
    );
    return observers;
}

// The observers that still watch something.
export function liveObservers(observers: readonly ObservedEnd[]): ObservedEnd[] {
    return observers.filter((observer) => {
        return !observer.disconnected;
    });
}

// The end of the list (the element the last live observer watches) comes into view.
export function seeEnd(observers: readonly ObservedEnd[]): void {
    const observer = liveObservers(observers).at(-1);
    if (observer === undefined) {
        throw new Error('nothing is watched');
    }
    act(() => {
        observer.callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });
}

export interface WatchedCards {
    targets: Element[];
    // The browser says each of these cards is (true) or is not (false) near the part of the list that is seen.
    report: (entries: Array<[Element, boolean]>) => void;
}

// An IntersectionObserver that records every element it watches (the cards of a list, see useOffscreenPause) and lets the test say which
// of them are in sight.
export function stubCardObserver(): WatchedCards {
    const watched: WatchedCards = {
        targets: [],
        report: () => {
            return undefined;
        }
    };
    vi.stubGlobal(
        'IntersectionObserver',
        class {
            constructor(callback: IntersectionObserverCallback) {
                watched.report = (entries) => {
                    act(() => {
                        callback(
                            entries.map(([target, isIntersecting]) => {
                                return { target, isIntersecting } as IntersectionObserverEntry;
                            }),
                            {} as IntersectionObserver
                        );
                    });
                };
            }
            observe(target: Element): void {
                watched.targets.push(target);
            }
            unobserve(target: Element): void {
                watched.targets = watched.targets.filter((element) => {
                    return element !== target;
                });
            }
            disconnect(): void {
                watched.targets = [];
            }
        }
    );
    return watched;
}
