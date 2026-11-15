import { act } from '@testing-library/react';

export interface ObservedEnd {
    callback: IntersectionObserverCallback;
    target: Element | null;
    disconnected: boolean;
}

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

export function liveObservers(observers: readonly ObservedEnd[]): ObservedEnd[] {
    return observers.filter((observer) => {
        return !observer.disconnected;
    });
}

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
    report: (entries: Array<[Element, boolean]>) => void;
}

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
