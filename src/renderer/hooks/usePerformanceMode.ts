import { useAppStore } from '../store/appStore';

export function usePerformanceMode(): boolean {
    return useAppStore((state) => {
        return state.settings.performanceMode;
    });
}
