import { createDoneLinger, DONE_LINGER_MS } from '@renderer/store/doneLinger';

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('createDoneLinger', () => {
    it('keeps a download that is complete for five seconds', () => {
        expect(DONE_LINGER_MS).toBe(5000);
    });

    it('lets the download leave once it stayed its five seconds, and not before', () => {
        const linger = createDoneLinger<string>();
        const leave = vi.fn();
        linger.schedule('job-1', leave);
        vi.advanceTimersByTime(DONE_LINGER_MS - 1);
        expect(leave).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(leave).toHaveBeenCalledTimes(1);
        expect(leave).toHaveBeenCalledWith();
        vi.advanceTimersByTime(DONE_LINGER_MS);
        expect(leave).toHaveBeenCalledTimes(1);
    });

    it('does not let a download leave by itself once it changed', () => {
        const linger = createDoneLinger<number>();
        const leave = vi.fn();
        linger.schedule(7, leave);
        linger.cancel(7);
        vi.advanceTimersByTime(DONE_LINGER_MS * 2);
        expect(leave).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('starts the time again for a download given again, and lets it leave only once', () => {
        const linger = createDoneLinger<string>();
        const first = vi.fn();
        const second = vi.fn();
        linger.schedule('job-1', first);
        vi.advanceTimersByTime(3000);
        linger.schedule('job-1', second);
        vi.advanceTimersByTime(DONE_LINGER_MS - 1);
        expect(first).not.toHaveBeenCalled();
        expect(second).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('keeps the time of each download apart', () => {
        const linger = createDoneLinger<string>();
        const one = vi.fn();
        const two = vi.fn();
        linger.schedule('job-1', one);
        vi.advanceTimersByTime(2000);
        linger.schedule('job-2', two);
        linger.cancel('job-3');
        vi.advanceTimersByTime(3000);
        expect(one).toHaveBeenCalledTimes(1);
        expect(two).not.toHaveBeenCalled();
        vi.advanceTimersByTime(2000);
        expect(two).toHaveBeenCalledTimes(1);
    });
});
