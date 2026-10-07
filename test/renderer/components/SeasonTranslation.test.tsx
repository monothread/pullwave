// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SubtitleTranslationJob } from '@shared/anime';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { SeasonTranslation } from '@renderer/components/SeasonTranslation';
import { useAppStore } from '@renderer/store/appStore';
import { makeAnime, makeEpisode } from '../../helpers/animeFixtures';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();

const ANIME = makeAnime(
    [
        makeEpisode({ id: 1, number: '1' }),
        makeEpisode({ id: 2, number: '2' }),
        makeEpisode({ id: 3, number: '3', status: 'queued', filePath: null }),
        makeEpisode({ id: 4, number: '4', status: 'error', filePath: null })
    ],
    { id: 10, title: 'Naruto' }
);

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: { ...DEFAULT_SETTINGS, translateLanguage: 'German' } });
});

function job(episodeId: number, status: SubtitleTranslationJob['status'], overrides: Partial<SubtitleTranslationJob> = {}): SubtitleTranslationJob {
    return { episodeId, language: 'German', status, done: 0, total: 0, reason: null, ...overrides };
}

function emit(update: SubtitleTranslationJob): void {
    act(() => {
        mock.emitSubtitleTranslation(update);
    });
}

async function confirmed() {
    const user = userEvent.setup();
    render(<SeasonTranslation anime={ANIME} />);
    await user.click(screen.getByRole('button', { name: 'TRANSLATE SUBTITLES: Naruto' }));
    await user.click(screen.getByRole('button', { name: 'CONFIRM' }));
    return user;
}

describe('SeasonTranslation', () => {
    it('offers to translate the subtitles of the season, and does nothing until the user confirms', () => {
        render(<SeasonTranslation anime={ANIME} />);
        const button = screen.getByRole('button', { name: 'TRANSLATE SUBTITLES: Naruto' });
        expect(button).toHaveTextContent('TRANSLATE SUBTITLES');
        expect(mock.api.translateAnimeSubtitles).not.toHaveBeenCalled();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('says there is nothing to translate when no episode of the season is downloaded', () => {
        const waiting = makeAnime([makeEpisode({ id: 3, number: '3', status: 'queued', filePath: null })], { id: 11, title: 'Bleach' });
        render(<SeasonTranslation anime={waiting} />);
        expect(screen.getByText('This season has no downloaded episode to translate.')).toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    describe('confirming', () => {
        it('asks first, saying how many episodes, into which language and that it costs the token of the user', async () => {
            const user = userEvent.setup();
            render(<SeasonTranslation anime={ANIME} />);
            await user.click(screen.getByRole('button', { name: 'TRANSLATE SUBTITLES: Naruto' }));
            expect(screen.getByText('Translate the subtitles of 2 episodes into German with your account? Each episode is a request to the provider, and the cost is yours.')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'CONFIRM' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'CANCEL' })).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'TRANSLATE SUBTITLES: Naruto' })).not.toBeInTheDocument();
            expect(mock.api.translateAnimeSubtitles).not.toHaveBeenCalled();
        });

        it('goes back to the button when the user gives up, asking nothing of the provider', async () => {
            const user = userEvent.setup();
            render(<SeasonTranslation anime={ANIME} />);
            await user.click(screen.getByRole('button', { name: 'TRANSLATE SUBTITLES: Naruto' }));
            await user.click(screen.getByRole('button', { name: 'CANCEL' }));
            expect(screen.getByRole('button', { name: 'TRANSLATE SUBTITLES: Naruto' })).toBeInTheDocument();
            expect(mock.api.translateAnimeSubtitles).not.toHaveBeenCalled();
        });

        it('queues the downloaded episodes of the season, in the language of the settings, when the user confirms', async () => {
            await confirmed();
            expect(mock.api.translateAnimeSubtitles).toHaveBeenCalledTimes(1);
            expect(mock.api.translateAnimeSubtitles).toHaveBeenCalledWith({ episodeIds: [1, 2], language: 'German' });
        });
    });

    describe('following it', () => {
        it('shows how many episodes are done out of the ones that were queued, with a button to stop them', async () => {
            await confirmed();
            emit(job(1, 'queued'));
            emit(job(2, 'queued'));
            expect(screen.getByTestId('season-translation-progress')).toHaveTextContent('Translating subtitles: 0 of 2 episodes done.');
            emit(job(1, 'running', { done: 5, total: 20 }));
            expect(screen.getByTestId('season-translation-progress')).toHaveTextContent('Translating subtitles: 0 of 2 episodes done.');
            emit(job(1, 'done', { done: 20, total: 20 }));
            expect(screen.getByTestId('season-translation-progress')).toHaveTextContent('Translating subtitles: 1 of 2 episodes done.');
            expect(screen.getByRole('button', { name: 'STOP' })).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'TRANSLATE SUBTITLES: Naruto' })).not.toBeInTheDocument();
        });

        it('stops all the translations', async () => {
            const user = await confirmed();
            emit(job(1, 'running'));
            await user.click(screen.getByRole('button', { name: 'STOP' }));
            expect(mock.api.cancelAnimeSubtitleTranslation).toHaveBeenCalledTimes(1);
            expect(mock.api.cancelAnimeSubtitleTranslation).toHaveBeenCalledWith(null);
        });

        it('ignores the updates of episodes that are not of the season', async () => {
            await confirmed();
            emit(job(99, 'running', { done: 1, total: 4 }));
            expect(screen.queryByTestId('season-translation-progress')).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'TRANSLATE SUBTITLES: Naruto' })).toBeInTheDocument();
            emit(job(1, 'queued'));
            emit(job(99, 'queued'));
            expect(screen.getByTestId('season-translation-progress')).toHaveTextContent('Translating subtitles: 0 of 1 episodes done.');
        });

        it('goes back to the button when all of them ended well, with no warning', async () => {
            await confirmed();
            emit(job(1, 'done'));
            emit(job(2, 'done'));
            expect(screen.getByRole('button', { name: 'TRANSLATE SUBTITLES: Naruto' })).toBeInTheDocument();
            expect(screen.queryByTestId('season-translation-progress')).not.toBeInTheDocument();
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });

        it('warns how many could not be translated when some failed', async () => {
            await confirmed();
            emit(job(1, 'done'));
            emit(job(2, 'error', { reason: 'INVALID_TOKEN: bad key' }));
            expect(screen.getByRole('alert')).toHaveTextContent('1 episodes could not be translated. Open one to see why.');
            expect(screen.getByRole('button', { name: 'TRANSLATE SUBTITLES: Naruto' })).toBeInTheDocument();
        });

        it('does not warn about the ones that were cancelled', async () => {
            await confirmed();
            emit(job(1, 'cancelled', { reason: 'cancelled' }));
            emit(job(2, 'cancelled', { reason: 'cancelled' }));
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });

        it('forgets what happened before when it starts again', async () => {
            const user = await confirmed();
            emit(job(1, 'error', { reason: 'NETWORK: x' }));
            emit(job(2, 'error', { reason: 'NETWORK: x' }));
            expect(screen.getByRole('alert')).toHaveTextContent('2 episodes could not be translated. Open one to see why.');
            await user.click(screen.getByRole('button', { name: 'TRANSLATE SUBTITLES: Naruto' }));
            await user.click(screen.getByRole('button', { name: 'CONFIRM' }));
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
            expect(mock.api.translateAnimeSubtitles).toHaveBeenCalledTimes(2);
        });
    });

    it('stops listening for updates when it goes away', () => {
        const { unmount } = render(<SeasonTranslation anime={ANIME} />);
        expect(mock.api.onSubtitleTranslationUpdate).toHaveBeenCalledTimes(1);
        unmount();
        expect(mock.unsubscribers[0]).toHaveBeenCalledTimes(1);
    });
});
