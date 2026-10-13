import type { BinaryInfo } from '@shared/types';
import type { ProgramId } from '@shared/tools';
import { useTranslator } from '../i18n/useTranslator';
import { useAnimeStore } from '../store/animeStore';
import { useAppStore } from '../store/appStore';
import { useProgramsStore } from '../store/programsStore';
import { isWorking } from './programText';

interface BinaryChipProps {
    id: ProgramId;
    label: string;
    info: BinaryInfo | undefined;
}

// A program the app downloads is shown by how its download goes (a percentage, WAITING, FAILED with the reason on hover) until it is there; once
// it is installed and runs the chip goes away (its version is in the settings). It stays for a program that does not run (MISSING).
function BinaryChip({ id, label, info }: BinaryChipProps) {
    const t = useTranslator();
    const program = useProgramsStore((state) => {
        return (
            state.status?.programs.find((item) => {
                return item.id === id;
            }) ?? null
        );
    });
    const state = program !== null && !program.custom ? program.state : null;
    if (state !== null && state.status === 'error') {
        return (
            <span className="chip chip--bad" title={state.error?.message ?? ''}>
                {label} {t('tools.chip.failed')}
            </span>
        );
    }
    if (state !== null && isWorking(state)) {
        return (
            <span className="chip chip--pending">
                {label} {Math.round(state.percent)}%
            </span>
        );
    }
    if (state !== null && state.status === 'missing') {
        return (
            <span className="chip chip--pending">
                {label} {t('tools.chip.waiting')}
            </span>
        );
    }
    // Not probed yet, or installed and running: nothing to say.
    if (!info || info.found) {
        return null;
    }
    return (
        <span className="chip chip--bad" title={info.path}>
            {label} {t('binary.missing')}
        </span>
    );
}

export function BinaryStatus() {
    const binaries = useAppStore((state) => {
        return state.binaries;
    });
    // ani-cli only exists where the anime section does.
    const aniCli = useAnimeStore((state) => {
        return state.status.aniCli;
    });
    return (
        <div className="binary-status">
            <BinaryChip id="ytdlp" label="yt-dlp" info={binaries?.ytdlp} />
            <BinaryChip id="ffmpeg" label="ffmpeg" info={binaries?.ffmpeg} />
            {aniCli && <BinaryChip id="anicli" label="ani-cli" info={aniCli} />}
        </div>
    );
}
