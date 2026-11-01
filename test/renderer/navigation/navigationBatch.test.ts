import { batchNavigation, isBatchingNavigation, onNavigationBatchEnd } from '@renderer/navigation/navigationBatch';

describe('navigationBatch', () => {
    it('is not batching outside of a batch, and is inside one', () => {
        expect(isBatchingNavigation()).toBe(false);
        let inside = false;
        batchNavigation(() => {
            inside = isBatchingNavigation();
        });
        expect(inside).toBe(true);
        expect(isBatchingNavigation()).toBe(false);
    });

    it('calls the listeners once at the end of the outer batch, after its steps', () => {
        const calls: string[] = [];
        const stop = onNavigationBatchEnd(() => {
            calls.push('end');
        });
        batchNavigation(() => {
            calls.push('step 1');
            batchNavigation(() => {
                calls.push('inner step');
            });
            calls.push('step 2');
        });
        expect(calls).toEqual(['step 1', 'inner step', 'step 2', 'end']);
        stop();
    });

    it('ends the batch and tells the listeners even when a step throws', () => {
        const listener = vi.fn();
        const stop = onNavigationBatchEnd(listener);
        expect(() => {
            batchNavigation(() => {
                throw new Error('boom');
            });
        }).toThrow('boom');
        expect(isBatchingNavigation()).toBe(false);
        expect(listener).toHaveBeenCalledTimes(1);
        stop();
    });

    it('stops calling a listener once it is removed', () => {
        const listener = vi.fn();
        const stop = onNavigationBatchEnd(listener);
        stop();
        batchNavigation(() => {
            return undefined;
        });
        expect(listener).not.toHaveBeenCalled();
    });
});
