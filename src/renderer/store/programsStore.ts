import { create } from 'zustand';
import type { MessageKey, MessageParams } from '@shared/i18n/core';
import { createTranslator } from '../i18n/catalogs';
import type { ProgramInfo, ProgramLookupReason, ProgramsStatus, ProgramVersions } from '@shared/programs';
import { PROGRAM_IDS, type ProgramId, type ToolState } from '@shared/tools';
import { resolveAppLanguage } from '../i18n/language';
import { useAnimeStore } from './animeStore';
import { useAppStore } from './appStore';

export type ProgramWork = 'retrying' | 'reinstalling' | 'updating' | 'resetting';

export interface ProgramResult {
    action: 'update' | 'reset';
    ok: boolean;
    reason: 'current' | 'busy' | 'custom' | 'unsupported' | 'lookup' | 'failed' | 'none' | null;
    lookup: ProgramLookupReason | null;
    version: string | null;
    message: string;
}

interface ProgramsState {
    status: ProgramsStatus | null;
    updates: Partial<Record<ProgramId, ToolState>>;
    versions: ProgramVersions | null;
    checking: boolean;
    working: Partial<Record<ProgramId, ProgramWork>>;
    results: Partial<Record<ProgramId, ProgramResult>>;
    init: () => Promise<() => void>;
    refresh: () => Promise<void>;
    retry: (id: ProgramId) => Promise<void>;
    reinstall: (id: ProgramId) => Promise<void>;
    check: () => Promise<void>;
    update: (id: ProgramId) => Promise<void>;
    reset: (id: ProgramId) => Promise<void>;
}

export const PROGRAM_NAMES: Record<ProgramId, string> = {
    ytdlp: 'yt-dlp',
    deno: 'deno',
    ffmpeg: 'ffmpeg',
    anicli: 'ani-cli',
    busybox: 'busybox',
    curl: 'curl'
};

function translateNow(key: MessageKey, params?: MessageParams): string {
    return createTranslator(resolveAppLanguage(useAppStore.getState().settings.language))(key, params);
}

function isProgramId(id: string): id is ProgramId {
    return (PROGRAM_IDS as readonly string[]).includes(id);
}

function patchState(status: ProgramsStatus | null, state: ToolState): ProgramsStatus | null {
    if (status === null) {
        return status;
    }
    return {
        ...status,
        programs: status.programs.map((program): ProgramInfo => {
            return program.id === state.id ? { ...program, state } : program;
        })
    };
}

function refreshDependents(): void {
    void useAppStore.getState().refreshBinaries();
    void useAnimeStore.getState().refreshStatus();
}

export const useProgramsStore = create<ProgramsState>((set, get) => {
    function patchWorking(id: ProgramId, work: ProgramWork | null): void {
        set((state) => {
            const working = { ...state.working };
            if (work === null) {
                delete working[id];
            } else {
                working[id] = work;
            }
            return { working };
        });
    }

    return {
        status: null,
        updates: {},
        versions: null,
        checking: false,
        working: {},
        results: {},

        init: async () => {
            const api = window.api.programs;
            set({ status: await api.status() });
            const unsubscribers = [
                api.onToolState((state) => {
                    if (!isProgramId(state.id)) {
                        return;
                    }
                    const id = state.id;
                    set((current) => {
                        return { status: patchState(current.status, state) };
                    });
                    if (state.status === 'ready') {
                        refreshDependents();
                    }
                    if (state.status === 'error') {
                        refreshDependents();
                        useAppStore.getState().pushToast(translateNow('tools.toast.failed', { name: PROGRAM_NAMES[id] }));
                    }
                }),
                api.onUpdateState((state) => {
                    if (!isProgramId(state.id)) {
                        return;
                    }
                    const id = state.id;
                    set((current) => {
                        const updates = { ...current.updates };
                        if (state.status === 'ready') {
                            delete updates[id];
                        } else {
                            updates[id] = state;
                        }
                        return { updates };
                    });
                })
            ];
            return (): void => {
                unsubscribers.forEach((unsubscribe) => {
                    unsubscribe();
                });
            };
        },

        refresh: async () => {
            set({ status: await window.api.programs.status() });
        },

        retry: async (id) => {
            patchWorking(id, 'retrying');
            try {
                await window.api.programs.install(id);
                await get().refresh();
            } finally {
                patchWorking(id, null);
            }
        },

        reinstall: async (id) => {
            patchWorking(id, 'reinstalling');
            try {
                await window.api.programs.reinstall(id);
                await get().refresh();
            } finally {
                patchWorking(id, null);
            }
        },

        check: async () => {
            set({ checking: true });
            try {
                set({ versions: await window.api.programs.check() });
            } finally {
                set({ checking: false });
            }
        },

        update: async (id) => {
            patchWorking(id, 'updating');
            set((state) => {
                const results = { ...state.results };
                delete results[id];
                return { results };
            });
            try {
                const answer = await window.api.programs.update(id);
                const result: ProgramResult = answer.ok
                    ? { action: 'update', ok: true, reason: null, lookup: null, version: answer.version, message: '' }
                    : { action: 'update', ok: false, reason: answer.reason, lookup: answer.lookup ?? null, version: null, message: answer.message };
                set((state) => {
                    return { results: { ...state.results, [id]: result } };
                });
                await get().refresh();
                if (answer.ok) {
                    refreshDependents();
                }
                if (get().versions !== null) {
                    await get().check();
                }
            } finally {
                patchWorking(id, null);
            }
        },

        reset: async (id) => {
            patchWorking(id, 'resetting');
            try {
                const answer = await window.api.programs.reset(id);
                const result: ProgramResult = answer.ok
                    ? { action: 'reset', ok: true, reason: null, lookup: null, version: null, message: '' }
                    : { action: 'reset', ok: false, reason: answer.reason, lookup: null, version: null, message: answer.message };
                set((state) => {
                    return { results: { ...state.results, [id]: result } };
                });
                await get().refresh();
                refreshDependents();
                if (get().versions !== null) {
                    await get().check();
                }
            } finally {
                patchWorking(id, null);
            }
        }
    };
});
