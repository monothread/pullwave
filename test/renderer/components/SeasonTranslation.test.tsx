// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SubtitleTranslationJob } from '@shared/anime';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { SeasonTranslation } from '@renderer/components/SeasonTranslation';
import { useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { makeAnime, makeEpisode, makeStatus } from '../../helpers/animeFixtures';
import { answerDialog, confirmDialog } from '../../helpers/confirmDialog';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialAnime = useAnimeStore.getState();
let dispose: () => void;

const ANIME = makeAnime(
    [
        makeEpisode({ id: 1, number: '1' }),
        makeEpisode({ id: 2, number: '2' }),
        makeEpisode({ id: 3, number: '3', status: 'queued', filePath: null }),
        makeEpisode({ id: 4, number: '4', status: 'error', filePath: null })
    ],
    { id: 10, title: 'Naruto' }
);

const BUTTON = 'TRANSLATE SUBTITLES: Naruto';
const WINDOW = 'Translate the subtitles?';

function nothingToTranslate(): { language: 'German'; episodeIds: number[] } {
    return { language: 'German', episodeIds: [] };
}

// The updates of the translations reach the screen through the store, which listens for them from the start of the anime section.
beforeEach(async () => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: { ...DEFAULT_SETTINGS, animeSubtitles: 'German' } });
    useAnimeStore.setState({ ...initialAnime, translationUpdates: {}, subtitleJobs: [], view: 'library', returnView: 'library' });
    mock.api.getAnimeStatus.mockResolvedValue(makeStatus());
    dispose = await useAnimeStore.getState().init();
});

afterEach(() => {
    dispose();
    useAnimeStore.setState(initialAnime, true);
});

function job(episodeId: number, status: SubtitleTranslationJob['status'], overrides: Partial<SubtitleTranslationJob> = {}): SubtitleTranslationJob {
    return { episodeId, language: 'German', status, done: 0, total: 0, reason: null, ...overrides };
}

function emit(update: SubtitleTranslationJob): void {
    act(() => {
        mock.emitSubtitleTranslation(update);
    });
}

async function openWindow() {
    const user = userEvent.setup();
    render(<SeasonTranslation anime={ANIME} />);
    await user.click(await screen.findByRole('button', { name: BUTTON }));
    return user;
}

async function confirmed() {
    const user = await openWindow();
    await answerDialog(user, WINDOW, 'CONFIRM');
    return user;
}

describe('SeasonTranslation', () => {
    it('offers to translate the subtitles of the season, and does nothing until the user confirms', async () => {
        render(<SeasonTranslation anime={ANIME} />);
        const button = await screen.findByRole('button', { name: BUTTON });
        expect(button).toHaveTextContent('TRANSLATE SUBTITLES');
        expect(button).toHaveClass('btn', 'btn--small');
        expect(mock.api.translateAnimeSubtitles).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('says there is nothing to translate when no episode of the season is downloaded', () => {
        const waiting = makeAnime([makeEpisode({ id: 3, number: '3', status: 'queued', filePath: null })], { id: 11, title: 'Bleach' });
        render(<SeasonTranslation anime={waiting} />);
        expect(screen.getByText('This season has no downloaded episode to translate.')).toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    describe('the window that asks first', () => {
        it('says how many episodes, into which language and that it costs the token of the user', async () => {
            await openWindow();
            const dialog = confirmDialog(WINDOW);
            expect(dialog).toHaveTextContent('Translate the subtitles of 2 episodes into German with your account? Each episode is a request to the provider, and the cost is yours.');
            expect(within(dialog).getByRole('button', { name: 'CONFIRM' })).toBeInTheDocument();
            expect(within(dialog).getByRole('button', { name: 'CANCEL' })).toBeInTheDocument();
            expect(mock.api.translateAnimeSubtitles).not.toHaveBeenCalled();
        });

        it('closes and asks nothing of the provider when the user gives up, or presses Esc', async () => {
            const user = await openWindow();
            await answerDialog(user, WINDOW, 'CANCEL');
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            await user.click(screen.getByRole('button', { name: BUTTON }));
            await user.keyboard('{Escape}');
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: BUTTON })).toBeInTheDocument();
            expect(mock.api.translateAnimeSubtitles).not.toHaveBeenCalled();
        });

        it('queues the episodes that can be translated, in the language of the settings, when the user confirms', async () => {
            await confirmed();
            expect(mock.api.translateAnimeSubtitles).toHaveBeenCalledTimes(1);
            expect(mock.api.translateAnimeSubtitles).toHaveBeenCalledWith({ episodeIds: [1, 2], language: 'German' });
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });
    });

    describe('while it goes on', () => {
        it('has only the button to the screen of the subtitles, which opens it', async () => {
            const user = await confirmed();
            emit(job(1, 'queued'));
            emit(job(2, 'queued'));
            const button = screen.getByRole('button', { name: 'SEE PROGRESS' });
            expect(button).toHaveClass('btn', 'btn--small', 'btn--primary');
            expect(screen.getAllByRole('button')).toEqual([button]);
            expect(screen.queryByText(/Translating subtitles/)).not.toBeInTheDocument();
            await user.click(button);
            expect(useAnimeStore.getState()).toMatchObject({ view: 'subtitles', returnView: 'library' });
        });

        it('keeps the button while any of the season goes on, counting a skipped one as ended', async () => {
            await confirmed();
            emit(job(1, 'queued'));
            emit(job(2, 'queued'));
            emit(job(1, 'skipped', { reason: 'exists' }));
            emit(job(2, 'running', { done: 3, total: 10 }));
            expect(screen.getByRole('button', { name: 'SEE PROGRESS' })).toBeInTheDocument();
            expect(screen.queryByTestId('season-translation-skipped')).not.toBeInTheDocument();
        });

        it('ignores the updates of episodes that are not of the season', async () => {
            await confirmed();
            emit(job(99, 'running', { done: 1, total: 4 }));
            expect(screen.queryByRole('button', { name: 'SEE PROGRESS' })).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: BUTTON })).toBeInTheDocument();
            emit(job(1, 'queued'));
            expect(screen.getByRole('button', { name: 'SEE PROGRESS' })).toBeInTheDocument();
        });

        it('shows the same button at once when the screen is left and opened again, never the button to translate', async () => {
            await confirmed();
            emit(job(1, 'done'));
            emit(job(2, 'running', { done: 2, total: 10 }));
            cleanup();
            mock.api.listTranslatableEpisodes.mockReturnValue(new Promise(() => {
                return undefined;
            }));

            render(<SeasonTranslation anime={ANIME} />);

            expect(screen.getByRole('button', { name: 'SEE PROGRESS' })).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: BUTTON })).not.toBeInTheDocument();
        });
    });

    describe('when it ended', () => {
        it('goes back to the button when the episodes can still be translated, with no warning', async () => {
            await confirmed();
            emit(job(1, 'cancelled', { reason: 'cancelled' }));
            emit(job(2, 'cancelled', { reason: 'cancelled' }));
            expect(await screen.findByRole('button', { name: BUTTON })).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'SEE PROGRESS' })).not.toBeInTheDocument();
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });

        it('shows nothing when every episode has the subtitle now', async () => {
            await confirmed();
            mock.api.listTranslatableEpisodes.mockResolvedValue(nothingToTranslate());
            emit(job(1, 'done'));
            emit(job(2, 'done'));
            await vi.waitFor(() => {
                expect(screen.queryByRole('button')).not.toBeInTheDocument();
            });
            expect(screen.queryByText(/already has it/)).not.toBeInTheDocument();
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });

        it('warns how many could not be translated when some failed', async () => {
            await confirmed();
            emit(job(1, 'done'));
            emit(job(2, 'error', { reason: 'INVALID_TOKEN: bad key' }));
            expect(screen.getByRole('alert')).toHaveTextContent('1 episodes could not be translated. Open one to see why.');
            expect(await screen.findByRole('button', { name: BUTTON })).toBeInTheDocument();
        });

        it('says how many episodes already had the subtitle in the language and were skipped, and does not take it for a failure', async () => {
            await confirmed();
            emit(job(1, 'skipped', { reason: 'exists' }));
            emit(job(2, 'done'));
            expect(screen.getByTestId('season-translation-skipped')).toHaveTextContent('1 episodes already had the subtitle in German and were skipped.');
            expect(screen.getByTestId('season-translation-skipped')).toHaveAttribute('role', 'status');
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });

        it('says the ones skipped and warns about the ones that failed, apart', async () => {
            await confirmed();
            emit(job(1, 'skipped', { reason: 'exists' }));
            emit(job(2, 'error', { reason: 'NETWORK: x' }));
            expect(screen.getByTestId('season-translation-skipped')).toHaveTextContent('1 episodes already had the subtitle in German and were skipped.');
            expect(screen.getByRole('alert')).toHaveTextContent('1 episodes could not be translated. Open one to see why.');
        });

        it('says the language the episodes were skipped in, the one of the jobs', async () => {
            await confirmed();
            emit(job(1, 'skipped', { reason: 'exists', language: 'Spanish' }));
            expect(screen.getByTestId('season-translation-skipped')).toHaveTextContent('1 episodes already had the subtitle in Spanish and were skipped.');
        });

        it('does not say anything about skipped episodes when none was, nor warn about the cancelled ones', async () => {
            await confirmed();
            emit(job(1, 'done'));
            emit(job(2, 'cancelled', { reason: 'cancelled' }));
            expect(screen.queryByTestId('season-translation-skipped')).not.toBeInTheDocument();
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });

        it('keeps the warnings when the screen is left and opened again', async () => {
            await confirmed();
            emit(job(1, 'error', { reason: 'NETWORK: x' }));
            emit(job(2, 'skipped', { reason: 'exists' }));
            cleanup();

            render(<SeasonTranslation anime={ANIME} />);

            expect(await screen.findByRole('alert')).toHaveTextContent('1 episodes could not be translated. Open one to see why.');
            expect(screen.getByTestId('season-translation-skipped')).toHaveTextContent('1 episodes already had the subtitle in German and were skipped.');
        });

        it('forgets what happened before when it starts again', async () => {
            const user = await confirmed();
            emit(job(1, 'error', { reason: 'NETWORK: x' }));
            emit(job(2, 'skipped', { reason: 'exists' }));
            expect(screen.getByRole('alert')).toBeInTheDocument();
            await user.click(await screen.findByRole('button', { name: BUTTON }));
            await answerDialog(user, WINDOW, 'CONFIRM');
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
            expect(screen.queryByTestId('season-translation-skipped')).not.toBeInTheDocument();
            expect(mock.api.translateAnimeSubtitles).toHaveBeenCalledTimes(2);
        });
    });

    describe('which episodes it offers to translate', () => {
        it('asks the main process which downloaded episodes can be translated, and into which language', async () => {
            render(<SeasonTranslation anime={ANIME} />);
            await screen.findByRole('button', { name: BUTTON });
            expect(mock.api.listTranslatableEpisodes).toHaveBeenCalledTimes(1);
            expect(mock.api.listTranslatableEpisodes).toHaveBeenCalledWith([1, 2]);
        });

        it('translates into the language the main process says, the one of the anime subtitles, and names it in the window', async () => {
            mock.api.listTranslatableEpisodes.mockResolvedValue({ language: 'Portuguese', episodeIds: [1, 2] });
            const user = await openWindow();
            expect(confirmDialog(WINDOW)).toHaveTextContent('Translate the subtitles of 2 episodes into Portuguese with your account?');
            await answerDialog(user, WINDOW, 'CONFIRM');
            expect(mock.api.translateAnimeSubtitles).toHaveBeenCalledWith({ episodeIds: [1, 2], language: 'Portuguese' });
        });

        it('shows nothing until the main process answers', () => {
            mock.api.listTranslatableEpisodes.mockReturnValue(new Promise(() => {
                return undefined;
            }));
            const { container } = render(<SeasonTranslation anime={ANIME} />);
            expect(container).toBeEmptyDOMElement();
        });

        it('shows nothing when every episode has the subtitle in the language already', async () => {
            mock.api.listTranslatableEpisodes.mockResolvedValue(nothingToTranslate());
            const { container } = render(<SeasonTranslation anime={ANIME} />);
            await vi.waitFor(() => {
                expect(mock.api.listTranslatableEpisodes).toHaveBeenCalledTimes(1);
            });
            await act(async () => {
                await Promise.resolve();
            });
            expect(container).toBeEmptyDOMElement();
        });

        it('counts and queues only the episodes that can be translated', async () => {
            mock.api.listTranslatableEpisodes.mockResolvedValue({ language: 'German', episodeIds: [2] });
            const user = await openWindow();
            expect(confirmDialog(WINDOW)).toHaveTextContent('Translate the subtitles of 1 episodes into German with your account?');
            await answerDialog(user, WINDOW, 'CONFIRM');
            expect(mock.api.translateAnimeSubtitles).toHaveBeenCalledWith({ episodeIds: [2], language: 'German' });
        });

        it('asks again when a translation of the season ends', async () => {
            await confirmed();
            emit(job(1, 'running'));
            expect(mock.api.listTranslatableEpisodes).toHaveBeenCalledTimes(1);
            emit(job(1, 'done'));
            await vi.waitFor(() => {
                expect(mock.api.listTranslatableEpisodes).toHaveBeenCalledTimes(2);
            });
        });

        it('brings the button back when the anime subtitles change to a language an episode does not have', async () => {
            mock.api.listTranslatableEpisodes.mockResolvedValue(nothingToTranslate());
            render(<SeasonTranslation anime={ANIME} />);
            await vi.waitFor(() => {
                expect(mock.api.listTranslatableEpisodes).toHaveBeenCalledTimes(1);
            });
            expect(screen.queryByRole('button')).not.toBeInTheDocument();

            mock.api.listTranslatableEpisodes.mockResolvedValue({ language: 'Spanish', episodeIds: [1] });
            act(() => {
                useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, animeSubtitles: 'Spanish' } });
            });

            expect(await screen.findByRole('button', { name: BUTTON })).toBeInTheDocument();
            expect(mock.api.listTranslatableEpisodes).toHaveBeenCalledTimes(2);
        });

        it.each([
            ['the language of the app, when the anime subtitles follow it', { animeSubtitles: 'auto', language: 'pt' }],
            ['the language of the app, when the anime subtitles leave the choice to ani-cli', { animeSubtitles: 'default', language: 'ja' }],
            ['the anime subtitles', { animeSubtitles: 'French' }]
        ] as const)('asks again when %s changes (it decides the language)', async (_name, change) => {
            render(<SeasonTranslation anime={ANIME} />);
            await screen.findByRole('button', { name: BUTTON });
            act(() => {
                useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, ...change } });
            });
            await vi.waitFor(() => {
                expect(mock.api.listTranslatableEpisodes).toHaveBeenCalledTimes(2);
            });
        });

        it('does not ask when no episode is downloaded', () => {
            render(<SeasonTranslation anime={makeAnime([makeEpisode({ id: 3, status: 'queued', filePath: null })], { id: 11, title: 'Bleach' })} />);
            expect(mock.api.listTranslatableEpisodes).not.toHaveBeenCalled();
        });
    });
});
