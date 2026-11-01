// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { useMangaLanguage } from '@renderer/hooks/useMangaLanguage';
import { useAppStore } from '@renderer/store/appStore';

const initialApp = useAppStore.getState();

beforeEach(() => {
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS });
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('useMangaLanguage', () => {
    it('gives the language of the settings when something is in it', () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, mangaLanguage: 'pt' } });
        expect(renderHook(() => { return useMangaLanguage(['en', 'pt']); }).result.current).toBe('pt');
    });

    it('gives every language when the settings ask for it', () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, mangaLanguage: 'all-languages' } });
        expect(renderHook(() => { return useMangaLanguage(['en', 'pt']); }).result.current).toBe('all-languages');
    });

    it('follows the language of the computer on automatic', () => {
        vi.spyOn(navigator, 'language', 'get').mockReturnValue('pt-BR');
        expect(renderHook(() => { return useMangaLanguage(['en', 'pt']); }).result.current).toBe('pt');
    });

    it('falls back to English on automatic, and to every language when there is no English either', () => {
        vi.spyOn(navigator, 'language', 'get').mockReturnValue('ja-JP');
        expect(renderHook(() => { return useMangaLanguage(['en', 'pt']); }).result.current).toBe('en');
        expect(renderHook(() => { return useMangaLanguage(['pt']); }).result.current).toBe('all-languages');
    });

    it('changes when the settings change', () => {
        const { result, rerender } = renderHook(() => { return useMangaLanguage(['en', 'pt']); });
        expect(result.current).toBe('en');
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, mangaLanguage: 'pt' } });
        rerender();
        expect(result.current).toBe('pt');
    });
});
