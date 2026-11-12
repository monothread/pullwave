// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { AnimeJobs } from '@renderer/components/AnimeJobs';
import { MangaJobs } from '@renderer/components/MangaJobs';
import { QueueList } from '@renderer/components/QueueList';
import { useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { animeStatusKey } from '@renderer/components/animeText';
import { statusLabel } from '@renderer/components/jobStatus';
import { jobStatusKey } from '@renderer/components/mangaText';
import { makeAnimeJob } from '../../helpers/animeFixtures';
import { answerDialog } from '../../helpers/confirmDialog';
import { makeMangaJob } from '../../helpers/mangaFixtures';
import { installMockApi, makeJob, type MockApiHandle } from '../../helpers/mockApi';

// Each row asks for the text of its status once per drawing: counting those asks tells which rows were drawn again.
vi.mock('@renderer/components/jobStatus', async (importOriginal) => {
    const original = await importOriginal<typeof import('@renderer/components/jobStatus')>();
    return { ...original, statusLabel: vi.fn(original.statusLabel) };
});
vi.mock('@renderer/components/animeText', async (importOriginal) => {
    const original = await importOriginal<typeof import('@renderer/components/animeText')>();
    return { ...original, animeStatusKey: vi.fn(original.animeStatusKey) };
});
vi.mock('@renderer/components/mangaText', async (importOriginal) => {
    const original = await importOriginal<typeof import('@renderer/components/mangaText')>();
    return { ...original, jobStatusKey: vi.fn(original.jobStatusKey) };
});

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialAnime = useAnimeStore.getState();
const initialManga = useMangaStore.getState();

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS, jobs: [] });
    useAnimeStore.setState({ ...initialAnime, jobs: [], queueHeld: false });
    useMangaStore.setState({ ...initialManga, jobs: [], queueHeld: false });
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('the cards of the video queue', () => {
    it('draws again only the card whose download changed', () => {
        useAppStore.setState({ jobs: [makeJob({ id: 'a', status: 'running', percent: 10 }), makeJob({ id: 'b', status: 'queued', percent: 0 })] });
        render(<QueueList />);
        vi.mocked(statusLabel).mockClear();
        act(() => {
            useAppStore.setState((state) => {
                return { jobs: [{ ...state.jobs[0]!, percent: 60 }, state.jobs[1]!] };
            });
        });
        expect(vi.mocked(statusLabel).mock.calls.map((call) => {
            return [call[0], call[1]];
        })).toEqual([['running', false]]);
    });

    it('uses the actions of the store as it is when they are used', async () => {
        const user = userEvent.setup();
        const cancelJob = vi.fn(() => {
            return Promise.resolve();
        });
        useAppStore.setState({ jobs: [makeJob({ id: 'a', status: 'running' })] });
        render(<QueueList />);
        useAppStore.setState({ cancelJob });
        await user.click(screen.getByRole('button', { name: 'CANCEL' }));
        await answerDialog(user, 'Cancel this download?', 'CANCEL');
        expect(cancelJob).toHaveBeenCalledWith('a');
        expect(mock.api.cancelJob).not.toHaveBeenCalled();
    });
});

describe('the rows of the anime queue', () => {
    it('draws again only the row whose download changed', () => {
        useAnimeStore.setState({ jobs: [makeAnimeJob({ episodeId: 1, status: 'running', percent: 10 }), makeAnimeJob({ episodeId: 2, status: 'paused', percent: 30 })] });
        render(<AnimeJobs />);
        vi.mocked(animeStatusKey).mockClear();
        act(() => {
            useAnimeStore.setState((state) => {
                return { jobs: [state.jobs[0]!, { ...state.jobs[1]!, percent: 40 }] };
            });
        });
        expect(vi.mocked(animeStatusKey).mock.calls).toEqual([['paused']]);
    });

    it('uses the actions of the store as it is when they are used', async () => {
        const user = userEvent.setup();
        const pauseJob = vi.fn(() => {
            return Promise.resolve();
        });
        useAnimeStore.setState({ jobs: [makeAnimeJob({ episodeId: 7, status: 'running' })] });
        render(<AnimeJobs />);
        useAnimeStore.setState({ pauseJob });
        await user.click(within(screen.getByTestId('anime-job')).getByRole('button', { name: 'PAUSE' }));
        expect(pauseJob).toHaveBeenCalledWith(7);
    });
});

describe('the rows of the manga queue', () => {
    it('draws again only the row whose download changed', () => {
        useMangaStore.setState({ jobs: [makeMangaJob({ chapterId: 1, status: 'running', percent: 10 }), makeMangaJob({ chapterId: 2, status: 'queued', percent: 0 })] });
        render(<MangaJobs />);
        vi.mocked(jobStatusKey).mockClear();
        act(() => {
            useMangaStore.setState((state) => {
                return { jobs: [{ ...state.jobs[0]!, percent: 55, pagesDone: 11 }, state.jobs[1]!] };
            });
        });
        expect(vi.mocked(jobStatusKey).mock.calls).toEqual([['running']]);
    });

    it('uses the actions of the store as it is when they are used', async () => {
        const user = userEvent.setup();
        const resumeJob = vi.fn(() => {
            return Promise.resolve();
        });
        useMangaStore.setState({ jobs: [makeMangaJob({ chapterId: 9, status: 'paused' })] });
        render(<MangaJobs />);
        useMangaStore.setState({ resumeJob });
        await user.click(within(screen.getByTestId('manga-job')).getByRole('button', { name: 'RESUME' }));
        expect(resumeJob).toHaveBeenCalledWith(9);
    });
});
