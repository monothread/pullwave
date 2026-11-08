// @vitest-environment jsdom
const { animateMock, playUiSoundMock } = vi.hoisted(() => {
    return { animateMock: vi.fn(), playUiSoundMock: vi.fn() };
});
vi.mock('motion', () => {
    return { animate: animateMock };
});
vi.mock('@renderer/sound/uiSound', () => {
    return { playUiSound: playUiSoundMock, setUiSoundVolume: vi.fn() };
});

import { FLY_MS, findCover, findNavButton, flightOf, flyCoverToLibrary, NAV_PULSE_CLASS } from '@renderer/fx/flyCover';
import { useFxStore } from '@renderer/fx/fxStore';
import { useUiPrefsStore } from '@renderer/store/uiPrefsStore';

function box(left: number, top: number, width: number, height: number): DOMRect {
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => { return {}; } } as DOMRect;
}

function mountPage(): { cover: HTMLElement; nav: HTMLElement } {
    document.body.innerHTML = `
        <nav class="sidenav"><button data-section-id="anime">ANIME</button><button data-section-id="manga">MANGA</button></nav>
        <div class="detail__art"><img class="cover" src="x.png" alt="" /></div>`;
    const cover = document.querySelector<HTMLElement>('.detail__art img.cover') as HTMLElement;
    const nav = document.querySelector<HTMLElement>('[data-section-id="anime"]') as HTMLElement;
    cover.getBoundingClientRect = () => { return box(400, 200, 100, 150); };
    nav.getBoundingClientRect = () => { return box(10, 100, 60, 40); };
    return { cover, nav };
}

beforeEach(() => {
    animateMock.mockReset();
    playUiSoundMock.mockReset();
    useFxStore.setState({ celebrations: 0, failures: 0, dances: 0, rainbow: false });
    useUiPrefsStore.setState({ sounds: true });
    document.body.innerHTML = '';
});

afterEach(() => {
    vi.useRealTimers();
});

describe('finding the pieces', () => {
    it('finds the cover of the page and the item of the menu of a section', () => {
        const { cover, nav } = mountPage();
        expect(findCover()).toBe(cover);
        expect(findNavButton('anime')).toBe(nav);
        expect(findNavButton('manga')?.textContent).toBe('MANGA');
    });

    it('finds nothing on a page without them', () => {
        expect(findCover()).toBeNull();
        expect(findNavButton('anime')).toBeNull();
    });
});

describe('flightOf', () => {
    it('goes from the middle of the cover to the middle of the item, shrinking to half the item', () => {
        expect(flightOf(box(400, 200, 100, 150), box(10, 100, 60, 40))).toEqual({ x: 40 - 450, y: 120 - 275, scale: 0.2 });
    });

    it('does not shrink a cover to nothing', () => {
        expect(flightOf(box(0, 0, 1000, 10), box(0, 0, 2, 2)).scale).toBe(0.05);
    });

    it('uses a small default scale for a cover with no width', () => {
        expect(flightOf(box(0, 0, 0, 10), box(0, 0, 40, 40)).scale).toBe(0.1);
    });
});

describe('flyCoverToLibrary', () => {
    it('only plays the sound and the dance when there is no cover on the screen', () => {
        flyCoverToLibrary('anime');
        expect(playUiSoundMock.mock.calls).toEqual([['add']]);
        expect(useFxStore.getState().dances).toBe(1);
        expect(animateMock).not.toHaveBeenCalled();
    });

    it('stays quiet while the sounds are off, but still dances', () => {
        useUiPrefsStore.setState({ sounds: false });
        flyCoverToLibrary('anime');
        expect(playUiSoundMock).not.toHaveBeenCalled();
        expect(useFxStore.getState().dances).toBe(1);
    });

    it('does not fly when the item of the menu is missing', () => {
        const { cover } = mountPage();
        document.querySelector('.sidenav')?.remove();
        flyCoverToLibrary('anime', cover);
        expect(animateMock).not.toHaveBeenCalled();
    });

    it('sends a copy of the cover to the menu, takes it away at the end and makes the item pulse', async () => {
        vi.useFakeTimers();
        const { cover, nav } = mountPage();
        animateMock.mockReturnValue(Promise.resolve());
        flyCoverToLibrary('anime', cover);
        const ghost = document.body.querySelector<HTMLElement>('body > img.cover') as HTMLElement;
        expect(ghost.getAttribute('aria-hidden')).toBe('true');
        expect(ghost.style.position).toBe('fixed');
        expect([ghost.style.left, ghost.style.top, ghost.style.width, ghost.style.height]).toEqual(['400px', '200px', '100px', '150px']);
        expect(ghost.style.pointerEvents).toBe('none');
        expect(animateMock.mock.calls).toEqual([
            [
                ghost,
                { x: [0, -410 * 0.4, -410], y: [0, -60, -155], scale: [1, 1.12, 0.2], opacity: [1, 1, 0.2], rotate: [0, -8, 14] },
                { duration: FLY_MS, ease: 'easeInOut' }
            ]
        ]);
        await vi.advanceTimersByTimeAsync(0);
        expect(document.body.contains(ghost)).toBe(false);
        expect(nav.classList.contains(NAV_PULSE_CLASS)).toBe(true);
        vi.advanceTimersByTime(900);
        expect(nav.classList.contains(NAV_PULSE_CLASS)).toBe(false);
    });
});
