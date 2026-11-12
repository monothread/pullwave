import { clearListMemories, LIST_MEMORY_LIMIT, ListMemory } from '@renderer/hooks/listMemory';

describe('ListMemory', () => {
    it('keeps 50 lists by default', () => {
        expect(LIST_MEMORY_LIMIT).toBe(50);
        const memory = new ListMemory<number>();
        for (let index = 0; index <= LIST_MEMORY_LIMIT; index += 1) {
            memory.set(`list-${String(index)}`, index);
        }
        expect(memory.get('list-0')).toBeUndefined();
        expect(memory.get('list-1')).toBe(1);
        expect(memory.get(`list-${String(LIST_MEMORY_LIMIT)}`)).toBe(LIST_MEMORY_LIMIT);
    });

    it('gives back what was kept for a key, and undefined for a key never kept', () => {
        const memory = new ListMemory<{ count: number }>(3);
        memory.set('chapters', { count: 120 });
        expect(memory.get('chapters')).toEqual({ count: 120 });
        expect(memory.get('episodes')).toBeUndefined();
    });

    it('replaces the value of a key that is kept again', () => {
        const memory = new ListMemory<number>(3);
        memory.set('chapters', 60);
        memory.set('chapters', 180);
        expect(memory.get('chapters')).toBe(180);
    });

    it('forgets the list kept the longest ago when it holds more than its limit', () => {
        const memory = new ListMemory<number>(2);
        memory.set('first', 1);
        memory.set('second', 2);
        memory.set('third', 3);
        expect(memory.get('first')).toBeUndefined();
        expect(memory.get('second')).toBe(2);
        expect(memory.get('third')).toBe(3);
    });

    it('takes a key kept again as the newest, so it is not the one forgotten', () => {
        const memory = new ListMemory<number>(2);
        memory.set('first', 1);
        memory.set('second', 2);
        memory.set('first', 10);
        memory.set('third', 3);
        expect(memory.get('first')).toBe(10);
        expect(memory.get('second')).toBeUndefined();
        expect(memory.get('third')).toBe(3);
    });

    it('forgets everything on clear', () => {
        const memory = new ListMemory<number>(3);
        memory.set('first', 1);
        memory.set('second', 2);
        memory.clear();
        expect(memory.get('first')).toBeUndefined();
        expect(memory.get('second')).toBeUndefined();
    });
});

describe('clearListMemories', () => {
    it('clears every memory that was made', () => {
        const counts = new ListMemory<number>(3);
        const names = new ListMemory<string>(3);
        counts.set('chapters', 60);
        names.set('chapters', 'One Piece');
        clearListMemories();
        expect(counts.get('chapters')).toBeUndefined();
        expect(names.get('chapters')).toBeUndefined();
    });
});
