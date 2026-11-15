export const MAX_NAVIGATION_ENTRIES = 50;

export class NavigationHistory<T> {
    private entries: T[] = [];
    private scrolls: number[] = [];
    private index = -1;

    constructor(
        private readonly limit: number,
        private readonly keyOf: (entry: T) => string
    ) {}

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

    rememberScroll(scrollTop: number): void {
        if (this.entries[this.index] !== undefined) {
            this.scrolls[this.index] = scrollTop;
        }
    }

    currentScroll(): number {
        return this.scrolls[this.index] ?? 0;
    }

    back(): T | null {
        return this.move(-1);
    }

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
