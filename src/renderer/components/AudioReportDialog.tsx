import { useId } from 'react';
import { createPortal } from 'react-dom';
import { useTranslator } from '../i18n/useTranslator';
import { useModalDialog } from '../hooks/useModalDialog';
import { useAnimeStore } from '../store/animeStore';
import type { MessageKey } from '@shared/i18n';
import type { AudioReport, LibraryProblemKind } from './animeText';

const PROBLEM_KEYS: Record<LibraryProblemKind, MessageKey> = {
    'no-audio': 'anime.noAudio',
    'file-missing': 'anime.fileMissing'
};

interface AudioReportWindowProps {
    report: AudioReport;
}

// The window that opens when the check of the downloaded episodes ends: how it went, every episode that has a problem (its video has no
// audio, or its file is not on the disk) and a button that downloads all of them again. It is put in the body of the page, over the screen.
function AudioReportWindow({ report }: AudioReportWindowProps) {
    const t = useTranslator();
    const titleId = useId();
    const closeAudioReport = useAnimeStore((state) => {
        return state.closeAudioReport;
    });
    const redownloadProblems = useAnimeStore((state) => {
        return state.redownloadProblems;
    });
    const { dialogRef, handleKeyDown } = useModalDialog(closeAudioReport, true);
    const { summary, problems, downloaded } = report;

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
                        <p className="modal__hint">{t('anime.audio.report.fixHint')}</p>
                    </>
                )}
                <div className="modal__actions">
                    <button type="button" className="btn btn--small btn--ghost" onClick={closeAudioReport}>
                        {t('anime.audio.report.close')}
                    </button>
                    {problems.length > 0 && (
                        <button
                            type="button"
                            className="btn btn--small btn--primary"
                            onClick={() => {
                                void redownloadProblems();
                            }}
                        >
                            {t('anime.audio.report.fix', { count: problems.length })}
                        </button>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
}

// Shows the window while there is a report of the check of the audio of the library (it is mounted only then, so the focus goes into it).
export function AudioReportDialog() {
    const report = useAnimeStore((state) => {
        return state.audioReport;
    });
    return report === null ? null : <AudioReportWindow report={report} />;
}
