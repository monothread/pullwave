export const LIST_MEMORY_LIMIT = 50;

const memories: ListMemory<unknown>[] = [];

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

export function clearListMemories(): void {
    memories.forEach((memory) => {
        memory.clear();
    });
}
