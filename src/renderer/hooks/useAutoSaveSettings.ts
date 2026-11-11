import { useCallback, useEffect, useRef, useState } from 'react';
import type { Settings } from '@shared/types';

export const AUTOSAVE_DELAY_MS = 2000;

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export interface AutoSaveSettings {
    draft: Settings;
    status: SaveStatus;
    change: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
    edit: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
    changeMany: (patch: Partial<Settings>) => void;
    // Puts in the draft what the main process saved by itself, without saving it again.
    sync: (patch: Partial<Settings>) => void;
}

export function useAutoSaveSettings(stored: Settings, save: (settings: Settings) => Promise<Settings>): AutoSaveSettings {
    const [draft, setDraft] = useState<Settings>(stored);
    const [status, setStatus] = useState<SaveStatus>('idle');
    const latest = useRef<Settings>(stored);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const cancelTimer = useCallback((): void => {
        if (timer.current !== null) {
            clearTimeout(timer.current);
            timer.current = null;
        }
    }, []);

    const flush = useCallback(async (): Promise<void> => {
        cancelTimer();
        const payload = latest.current;
        setStatus('saving');
        try {
            const saved = await save(payload);
            if (latest.current === payload) {
                latest.current = saved;
                setDraft(saved);
            }
            setStatus(timer.current === null ? 'saved' : 'pending');
        } catch {
            setStatus('error');
        }
    }, [cancelTimer, save]);

    const applyMany = useCallback((patch: Partial<Settings>): void => {
        const next = { ...latest.current, ...patch };
        latest.current = next;
        setDraft(next);
    }, []);

    const apply = useCallback(
        <K extends keyof Settings>(key: K, value: Settings[K]): void => {
            applyMany({ [key]: value });
        },
        [applyMany]
    );

    const change = useCallback(
        <K extends keyof Settings>(key: K, value: Settings[K]): void => {
            apply(key, value);
            void flush();
        },
        [apply, flush]
    );

    const changeMany = useCallback(
        (patch: Partial<Settings>): void => {
            applyMany(patch);
            void flush();
        },
        [applyMany, flush]
    );

    const edit = useCallback(
        <K extends keyof Settings>(key: K, value: Settings[K]): void => {
            apply(key, value);
            cancelTimer();
            setStatus('pending');
            timer.current = setTimeout(() => {
                void flush();
            }, AUTOSAVE_DELAY_MS);
        },
        [apply, cancelTimer, flush]
    );

    useEffect(() => {
        return () => {
            if (timer.current !== null) {
                void flush();
            }
        };
    }, [flush]);

    return { draft, status, change, edit, changeMany, sync: applyMany };
}
