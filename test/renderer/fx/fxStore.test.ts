import { useFxStore } from '@renderer/fx/fxStore';

beforeEach(() => {
    useFxStore.setState({ celebrations: 0, failures: 0, dances: 0, rainbow: false });
});

describe('the store of the effects', () => {
    it('starts quiet', () => {
        expect(useFxStore.getState()).toMatchObject({ celebrations: 0, failures: 0, dances: 0, rainbow: false });
    });

    it('counts a celebration and makes the wave dance with it', () => {
        useFxStore.getState().celebrate();
        useFxStore.getState().celebrate();
        expect(useFxStore.getState()).toMatchObject({ celebrations: 2, dances: 2, failures: 0 });
    });

    it('counts a failure without a dance', () => {
        useFxStore.getState().fail();
        expect(useFxStore.getState()).toMatchObject({ failures: 1, dances: 0, celebrations: 0 });
    });

    it('counts a dance by itself', () => {
        useFxStore.getState().dance();
        expect(useFxStore.getState()).toMatchObject({ dances: 1, celebrations: 0 });
    });

    it('turns the secret mode on and off, telling which it is now', () => {
        expect(useFxStore.getState().toggleRainbow()).toBe(true);
        expect(useFxStore.getState().rainbow).toBe(true);
        expect(useFxStore.getState().toggleRainbow()).toBe(false);
        expect(useFxStore.getState().rainbow).toBe(false);
    });
});
