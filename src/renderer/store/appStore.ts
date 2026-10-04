import { create } from 'zustand';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { createTranslator, type MessageKey, type MessageParams } from '@shared/i18n';
import { resolveAppLanguage } from '../i18n/language';
import type {
    AddJobResult,
    AppUpdateState,
    BinariesStatus,
    DetectedBrowser,
    DownloadJob,
    HistoryEntry,
    LinkRequest,
    Settings,
    StreamCandidate,
    StreamFindStage,
    TraySupport
} from '@shared/types';

export type Tab = 'downloads' | 'anime' | 'settings';
// The screens of the video downloader: the queue with the field for links, what was downloaded, and its settings.
export type DownloadsView = 'queue' | 'history' | 'settings';
export type NoticeKind = 'error' | 'info';

export interface Notice {
    kind: NoticeKind;
    message: string;
}

// A short notice that is stacked with the others and goes away by itself (see Toast): a download that is complete.
export interface ToastItem {
    id: number;
    message: string;
}

export interface StreamSearchState {
    status: 'searching' | 'done';
    stage: StreamFindStage;
    candidates: StreamCandidate[];
    message: string | null;
    usedBrowser: boolean;
}

export const INITIAL_APP_UPDATE: AppUpdateState = { status: 'idle', currentVersion: '', version: null, percent: 0, message: null };

export interface AppState {
    tab: Tab;
    downloadsView: DownloadsView;
    jobs: DownloadJob[];
    history: HistoryEntry[];
    settings: Settings;
    binaries: BinariesStatus | null;
    notice: Notice | null;
    // The notices that are on the screen together, the newest on top of the others; each one goes away by itself.
    toasts: ToastItem[];
    updating: boolean;
    appUpdate: AppUpdateState;
    traySupport: TraySupport | null;
    browsers: DetectedBrowser[] | null;
    streamSearches: Record<string, StreamSearchState>;
    setTab: (tab: Tab) => void;
    setDownloadsView: (view: DownloadsView) => void;
    // Shows a notice (it takes the place of the one on the screen); null takes it away.
    setNotice: (notice: Notice | null) => void;
    // Adds a notice to the stack of the ones that go away by themselves, and says which one it is.
    pushToast: (message: string) => number;
    dismissToast: (id: number) => void;
    init: () => Promise<() => void>;
    addUrls: (links: LinkRequest[]) => Promise<AddJobResult[]>;
    cancelJob: (id: string) => Promise<void>;
    pauseJob: (id: string) => Promise<void>;
    resumeJob: (id: string) => Promise<void>;
    stopJob: (id: string) => Promise<void>;
    retryJob: (id: string) => Promise<void>;
    removeJob: (id: string) => Promise<void>;
    clearPartialFiles: (id: string) => Promise<void>;
    clearFinished: () => Promise<void>;
    refreshHistory: () => Promise<void>;
    clearHistory: () => Promise<void>;
    saveSettings: (settings: Settings) => Promise<Settings>;
    refreshBinaries: () => Promise<void>;
    updateYtdlp: () => Promise<void>;
    // Goes back to the yt-dlp that ships with the app.
    resetYtdlp: () => Promise<void>;
    chooseDirectory: () => Promise<string | null>;
    checkAppUpdate: () => Promise<void>;
    downloadAppUpdate: () => Promise<void>;
    installAppUpdate: () => Promise<void>;
    refreshTraySupport: () => Promise<void>;
    loadBrowsers: (refresh?: boolean) => Promise<void>;
    findStreams: (jobId: string, deep: boolean) => Promise<void>;
    cancelStreamSearch: (jobId: string) => Promise<void>;
    downloadStream: (jobId: string, candidateId: string) => Promise<void>;
    closeStreamSearch: (jobId: string) => void;
}

// Messages the store creates itself (not reactive): they use the language that is saved when they are created.
function translateNow(settings: Settings, key: MessageKey, params?: MessageParams): string {
    return createTranslator(resolveAppLanguage(settings.language))(key, params);
}

// The folder and the options are only passed when the link has them.
function addRequest(link: LinkRequest): Promise<AddJobResult> {
    if (Object.keys(link.options).length > 0) {
        return window.api.addDownload(link.url, link.downloadDir ?? '', link.options);
    }
    return link.downloadDir ? window.api.addDownload(link.url, link.downloadDir) : window.api.addDownload(link.url);
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
    return Object.fromEntries(
        Object.entries(record).filter(([entryKey]) => {
            return entryKey !== key;
        })
    );
}

export function upsertJob(jobs: DownloadJob[], job: DownloadJob): DownloadJob[] {
    const exists = jobs.some((candidate) => {
        return candidate.id === job.id;
    });
    if (!exists) {
        return [...jobs, job];
    }
    return jobs.map((candidate) => {
        return candidate.id === job.id ? job : candidate;
    });
}

// What the next notice of the stack is called.
let toastCounter = 0;

export const useAppStore = create<AppState>((set, get) => {
    return {
        tab: 'downloads',
        downloadsView: 'queue',
        jobs: [],
        history: [],
        settings: DEFAULT_SETTINGS,
        binaries: null,
        notice: null,
        toasts: [],
        updating: false,
        appUpdate: INITIAL_APP_UPDATE,
        traySupport: null,
        browsers: null,
        streamSearches: {},

        setTab: (tab) => {
            set({ tab });
        },

        setDownloadsView: (downloadsView) => {
            set({ downloadsView });
        },

        setNotice: (notice) => {
            set({ notice });
        },

        pushToast: (message) => {
            toastCounter += 1;
            const id = toastCounter;
            set((state) => {
                return { toasts: [...state.toasts, { id, message }] };
            });
            return id;
        },

        dismissToast: (id) => {
            set((state) => {
                return {
                    toasts: state.toasts.filter((toast) => {
                        return toast.id !== id;
                    })
                };
            });
        },

        init: async () => {
            const api = window.api;
            const [settings, jobs, history, binaries, appUpdate] = await Promise.all([
                api.getSettings(),
                api.listJobs(),
                api.listHistory(),
                api.checkBinaries(),
                api.getAppUpdateState()
            ]);
            // The app opens on the tab the settings say (the anime one is left for the downloads when the section does not exist).
            set({ settings, jobs, history, binaries, appUpdate, tab: settings.startTab });
            const unsubscribers = [
                api.onJobUpdate((job) => {
                    const finishedNow = job.status === 'done' && get().jobs.find((candidate) => {
                        return candidate.id === job.id;
                    })?.status !== 'done';
                    set((state) => {
                        return { jobs: upsertJob(state.jobs, job) };
                    });
                    if (finishedNow) {
                        // A download that is complete says so for a few seconds and leaves the queue (it stays in the history).
                        get().pushToast(translateNow(get().settings, 'notice.downloadDone', { title: job.title ?? job.url }));
                        void get().removeJob(job.id);
                    }
                }),
                api.onJobRemoved((id) => {
                    set((state) => {
                        return {
                            jobs: state.jobs.filter((job) => {
                                return job.id !== id;
                            }),
                            streamSearches: withoutKey(state.streamSearches, id)
                        };
                    });
                }),
                api.onStreamFindProgress((progress) => {
                    set((state) => {
                        const search = state.streamSearches[progress.jobId];
                        if (search?.status !== 'searching') {
                            return state;
                        }
                        return { streamSearches: { ...state.streamSearches, [progress.jobId]: { ...search, stage: progress.stage } } };
                    });
                }),
                api.onHistoryChanged(() => {
                    void get().refreshHistory();
                }),
                api.onAppUpdateState((appUpdate) => {
                    set({ appUpdate });
                })
            ];
            return (): void => {
                unsubscribers.forEach((unsubscribe) => {
                    unsubscribe();
                });
            };
        },

        addUrls: (links) => {
            return Promise.all(
                links.map((link) => {
                    return addRequest(link);
                })
            );
        },

        cancelJob: async (id) => {
            await window.api.cancelJob(id);
        },

        pauseJob: async (id) => {
            await window.api.pauseJob(id);
        },

        resumeJob: async (id) => {
            await window.api.resumeJob(id);
        },

        stopJob: async (id) => {
            await window.api.stopJob(id);
        },

        retryJob: async (id) => {
            await window.api.retryJob(id);
        },

        removeJob: async (id) => {
            await window.api.removeJob(id);
        },

        clearPartialFiles: async (id) => {
            await window.api.clearPartialFiles(id);
        },

        clearFinished: async () => {
            await window.api.clearFinished();
        },

        refreshHistory: async () => {
            set({ history: await window.api.listHistory() });
        },

        clearHistory: async () => {
            await window.api.clearHistory();
            set({ history: [] });
        },

        saveSettings: async (settings) => {
            const previous = get().settings;
            const saved = await window.api.saveSettings(settings);
            set({ settings: saved });
            if (saved.ytdlpPath !== previous.ytdlpPath || saved.ffmpegPath !== previous.ffmpegPath) {
                await get().refreshBinaries();
            }
            return saved;
        },

        refreshBinaries: async () => {
            set({ binaries: await window.api.checkBinaries() });
        },

        updateYtdlp: async () => {
            set({ updating: true });
            const result = await window.api.updateYtdlp();
            set({
                updating: false,
                notice: { kind: result.ok ? 'info' : 'error', message: result.output || translateNow(get().settings, result.ok ? 'notice.ytdlpUpToDate' : 'notice.updateFailed') }
            });
            await get().refreshBinaries();
        },

        resetYtdlp: async () => {
            set({ updating: true });
            const result = await window.api.resetYtdlp();
            set({
                updating: false,
                notice: { kind: result.ok ? 'info' : 'error', message: result.output || translateNow(get().settings, 'notice.updateFailed') }
            });
            await get().refreshBinaries();
        },

        chooseDirectory: () => {
            return window.api.chooseDirectory();
        },

        checkAppUpdate: async () => {
            await window.api.checkAppUpdate();
        },

        downloadAppUpdate: async () => {
            await window.api.downloadAppUpdate();
        },

        installAppUpdate: async () => {
            await window.api.installAppUpdate();
        },

        refreshTraySupport: async () => {
            set({ traySupport: await window.api.getTraySupport() });
        },

        loadBrowsers: async (refresh = false) => {
            set({ browsers: await window.api.listBrowsers(refresh) });
        },

        findStreams: async (jobId, deep) => {
            set((state) => {
                return {
                    streamSearches: {
                        ...state.streamSearches,
                        [jobId]: { status: 'searching', stage: 'scanning', candidates: [], message: null, usedBrowser: false }
                    }
                };
            });
            const result = await window.api.findStreams(jobId, deep);
            set((state) => {
                if (!state.streamSearches[jobId]) {
                    return state;
                }
                return {
                    streamSearches: {
                        ...state.streamSearches,
                        [jobId]: {
                            status: 'done',
                            stage: state.streamSearches[jobId]?.stage ?? 'scanning',
                            candidates: result.candidates,
                            message: result.message,
                            usedBrowser: result.usedBrowser
                        }
                    }
                };
            });
        },

        cancelStreamSearch: async (jobId) => {
            await window.api.cancelStreamFind(jobId);
        },

        downloadStream: async (jobId, candidateId) => {
            const result = await window.api.downloadStream(candidateId);
            if (!result.ok) {
                set({ notice: { kind: 'error', message: result.message ?? translateNow(get().settings, 'url.addFailed') } });
                return;
            }
            get().closeStreamSearch(jobId);
        },

        closeStreamSearch: (jobId) => {
            void window.api.cancelStreamFind(jobId);
            set((state) => {
                return { streamSearches: withoutKey(state.streamSearches, jobId) };
            });
        }
    };
});
