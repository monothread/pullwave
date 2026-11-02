// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { MangaJob } from '@shared/manga';
import { groupActiveJobs, MangaManageDownloads } from '@renderer/components/MangaManageDownloads';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeMangaJob } from '../../helpers/mangaFixtures';
import { answerDialog, confirmDialog } from '../../helpers/confirmDialog';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialManga = useMangaStore.getState();

const ONE_PIECE = { mangaId: 1, mangaTitle: 'One Piece' };
const BLEACH = { mangaId: 2, mangaTitle: 'Bleach' };

function jobs(): MangaJob[] {
    return [
        makeMangaJob({ chapterId: 1, ...ONE_PIECE, status: 'running' }),
        makeMangaJob({ chapterId: 2, ...ONE_PIECE, status: 'queued' }),
        makeMangaJob({ chapterId: 3, ...ONE_PIECE, status: 'queued' }),
        makeMangaJob({ chapterId: 4, ...BLEACH, status: 'paused' }),
        makeMangaJob({ chapterId: 5, ...BLEACH, status: 'done' }),
        makeMangaJob({ chapterId: 6, mangaId: 3, mangaTitle: 'Naruto', status: 'error' })
    ];
}

function dialog(): HTMLElement {
    return confirmDialog('Manage downloads');
}

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS });
    useMangaStore.setState({ ...initialManga, jobs: jobs(), queueHeld: false });
});

describe('groupActiveJobs', () => {
    it('counts the chapters of each manga by what they are doing, in the order the mangas first appear', () => {
        expect(groupActiveJobs(jobs())).toEqual([
            { mangaId: 1, title: 'One Piece', running: 1, queued: 2, paused: 0 },
            { mangaId: 2, title: 'Bleach', running: 0, queued: 0, paused: 1 }
        ]);
    });

    it('leaves out the mangas whose downloads are all over, and gives nothing for no jobs', () => {
        expect(
            groupActiveJobs([makeMangaJob({ status: 'done' }), makeMangaJob({ chapterId: 2, status: 'error' }), makeMangaJob({ chapterId: 3, status: 'cancelled' })])
        ).toEqual([]);
        expect(groupActiveJobs([])).toEqual([]);
    });
});

describe('MangaManageDownloads', () => {
    it('is a window with a title and a hint, listing only the mangas with downloads to manage and what each is doing', () => {
        render(<MangaManageDownloads onClose={vi.fn()} />);
        const window = dialog();
        expect(window).toHaveAttribute('aria-modal', 'true');
        expect(within(window).getByRole('heading', { name: 'Manage downloads' })).toBeInTheDocument();
        expect(
            within(window).getByText('Pick the mangas, then pause, resume or cancel all their downloads at once. Pick all of them to act on everything.')
        ).toBeInTheDocument();
        expect(within(window).getAllByRole('listitem').map((item) => {
            return item.textContent;
        })).toEqual(['One Piece · 1 downloading · 2 waiting · 0 paused', 'Bleach · 0 downloading · 0 waiting · 1 paused']);
        expect(within(window).queryByRole('checkbox', { name: 'Naruto' })).not.toBeInTheDocument();
        expect(within(window).getByRole('checkbox', { name: 'Select all' })).not.toBeChecked();
        expect(within(window).getByRole('checkbox', { name: 'One Piece' })).not.toBeChecked();
        expect(within(window).getByRole('checkbox', { name: 'Bleach' })).not.toBeChecked();
    });

    it('has every action off until a manga is picked, and CLOSE always on', () => {
        render(<MangaManageDownloads onClose={vi.fn()} />);
        const window = dialog();
        expect(within(window).getByRole('button', { name: 'PAUSE SELECTED' })).toBeDisabled();
        expect(within(window).getByRole('button', { name: 'RESUME SELECTED' })).toBeDisabled();
        expect(within(window).getByRole('button', { name: 'CANCEL SELECTED' })).toBeDisabled();
        expect(within(window).getByRole('button', { name: 'CLOSE' })).toBeEnabled();
    });

    it('says there is nothing to manage, with no list and no way to act, when no download is going on', () => {
        useMangaStore.setState({ jobs: [makeMangaJob({ status: 'done' })] });
        render(<MangaManageDownloads onClose={vi.fn()} />);
        const window = dialog();
        expect(within(window).getByText('No downloads to manage.')).toBeInTheDocument();
        expect(within(window).queryByRole('checkbox')).not.toBeInTheDocument();
        expect(within(window).queryByRole('list')).not.toBeInTheDocument();
        expect(within(window).getByRole('button', { name: 'PAUSE SELECTED' })).toBeDisabled();
        expect(within(window).getByRole('button', { name: 'RESUME SELECTED' })).toBeDisabled();
        expect(within(window).getByRole('button', { name: 'CANCEL SELECTED' })).toBeDisabled();
    });

    it('pauses only the mangas picked, and offers RESUME only when one of them has a paused chapter', async () => {
        const user = userEvent.setup();
        render(<MangaManageDownloads onClose={vi.fn()} />);
        const window = dialog();

        await user.click(within(window).getByRole('checkbox', { name: 'One Piece' }));

        expect(within(window).getByRole('checkbox', { name: 'One Piece' })).toBeChecked();
        expect(within(window).getByRole('button', { name: 'PAUSE SELECTED' })).toBeEnabled();
        expect(within(window).getByRole('button', { name: 'RESUME SELECTED' })).toBeDisabled();
        await user.click(within(window).getByRole('button', { name: 'PAUSE SELECTED' }));
        expect(mock.api.manga.pauseMangas.mock.calls).toEqual([[[1]]]);
        expect(mock.api.manga.resumeMangas).not.toHaveBeenCalled();
        expect(mock.api.manga.cancelMangas).not.toHaveBeenCalled();
        // The window stays open, so more can be done.
        expect(dialog()).toBeInTheDocument();
    });

    it('resumes only the mangas picked, and offers PAUSE only when one of them has a chapter to pause', async () => {
        const user = userEvent.setup();
        render(<MangaManageDownloads onClose={vi.fn()} />);
        const window = dialog();

        await user.click(within(window).getByRole('checkbox', { name: 'Bleach' }));

        expect(within(window).getByRole('button', { name: 'PAUSE SELECTED' })).toBeDisabled();
        expect(within(window).getByRole('button', { name: 'RESUME SELECTED' })).toBeEnabled();
        await user.click(within(window).getByRole('button', { name: 'RESUME SELECTED' }));
        expect(mock.api.manga.resumeMangas.mock.calls).toEqual([[[2]]]);
        expect(mock.api.manga.pauseMangas).not.toHaveBeenCalled();
    });

    it('offers both PAUSE and RESUME when the picked mangas have both, and sends all of them', async () => {
        const user = userEvent.setup();
        render(<MangaManageDownloads onClose={vi.fn()} />);
        const window = dialog();

        await user.click(within(window).getByRole('checkbox', { name: 'One Piece' }));
        await user.click(within(window).getByRole('checkbox', { name: 'Bleach' }));
        await user.click(within(window).getByRole('button', { name: 'PAUSE SELECTED' }));
        await user.click(within(window).getByRole('button', { name: 'RESUME SELECTED' }));

        expect(mock.api.manga.pauseMangas.mock.calls).toEqual([[[1, 2]]]);
        expect(mock.api.manga.resumeMangas.mock.calls).toEqual([[[1, 2]]]);
    });

    it('picks every manga with SELECT ALL, and lets them all go again', async () => {
        const user = userEvent.setup();
        render(<MangaManageDownloads onClose={vi.fn()} />);
        const window = dialog();

        await user.click(within(window).getByRole('checkbox', { name: 'Select all' }));

        expect(within(window).getByRole('checkbox', { name: 'Select all' })).toBeChecked();
        expect(within(window).getByRole('checkbox', { name: 'One Piece' })).toBeChecked();
        expect(within(window).getByRole('checkbox', { name: 'Bleach' })).toBeChecked();
        await user.click(within(window).getByRole('button', { name: 'PAUSE SELECTED' }));
        expect(mock.api.manga.pauseMangas.mock.calls).toEqual([[[1, 2]]]);
        await user.click(within(window).getByRole('checkbox', { name: 'Select all' }));
        expect(within(window).getByRole('checkbox', { name: 'Select all' })).not.toBeChecked();
        expect(within(window).getByRole('checkbox', { name: 'One Piece' })).not.toBeChecked();
        expect(within(window).getByRole('checkbox', { name: 'Bleach' })).not.toBeChecked();
        expect(within(window).getByRole('button', { name: 'PAUSE SELECTED' })).toBeDisabled();
    });

    it('marks SELECT ALL once every manga is picked one by one, and unmarks it when one is let go', async () => {
        const user = userEvent.setup();
        render(<MangaManageDownloads onClose={vi.fn()} />);
        const window = dialog();

        await user.click(within(window).getByRole('checkbox', { name: 'One Piece' }));
        expect(within(window).getByRole('checkbox', { name: 'Select all' })).not.toBeChecked();
        await user.click(within(window).getByRole('checkbox', { name: 'Bleach' }));
        expect(within(window).getByRole('checkbox', { name: 'Select all' })).toBeChecked();
        await user.click(within(window).getByRole('checkbox', { name: 'One Piece' }));
        expect(within(window).getByRole('checkbox', { name: 'Select all' })).not.toBeChecked();
        expect(within(window).getByRole('checkbox', { name: 'One Piece' })).not.toBeChecked();
        expect(within(window).getByRole('checkbox', { name: 'Bleach' })).toBeChecked();
    });

    it('asks before cancelling, and keeps everything when the answer is to go back', async () => {
        const user = userEvent.setup();
        render(<MangaManageDownloads onClose={vi.fn()} />);
        await user.click(within(dialog()).getByRole('checkbox', { name: 'One Piece' }));

        await user.click(within(dialog()).getByRole('button', { name: 'CANCEL SELECTED' }));

        const question = confirmDialog('Cancel the downloads of the selected mangas?');
        expect(within(question).getByText('Every chapter of them that is downloading, waiting or paused stops. You can start them again later.')).toBeInTheDocument();
        await answerDialog(user, 'Cancel the downloads of the selected mangas?', 'BACK');
        expect(mock.api.manga.cancelMangas).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog', { name: 'Cancel the downloads of the selected mangas?' })).not.toBeInTheDocument();
        expect(dialog()).toBeInTheDocument();
    });

    it('cancels the downloads of the mangas picked once it is confirmed, and of no other', async () => {
        const user = userEvent.setup();
        render(<MangaManageDownloads onClose={vi.fn()} />);
        await user.click(within(dialog()).getByRole('checkbox', { name: 'Bleach' }));

        await user.click(within(dialog()).getByRole('button', { name: 'CANCEL SELECTED' }));
        await answerDialog(user, 'Cancel the downloads of the selected mangas?', 'CANCEL SELECTED');

        expect(mock.api.manga.cancelMangas.mock.calls).toEqual([[[2]]]);
        expect(mock.api.manga.pauseMangas).not.toHaveBeenCalled();
        expect(mock.api.manga.resumeMangas).not.toHaveBeenCalled();
    });

    it('cancels everything when all the mangas are picked', async () => {
        const user = userEvent.setup();
        render(<MangaManageDownloads onClose={vi.fn()} />);
        await user.click(within(dialog()).getByRole('checkbox', { name: 'Select all' }));

        await user.click(within(dialog()).getByRole('button', { name: 'CANCEL SELECTED' }));
        await answerDialog(user, 'Cancel the downloads of the selected mangas?', 'CANCEL SELECTED');

        expect(mock.api.manga.cancelMangas.mock.calls).toEqual([[[1, 2]]]);
    });

    it('drops from the picked ones a manga whose downloads are gone while the window is open', async () => {
        const user = userEvent.setup();
        render(<MangaManageDownloads onClose={vi.fn()} />);
        await user.click(within(dialog()).getByRole('checkbox', { name: 'Select all' }));

        act(() => {
            useMangaStore.setState({ jobs: jobs().filter((job) => {
                return job.mangaId !== 2;
            }) });
        });

        expect(within(dialog()).queryByRole('checkbox', { name: 'Bleach' })).not.toBeInTheDocument();
        expect(within(dialog()).getByRole('checkbox', { name: 'Select all' })).toBeChecked();
        await user.click(within(dialog()).getByRole('button', { name: 'PAUSE SELECTED' }));
        expect(mock.api.manga.pauseMangas.mock.calls).toEqual([[[1]]]);
    });

    it('closes with CLOSE, with Esc and with a click outside the window, and not with a click inside', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        render(<MangaManageDownloads onClose={onClose} />);

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
