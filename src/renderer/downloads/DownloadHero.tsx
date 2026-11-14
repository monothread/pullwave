import type { ReactNode } from 'react';
import type { DownloadPart } from '@shared/types';
import { useSpeedHistory } from '../hooks/useSpeedHistory';
import { useTranslator } from '../i18n/useTranslator';
import { Drawn } from '../components/Drawn';
import { hasParts } from '../components/PartBars';
import { PartsZipper } from '../components/PartsZipper';
import { StepTrail } from '../components/StepTrail';
import { useZipPhase } from '../hooks/useZipPhase';
import { SectionIcon, type SectionIconName } from '../components/SectionIcon';
import { flowSeconds, formatSpeed, parseSpeed } from './speed';
import { SpeedGraph } from './SpeedGraph';

export interface DownloadHeroProps {
    // What tells this download from another one: the graph starts again for a new one.
    id: string;
    title: string;
    // The episode, the chapter or the pages; null for a video.
    detail: string | null;
    percent: number;
    // The parts of a download whose video and audio come apart, each with a bar of its own in place of the one bar; null for one that does not.
    parts?: DownloadPart[] | null;
    // The step after the download that is going on (a post-processor of yt-dlp, or the joining of an episode), null when there is none.
    postProcess?: string | null;
    // The steps after the download that started, in their order.
    steps?: readonly string[];
    // The download ended: it stays a few seconds, green, before it leaves.
    done?: boolean;
    // The speed and the time left as the program says them ("" when it says nothing).
    speed: string;
    eta: string;
    kind: SectionIconName;
    // The cover; null draws the picture of the section.
    cover: ReactNode;
    // The shape of the cover: a poster (2:3, the covers of the anime and the manga) or wide (16:9, the picture of a video).
    coverShape?: 'poster' | 'wide';
    // How many downloads wait after this one.
    waiting: number;
}

function clampPercent(percent: number): number {
    return Math.min(100, Math.max(0, percent));
}

const NO_STEPS: readonly string[] = [];

function heroClass(coverShape: 'poster' | 'wide', done: boolean): string {
    const classes = ['download-hero'];
    if (coverShape === 'wide') {
        classes.push('download-hero--wide');
    }
    if (done) {
        classes.push('download-hero--done');
    }
    return classes.join(' ');
}

function barClass(processing: boolean): string {
    return processing ? 'download-hero__bar progress progress--processing' : 'download-hero__bar progress';
}

// The download going on, big, at the top of the list of downloads: its cover, its bar (the bars of its parts zipped into one once they are
// downloaded, then the bar of the step going on), the steps after the download, its speed and the graph of the last minute, and how many come
// after it. It is for the eye only (hidden from the screen readers): everything it shows is in the card of the download.
export function DownloadHero({ id, title, detail, percent, parts = null, postProcess = null, steps = NO_STEPS, done = false, speed, eta, kind, cover, coverShape = 'poster', waiting }: DownloadHeroProps) {
    const t = useTranslator();
    const zip = useZipPhase(postProcess !== null || done);
    const samples = useSpeedHistory(id, parseSpeed(speed));
    const peak = samples.length > 0 ? Math.max(...samples) : 0;
    const shown = clampPercent(percent);
    const flowDuration = `${String(flowSeconds(parseSpeed(speed)))}s`;
    return (
        <section className={heroClass(coverShape, done)} aria-hidden="true" data-testid="download-hero">
            <div className="download-hero__art">
                {cover ?? (
                    <span className="tile__generated">
                        <SectionIcon name={kind} />
                    </span>
                )}
            </div>
            <div className="download-hero__body">
                <span className="hero__eyebrow">{t(done ? 'downloads.hero.done' : 'downloads.hero.current')}</span>
                <Drawn className="download-hero__title" text={title} />
                {detail !== null && <Drawn className="download-hero__detail" text={detail} />}
                {hasParts(parts) && zip !== 'joined' ? (
                    <PartsZipper parts={parts} phase={zip} t={t} barClassName="download-hero__bar" flowDuration={flowDuration} drawn />
                ) : (
                    <div className={barClass(postProcess !== null && !done)} aria-hidden="true">
                        <div className="progress__bar" style={{ width: `${String(shown)}%`, animationDuration: flowDuration }} />
                    </div>
                )}
                <StepTrail steps={steps} status={done ? 'done' : 'running'} t={t} drawn />
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
                {!hasParts(parts) && <Drawn className="download-hero__percent" text={`${String(Math.round(shown))}%`} />}
            </div>
            <div className="download-hero__graph">
                {speed !== '' && <SpeedGraph samples={samples} label={t('downloads.hero.graph')} />}
                {peak > 0 && <span className="download-hero__peak">{t('downloads.hero.peak', { speed: formatSpeed(peak) })}</span>}
                {waiting > 0 && <span className="download-hero__next">{t('downloads.hero.upNext', { count: waiting })}</span>}
            </div>
        </section>
    );
}
