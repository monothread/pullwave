import type { BinaryInfo } from '@shared/types';
import type { ProgramInfo } from '@shared/programs';
import type { ProgramId } from '@shared/tools';
import type { Translator } from '@shared/i18n/core';
import { useTranslator } from '../i18n/useTranslator';
import { useAnimeStore } from '../store/animeStore';
import { useAppStore } from '../store/appStore';
import { useProgramsStore } from '../store/programsStore';
import { isWorking } from './programText';

// What the chip of one program says, its colour and what it shows on hover.
interface ProgramChip {
    id: ProgramId;
    text: string;
    tone: 'bad' | 'pending';
    title: string | null;
}

// The program the chip is about: its id, its name and how the app found it.
interface ProgramChipSource {
    id: ProgramId;
    label: string;
    info: BinaryInfo | undefined;
}

// From this many chips on, a window narrower than 1280 pixels shows one chip that sums them up (see .binary-status__summary): three of them
// with the clock do not fit on the line of the top bar there.
export const SUMMARY_FROM = 2;

// A program the app downloads is shown by how its download goes (a percentage, WAITING, FAILED with the reason on hover) until it is there; once
// it is installed and runs the chip goes away (its version is in the settings). It stays for a program that does not run (MISSING).
export function programChipOf(source: ProgramChipSource, program: ProgramInfo | null, t: Translator): ProgramChip | null {
    const { id, label, info } = source;
    const state = program !== null && !program.custom ? program.state : null;
    if (state !== null && state.status === 'error') {
        return { id, text: `${label} ${t('tools.chip.failed')}`, tone: 'bad', title: state.error?.message ?? '' };
    }
    if (state !== null && isWorking(state)) {
        return { id, text: `${label} ${String(Math.round(state.percent))}%`, tone: 'pending', title: null };
    }
    if (state !== null && state.status === 'missing') {
        return { id, text: `${label} ${t('tools.chip.waiting')}`, tone: 'pending', title: null };
    }
    // Not probed yet, or installed and running: nothing to say.
    if (!info || info.found) {
        return null;
    }
    return { id, text: `${label} ${t('binary.missing')}`, tone: 'bad', title: info.path };
}

// What the summary shows on hover: one line for each program, with the reason or the place after a dash when there is one.
export function summaryTitleOf(chips: ProgramChip[]): string {
    return chips
        .map((chip) => {
            return chip.title === null || chip.title === '' ? chip.text : `${chip.text} — ${chip.title}`;
        })
        .join('\n');
}

// The summary is red when one of the programs failed or is missing, grey while they only wait or download.
export function summaryToneOf(chips: ProgramChip[]): ProgramChip['tone'] {
    return chips.some((chip) => {
        return chip.tone === 'bad';
    })
        ? 'bad'
        : 'pending';
}

function useProgramChips(t: Translator): ProgramChip[] {
    const binaries = useAppStore((state) => {
        return state.binaries;
    });
    // ani-cli only exists where the anime section does.
    const aniCli = useAnimeStore((state) => {
        return state.status.aniCli;
    });
    const programs = useProgramsStore((state) => {
        return state.status?.programs ?? null;
    });
    const sources: ProgramChipSource[] = [
        { id: 'ytdlp', label: 'yt-dlp', info: binaries?.ytdlp },
        { id: 'ffmpeg', label: 'ffmpeg', info: binaries?.ffmpeg }
    ];
    if (aniCli) {
        sources.push({ id: 'anicli', label: 'ani-cli', info: aniCli });
    }
    return sources
        .map((source) => {
            const program =
                programs?.find((item) => {
                    return item.id === source.id;
                }) ?? null;
            return programChipOf(source, program, t);
        })
        .filter((chip): chip is ProgramChip => {
            return chip !== null;
        });
}

export function BinaryStatus() {
    const t = useTranslator();
    const chips = useProgramChips(t);
    return (
        <div className="binary-status">
            {chips.length >= SUMMARY_FROM && (
                <span className={`chip chip--${summaryToneOf(chips)} binary-status__summary`} title={summaryTitleOf(chips)}>
                    {t('tools.chip.summary', { count: chips.length })}
                </span>
            )}
            {chips.map((chip) => {
                return (
                    <span key={chip.id} className={`chip chip--${chip.tone} binary-status__detail`} title={chip.title ?? undefined}>
                        {chip.text}
                    </span>
                );
            })}
        </div>
    );
}
