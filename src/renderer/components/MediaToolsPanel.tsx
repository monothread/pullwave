import { useEffect } from 'react';
import type { MessageKey } from '@shared/i18n';
import { useTranslator } from '../i18n/useTranslator';
import { useAppStore, type ToolsMode } from '../store/appStore';
import { useConvertStore } from '../store/convertStore';
import { useCutStore } from '../store/cutStore';
import { useMergeStore } from '../store/mergeStore';
import { ConvertPanel } from './ConvertPanel';
import { CutPanel } from './CutPanel';
import { MergePanel } from './MergePanel';

const MODES: ReadonlyArray<{ id: ToolsMode; label: MessageKey }> = [
    { id: 'cut', label: 'tools.mode.cut' },
    { id: 'convert', label: 'tools.mode.convert' },
    { id: 'merge', label: 'tools.mode.merge' }
];

export function MediaToolsPanel() {
    const t = useTranslator();
    const mode = useAppStore((state) => {
        return state.toolsMode;
    });
    const setMode = useAppStore((state) => {
        return state.setToolsMode;
    });
    const cutRunning = useCutStore((state) => {
        return state.run?.status === 'running';
    });
    const convertRunning = useConvertStore((state) => {
        return state.run?.status === 'running';
    });
    const mergeRunning = useMergeStore((state) => {
        return state.run?.status === 'running';
    });
    const initCut = useCutStore((state) => {
        return state.init;
    });
    const initConvert = useConvertStore((state) => {
        return state.init;
    });
    const initMerge = useMergeStore((state) => {
        return state.init;
    });

    useEffect(() => {
        const stops: Array<() => void> = [];
        let stopped = false;
        const startSubscription = (subscribe: () => Promise<() => void>): void => {
            void subscribe().then((stop) => {
                if (stopped) {
                    stop();
                    return;
                }
                stops.push(stop);
            });
        };
        startSubscription(initCut);
        startSubscription(initConvert);
        startSubscription(initMerge);
        return () => {
            stopped = true;
            stops.forEach((stop) => {
                stop();
            });
        };
    }, [initCut, initConvert, initMerge]);

    const runningByMode: Record<ToolsMode, boolean> = {
        cut: cutRunning,
        convert: convertRunning,
        merge: mergeRunning
    };

    return (
        <div className="tools" aria-label={t('tools.aria')}>
            <div className="tools__modes" role="tablist" aria-label={t('tools.mode.aria')}>
                {MODES.map((item) => {
                    const active = mode === item.id;
                    const busy = runningByMode[item.id];
                    return (
                        <button
                            key={item.id}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            className={`btn btn--small tools__mode${active ? ' btn--primary tools__mode--active' : ''}`}
                            onClick={() => {
                                setMode(item.id);
                            }}
                        >
                            <span>{t(item.label)}</span>
                            {busy && <span className="tools__mode-dot" aria-label={t('tools.mode.running')} title={t('tools.mode.running')} />}
                        </button>
                    );
                })}
            </div>
            {mode === 'cut' && <CutPanel skipInit />}
            {mode === 'convert' && <ConvertPanel skipInit />}
            {mode === 'merge' && <MergePanel skipInit />}
        </div>
    );
}
