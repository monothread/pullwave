// A change of page made of several steps (the section, then a screen of it, then a series...) is one page for the back and forward buttons of
// the mouse: the history waits for the end of the batch to take the page, instead of taking each step as a page of its own.

type BatchEndListener = () => void;

let depth = 0;
const listeners = new Set<BatchEndListener>();

// Whether a batch of changes of page is going on.
export function isBatchingNavigation(): boolean {
    return depth > 0;
}

// Runs the steps of one change of page as one; batches inside a batch join it.
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

// Calls the listener at the end of every batch; returns what stops it.
export function onNavigationBatchEnd(listener: BatchEndListener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
