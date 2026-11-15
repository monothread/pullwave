import { useSeriesCoverTitle } from '../hooks/useSeriesCoverTitle';
import { AnimeCover } from './AnimeCover';

interface SeriesCoverProps {
    titles: readonly string[];
    name: string;
}

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
