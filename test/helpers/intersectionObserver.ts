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
