import { create } from 'zustand';
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { MessageKey, MessageParams } from '@shared/i18n/core';
import { createTranslator, loadCatalog } from '../i18n/catalogs';
import type { LlmStatus } from '@shared/llm';
import { useFxStore } from '../fx/fxStore';
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
    TraySupport
} from '@shared/types';

// The home screen opens first: it gathers what is going on in every section (D-127).
export type Tab = 'home' | 'downloads' | 'anime' | 'manga' | 'settings';
// The screens of the video downloader: the queue with the field for links, what was downloaded, and its settings.
export type DownloadsView = 'queue' | 'cut' | 'history' | 'settings';
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

export const INITIAL_APP_UPDATE: AppUpdateState = { status: 'idle', currentVersion: '', version: null, percent: 0, message: null };
// What is known of the tokens of the language models before the main process is asked.
export const INITIAL_LLM_STATUS: LlmStatus = { canStore: true, providers: [] };

export interface AppState {
    tab: Tab;
    downloadsView: DownloadsView;
    jobs: DownloadJob[];
    history: HistoryEntry[];
    settings: Settings;
    // False until the settings have arrived from the main process; until then `settings` only holds the defaults.
    settingsLoaded: boolean;
    binaries: BinariesStatus | null;
    notice: Notice | null;
    // The notices that are on the screen together, the newest on top of the others; each one goes away by itself.
    toasts: ToastItem[];
    appUpdate: AppUpdateState;
    traySupport: TraySupport | null;
    browsers: DetectedBrowser[] | null;
    // Which slots (providers) have a token, and whether the system can keep one.
    llmStatus: LlmStatus;
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
    // Reads the settings again (the main process changed them by itself).
    refreshSettings: () => Promise<void>;
    refreshLlmStatus: () => Promise<void>;
    refreshBinaries: () => Promise<void>;
    chooseDirectory: () => Promise<string | null>;
    checkAppUpdate: () => Promise<void>;
    downloadAppUpdate: () => Promise<void>;
    installAppUpdate: () => Promise<void>;
    refreshTraySupport: () => Promise<void>;
    loadBrowsers: (refresh?: boolean) => Promise<void>;
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
        tab: 'home',
        downloadsView: 'queue',
        jobs: [],
        history: [],
        settings: DEFAULT_SETTINGS,
        settingsLoaded: false,
        binaries: null,
        notice: null,
        toasts: [],
        appUpdate: INITIAL_APP_UPDATE,
        traySupport: null,
        browsers: null,
        llmStatus: INITIAL_LLM_STATUS,

        setTab: (tab) => {
            set({ tab });
        },

        setDownloadsView: (downloadsView) => {
            set({ downloadsView });
        },

        setNotice: (notice) => {
            set({ notice });
            if (notice?.kind === 'error') {
                useFxStore.getState().fail();
            }
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
            // The app opens on the home screen (the first state); a section chosen in the menu while the app was starting is kept.
            set({ settings, settingsLoaded: true, jobs, history, binaries, appUpdate });
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
                        useFxStore.getState().celebrate();
                        void get().removeJob(job.id);
                    }
                }),
                api.onJobRemoved((id) => {
                    set((state) => {
                        return {
                            jobs: state.jobs.filter((job) => {
                                return job.id !== id;
                            })
                        };
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
            // A new language is shown once its texts are there (and the messages the stores write from then on are in it).
            await loadCatalog(resolveAppLanguage(saved.language));
            set({ settings: saved });
            if (saved.ytdlpPath !== previous.ytdlpPath || saved.ffmpegPath !== previous.ffmpegPath) {
                await get().refreshBinaries();
            }
            return saved;
        },

        refreshSettings: async () => {
            set({ settings: await window.api.getSettings() });
        },

        refreshLlmStatus: async () => {
            set({ llmStatus: await window.api.getLlmStatus() });
        },

        refreshBinaries: async () => {
            set({ binaries: await window.api.checkBinaries() });
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
        }
    };
});
