import { libraryEntryRefresh, withEntry, type LibraryEntrySource } from '@renderer/store/libraryEntryRefresh';

interface Item {
    id: number;
    name: string;
}

const ONE: Item = { id: 1, name: 'one' };
const TWO: Item = { id: 2, name: 'two' };
const ONE_NEW: Item = { id: 1, name: 'one, changed' };

function source(library: Item[], read: (id: number) => Promise<Item | null>) {
    const state = { library };
    const put = vi.fn((entry: Item) => {
        state.library = withEntry(state.library, entry);
    });
    const refreshAll = vi.fn(async () => {
        return undefined;
    });
    const given: LibraryEntrySource<Item> = {
        read: vi.fn(read),
        current: () => {
            return state.library;
        },
        put,
        refreshAll
    };
    return { given, state, put, refreshAll };
}

describe('withEntry', () => {
    it('puts the item in the place of the one with its id, keeping the order and the other items as they were', () => {
        const library = [ONE, TWO];
        const next = withEntry(library, ONE_NEW);
        expect(next).toEqual([ONE_NEW, TWO]);
        expect(next[1]).toBe(TWO);
        expect(library).toEqual([ONE, TWO]);
    });

    it('leaves the library as it was for an item it does not have', () => {
        expect(withEntry([ONE], TWO)).toEqual([ONE]);
    });
});

describe('libraryEntryRefresh', () => {
    it('reads the item alone and puts it in place, without reading the whole library', async () => {
        const { given, state, put, refreshAll } = source([ONE, TWO], async () => {
            return ONE_NEW;
        });
        await libraryEntryRefresh(given)(1);
        expect(given.read).toHaveBeenCalledWith(1);
        expect(put).toHaveBeenCalledWith(ONE_NEW);
        expect(state.library).toEqual([ONE_NEW, TWO]);
        expect(refreshAll).not.toHaveBeenCalled();
    });

    it('reads the whole library when the item is no longer in it', async () => {
        const { given, put, refreshAll } = source([ONE, TWO], async () => {
            return null;
        });
        await libraryEntryRefresh(given)(1);
        expect(put).not.toHaveBeenCalled();
        expect(refreshAll).toHaveBeenCalledTimes(1);
    });

    it('reads the whole library when the screen does not have the item', async () => {
        const { given, put, refreshAll } = source([TWO], async () => {
            return ONE_NEW;
        });
        await libraryEntryRefresh(given)(1);
        expect(put).not.toHaveBeenCalled();
        expect(refreshAll).toHaveBeenCalledTimes(1);
    });

    it('looks at the library after the answer: an item taken out while it was read makes the whole library be read', async () => {
        const holder = { state: { library: [] as Item[] } };
        const { given, state, put, refreshAll } = source([ONE, TWO], async () => {
            holder.state.library = [TWO];
            return ONE_NEW;
        });
        holder.state = state;
        await libraryEntryRefresh(given)(1);
        expect(put).not.toHaveBeenCalled();
        expect(refreshAll).toHaveBeenCalledTimes(1);
    });

    it('reads the whole library when the item cannot be read alone', async () => {
        const { given, put, refreshAll } = source([ONE, TWO], async () => {
            throw new Error('gone');
        });
        await libraryEntryRefresh(given)(1);
        expect(put).not.toHaveBeenCalled();
        expect(refreshAll).toHaveBeenCalledTimes(1);
    });

    it('reads one item at a time: the changes told while it is read make one more read after it', async () => {
        const answers: Array<(item: Item) => void> = [];
        const { given, state } = source([ONE, TWO], () => {
            return new Promise((resolve) => {
                answers.push(resolve);
            });
        });
        const refresh = libraryEntryRefresh(given);
        const done = refresh(1);
        void refresh(1);
        void refresh(1);
        expect(given.read).toHaveBeenCalledTimes(1);
        answers[0]?.(ONE);
        await vi.waitFor(() => {
            expect(given.read).toHaveBeenCalledTimes(2);
        });
        answers[1]?.(ONE_NEW);
        await done;
        expect(state.library).toEqual([ONE_NEW, TWO]);
        expect(given.read).toHaveBeenCalledTimes(2);
    });
});
