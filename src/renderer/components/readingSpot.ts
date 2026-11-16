export interface ReadingSpot {
    page: number;
    share: number;
}

function viewMiddle(area: HTMLElement): number {
    return area.getBoundingClientRect().top + area.clientHeight / 2;
}

export function readingSpotOf(area: HTMLElement, flow: HTMLElement): ReadingSpot | null {
    const middle = viewMiddle(area);
    for (const page of flow.querySelectorAll<HTMLElement>('[data-page]')) {
        const box = page.getBoundingClientRect();
        if (box.height > 0 && box.bottom > middle) {
            return { page: Number(page.dataset['page']), share: (middle - box.top) / box.height };
        }
    }
    return null;
}

export function bringBackReadingSpot(area: HTMLElement, flow: HTMLElement, spot: ReadingSpot): void {
    const page = flow.querySelector<HTMLElement>(`[data-page="${String(spot.page)}"]`);
    if (page === null) {
        return;
    }
    const box = page.getBoundingClientRect();
    area.scrollTop += box.top + box.height * spot.share - viewMiddle(area);
}
