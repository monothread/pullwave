export const MAX_NAVIGATION_ENTRIES = 50;

// The pages the viewer went through, with a cursor on the one being shown. Going back and forward moves the cursor; a new page
// drops everything ahead of it, as in a browser.
export class NavigationHistory<T> {
    private entries: T[] = [];
    // How far each page was scrolled when it was left, by the position of its entry.
    private scrolls: number[] = [];
    private index = -1;

    constructor(
        private readonly limit: number,
        private readonly keyOf: (entry: T) => string
    ) {}

    // Records the page being shown. The same page as the current one only refreshes it (its content may have loaded since).
    record(entry: T): void {
        const current = this.entries[this.index];
        if (current !== undefined && this.keyOf(current) === this.keyOf(entry)) {
            this.entries[this.index] = entry;
            return;
        }
        this.entries = [...this.entries.slice(0, this.index + 1), entry].slice(-this.limit);
        this.scrolls = [...this.scrolls.slice(0, this.index + 1), 0].slice(-this.limit);
        this.index = this.entries.length - 1;
    }

    // Keeps how far the current page is scrolled, to be given back when the viewer comes to it again.
    rememberScroll(scrollTop: number): void {
        if (this.entries[this.index] !== undefined) {
            this.scrolls[this.index] = scrollTop;
        }
    }

    // How far the current page was scrolled the last time it was left (0 when it has not been).
    currentScroll(): number {
        return this.scrolls[this.index] ?? 0;
    }

    // The previous page, or null when there is none.
    back(): T | null {
        return this.move(-1);
    }

    // The next page, or null when there is none.
    forward(): T | null {
        return this.move(1);
    }

    private move(step: 1 | -1): T | null {
        const target = this.index + step;
        if (target < 0 || target >= this.entries.length) {
            return null;
        }
        this.index = target;
        return this.entries[target] ?? null;
    }
}
