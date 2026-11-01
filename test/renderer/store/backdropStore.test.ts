import { useBackdropStore } from '@renderer/store/backdropStore';

afterEach(() => {
    useBackdropStore.setState({ url: null });
});

describe('the cover behind the screen', () => {
    it('starts with none', () => {
        expect(useBackdropStore.getState().url).toBeNull();
    });

    it('shows the cover it is given, and none again when cleared or given null', () => {
        useBackdropStore.getState().show('pullwave-manga://cover/1');
        expect(useBackdropStore.getState().url).toBe('pullwave-manga://cover/1');
        useBackdropStore.getState().clear();
        expect(useBackdropStore.getState().url).toBeNull();
        useBackdropStore.getState().show('pullwave-manga://cover/2');
        useBackdropStore.getState().show(null);
        expect(useBackdropStore.getState().url).toBeNull();
    });
});
