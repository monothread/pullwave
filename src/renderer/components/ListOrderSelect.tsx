import { useTranslator } from '../i18n/useTranslator';
import { LIST_ORDERS, useListOrder, type ListKind, type ListOrder } from '../store/sortPrefsStore';

interface ListOrderSelectProps {
    kind: ListKind;
    itemKey: string;
}

const ORDER_KEYS = {
    asc: 'list.order.asc',
    desc: 'list.order.desc'
} as const;

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
