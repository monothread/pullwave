import { useTranslator } from '../i18n/useTranslator';
import { LIST_ORDERS, useListOrder, type ListKind, type ListOrder } from '../store/sortPrefsStore';

interface ListOrderSelectProps {
    // Whose order it is: the chapters of a manga or the episodes of an anime.
    kind: ListKind;
    // Which one of them: the key of the manga or of the anime (see `mangaListKey` and `animeListKey`).
    itemKey: string;
}

const ORDER_KEYS = {
    asc: 'list.order.asc',
    desc: 'list.order.desc'
} as const;

// Over the list of chapters of a manga or of episodes of an anime: the first one on top or the last one on top. The choice is kept for that
// title, for the next time the app opens.
export function ListOrderSelect({ kind, itemKey }: ListOrderSelectProps) {
    const t = useTranslator();
    const [order, setOrder] = useListOrder(kind, itemKey);
    return (
        <label className="library-controls__sort list-order">
            <span className="field__label">{t('library.sort')}</span>
            <select
                className="input"
                value={order}
                onChange={(event) => {
                    setOrder(event.target.value as ListOrder);
                }}
            >
                {LIST_ORDERS.map((option) => {
                    return (
                        <option key={option} value={option}>
                            {t(ORDER_KEYS[option])}
                        </option>
                    );
                })}
            </select>
        </label>
    );
}
