// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { pagesScrollFraction, scrollFraction, useScrollFraction, type Edges } from '@renderer/hooks/useScrollFraction';

function box(top: number, height: number): DOMRect {
    return { top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => { return {}; } } as DOMRect;
}

describe('scrollFraction', () => {
    it('is 0 while the top of the content is at the top of the area', () => {
        expect(scrollFraction({ top: 100, height: 2000 }, { top: 100, height: 500 })).toBe(0);
    });

    it('is 1 when the end of the content is at the bottom of the area', () => {
        expect(scrollFraction({ top: -1500, height: 2000 }, { top: 0, height: 500 })).toBe(1);
    });

    it('is the part of the scrollable distance that was scrolled', () => {
        expect(scrollFraction({ top: -750, height: 2000 }, { top: 0, height: 500 })).toBe(0.5);
    });

    it('stays between 0 and 1 when the content is below or past the area', () => {
        expect(scrollFraction({ top: 400, height: 2000 }, { top: 0, height: 500 })).toBe(0);
        expect(scrollFraction({ top: -5000, height: 2000 }, { top: 0, height: 500 })).toBe(1);
    });

    it('is 1 for content that fits in the area, and 0 for content with no size yet', () => {
        expect(scrollFraction({ top: 0, height: 300 }, { top: 0, height: 500 })).toBe(1);
        expect(scrollFraction({ top: 0, height: 500 }, { top: 0, height: 500 })).toBe(1);
        expect(scrollFraction({ top: 0, height: 0 }, { top: 0, height: 500 })).toBe(0);
    });
});

function stackPages(heights: readonly number[], scrollTop: number, gap = 0): Edges[] {
    let top = -scrollTop;
    return heights.map((height, index) => {
        if (index > 0) {
            top += gap;
        }
        const edges: Edges = { top, height };
        top += height;
        return edges;
    });
}

describe('pagesScrollFraction', () => {
    const area: Edges = { top: 0, height: 900 };

    it('returns 0 when there are no pages or zero span, and 1 when all pages fit in the area even when offset below the top', () => {
        expect(pagesScrollFraction([], area)).toBe(0);
        expect(pagesScrollFraction([{ top: 0, height: 0 }], area)).toBe(0);
        expect(pagesScrollFraction(stackPages([300, 400], 0), area)).toBe(1);
        expect(pagesScrollFraction([{ top: 180, height: 760 }], { top: 100, height: 800 })).toBe(1);
        expect(pagesScrollFraction([{ top: 203, height: 350 }, { top: 553, height: 350 }], { top: 100, height: 800 })).toBe(1);
    });

    it('starts at 0, reaches 1 at the bottom, and stays clamped past either edge', () => {
        const heights = [5000, 630, 630, 630];
        expect(pagesScrollFraction(stackPages(heights, 0), area)).toBe(0);
        expect(pagesScrollFraction(stackPages(heights, -400), area)).toBe(0);
        expect(pagesScrollFraction(stackPages(heights, 5990), area)).toBe(1);
        expect(pagesScrollFraction(stackPages(heights, 9000), area)).toBe(1);
    });

    it('matches scrollFraction exactly when every page has the same height', () => {
        const heights = [1000, 1000, 1000];
        const viewport: Edges = { top: 0, height: 500 };
        for (const scrollTop of [0, 500, 1250, 2000, 2500]) {
            expect(pagesScrollFraction(stackPages(heights, scrollTop), viewport)).toBeCloseTo(scrollFraction({ top: -scrollTop, height: 3000 }, viewport), 10);
        }
        expect(pagesScrollFraction(stackPages([8000], 3550), area)).toBeCloseTo(0.5, 10);
    });

    it('does not retreat when pending pages below the viewport grow into tall manhwa strips', () => {
        const pendingHeights = [5000, 630, 630, 630];
        const nextLoadedHeights = [5000, 5000, 630, 630];
        const allLoadedHeights = [5000, 5000, 5000, 5000];
        const beforeLoad = pagesScrollFraction(stackPages(pendingHeights, 4100), area);
        const afterOneLoad = pagesScrollFraction(stackPages(nextLoadedHeights, 4100), area);
        const afterAllLoad = pagesScrollFraction(stackPages(allLoadedHeights, 4100), area);
        expect(beforeLoad).toBeCloseTo(0.82 / 3.82, 10);
        expect(afterOneLoad).toBeCloseTo(beforeLoad, 10);
        expect(afterAllLoad).toBeCloseTo(beforeLoad, 10);
    });

    it('adapts advance speed to each page height and stays monotonic across uneven pages and gaps', () => {
        const heights = [6000, 1000, 5000, 800];
        const gap = 24;
        const totalHeight = heights.reduce((sum, height) => {
            return sum + height;
        }, 0) + gap * (heights.length - 1);
        const maxScroll = totalHeight - area.height;
        let previous = 0;
        for (let scrollTop = 0; scrollTop <= maxScroll; scrollTop += 200) {
            const current = pagesScrollFraction(stackPages(heights, scrollTop, gap), area);
            expect(current).toBeGreaterThanOrEqual(previous);
            previous = current;
        }
        expect(pagesScrollFraction(stackPages(heights, maxScroll, gap), area)).toBe(1);

        const slowStep = pagesScrollFraction(stackPages(heights, 1500, gap), area) - pagesScrollFraction(stackPages(heights, 1000, gap), area);
        const fastStep = pagesScrollFraction(stackPages(heights, 6500, gap), area) - pagesScrollFraction(stackPages(heights, 6000, gap), area);
        expect(fastStep).toBeGreaterThan(slowStep * 3);
    });

    it('retraces the exact same progress when scrolling back up and handles zero-height pages', () => {
        const heights = [5000, 0, 5000];
        const down = pagesScrollFraction(stackPages(heights, 2500), area);
        const further = pagesScrollFraction(stackPages(heights, 6000), area);
        const backUp = pagesScrollFraction(stackPages(heights, 2500), area);
        expect(further).toBeGreaterThan(down);
        expect(backUp).toBe(down);
    });
});

describe('useScrollFraction', () => {
    function setup(contentTop: { value: number }) {
        const area = document.createElement('div');
        const content = document.createElement('div');
        area.getBoundingClientRect = () => {
            return box(0, 500);
        };
        content.getBoundingClientRect = () => {
            return box(contentTop.value, 2000);
        };
        return { area, content };
    }

    it('follows the scroll of the area', () => {
        const top = { value: 0 };
        const { area, content } = setup(top);
        const { result } = renderHook(() => {
            return useScrollFraction(() => { return area; }, { current: content }, true);
        });
        expect(result.current).toBe(0);
        top.value = -750;
        act(() => {
            area.dispatchEvent(new Event('scroll'));
        });
        expect(result.current).toBe(0.5);
        top.value = -1500;
        act(() => {
            area.dispatchEvent(new Event('scroll'));
        });
        expect(result.current).toBe(1);
    });

    it('is recalculated when the window changes size', () => {
        const top = { value: -750 };
        const { area, content } = setup(top);
        const { result } = renderHook(() => {
            return useScrollFraction(() => { return area; }, { current: content }, true);
        });
        expect(result.current).toBe(0.5);
        top.value = -1500;
        act(() => {
            window.dispatchEvent(new Event('resize'));
        });
        expect(result.current).toBe(1);
    });

    it('is recalculated when the content changes size', () => {
        const top = { value: -750 };
        const { area, content } = setup(top);
        let notify: () => void = () => { return undefined; };
        class FakeResizeObserver {
            constructor(handler: () => void) {
                notify = handler;
            }
            observe = vi.fn();
            disconnect = vi.fn();
        }
        vi.stubGlobal('ResizeObserver', FakeResizeObserver);
        const { result } = renderHook(() => {
            return useScrollFraction(() => { return area; }, { current: content }, true);
        });
        top.value = -1500;
        act(() => {
            notify();
        });
        expect(result.current).toBe(1);
        vi.unstubAllGlobals();
    });

    it('listens to nothing while it is not active, or when there is no area or content', () => {
        const top = { value: -750 };
        const { area, content } = setup(top);
        const add = vi.spyOn(area, 'addEventListener');
        expect(
            renderHook(() => {
                return useScrollFraction(() => { return area; }, { current: content }, false);
            }).result.current
        ).toBe(0);
        expect(
            renderHook(() => {
                return useScrollFraction(() => { return null; }, { current: content }, true);
            }).result.current
        ).toBe(0);
        expect(
            renderHook(() => {
                return useScrollFraction(() => { return area; }, { current: null }, true);
            }).result.current
        ).toBe(0);
        expect(add).not.toHaveBeenCalled();
    });

    it('stops listening when it is removed', () => {
        const top = { value: 0 };
        const { area, content } = setup(top);
        const remove = vi.spyOn(area, 'removeEventListener');
        const removeWindow = vi.spyOn(window, 'removeEventListener');
        const { unmount } = renderHook(() => {
            return useScrollFraction(() => { return area; }, { current: content }, true);
        });
        unmount();
        expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
        expect(removeWindow).toHaveBeenCalledWith('resize', expect.any(Function));
    });

    it('measures slotted and direct data-page children and does not retreat when pages below grow', () => {
        const area = document.createElement('div');
        const content = document.createElement('div');
        const heights = [5000, 630, 630, 630];
        let scrollTop = 4100;
        area.getBoundingClientRect = () => {
            return box(0, 900);
        };
        const pageTop = (index: number): number => {
            let offset = -scrollTop;
            for (let prior = 0; prior < index; prior += 1) {
                offset += heights[prior] ?? 0;
            }
            return offset;
        };
        heights.forEach((_height, index) => {
            if (index === 2) {
                const failed = document.createElement('div');
                failed.dataset['page'] = String(index);
                failed.getBoundingClientRect = () => {
                    return box(pageTop(index), heights[index] ?? 0);
                };
                content.appendChild(failed);
                return;
            }
            const slot = document.createElement('div');
            const page = document.createElement('div');
            page.dataset['page'] = String(index);
            page.getBoundingClientRect = () => {
                return box(pageTop(index), heights[index] ?? 0);
            };
            slot.appendChild(page);
            content.appendChild(slot);
        });
        let notify: () => void = () => {
            return undefined;
        };
        class FakeResizeObserver {
            constructor(handler: () => void) {
                notify = handler;
            }
            observe = vi.fn();
            disconnect = vi.fn();
        }
        vi.stubGlobal('ResizeObserver', FakeResizeObserver);
        const { result } = renderHook(() => {
            return useScrollFraction(
                () => {
                    return area;
                },
                { current: content },
                true
            );
        });
        const expected = 0.82 / 3.82;
        expect(result.current).toBeCloseTo(expected, 10);

        heights[1] = 5000;
        heights[2] = 5000;
        heights[3] = 5000;
        act(() => {
            notify();
        });
        expect(result.current).toBeCloseTo(expected, 10);

        scrollTop = 19100;
        act(() => {
            area.dispatchEvent(new Event('scroll'));
        });
        expect(result.current).toBe(1);
        vi.unstubAllGlobals();
    });

    it('falls back to container edges when children lack data-page or layout height', () => {
        const top = { value: -750 };
        const { area, content } = setup(top);
        const plain = document.createElement('div');
        content.appendChild(plain);
        const { result: plainResult } = renderHook(() => {
            return useScrollFraction(
                () => {
                    return area;
                },
                { current: content },
                true
            );
        });
        expect(plainResult.current).toBe(0.5);

        content.innerHTML = '';
        for (let index = 0; index < 3; index += 1) {
            const slot = document.createElement('div');
            const page = document.createElement('div');
            page.dataset['page'] = String(index);
            page.getBoundingClientRect = () => {
                return box(0, 0);
            };
            slot.appendChild(page);
            content.appendChild(slot);
        }
        const { result: zeroHeightResult } = renderHook(() => {
            return useScrollFraction(
                () => {
                    return area;
                },
                { current: content },
                true
            );
        });
        expect(zeroHeightResult.current).toBe(0.5);

        content.innerHTML = '';
        for (let index = 0; index < 3; index += 1) {
            const slot = document.createElement('div');
            if (index !== 1) {
                const page = document.createElement('div');
                page.dataset['page'] = String(index);
                page.getBoundingClientRect = () => {
                    return box(index * 1000 - 750, 1000);
                };
                slot.appendChild(page);
            }
            content.appendChild(slot);
        }
        const { result: mixedResult } = renderHook(() => {
            return useScrollFraction(
                () => {
                    return area;
                },
                { current: content },
                true
            );
        });
        expect(mixedResult.current).toBe(0.5);
    });

    it('handles a single tall page and stays steady when a page above the viewport grows with scroll anchoring', () => {
        const area = document.createElement('div');
        const content = document.createElement('div');
        area.getBoundingClientRect = () => {
            return box(0, 900);
        };
        let singleTop = -3550;
        const singleSlot = document.createElement('div');
        const singlePage = document.createElement('div');
        singlePage.dataset['page'] = '0';
        singlePage.getBoundingClientRect = () => {
            return box(singleTop, 8000);
        };
        singleSlot.appendChild(singlePage);
        content.appendChild(singleSlot);
        const { result: singleResult, unmount } = renderHook(() => {
            return useScrollFraction(
                () => {
                    return area;
                },
                { current: content },
                true
            );
        });
        expect(singleResult.current).toBeCloseTo(0.5, 10);
        singleTop = -7100;
        act(() => {
            area.dispatchEvent(new Event('scroll'));
        });
        expect(singleResult.current).toBe(1);
        unmount();

        content.innerHTML = '';
        const heights = [630, 5000, 630];
        let scrollTop = 2630;
        const pageTop = (index: number): number => {
            let offset = -scrollTop;
            for (let prior = 0; prior < index; prior += 1) {
                offset += heights[prior] ?? 0;
            }
            return offset;
        };
        heights.forEach((_height, index) => {
            const slot = document.createElement('div');
            const page = document.createElement('div');
            page.dataset['page'] = String(index);
            page.getBoundingClientRect = () => {
                return box(pageTop(index), heights[index] ?? 0);
            };
            slot.appendChild(page);
            content.appendChild(slot);
        });
        let notify: () => void = () => {
            return undefined;
        };
        class FakeResizeObserver {
            constructor(handler: () => void) {
                notify = handler;
            }
            observe = vi.fn();
            disconnect = vi.fn();
        }
        vi.stubGlobal('ResizeObserver', FakeResizeObserver);
        const { result: anchoredResult } = renderHook(() => {
            return useScrollFraction(
                () => {
                    return area;
                },
                { current: content },
                true
            );
        });
        const before = anchoredResult.current;
        heights[0] = 5000;
        scrollTop += 5000 - 630;
        act(() => {
            notify();
        });
        expect(anchoredResult.current).toBeCloseTo(before, 10);
        vi.unstubAllGlobals();
    });
});
