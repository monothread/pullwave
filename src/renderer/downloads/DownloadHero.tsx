import type { ReactNode } from 'react';
import { useSpeedHistory } from '../hooks/useSpeedHistory';
import { useTranslator } from '../i18n/useTranslator';
import { Drawn } from '../components/Drawn';
import { SectionIcon, type SectionIconName } from '../components/SectionIcon';
import { formatSpeed, parseSpeed } from './speed';
import { SpeedGraph } from './SpeedGraph';

export interface DownloadHeroProps {
    // What tells this download from another one: the graph starts again for a new one.
    id: string;
    title: string;
    // The episode, the chapter or the pages; null for a video.
    detail: string | null;
    percent: number;
    // The speed and the time left as the program says them ("" when it says nothing).
    speed: string;
    eta: string;
    kind: SectionIconName;
    // The cover; null draws the picture of the section.
    cover: ReactNode;
    // How many downloads wait after this one.
    waiting: number;
}

function clampPercent(percent: number): number {
    return Math.min(100, Math.max(0, percent));
}

// The download going on, big, at the top of the list of downloads: its cover, its bar, its speed and the graph of the last minute, and how
// many come after it. It is for the eye only (hidden from the screen readers): everything it shows is in the card of the download.
export function DownloadHero({ id, title, detail, percent, speed, eta, kind, cover, waiting }: DownloadHeroProps) {
    const t = useTranslator();
    const samples = useSpeedHistory(id, parseSpeed(speed));
    const peak = samples.length > 0 ? Math.max(...samples) : 0;
    const shown = clampPercent(percent);
    return (
        <section className="download-hero" aria-hidden="true" data-testid="download-hero">
            <div className="download-hero__art">
                {cover ?? (
                    <span className="tile__generated">
                        <SectionIcon name={kind} />
                    </span>
                )}
            </div>
            <div className="download-hero__body">
                <span className="hero__eyebrow">{t('downloads.hero.current')}</span>
                <Drawn className="download-hero__title" text={title} />
                {detail !== null && <Drawn className="download-hero__detail" text={detail} />}
                <div className="download-hero__bar progress" aria-hidden="true">
                    <div className="progress__bar" style={{ width: `${String(shown)}%` }} />
                </div>
                <dl className="download-hero__stats">
                    <div className="download-hero__stat">
                        <dt>{t('downloads.hero.speed')}</dt>
                        <dd>
                            <Drawn className="download-hero__value" text={speed === '' ? '—' : speed} />
                        </dd>
                    </div>
                    <div className="download-hero__stat">
                        <dt>{t('downloads.hero.eta')}</dt>
                        <dd>
                            <Drawn className="download-hero__value" text={eta === '' ? '—' : eta} />
                        </dd>
                    </div>
                </dl>
                <Drawn className="download-hero__percent" text={`${String(Math.round(shown))}%`} />
            </div>
            <div className="download-hero__graph">
                {speed !== '' && <SpeedGraph samples={samples} label={t('downloads.hero.graph')} />}
                {peak > 0 && <span className="download-hero__peak">{t('downloads.hero.peak', { speed: formatSpeed(peak) })}</span>}
                {waiting > 0 && <span className="download-hero__next">{t('downloads.hero.upNext', { count: waiting })}</span>}
            </div>
        </section>
    );
}
