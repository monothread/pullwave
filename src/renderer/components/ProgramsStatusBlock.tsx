import type { MessageKey } from '@shared/i18n';
import { PLACE_PROGRAMS, type ProgramInfo, type ProgramPlace, type ProgramVersionInfo } from '@shared/programs';
import type { ProgramId } from '@shared/tools';
import { useTranslator } from '../i18n/useTranslator';
import { useAnimeStore } from '../store/animeStore';
import { useAppStore } from '../store/appStore';
import { PROGRAM_NAMES, useProgramsStore, type ProgramResult } from '../store/programsStore';
import { displayVersion, isWorking, lookupReasonKey, programErrorKey } from './programText';
import { ConfirmButton } from './ConfirmButton';

const PATCH_KEYS: Record<string, MessageKey> = {
    subtitleSelection: 'tools.patch.subtitleSelection',
    allSubtitles: 'tools.patch.allSubtitles',
    debugReferer: 'tools.patch.debugReferer'
};

const HINTS: Record<ProgramPlace, MessageKey> = {
    global: 'tools.hint.global',
    downloads: 'tools.hint.downloads',
    anime: 'tools.hint.anime'
};

// The programs that stay at the version the app was made with: there is nothing newer to look for.
const PINNED: readonly ProgramId[] = ['busybox', 'curl'];

function badgeOf(program: ProgramInfo): { className: string; key: MessageKey } {
    if (program.custom) {
        return { className: 'badge', key: 'tools.state.custom' };
    }
    switch (program.state.status) {
        case 'ready':
            return { className: 'badge badge--done', key: 'tools.state.ready' };
        case 'error':
            return { className: 'badge badge--error', key: program.state.error?.code === 'UNSUPPORTED_PLATFORM' ? 'tools.state.unsupported' : 'tools.state.error' };
        case 'missing':
            return { className: 'badge badge--cancelled', key: 'tools.state.missing' };
        default:
            return { className: 'badge badge--waiting', key: 'tools.state.downloading' };
    }
}

interface ProgramRowProps {
    program: ProgramInfo;
    // The version the program says it is (what it was asked with), and whether it runs at all (null: not known).
    version: string | null;
    runs: boolean | null;
    customPath: string;
    info: ProgramVersionInfo | null;
    result: ProgramResult | null;
}

function resultText(result: ProgramResult, t: ReturnType<typeof useTranslator>): string {
    if (result.ok) {
        return result.action === 'reset' ? t('tools.result.reset') : t('tools.result.updated', { version: result.version ?? '' });
    }
    switch (result.reason) {
        case 'current':
            return t('tools.result.current');
        case 'busy':
            return t('tools.result.busy');
        case 'custom':
            return t('tools.result.custom');
        case 'unsupported':
            return t('tools.result.unsupported');
        case 'none':
            return t('tools.result.none');
        case 'lookup':
            return t('tools.lookupFailed', { reason: result.lookup === null ? result.message : t(lookupReasonKey(result.lookup)) });
        default:
            return t('tools.result.failed', { message: result.message });
    }
}

function ProgramRow({ program, version, runs, customPath, info, result }: ProgramRowProps) {
    const t = useTranslator();
    const working = useProgramsStore((state) => {
        return state.working[program.id];
    });
    const download = useProgramsStore((state) => {
        return state.updates[program.id];
    });
    const retry = useProgramsStore((state) => {
        return state.retry;
    });
    const reinstall = useProgramsStore((state) => {
        return state.reinstall;
    });
    const update = useProgramsStore((state) => {
        return state.update;
    });
    const reset = useProgramsStore((state) => {
        return state.reset;
    });
    const { state } = program;
    const name = PROGRAM_NAMES[program.id];
    const badge = badgeOf(program);
    const busy = working !== undefined || isWorking(state);
    const notRunning = !program.custom && state.status === 'ready' && runs === false;
    const latestLabel = info?.latest ? displayVersion(program.id, info.latest) : null;
    const idleUpdateLabel = program.id === 'ffmpeg' ? t('tools.updateBuild') : t('tools.update', { version: latestLabel ?? '' });
    const updateLabel = working === 'updating' ? t('tools.updating') : idleUpdateLabel;
    const resetLabel = working === 'resetting' ? t('tools.resetting') : t('tools.reset');
    return (
        <li className="history__item" data-testid={`program-${program.id}`}>
            <div className="history__main">
                <span className="history__title">{name}</span>
                {program.custom ? (
                    <span className="history__meta">{program.id === 'deno' ? t('tools.customDeno') : t('tools.custom', { path: customPath })}</span>
                ) : state.status === 'ready' ? (
                    <span className="history__meta">{version === null ? t('tools.versionUnknown') : t('tools.version', { version: displayVersion(program.id, version) })}</span>
                ) : isWorking(state) ? (
                    <span className="history__meta">{t('tools.status.downloading', { percent: Math.round(state.percent) })}</span>
                ) : null}
                {isWorking(state) && !program.custom && (
                    <div className="progress" role="progressbar" aria-label={name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(state.percent)}>
                        <div className="progress__bar progress__bar--smooth" style={{ width: `${String(state.percent)}%` }} />
                    </div>
                )}
                {!program.custom && state.status === 'error' && state.error && (
                    <span className="field__warning" role="alert" title={state.error.message}>
                        {t(programErrorKey(state.error.code))}
                    </span>
                )}
                {notRunning && (
                    <span className="field__warning" role="alert">
                        {t('tools.notRunning')}
                    </span>
                )}
                {PINNED.includes(program.id) && !program.custom && <span className="history__meta">{t('tools.pinned')}</span>}
                {info?.latest && !program.custom && (
                    <span className="history__meta">
                        {info.updatable ? (program.id === 'ffmpeg' ? t('tools.latestBuild') : t('tools.latest', { version: latestLabel ?? '' })) : t('tools.upToDate')}
                    </span>
                )}
                {info?.error && !program.custom && (
                    <span className="history__meta" role="alert" title={info.errorMessage ?? undefined}>
                        {t('tools.lookupFailed', { reason: t(lookupReasonKey(info.error)) })}
                    </span>
                )}
                {info !== null && info.unfit.length > 0 && info.updatable && (
                    <span className="history__meta" role="alert">
                        {t('tools.patchesPartial', {
                            changes: info.unfit
                                .map((change) => {
                                    return t(PATCH_KEYS[change] ?? 'tools.patch.debugReferer');
                                })
                                .join(', ')
                        })}
                    </span>
                )}
                {download !== undefined && (
                    <>
                        <div className="progress" role="progressbar" aria-label={t('tools.updateDownloading', { percent: Math.round(download.percent) })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(download.percent)}>
                            <div className="progress__bar progress__bar--smooth" style={{ width: `${String(download.percent)}%` }} />
                        </div>
                        {download.status === 'error' && download.error ? (
                            <span className="field__warning" role="alert" title={download.error.message}>
                                {t(programErrorKey(download.error.code))}
                            </span>
                        ) : (
                            <span className="history__meta">{t('tools.updateDownloading', { percent: Math.round(download.percent) })}</span>
                        )}
                    </>
                )}
                {result && (
                    <span className={`history__meta${result.ok ? '' : ' field__warning'}`} role={result.ok ? undefined : 'alert'} title={result.ok ? undefined : result.message}>
                        {resultText(result, t)}
                    </span>
                )}
            </div>
            <span className="anime__actions">
                {!program.custom && state.status === 'error' && state.error?.code !== 'UNSUPPORTED_PLATFORM' && (
                    <button
                        type="button"
                        className="btn btn--small btn--primary"
                        disabled={busy}
                        onClick={() => {
                            void retry(program.id);
                        }}
                    >
                        {working === 'retrying' ? t('tools.status.missing') : t('tools.retry')}
                    </button>
                )}
                {notRunning && (
                    <button
                        type="button"
                        className="btn btn--small btn--primary"
                        disabled={busy}
                        onClick={() => {
                            void reinstall(program.id);
                        }}
                    >
                        {working === 'reinstalling' ? t('tools.reinstalling') : t('tools.reinstall')}
                    </button>
                )}
                {info?.updatable && !program.custom && (
                    <button
                        type="button"
                        className="btn btn--small btn--primary"
                        disabled={busy}
                        aria-label={`${name}: ${updateLabel}`}
                        onClick={() => {
                            void update(program.id);
                        }}
                    >
                        {updateLabel}
                    </button>
                )}
                {info?.chosen && !program.custom && (
                    <ConfirmButton
                        className="btn btn--small"
                        disabled={busy}
                        ariaLabel={`${name}: ${resetLabel}`}
                        dialog={{ title: t('confirm.programReset.title', { name }), message: t('confirm.programReset.message'), confirmLabel: t('tools.reset'), cancelLabel: t('confirm.back') }}
                        onConfirm={() => {
                            void reset(program.id);
                        }}
                    >
                        {resetLabel}
                    </ConfirmButton>
                )}
                <span className={badge.className}>{t(badge.key)}</span>
            </span>
        </li>
    );
}

interface ProgramsStatusBlockProps {
    place: ProgramPlace;
}

// The status of the programs that belong to a place in the settings (ffmpeg in the settings of the app, yt-dlp and deno in the ones of the video
// downloader, ani-cli with busybox and curl in the ones of the anime): whether each is installed, its version, the latest one, and the buttons that
// try again, install again, update, or go back to the version the app was made with.
export function ProgramsStatusBlock({ place }: ProgramsStatusBlockProps) {
    const t = useTranslator();
    const status = useProgramsStore((state) => {
        return state.status;
    });
    const versions = useProgramsStore((state) => {
        return state.versions;
    });
    const checking = useProgramsStore((state) => {
        return state.checking;
    });
    const results = useProgramsStore((state) => {
        return state.results;
    });
    const check = useProgramsStore((state) => {
        return state.check;
    });
    const binaries = useAppStore((state) => {
        return state.binaries;
    });
    const settings = useAppStore((state) => {
        return state.settings;
    });
    const aniCli = useAnimeStore((state) => {
        return state.status.aniCli;
    });
    if (status === null) {
        return null;
    }
    if (!status.supported) {
        return (
            <fieldset className="panel" aria-label={t('tools.block.title')} data-testid={`programs-block-${place}`}>
                <legend>{t('tools.block.title')}</legend>
                <p className="field__hint">{t('tools.unsupported')}</p>
            </fieldset>
        );
    }
    const programs = PLACE_PROGRAMS[place]
        .map((id) => {
            return status.programs.find((program) => {
                return program.id === id;
            });
        })
        .filter((program): program is ProgramInfo => {
            return program !== undefined;
        });
    // What each program says of itself, when it is run to find out (yt-dlp and ffmpeg) or read (ani-cli).
    const probe = (id: ProgramId): { version: string | null; runs: boolean | null; customPath: string } => {
        switch (id) {
            case 'ytdlp':
                return { version: binaries?.ytdlp.version ?? null, runs: binaries === null ? null : binaries.ytdlp.found, customPath: settings.ytdlpPath };
            case 'deno':
                return { version: programs.find((program) => {
                    return program.id === 'deno';
                })?.state.version ?? null, runs: null, customPath: settings.ytdlpPath };
            case 'ffmpeg':
                return { version: binaries?.ffmpeg.version ?? null, runs: binaries === null ? null : binaries.ffmpeg.found, customPath: settings.ffmpegPath };
            case 'anicli':
                return { version: aniCli?.version ?? null, runs: aniCli === null ? null : aniCli.found, customPath: aniCli?.path ?? '' };
            default:
                return {
                    version: programs.find((program) => {
                        return program.id === id;
                    })?.state.version ?? null,
                    runs: null,
                    customPath: ''
                };
        }
    };
    return (
        <fieldset className="panel" aria-label={t('tools.block.title')} data-testid={`programs-block-${place}`}>
            <legend>{t('tools.block.title')}</legend>
            <ul className="history__list">
                {programs.map((program) => {
                    const seen = probe(program.id);
                    return <ProgramRow key={program.id} program={program} version={seen.version} runs={seen.runs} customPath={seen.customPath} info={versions?.[program.id] ?? null} result={results[program.id] ?? null} />;
                })}
            </ul>
            <div className="field-row">
                <button
                    type="button"
                    className="btn btn--small"
                    disabled={checking}
                    onClick={() => {
                        void check();
                    }}
                >
                    {checking ? t('tools.checking') : t('tools.check')}
                </button>
            </div>
            <p className="field__hint">{t(HINTS[place])}</p>
        </fieldset>
    );
}
