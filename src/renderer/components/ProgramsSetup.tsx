import type { ReactNode } from 'react';
import { AREA_PROGRAMS, type ProgramArea, type ProgramInfo } from '@shared/programs';
import { useTranslator } from '../i18n/useTranslator';
import { PROGRAM_NAMES, useProgramsStore } from '../store/programsStore';
import { isWorking, programErrorKey, programProgressKey } from './programText';

interface ProgramProgressProps {
    program: ProgramInfo;
    retrying: boolean;
    onRetry: () => void;
}

// One program that is being downloaded: its name, a bar, what it is doing; or why it failed, with the way to try again.
function ProgramProgress({ program, retrying, onRetry }: ProgramProgressProps) {
    const t = useTranslator();
    const { state } = program;
    const name = PROGRAM_NAMES[program.id];
    return (
        <li className="history__item" data-testid={`program-setup-${program.id}`}>
            <div className="history__main">
                <span className="history__title">{name}</span>
                {state.status === 'error' && state.error ? (
                    <span className="field__warning" role="alert" title={state.error.message}>
                        {t(programErrorKey(state.error.code))}
                    </span>
                ) : (
                    <>
                        <div className="progress" role="progressbar" aria-label={name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(state.percent)}>
                            <div className="progress__bar progress__bar--smooth" style={{ width: `${String(state.status === 'ready' ? 100 : state.percent)}%` }} />
                        </div>
                        <span className="history__meta">
                            {state.status === 'ready'
                                ? t('tools.status.ready')
                                : t(programProgressKey(state.status === 'error' ? 'missing' : state.status), { percent: Math.round(state.percent) })}
                        </span>
                    </>
                )}
            </div>
            {state.status === 'error' && (
                <span className="anime__actions">
                    <button type="button" className="btn btn--small btn--primary" disabled={retrying} onClick={onRetry}>
                        {t('tools.retry')}
                    </button>
                </span>
            )}
        </li>
    );
}

interface ProgramsGateProps {
    area: ProgramArea;
    children: ReactNode;
}

// What a part of the app (the video downloader, the anime section) needs: until the programs it runs are downloaded it shows how that is going
// (and TRY AGAIN for any that failed) instead of the part itself. A program the user gave a path for is not waited for. Nothing is shown
// until the state of the programs is known, and on a system the programs are not made for the part is shown as it is.
export function ProgramsGate({ area, children }: ProgramsGateProps) {
    const t = useTranslator();
    const status = useProgramsStore((state) => {
        return state.status;
    });
    const working = useProgramsStore((state) => {
        return state.working;
    });
    const retry = useProgramsStore((state) => {
        return state.retry;
    });
    if (status === null || !status.supported) {
        return <>{children}</>;
    }
    const needed = status.programs.filter((program) => {
        return AREA_PROGRAMS[area].includes(program.id) && !program.custom;
    });
    const waiting = needed.filter((program) => {
        return program.state.status !== 'ready';
    });
    if (waiting.length === 0) {
        return <>{children}</>;
    }
    const failed = waiting.some((program) => {
        return program.state.status === 'error';
    });
    return (
        <section className="panel programs__setup" aria-label={t(`tools.setup.title.${area}`)} data-testid={`programs-setup-${area}`}>
            <span className="section-label">{t(`tools.setup.title.${area}`)}</span>
            <p className="field__hint">{t('tools.setup.hint')}</p>
            <ul className="history__list">
                {needed.map((program) => {
                    return (
                        <ProgramProgress
                            key={program.id}
                            program={program}
                            retrying={working[program.id] === 'retrying' || isWorking(program.state)}
                            onRetry={() => {
                                void retry(program.id);
                            }}
                        />
                    );
                })}
            </ul>
            {failed && (
                <p className="field__warning" role="alert">
                    {t('tools.setup.partial')}
                </p>
            )}
        </section>
    );
}
