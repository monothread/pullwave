// @vitest-environment jsdom
import { act, render, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { AnimeJob } from '@shared/anime';
import { AnimeManageDownloads, groupActiveAnimeJobs } from '@renderer/components/AnimeManageDownloads';
import { useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { makeAnimeJob } from '../../helpers/animeFixtures';
import { answerDialog, confirmDialog } from '../../helpers/confirmDialog';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialAnime = useAnimeStore.getState();

const NARUTO = { animeId: 1, animeTitle: 'Naruto' };
const BLEACH = { animeId: 2, animeTitle: 'Bleach' };

function jobs(): AnimeJob[] {
    return [
        makeAnimeJob({ episodeId: 1, ...NARUTO, episode: '1', status: 'running' }),
        makeAnimeJob({ episodeId: 2, ...NARUTO, episode: '2', status: 'queued' }),
        makeAnimeJob({ episodeId: 3, ...NARUTO, episode: '3', status: 'queued' }),
        makeAnimeJob({ episodeId: 4, ...BLEACH, episode: '1', status: 'paused' }),
        makeAnimeJob({ episodeId: 5, ...BLEACH, episode: '2', status: 'done' }),
        makeAnimeJob({ episodeId: 6, animeId: 3, animeTitle: 'One Piece', episode: '1', status: 'error' })
    ];
}

function dialog(): HTMLElement {
    return confirmDialog('Manage downloads');
}

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS });
    useAnimeStore.setState({ ...initialAnime, jobs: jobs(), queueHeld: false });
});

describe('groupActiveAnimeJobs', () => {
    it('counts the episodes of each anime by what they are doing, in the order the anime first appear', () => {
        expect(groupActiveAnimeJobs(jobs())).toEqual([
            { id: 1, title: 'Naruto', running: 1, queued: 2, paused: 0 },
            { id: 2, title: 'Bleach', running: 0, queued: 0, paused: 1 }
        ]);
    });

    it('leaves out the anime whose downloads are all over, and gives nothing for no jobs', () => {
        expect(groupActiveAnimeJobs([makeAnimeJob({ status: 'done' }), makeAnimeJob({ episodeId: 2, status: 'error' }), makeAnimeJob({ episodeId: 3, status: 'cancelled' })])).toEqual([]);
        expect(groupActiveAnimeJobs([])).toEqual([]);
    });
});

describe('AnimeManageDownloads', () => {
    it('is a window with a title and a hint, listing only the anime with downloads to manage and what each is doing', () => {
        render(<AnimeManageDownloads onClose={vi.fn()} />);
        const window = dialog();
        expect(window).toHaveAttribute('aria-modal', 'true');
        expect(within(window).getByRole('heading', { name: 'Manage downloads' })).toBeInTheDocument();
        expect(within(window).getByText('Pick the anime, then pause, resume or cancel all their downloads at once. Pick all of them to act on everything.')).toBeInTheDocument();
        expect(within(window).getAllByRole('listitem').map((item) => {
            return item.textContent;
        })).toEqual(['Naruto · 1 downloading · 2 waiting · 0 paused', 'Bleach · 0 downloading · 0 waiting · 1 paused']);
        expect(within(window).queryByRole('checkbox', { name: 'One Piece' })).not.toBeInTheDocument();
        expect(within(window).getByRole('checkbox', { name: 'Select all' })).not.toBeChecked();
    });

    it('has every action off until an anime is picked, and CLOSE always on', () => {
        render(<AnimeManageDownloads onClose={vi.fn()} />);
        const window = dialog();
        expect(within(window).getByRole('button', { name: 'PAUSE SELECTED' })).toBeDisabled();
        expect(within(window).getByRole('button', { name: 'RESUME SELECTED' })).toBeDisabled();
        expect(within(window).getByRole('button', { name: 'CANCEL SELECTED' })).toBeDisabled();
        expect(within(window).getByRole('button', { name: 'CLOSE' })).toBeEnabled();
    });

    it('says there is nothing to manage, with no list and no way to act, when no download is going on', () => {
        useAnimeStore.setState({ jobs: [makeAnimeJob({ status: 'done' })] });
        render(<AnimeManageDownloads onClose={vi.fn()} />);
        const window = dialog();
        expect(within(window).getByText('No downloads to manage.')).toBeInTheDocument();
        expect(within(window).queryByRole('checkbox')).not.toBeInTheDocument();
        expect(within(window).queryByRole('list')).not.toBeInTheDocument();
        expect(within(window).getByRole('button', { name: 'CANCEL SELECTED' })).toBeDisabled();
    });

    it('pauses only the anime picked, and offers RESUME only when one of them has a paused episode', async () => {
        const user = userEvent.setup();
        render(<AnimeManageDownloads onClose={vi.fn()} />);
        const window = dialog();

        await user.click(within(window).getByRole('checkbox', { name: 'Naruto' }));

        expect(within(window).getByRole('button', { name: 'RESUME SELECTED' })).toBeDisabled();
        await user.click(within(window).getByRole('button', { name: 'PAUSE SELECTED' }));
        expect(mock.api.pauseAnimes.mock.calls).toEqual([[[1]]]);
        expect(mock.api.resumeAnimes).not.toHaveBeenCalled();
        expect(mock.api.cancelAnimes).not.toHaveBeenCalled();
        // The window stays open, so more can be done.
        expect(dialog()).toBeInTheDocument();
    });

    it('resumes only the anime picked, and offers PAUSE only when one of them has an episode to pause', async () => {
        const user = userEvent.setup();
        render(<AnimeManageDownloads onClose={vi.fn()} />);
        const window = dialog();

        await user.click(within(window).getByRole('checkbox', { name: 'Bleach' }));

        expect(within(window).getByRole('button', { name: 'PAUSE SELECTED' })).toBeDisabled();
        await user.click(within(window).getByRole('button', { name: 'RESUME SELECTED' }));
        expect(mock.api.resumeAnimes.mock.calls).toEqual([[[2]]]);
        expect(mock.api.pauseAnimes).not.toHaveBeenCalled();
    });

    it('picks every anime with SELECT ALL, and lets them all go again', async () => {
        const user = userEvent.setup();
        render(<AnimeManageDownloads onClose={vi.fn()} />);
        const window = dialog();

        await user.click(within(window).getByRole('checkbox', { name: 'Select all' }));

        expect(within(window).getByRole('checkbox', { name: 'Naruto' })).toBeChecked();
        expect(within(window).getByRole('checkbox', { name: 'Bleach' })).toBeChecked();
        await user.click(within(window).getByRole('button', { name: 'PAUSE SELECTED' }));
        expect(mock.api.pauseAnimes.mock.calls).toEqual([[[1, 2]]]);
        await user.click(within(window).getByRole('checkbox', { name: 'Select all' }));
        expect(within(window).getByRole('checkbox', { name: 'Naruto' })).not.toBeChecked();
        expect(within(window).getByRole('button', { name: 'PAUSE SELECTED' })).toBeDisabled();
    });

    it('asks before cancelling, says what is lost, and keeps everything when the answer is to go back', async () => {
        const user = userEvent.setup();
        render(<AnimeManageDownloads onClose={vi.fn()} />);
        await user.click(within(dialog()).getByRole('checkbox', { name: 'Naruto' }));

        await user.click(within(dialog()).getByRole('button', { name: 'CANCEL SELECTED' }));

        const question = confirmDialog('Cancel the downloads of the selected anime?');
        expect(within(question).getByText('Every episode of them that is downloading, waiting or paused stops, and what it downloaded so far is deleted. You can start them again later.')).toBeInTheDocument();
        await answerDialog(user, 'Cancel the downloads of the selected anime?', 'BACK');
        expect(mock.api.cancelAnimes).not.toHaveBeenCalled();
        expect(dialog()).toBeInTheDocument();
    });

    it('cancels the downloads of the anime picked once it is confirmed, and of no other', async () => {
        const user = userEvent.setup();
        render(<AnimeManageDownloads onClose={vi.fn()} />);
        await user.click(within(dialog()).getByRole('checkbox', { name: 'Bleach' }));

        await user.click(within(dialog()).getByRole('button', { name: 'CANCEL SELECTED' }));
        await answerDialog(user, 'Cancel the downloads of the selected anime?', 'CANCEL SELECTED');

        expect(mock.api.cancelAnimes.mock.calls).toEqual([[[2]]]);
        expect(mock.api.pauseAnimes).not.toHaveBeenCalled();
        expect(mock.api.resumeAnimes).not.toHaveBeenCalled();
    });

    it('cancels everything when all the anime are picked', async () => {
        const user = userEvent.setup();
        render(<AnimeManageDownloads onClose={vi.fn()} />);
        await user.click(within(dialog()).getByRole('checkbox', { name: 'Select all' }));

        await user.click(within(dialog()).getByRole('button', { name: 'CANCEL SELECTED' }));
        await answerDialog(user, 'Cancel the downloads of the selected anime?', 'CANCEL SELECTED');

        expect(mock.api.cancelAnimes.mock.calls).toEqual([[[1, 2]]]);
    });

    it('drops from the picked ones an anime whose downloads are gone while the window is open', async () => {
        const user = userEvent.setup();
        render(<AnimeManageDownloads onClose={vi.fn()} />);
        await user.click(within(dialog()).getByRole('checkbox', { name: 'Select all' }));

        act(() => {
            useAnimeStore.setState({
                jobs: jobs().filter((job) => {
                    return job.animeId !== 2;
                })
            });
        });

        expect(within(dialog()).queryByRole('checkbox', { name: 'Bleach' })).not.toBeInTheDocument();
        await user.click(within(dialog()).getByRole('button', { name: 'PAUSE SELECTED' }));
        expect(mock.api.pauseAnimes.mock.calls).toEqual([[[1]]]);
    });

    it('closes with CLOSE, with Esc and with a click outside the window, and not with a click inside', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        render(<AnimeManageDownloads onClose={onClose} />);

        await user.click(dialog());
        expect(onClose).not.toHaveBeenCalled();
        await user.click(within(dialog()).getByRole('button', { name: 'CLOSE' }));
        expect(onClose).toHaveBeenCalledTimes(1);
        await user.keyboard('{Escape}');
        expect(onClose).toHaveBeenCalledTimes(2);
        await user.pointer({ keys: '[MouseLeft]', target: dialog().parentElement! });
        expect(onClose).toHaveBeenCalledTimes(3);
    });
});
