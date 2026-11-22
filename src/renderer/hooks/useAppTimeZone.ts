import { resolveTimeZone } from '@shared/timezone';
import { useAppStore } from '../store/appStore';

export function useAppTimeZone(): string {
    const setting = useAppStore((state) => {
        return state.settings.timeZone;
    });
    return resolveTimeZone(setting);
}
