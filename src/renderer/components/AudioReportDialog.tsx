import { useId } from 'react';
import { createPortal } from 'react-dom';
import { useTranslator } from '../i18n/useTranslator';
import { useModalDialog } from '../hooks/useModalDialog';
import { useAnimeStore } from '../store/animeStore';
import type { MessageKey } from '@shared/i18n';
import { isRepairable, type AudioReport, type LibraryProblemKind } from './animeText';

const PROBLEM_KEYS: Record<LibraryProblemKind, MessageKey> = {
    'no-audio': 'anime.noAudio',
    'file-missing': 'anime.fileMissing',
    unreadable: 'anime.unreadable'
};

interface AudioReportWindowProps {
    report: AudioReport;
}

function AudioReportWindow({ report }: AudioReportWindowProps) {
    const t = useTranslator();
    const titleId = useId();
    const closeAudioReport = useAnimeStore((state) => {
        return state.closeAudioReport;
    });
    const redownloadProblems = useAnimeStore((state) => {
        return state.redownloadProblems;
    });
    const repairProblems = useAnimeStore((state) => {
        return state.repairProblems;
    });
    const { dialogRef, handleKeyDown } = useModalDialog(closeAudioReport, true);
    const { summary, problems, downloaded } = report;
    const unreadable = problems.filter(isRepairable).length;
    const downloadable = problems.length - unreadable;

    return createPortal(
        <div
            className="modal-backdrop"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                    closeAudioReport();
                }
            }}
            onClick={(event) => {
                event.stopPropagation();
            }}
        >
            <div ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={handleKeyDown}>
                <h2 id={titleId} className="modal__title">
                    {t('anime.audio.report.title')}
                </h2>
                <p className="modal__hint" data-testid="audio-report-summary">
                    {t('anime.audio.report.summary', { checked: summary.checked, unreadable: summary.unreadable })}
                </p>
                {problems.length === 0 ? (
                    <p className="modal__hint" role="status">
                        {t(downloaded === 0 ? 'anime.audio.report.empty' : 'anime.audio.report.none')}
                    </p>
                ) : (
                    <>
                        <p className="modal__hint" role="status">
                            {t('anime.audio.report.problems', { count: problems.length })}
                        </p>
                        <ul className="modal__list modal__list--scroll" data-testid="audio-problems">
                            {problems.map((problem) => {
                                return (
                                    <li key={problem.episodeId} data-testid="audio-problem">
                                        {`${problem.animeTitle} · ${t('anime.episode', { number: problem.episode })} — ${t(PROBLEM_KEYS[problem.kind])}`}
                                    </li>
                                );
                            })}
                        </ul>
                        {downloadable > 0 && <p className="modal__hint">{t('anime.audio.report.fixHint')}</p>}
                        {unreadable > 0 && <p className="modal__hint">{t('anime.audio.report.unreadableHint')}</p>}
                    </>
                )}
                <div className="modal__actions">
                    <button type="button" className="btn btn--small btn--ghost" onClick={closeAudioReport}>
                        {t('anime.audio.report.close')}
                    </button>
                    {unreadable > 0 && (
                        <button
                            type="button"
                            className="btn btn--small btn--primary"
                            onClick={() => {
                                void repairProblems();
                            }}
                        >
                            {t('anime.audio.report.repair', { count: unreadable })}
                        </button>
                    )}
                    {downloadable > 0 && (
                        <button
                            type="button"
                            className="btn btn--small btn--primary"
                            onClick={() => {
                                void redownloadProblems();
                            }}
                        >
                            {t('anime.audio.report.fix', { count: downloadable })}
                        </button>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
}

export function AudioReportDialog() {
    const report = useAnimeStore((state) => {
        return state.audioReport;
    });
    return report === null ? null : <AudioReportWindow report={report} />;
}
