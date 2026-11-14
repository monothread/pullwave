// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { useTranslationTarget } from '@renderer/hooks/useTranslationTarget';
import { useAppStore } from '@renderer/store/appStore';

const initial = useAppStore.getState();

beforeEach(() => {
    useAppStore.setState({ ...initial, settings: DEFAULT_SETTINGS });
});

describe('useTranslationTarget', () => {
    it('gives the language of the anime subtitles, the Portuguese of the source as the Brazilian one', () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, animeSubtitles: 'Portuguese', language: 'en' } });
        const { result } = renderHook(() => {
            return useTranslationTarget();
        });
        expect(result.current).toBe('Portuguese (Brazil)');
    });

    it('gives the language of the app when the anime subtitles leave the choice to ani-cli', () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, animeSubtitles: 'default', language: 'es' } });
        const { result } = renderHook(() => {
            return useTranslationTarget();
        });
        expect(result.current).toBe('Spanish');
    });

    it('follows the settings when the anime subtitles or the language of the app change', () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, animeSubtitles: 'German', language: 'en' } });
        const { result } = renderHook(() => {
            return useTranslationTarget();
        });
        expect(result.current).toBe('German');
        act(() => {
            useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, animeSubtitles: 'auto', language: 'pt' } });
        });
        expect(result.current).toBe('Portuguese (Brazil)');
        act(() => {
            useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, animeSubtitles: 'default', language: 'ja' } });
        });
        expect(result.current).toBe('Japanese');
    });
});
