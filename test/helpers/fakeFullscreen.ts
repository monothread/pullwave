// The Fullscreen API, which jsdom does not have: an element asked for goes in fullscreen (and the document says so with `fullscreenchange`),
// and the document leaves it. `end` leaves it as the window does by itself (with Escape, for example).
export interface FakeFullscreen {
    current: () => Element | null;
    requests: Element[];
    exits: () => number;
    end: () => void;
    restore: () => void;
}

export function installFakeFullscreen(): FakeFullscreen {
    let current: Element | null = null;
    let exits = 0;
    const requests: Element[] = [];
    const change = (element: Element | null): void => {
        current = element;
        document.dispatchEvent(new Event('fullscreenchange'));
    };
    Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        get: () => {
            return current;
        }
    });
    Object.defineProperty(document, 'exitFullscreen', {
        configurable: true,
        value: () => {
            exits += 1;
            change(null);
            return Promise.resolve();
        }
    });
    Object.defineProperty(Element.prototype, 'requestFullscreen', {
        configurable: true,
        value: function requestFullscreen(this: Element) {
            requests.push(this);
            change(this);
            return Promise.resolve();
        }
    });
    return {
        current: () => {
            return current;
        },
        requests,
        exits: () => {
            return exits;
        },
        end: () => {
            change(null);
        },
        restore: () => {
            delete (document as { fullscreenElement?: unknown }).fullscreenElement;
            delete (document as { exitFullscreen?: unknown }).exitFullscreen;
            delete (Element.prototype as { requestFullscreen?: unknown }).requestFullscreen;
        }
    };
}
