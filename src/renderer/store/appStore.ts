import { create } from 'zustand';
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { MessageKey, MessageParams } from '@shared/i18n/core';
import { createTranslator, loadCatalog } from '../i18n/catalogs';
import type { LlmStatus } from '@shared/llm';
import { useFxStore } from '../fx/fxStore';
import { resolveAppLanguage } from '../i18n/language';
import { createDoneLinger } from './doneLinger';
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

export type Tab = 'home' | 'downloads' | 'anime' | 'manga' | 'settings';
export type DownloadsView = 'queue' | 'history' | 'explorer' | 'cut' | 'convert' | 'settings';
export type NoticeKind = 'error' | 'info';

export interface Notice {
    kind: NoticeKind;
    message: string;
}

export interface ToastItem {
    id: number;
    message: string;
}

export const INITIAL_APP_UPDATE: AppUpdateState = { status: 'idle', currentVersion: '', version: null, percent: 0, message: null };
export const INITIAL_LLM_STATUS: LlmStatus = { canStore: true, providers: [] };

export interface AppState {
    tab: Tab;
    downloadsView: DownloadsView;
    jobs: DownloadJob[];
    history: HistoryEntry[];
    settings: Settings;
    settingsLoaded: boolean;
    binaries: BinariesStatus | null;
    notice: Notice | null;
    toasts: ToastItem[];
    appUpdate: AppUpdateState;
    traySupport: TraySupport | null;
    browsers: DetectedBrowser[] | null;
    llmStatus: LlmStatus;
    setTab: (tab: Tab) => void;
    setDownloadsView: (view: DownloadsView) => void;
    setNotice: (notice: Notice | null) => void;
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

const doneLinger = createDoneLinger<string>();

function translateNow(settings: Settings, key: MessageKey, params?: MessageParams): string {
    return createTranslator(resolveAppLanguage(settings.language))(key, params);
}

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
            set({ settings, settingsLoaded: true, jobs, history, binaries, appUpdate });
            const leaveQueue = (id: string): void => {
                void get().removeJob(id);
            };
            jobs.filter((job) => {
                return job.status === 'done';
            }).forEach((job) => {
                doneLinger.schedule(job.id, () => {
                    leaveQueue(job.id);
                });
            });
            const unsubscribers = [
                api.onJobUpdate((job) => {
                    const finishedNow = job.status === 'done' && get().jobs.find((candidate) => {
                        return candidate.id === job.id;
                    })?.status !== 'done';
                    if (job.status !== 'done') {
                        doneLinger.cancel(job.id);
                    }
                    set((state) => {
                        return { jobs: upsertJob(state.jobs, job) };
                    });
                    if (finishedNow) {
                        get().pushToast(translateNow(get().settings, 'notice.downloadDone', { title: job.title ?? job.url }));
                        useFxStore.getState().celebrate();
                        doneLinger.schedule(job.id, () => {
                            leaveQueue(job.id);
                        });
                    }
                }),
                api.onJobRemoved((id) => {
                    doneLinger.cancel(id);
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
