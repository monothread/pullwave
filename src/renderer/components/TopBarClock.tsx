import { FlipText } from '../fx/FlipText';
import { useAppTimeZone } from '../hooks/useAppTimeZone';
import { useClock } from '../hooks/useClock';
import { useAppLanguage, useTranslator } from '../i18n/useTranslator';
import { clockDatetime, formatClock } from './clockText';

export function TopBarClock() {
    const t = useTranslator();
    const language = useAppLanguage();
    const timeZone = useAppTimeZone();
    const now = useClock();
    const time = formatClock(now, language, timeZone);
    return (
        <time className="topbar__clock" dateTime={clockDatetime(now, timeZone)} aria-label={t('app.clock', { time })}>
            <FlipText text={time} />
        </time>
    );
}
