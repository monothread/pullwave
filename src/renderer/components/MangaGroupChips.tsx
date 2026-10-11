import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';

interface MangaGroupChipsProps {
    // The mangas the chips are about: one manga, or every season of a series.
    mangaIds: readonly number[];
    // What the mangas are called, to tell what the chips are about.
    title: string;
}

// The groups of the library as buttons that put the mangas in them or take them out: a group is on when all the mangas are in it. A group
// that has only some of them (some seasons of a series) is half on, and a click puts the rest in.
export function MangaGroupChips({ mangaIds, title }: MangaGroupChipsProps) {
    const t = useTranslator();
    const groups = useMangaStore((state) => {
        return state.groups;
    });
    const library = useMangaStore((state) => {
        return state.library;
    });
    const setGroupMembers = useMangaStore((state) => {
        return state.setGroupMembers;
    });

    if (groups.length === 0) {
        return <p className="field__hint">{t('manga.groups.noneYet')}</p>;
    }
    const mangas = library.filter((manga) => {
        return mangaIds.includes(manga.id);
    });
    return (
        <ul className="manga__tags" aria-label={t('manga.groups.of', { title })}>
            {groups.map((group) => {
                const inside = mangas.filter((manga) => {
                    return manga.groupIds.includes(group.id);
                }).length;
                const all = mangas.length > 0 && inside === mangas.length;
                return (
                    <li key={group.id}>
                        <button
                            type="button"
                            className={`manga__tag${all ? ' manga__tag--on' : inside > 0 ? ' manga__tag--some' : ''}`}
                            aria-pressed={all ? true : inside > 0 ? 'mixed' : false}
                            onClick={() => {
                                void setGroupMembers(group.id, [...mangaIds], !all);
                            }}
                        >
                            {group.name}
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}
