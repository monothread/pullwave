export type NotFoundSize = 'screen' | 'small' | 'tiny';

interface NotFoundProps {
    text: string;
    size?: NotFoundSize;
}

export function NotFound({ text, size = 'screen' }: NotFoundProps) {
    return (
        <div className={`not-found not-found--${size}`} data-testid="not-found">
            <div className="not-found__stage" aria-hidden="true">
                <div className="not-found__rows">
                    <span />
                    <span />
                    <span />
                </div>
                <div className="not-found__burst" />
                <div className="not-found__lens">
                    <svg viewBox="0 0 64 64">
                        <circle className="not-found__glass" cx="27" cy="27" r="20" />
                        <path className="not-found__glint" d="M15 22 A13 13 0 0 1 24 13" />
                        <path className="not-found__cross" d="M20 20 L34 34 M34 20 L20 34" />
                        <line className="not-found__handle" x1="42" y1="42" x2="58" y2="58" />
                    </svg>
                </div>
            </div>
            <p className="not-found__text">{text}</p>
        </div>
    );
}
