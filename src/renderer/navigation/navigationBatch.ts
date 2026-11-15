type BatchEndListener = () => void;

let depth = 0;
const listeners = new Set<BatchEndListener>();

export function isBatchingNavigation(): boolean {
    return depth > 0;
}

export function batchNavigation(change: () => void): void {
    depth += 1;
    try {
        change();
    } finally {
        depth -= 1;
        if (depth === 0) {
            listeners.forEach((listener) => {
                listener();
            });
        }
    }
}

export function onNavigationBatchEnd(listener: BatchEndListener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
