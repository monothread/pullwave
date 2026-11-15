import { activeTotal } from '../home/homeData';
import { useActiveCounts } from '../hooks/useActiveCounts';

export type ActivityLevel = 'idle' | 'busy' | 'rush';

export const RUSH_FROM = 4;

export function activityOf(count: number): ActivityLevel {
    if (count === 0) {
        return 'idle';
    }
    return count >= RUSH_FROM ? 'rush' : 'busy';
}

export function useActivityLevel(): ActivityLevel {
    const counts = useActiveCounts();
    return activityOf(activeTotal(counts.video) + activeTotal(counts.anime) + activeTotal(counts.manga));
}
