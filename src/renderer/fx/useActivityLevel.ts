import { activeTotal } from '../home/homeData';
import { useActiveCounts } from '../hooks/useActiveCounts';

export type ActivityLevel = 'idle' | 'busy' | 'rush';

// More than this many downloads at once is a rush.
export const RUSH_FROM = 4;

export function activityOf(count: number): ActivityLevel {
    if (count === 0) {
        return 'idle';
    }
    return count >= RUSH_FROM ? 'rush' : 'busy';
}

// How busy the app is, from the downloads going on in every section: the wave of the name follows it.
export function useActivityLevel(): ActivityLevel {
    const counts = useActiveCounts();
    return activityOf(activeTotal(counts.video) + activeTotal(counts.anime) + activeTotal(counts.manga));
}
