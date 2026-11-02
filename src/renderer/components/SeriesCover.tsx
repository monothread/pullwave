import { useSeriesCoverTitle } from '../hooks/useSeriesCoverTitle';
import { AnimeCover } from './AnimeCover';

interface SeriesCoverProps {
    // The titles of the seasons of the series, in order.
    titles: readonly string[];
    // What stands for the series when it has no season.
    name: string;
}

// The cover of a series: the one of its first season, or, when that one has none, the one of the first season after it that has. When no
// season has one the block says so, without asking again.
export function SeriesCover({ titles, name }: SeriesCoverProps) {
    const { title, exhausted, markBroken } = useSeriesCoverTitle(titles);
    const shown = title ?? name;
    return (
        <AnimeCover
            key={shown}
            title={shown}
            url={exhausted ? null : undefined}
            onBroken={() => {
                markBroken(shown);
            }}
        />
    );
}
