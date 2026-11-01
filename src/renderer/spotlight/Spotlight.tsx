import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslator } from '../i18n/useTranslator';
import { useBackdropStore } from '../store/backdropStore';

// How long a highlight stays before the next one comes by itself.
export const SPOTLIGHT_ROTATE_MS = 5000;
// How long the change from one highlight to the next lasts: the one that leaves fades and slides away while the new one comes in.
export const SPOTLIGHT_SLIDE_MS = 700;

export interface SpotlightAction {
    label: string;
    // What the screen readers and the tests call the button, when the label alone does not say what it is about.
    ariaLabel?: string;
    onClick: () => void;
}

export interface SpotlightSlide {
    key: string;
    eyebrow: string;
    title: string;
    meta: string;
    art: ReactNode;
    // The cover, behind the slide and behind the screen.
    imageUrl: string | null;
    // How far it went, from 0 to 1; null draws no bar.
    progress: number | null;
    primary: SpotlightAction;
    secondary?: SpotlightAction;
}

interface SpotlightProps {
    slides: readonly SpotlightSlide[];
    label: string;
}

// The index `step` places away, going round at the ends.
export function slideAfter(index: number, step: number, count: number): number {
    if (count === 0) {
        return 0;
    }
    return (((index + step) % count) + count) % count;
}

function imageStyle(url: string | null): CSSProperties | undefined {
    return url === null ? undefined : ({ '--hero-image': `url("${url.replace(/"/g, '%22')}")` } as CSSProperties);
}

// Which way the slides go: forward, the new one comes from the right; back, from the left.
export type SlideDirection = 'forward' | 'back';

interface Leaving {
    slide: SpotlightSlide;
    direction: SlideDirection;
}

function percentOf(progress: number): string {
    return `${String(Math.round(Math.min(1, Math.max(0, progress)) * 100))}%`;
}

interface SlideViewProps {
    slide: SpotlightSlide;
    label: string;
    // The slide that is going away: drawn under the new one for the eye only, with no button to press.
    leaving?: SlideDirection;
    entering?: SlideDirection;
}

function SlideView({ slide, label, leaving, entering }: SlideViewProps) {
    const motion = leaving !== undefined ? ` spotlight__slide--leaving spotlight__slide--${leaving}` : entering !== undefined ? ` spotlight__slide--entering spotlight__slide--${entering}` : '';
    return (
        <div
            className={`spotlight__slide hero${motion}`}
            style={imageStyle(slide.imageUrl)}
            role={leaving === undefined ? 'group' : undefined}
            aria-roledescription={leaving === undefined ? 'slide' : undefined}
            aria-label={leaving === undefined ? label : undefined}
            aria-hidden={leaving === undefined ? undefined : true}
            inert={leaving !== undefined}
        >
            <div className="hero__art">{slide.art}</div>
            <div className="hero__body">
                <span className="hero__eyebrow">{slide.eyebrow}</span>
                <h2 className="hero__title">{slide.title}</h2>
                <p className="hero__meta">{slide.meta}</p>
                {slide.progress !== null && (
                    <span className="hero__progress" aria-hidden="true">
                        <span className="hero__progress-fill" style={{ width: percentOf(slide.progress) }} />
                    </span>
                )}
                <div className="hero__actions">
                    <button type="button" className="btn btn--primary hero__play" aria-label={slide.primary.ariaLabel} onClick={slide.primary.onClick}>
                        {slide.primary.label}
                    </button>
                    {slide.secondary !== undefined && (
                        <button type="button" className="btn hero__more" aria-label={slide.secondary.ariaLabel} onClick={slide.secondary.onClick}>
                            {slide.secondary.label}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

// The carousel of the highlights at the top of the home screen and of the libraries, as on the screen of a console: one title big over its
// cover, its buttons, and the next one by itself every five seconds, always (an arrow or a dot shows another one and the five seconds start
// again from it), with the one that leaves fading away under the one that comes. The cover of the one shown is behind the whole screen.
export function Spotlight({ slides, label }: SpotlightProps) {
    const t = useTranslator();
    const [index, setIndex] = useState(0);
    const [entering, setEntering] = useState<SlideDirection | null>(null);
    const [leaving, setLeaving] = useState<Leaving | null>(null);
    const showBackdrop = useBackdropStore((state) => {
        return state.show;
    });
    const count = slides.length;
    const current = slides[Math.min(index, Math.max(count - 1, 0))];

    const position = Math.min(index, Math.max(count - 1, 0));

    // Shows another slide: the one shown leaves and the new one comes in from the side it is on.
    const goTo = (next: number, direction: SlideDirection): void => {
        if (next === position || current === undefined) {
            return;
        }
        setLeaving({ slide: current, direction });
        setEntering(direction);
        setIndex(next);
    };

    // The timer only starts again when the slide changes, not each time the screen around is drawn again (a download going on).
    const goToRef = useRef(goTo);
    useEffect(() => {
        goToRef.current = goTo;
    });
    useEffect(() => {
        if (count < 2) {
            return undefined;
        }
        const timer = setTimeout(() => {
            goToRef.current(slideAfter(position, 1, count), 'forward');
        }, SPOTLIGHT_ROTATE_MS);
        return () => {
            clearTimeout(timer);
        };
    }, [count, position]);

    // The slide that left is taken away once the change is over.
    useEffect(() => {
        if (leaving === null) {
            return undefined;
        }
        const timer = setTimeout(() => {
            setLeaving(null);
            setEntering(null);
        }, SPOTLIGHT_SLIDE_MS);
        return () => {
            clearTimeout(timer);
        };
    }, [leaving]);

    const imageUrl = current?.imageUrl ?? null;
    useEffect(() => {
        if (imageUrl !== null) {
            showBackdrop(imageUrl);
        }
    }, [imageUrl, showBackdrop]);

    if (current === undefined) {
        return null;
    }
    return (
        <section className="spotlight" aria-roledescription="carousel" aria-label={label}>
            <div className="spotlight__stage">
                {leaving !== null && <SlideView key={`leaving-${leaving.slide.key}`} slide={leaving.slide} label="" leaving={leaving.direction} />}
                <SlideView key={current.key} slide={current} label={t('spotlight.position', { n: position + 1, total: count })} entering={entering ?? undefined} />
            </div>
            {count > 1 && (
                <div className="spotlight__controls">
                    <button
                        type="button"
                        className="spotlight__arrow"
                        aria-label={t('spotlight.previous')}
                        onClick={() => {
                            goTo(slideAfter(position, -1, count), 'back');
                        }}
                    >
                        ‹
                    </button>
                    <div className="spotlight__dots">
                        {slides.map((slide, dot) => {
                            return (
                                <button
                                    key={slide.key}
                                    type="button"
                                    className={`spotlight__dot${dot === position ? ' spotlight__dot--current' : ''}`}
                                    aria-label={t('spotlight.goTo', { n: dot + 1, total: count })}
                                    aria-current={dot === position ? 'true' : undefined}
                                    onClick={() => {
                                        goTo(dot, dot > position ? 'forward' : 'back');
                                    }}
                                />
                            );
                        })}
                    </div>
                    <button
                        type="button"
                        className="spotlight__arrow"
                        aria-label={t('spotlight.next')}
                        onClick={() => {
                            goTo(slideAfter(position, 1, count), 'forward');
                        }}
                    >
                        ›
                    </button>
                </div>
            )}
        </section>
    );
}
