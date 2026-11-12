// How many lists a memory keeps: the ones looked at last, the oldest being forgotten first.
export const LIST_MEMORY_LIMIT = 50;

const memories: ListMemory<unknown>[] = [];

// What a long list keeps of itself while it is not on the screen (how much of it was shown, how tall its parts are), so that coming back to
// it (the back button of the mouse, the page of a manga that is closed) finds it as tall as it was and the scroll can be put back.
export class ListMemory<T> {
    private readonly entries = new Map<string, T>();

    constructor(private readonly limit: number = LIST_MEMORY_LIMIT) {
        memories.push(this as ListMemory<unknown>);
    }

    get(key: string): T | undefined {
        return this.entries.get(key);
    }

    set(key: string, value: T): void {
        this.entries.delete(key);
        this.entries.set(key, value);
        while (this.entries.size > this.limit) {
            const oldest = this.entries.keys().next();
            if (oldest.done === true) {
                return;
            }
            this.entries.delete(oldest.value);
        }
    }

    clear(): void {
        this.entries.clear();
    }
}

// Forgets what every list kept (each test starts from lists never seen).
export function clearListMemories(): void {
    memories.forEach((memory) => {
        memory.clear();
    });
}
