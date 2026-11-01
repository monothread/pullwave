import { useTranslator } from '../i18n/useTranslator';
import { LIST_ORDERS, useListOrder, type ListKind, type ListOrder } from '../store/sortPrefsStore';

interface ListOrderSelectProps {
    // Whose order it is: the chapters of a manga or the episodes of an anime (each one is kept on its own).
    kind: ListKind;
}

const ORDER_KEYS = {
    asc: 'list.order.asc',
    desc: 'list.order.desc'
} as const;

// Over a list of chapters or episodes: the first one on top or the last one on top. The choice is kept for the next time the app opens.
export function ListOrderSelect({ kind }: ListOrderSelectProps) {
    const t = useTranslator();
    const [order, setOrder] = useListOrder(kind);
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
