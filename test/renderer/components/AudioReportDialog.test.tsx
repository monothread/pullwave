// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { AudioReport } from '@renderer/components/animeText';
import { AudioReportDialog } from '@renderer/components/AudioReportDialog';
import { useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialAnime = useAnimeStore.getState();

const WITH_PROBLEMS: AudioReport = {
    summary: { checked: 5, withoutAudio: 1, unreadable: 2, unreadableIds: [4, 5], missing: 1 },
    downloaded: 9,
    problems: [
        { animeId: 10, animeTitle: 'Naruto', episodeId: 2, episode: '2', kind: 'no-audio' },
        { animeId: 10, animeTitle: 'Naruto', episodeId: 3, episode: '3', kind: 'file-missing' }
    ]
};
// Episodes the check could not read, with one that has no audio.
const WITH_UNREADABLE: AudioReport = {
    summary: { checked: 5, withoutAudio: 1, unreadable: 2, unreadableIds: [4, 5], missing: 0 },
    downloaded: 9,
    problems: [
        { animeId: 10, animeTitle: 'Naruto', episodeId: 2, episode: '2', kind: 'no-audio' },
        { animeId: 10, animeTitle: 'Naruto', episodeId: 4, episode: '4', kind: 'unreadable' },
        { animeId: 11, animeTitle: 'Kaiju', episodeId: 5, episode: '1', kind: 'unreadable' }
    ]
};
const ONLY_UNREADABLE: AudioReport = {
    summary: { checked: 0, withoutAudio: 0, unreadable: 1, unreadableIds: [5], missing: 0 },
    downloaded: 3,
    problems: [{ animeId: 11, animeTitle: 'Kaiju', episodeId: 5, episode: '1', kind: 'unreadable' }]
};
const WITHOUT_PROBLEMS: AudioReport = { summary: { checked: 7, withoutAudio: 0, unreadable: 0, unreadableIds: [], missing: 0 }, downloaded: 7, problems: [] };
const EMPTY_LIBRARY: AudioReport = { summary: { checked: 0, withoutAudio: 0, unreadable: 0, unreadableIds: [], missing: 0 }, downloaded: 0, problems: [] };

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS, notice: null });
    useAnimeStore.setState({ ...initialAnime, audioReport: null });
});

describe('AudioReportDialog', () => {
    it('shows nothing while there is no report', () => {
        render(<AudioReportDialog />);

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('opens over the page, in the body, with how the check went', () => {
        useAnimeStore.setState({ audioReport: WITH_PROBLEMS });
        const { container } = render(<AudioReportDialog />);

        const dialog = screen.getByRole('dialog', { name: 'Downloaded episodes' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(container).toBeEmptyDOMElement();
        expect(document.body).toContainElement(dialog);
        expect(within(dialog).getByTestId('audio-report-summary')).toHaveTextContent('5 EPISODE(S) CHECKED NOW · 2 COULD NOT BE READ');
    });

    it('lists every episode that has a problem, with what is wrong, and offers to download them all again', () => {
        useAnimeStore.setState({ audioReport: WITH_PROBLEMS });
        render(<AudioReportDialog />);

        const dialog = screen.getByRole('dialog', { name: 'Downloaded episodes' });
        expect(within(dialog).getByText('2 EPISODE(S) WITH A PROBLEM:')).toBeInTheDocument();
        expect(
            within(within(dialog).getByTestId('audio-problems'))
                .getAllByTestId('audio-problem')
                .map((item) => {
                    return item.textContent;
                })
        ).toEqual(['Naruto · EP 2 — NO AUDIO', 'Naruto · EP 3 — FILE NOT FOUND']);
        expect(within(dialog).getByText(/^DOWNLOAD ALL AGAIN deletes only the video of the ones without audio/)).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: 'DOWNLOAD ALL AGAIN (2)' })).toBeEnabled();
        expect(within(dialog).getByRole('button', { name: 'CLOSE' })).toBeEnabled();
    });

    it('says there is no problem, with nothing to download again, when the episodes are fine', () => {
        useAnimeStore.setState({ audioReport: WITHOUT_PROBLEMS });
        render(<AudioReportDialog />);

        const dialog = screen.getByRole('dialog', { name: 'Downloaded episodes' });
        expect(within(dialog).getByTestId('audio-report-summary')).toHaveTextContent('7 EPISODE(S) CHECKED NOW · 0 COULD NOT BE READ');
        expect(within(dialog).getByRole('status')).toHaveTextContent('No problems found in the downloaded episodes.');
        expect(within(dialog).queryByTestId('audio-problems')).not.toBeInTheDocument();
        expect(within(dialog).queryByRole('button', { name: /^DOWNLOAD ALL AGAIN/ })).not.toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: 'CLOSE' })).toBeInTheDocument();
    });

    it('says there is nothing to check, and not that all is well, when the library has no downloaded episode', () => {
        useAnimeStore.setState({ audioReport: EMPTY_LIBRARY });
        render(<AudioReportDialog />);

        const dialog = screen.getByRole('dialog', { name: 'Downloaded episodes' });
        expect(within(dialog).getByTestId('audio-report-summary')).toHaveTextContent('0 EPISODE(S) CHECKED NOW · 0 COULD NOT BE READ');
        expect(within(dialog).getByRole('status')).toHaveTextContent('There are no downloaded episodes to check. Import the library or download an episode first.');
        expect(within(dialog).queryByText('No problems found in the downloaded episodes.')).not.toBeInTheDocument();
        expect(within(dialog).queryByRole('button', { name: /^DOWNLOAD ALL AGAIN/ })).not.toBeInTheDocument();
    });

    it('downloads all the episodes of the list again, closes, and says how many were queued', async () => {
        const user = userEvent.setup();
        useAnimeStore.setState({ audioReport: WITH_PROBLEMS });
        render(<AudioReportDialog />);

        await user.click(screen.getByRole('button', { name: 'DOWNLOAD ALL AGAIN (2)' }));

        expect(mock.api.redownloadAnimeEpisodes).toHaveBeenCalledTimes(1);
        expect(mock.api.redownloadAnimeEpisodes).toHaveBeenCalledWith([2, 3]);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(useAppStore.getState().notice).toEqual({ kind: 'info', message: 'Queued 2 episode(s) to be downloaded again.' });
    });

    it('lists the ones that could not be read with what is wrong, and offers to repair them apart from the ones to download again', () => {
        useAnimeStore.setState({ audioReport: WITH_UNREADABLE });
        render(<AudioReportDialog />);

        const dialog = screen.getByRole('dialog', { name: 'Downloaded episodes' });
        expect(within(dialog).getByText('3 EPISODE(S) WITH A PROBLEM:')).toBeInTheDocument();
        expect(
            within(within(dialog).getByTestId('audio-problems'))
                .getAllByTestId('audio-problem')
                .map((item) => {
                    return item.textContent;
                })
        ).toEqual(['Naruto · EP 2 — NO AUDIO', 'Naruto · EP 4 — COULD NOT BE READ', 'Kaiju · EP 1 — COULD NOT BE READ']);
        expect(within(dialog).getByText(/^REPAIR is for a video that some sources hide behind a picture/)).toBeInTheDocument();
        expect(within(dialog).getByText(/^DOWNLOAD ALL AGAIN deletes only the video of the ones without audio/)).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: 'REPAIR (2)' })).toBeEnabled();
        expect(within(dialog).getByRole('button', { name: 'DOWNLOAD ALL AGAIN (1)' })).toBeEnabled();
    });

    it('has only the repair, and not the download again, when everything that is wrong could not be read', () => {
        useAnimeStore.setState({ audioReport: ONLY_UNREADABLE });
        render(<AudioReportDialog />);

        const dialog = screen.getByRole('dialog', { name: 'Downloaded episodes' });
        expect(within(dialog).getByRole('button', { name: 'REPAIR (1)' })).toBeEnabled();
        expect(within(dialog).queryByRole('button', { name: /^DOWNLOAD ALL AGAIN/ })).not.toBeInTheDocument();
        expect(within(dialog).queryByText(/^DOWNLOAD ALL AGAIN deletes only the video/)).not.toBeInTheDocument();
    });

    it('has no repair when nothing could not be read', () => {
        useAnimeStore.setState({ audioReport: WITH_PROBLEMS });
        render(<AudioReportDialog />);

        const dialog = screen.getByRole('dialog', { name: 'Downloaded episodes' });
        expect(within(dialog).queryByRole('button', { name: /^REPAIR/ })).not.toBeInTheDocument();
        expect(within(dialog).queryByText(/^REPAIR is for a video/)).not.toBeInTheDocument();
    });

    it('repairs only the episodes that could not be read, closes, and says how it went', async () => {
        const user = userEvent.setup();
        mock.api.repairAnimeEpisodes.mockResolvedValue({ ok: true, repaired: 1, failed: 1, skipped: 0 });
        useAnimeStore.setState({ audioReport: WITH_UNREADABLE });
        render(<AudioReportDialog />);

        await user.click(screen.getByRole('button', { name: 'REPAIR (2)' }));

        expect(mock.api.repairAnimeEpisodes).toHaveBeenCalledTimes(1);
        expect(mock.api.repairAnimeEpisodes).toHaveBeenCalledWith([4, 5]);
        expect(mock.api.redownloadAnimeEpisodes).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(mock.api.listAnimeLibrary).toHaveBeenCalledTimes(1);
        expect(useAppStore.getState().notice).toEqual({ kind: 'info', message: '1 episode(s) repaired · 1 could not be repaired.' });
    });

    it('downloads again only the ones that a download can fix, and leaves the ones that could not be read for the repair', async () => {
        const user = userEvent.setup();
        useAnimeStore.setState({ audioReport: WITH_UNREADABLE });
        render(<AudioReportDialog />);

        await user.click(screen.getByRole('button', { name: 'DOWNLOAD ALL AGAIN (1)' }));

        expect(mock.api.redownloadAnimeEpisodes).toHaveBeenCalledWith([2]);
        expect(mock.api.repairAnimeEpisodes).not.toHaveBeenCalled();
        expect(useAppStore.getState().notice).toEqual({ kind: 'info', message: 'Queued 1 episode(s) to be downloaded again.' });
    });

    it('closes with CLOSE, without downloading anything', async () => {
        const user = userEvent.setup();
        useAnimeStore.setState({ audioReport: WITH_PROBLEMS });
        render(<AudioReportDialog />);

        await user.click(screen.getByRole('button', { name: 'CLOSE' }));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(useAnimeStore.getState().audioReport).toBeNull();
        expect(mock.api.redownloadAnimeEpisodes).not.toHaveBeenCalled();
    });

    it('closes with Esc', async () => {
        const user = userEvent.setup();
        useAnimeStore.setState({ audioReport: WITH_PROBLEMS });
        render(<AudioReportDialog />);

        await user.keyboard('{Escape}');

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(mock.api.redownloadAnimeEpisodes).not.toHaveBeenCalled();
    });

    it('closes with a click outside the window, and stays open with a click inside it', () => {
        useAnimeStore.setState({ audioReport: WITH_PROBLEMS });
        render(<AudioReportDialog />);
        const dialog = screen.getByRole('dialog', { name: 'Downloaded episodes' });

        fireEvent.mouseDown(dialog);
        expect(screen.getByRole('dialog', { name: 'Downloaded episodes' })).toBeInTheDocument();

        fireEvent.mouseDown(dialog.parentElement as HTMLElement);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('puts the focus inside the window when it opens', () => {
        useAnimeStore.setState({ audioReport: WITH_PROBLEMS });
        render(<AudioReportDialog />);

        expect(screen.getByRole('dialog', { name: 'Downloaded episodes' })).toContainElement(document.activeElement as HTMLElement);
    });

    it('opens when the report arrives after it was mounted, with the focus inside', async () => {
        render(<AudioReportDialog />);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

        useAnimeStore.setState({ audioReport: WITHOUT_PROBLEMS });

        const dialog = await screen.findByRole('dialog', { name: 'Downloaded episodes' });
        expect(dialog).toContainElement(document.activeElement as HTMLElement);
    });
});
