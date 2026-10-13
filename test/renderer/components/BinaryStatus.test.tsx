// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { BinaryStatus } from '@renderer/components/BinaryStatus';
import { UNSUPPORTED_STATUS, useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { ANI_CLI_INFO, makeStatus } from '../../helpers/animeFixtures';
import { useProgramsStore } from '@renderer/store/programsStore';
import { installMockApi, makeProgramInfo, makeProgramsStatus } from '../../helpers/mockApi';
import type { ProgramId, ToolState } from '@shared/tools';

const initial = useAppStore.getState();

beforeEach(() => {
    installMockApi();
    useAppStore.setState({ ...initial, binaries: null, notice: null });
    useAnimeStore.setState({ status: UNSUPPORTED_STATUS });
    useProgramsStore.setState({ status: null, updates: {}, versions: null, working: {}, results: {} });
});

describe('BinaryStatus', () => {
    const FOUND = {
        ytdlp: { found: true, path: '/data/tools/ytdlp/1/yt-dlp', version: '2026.08.19', source: 'installed' as const },
        ffmpeg: { found: true, path: '/data/tools/ffmpeg/b/bin/ffmpeg', version: '7.0', source: 'installed' as const }
    };

    function chips(): Array<string | null> {
        return Array.from(document.querySelectorAll('.chip')).map((chip) => {
            return chip.textContent;
        });
    }

    it('shows nothing before the programs are checked', () => {
        render(<BinaryStatus />);
        expect(chips()).toEqual([]);
        expect(document.querySelector('.binary-status')).toBeEmptyDOMElement();
    });

    it('shows nothing once the programs are installed and run', () => {
        useAppStore.setState({ binaries: FOUND });
        render(<BinaryStatus />);
        expect(chips()).toEqual([]);
    });

    it('shows nothing for programs the user chose, when they run', () => {
        useAppStore.setState({ binaries: { ytdlp: { ...FOUND.ytdlp, source: 'custom' }, ffmpeg: { ...FOUND.ffmpeg, source: 'custom' } } });
        render(<BinaryStatus />);
        expect(chips()).toEqual([]);
    });

    it('marks a program that does not run, with where it should be', () => {
        useAppStore.setState({
            binaries: {
                ytdlp: { found: false, path: '/data/tools/ytdlp/1/yt-dlp', version: null, source: 'installed' },
                ffmpeg: FOUND.ffmpeg
            }
        });
        render(<BinaryStatus />);
        expect(chips()).toEqual(['yt-dlp MISSING']);
        expect(screen.getByText('yt-dlp MISSING')).toHaveClass('chip--bad');
        expect(screen.getByText('yt-dlp MISSING')).toHaveAttribute('title', '/data/tools/ytdlp/1/yt-dlp');
    });

    it('has no button (the update of the programs is in the settings)', () => {
        render(<BinaryStatus />);
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    describe('ani-cli', () => {
        it('has no chip where the anime section does not exist', () => {
            useAppStore.setState({ binaries: FOUND });
            render(<BinaryStatus />);
            expect(screen.queryByText(/ani-cli/)).not.toBeInTheDocument();
        });

        it('has no chip while it is installed and runs', () => {
            useAppStore.setState({ binaries: FOUND });
            useAnimeStore.setState({ status: makeStatus() });
            render(<BinaryStatus />);
            expect(chips()).toEqual([]);
        });

        it('shows when it is missing', () => {
            useAnimeStore.setState({ status: makeStatus({ available: false, aniCli: { ...ANI_CLI_INFO, found: false, version: null } }) });
            render(<BinaryStatus />);
            expect(screen.getByText('ani-cli MISSING')).toHaveClass('chip--bad');
        });

        it('sits after yt-dlp and ffmpeg', () => {
            useAppStore.setState({
                binaries: {
                    ytdlp: { ...FOUND.ytdlp, found: false },
                    ffmpeg: { ...FOUND.ffmpeg, found: false }
                }
            });
            useAnimeStore.setState({ status: makeStatus({ aniCli: { ...ANI_CLI_INFO, found: false } }) });
            render(<BinaryStatus />);
            expect(chips()).toEqual(['yt-dlp MISSING', 'ffmpeg MISSING', 'ani-cli MISSING']);
        });
    });

    describe('programs being downloaded', () => {
        function setProgram(id: ProgramId, state: Partial<ToolState>, custom = false): void {
            const base = makeProgramsStatus();
            useProgramsStore.setState({
                status: {
                    ...base,
                    programs: base.programs.map((program) => {
                        return program.id === id ? makeProgramInfo(id, { custom, state: { ...program.state, ...state } }) : program;
                    })
                }
            });
        }

        it('shows the percentage while a program is downloaded', () => {
            setProgram('ytdlp', { status: 'downloading', percent: 42.4, version: null });
            render(<BinaryStatus />);
            expect(screen.getByText('yt-dlp 42%')).toHaveClass('chip--pending');
        });

        it('shows the percentage while a program is verified or unpacked', () => {
            setProgram('ytdlp', { status: 'verifying', percent: 90 });
            setProgram('ffmpeg', { status: 'extracting', percent: 95.6 });
            render(<BinaryStatus />);
            expect(screen.getByText('ffmpeg 96%')).toHaveClass('chip--pending');
        });

        it('says it is waiting when the download has not started', () => {
            setProgram('ffmpeg', { status: 'missing', percent: 0, version: null });
            render(<BinaryStatus />);
            expect(screen.getByText('ffmpeg WAITING')).toHaveClass('chip--pending');
        });

        it('says it failed, with the reason when the pointer is over it', () => {
            setProgram('ytdlp', { status: 'error', percent: 0, version: null, error: { code: 'DOWNLOAD_FAILED', message: 'getaddrinfo ENOTFOUND github.com' } });
            render(<BinaryStatus />);
            const chip = screen.getByText('yt-dlp FAILED');
            expect(chip).toHaveClass('chip--bad');
            expect(chip).toHaveAttribute('title', 'getaddrinfo ENOTFOUND github.com');
        });

        it('shows the download of ani-cli while the others wait', () => {
            useAnimeStore.setState({ status: makeStatus() });
            setProgram('anicli', { status: 'downloading', percent: 10 });
            render(<BinaryStatus />);
            expect(screen.getByText('ani-cli 10%')).toBeInTheDocument();
            expect(screen.queryByText('yt-dlp …')).not.toBeInTheDocument();
        });

        it('takes the chip away once the program is installed and runs', () => {
            useAppStore.setState({ binaries: { ytdlp: { found: true, path: '/t/yt-dlp', version: '2026.08.19', source: 'installed' }, ffmpeg: { found: true, path: '/t/ffmpeg', version: 'N-123-gabc', source: 'installed' } } });
            setProgram('ytdlp', { status: 'downloading', percent: 99 });
            const { rerender } = render(<BinaryStatus />);
            expect(screen.getByText('yt-dlp 99%')).toBeInTheDocument();
            setProgram('ytdlp', {});
            rerender(<BinaryStatus />);
            expect(document.querySelectorAll('.chip')).toHaveLength(0);
        });

        it('keeps the chip of a program that is installed but does not run', () => {
            useAppStore.setState({ binaries: { ytdlp: { found: false, path: '/t/yt-dlp', version: null, source: 'installed' }, ffmpeg: { found: true, path: '/t/ffmpeg', version: '7', source: 'installed' } } });
            setProgram('ytdlp', {});
            render(<BinaryStatus />);
            expect(screen.getByText('yt-dlp MISSING')).toHaveClass('chip--bad');
        });

        it('ignores the download of a program the user gave a path for', () => {
            setProgram('ytdlp', { status: 'error', percent: 0, error: { code: 'DOWNLOAD_FAILED', message: 'x' } }, true);
            useAppStore.setState({ binaries: { ytdlp: { found: true, path: '/opt/yt-dlp', version: '1', source: 'custom' }, ffmpeg: { found: true, path: '/t/ffmpeg', version: '7', source: 'installed' } } });
            render(<BinaryStatus />);
            expect(document.querySelectorAll('.chip')).toHaveLength(0);
            expect(screen.queryByText(/FAILED/)).not.toBeInTheDocument();
        });
    });
});
