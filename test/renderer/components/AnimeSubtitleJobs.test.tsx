// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { createTranslator } from '@shared/i18n';
import { activityDetail, activityPercent, AnimeSubtitleJobs, episodeOf } from '@renderer/components/AnimeSubtitleJobs';
import { useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import type { SubtitleActivity } from '@renderer/store/subtitleActivity';
import { makeAnime, makeEpisode } from '../../helpers/animeFixtures';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialAnime = useAnimeStore.getState();
const t = createTranslator('en');

const LIBRARY = [
    makeAnime([makeEpisode({ id: 4, animeId: 3, number: '7' }), makeEpisode({ id: 5, animeId: 3, number: '8' })], { id: 3, title: 'Naruto' }),
    makeAnime([makeEpisode({ id: 9, animeId: 6, number: '1' })], { id: 6, title: 'Bleach' })
];

const TRANSLATING: SubtitleActivity = { kind: 'translation', job: { episodeId: 4, language: 'Spanish', status: 'running', done: 3, total: 12, reason: null } };
const WAITING: SubtitleActivity = { kind: 'translation', job: { episodeId: 5, language: 'Korean', status: 'queued', done: 0, total: 0, reason: null } };
const MAKING: SubtitleActivity = {
    kind: 'generation',
    job: { episodeId: 9, language: 'Portuguese (Brazil)', status: 'running', done: 1, total: 2, reason: null, phase: 'sending', plan: 'transcribe-translate' }
};

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS });
    useAnimeStore.setState({ ...initialAnime, library: LIBRARY, subtitleJobs: [] });
});

afterEach(() => {
    useAppStore.setState(initialApp, true);
    useAnimeStore.setState(initialAnime, true);
});

describe('episodeOf', () => {
    it('finds the anime and the number of the episode in the library', () => {
        expect(episodeOf(LIBRARY, 5)).toEqual({ title: 'Naruto', episode: '8' });
        expect(episodeOf(LIBRARY, 9)).toEqual({ title: 'Bleach', episode: '1' });
    });

    it('is null for an episode that is not in the library', () => {
        expect(episodeOf(LIBRARY, 99)).toBeNull();
        expect(episodeOf([], 4)).toBeNull();
    });
});

describe('activityPercent', () => {
    it('counts the lines translated out of all of them', () => {
        expect(activityPercent(TRANSLATING)).toBe(25);
        expect(activityPercent({ kind: 'translation', job: { ...TRANSLATING.job, done: 12 } })).toBe(100);
    });

    it('is zero before the translation knows how many lines there are', () => {
        expect(activityPercent(WAITING)).toBe(0);
    });

    it('never goes past 100', () => {
        expect(activityPercent({ kind: 'translation', job: { ...TRANSLATING.job, done: 15 } })).toBe(100);
    });

    it('counts the steps of a subtitle made from the audio', () => {
        // Taking the audio out is done (5) and half of sending it (50) is done.
        expect(activityPercent(MAKING)).toBe(30);
    });

    it('is zero for a subtitle made from the audio before it knows its plan', () => {
        expect(activityPercent({ kind: 'generation', job: { episodeId: 9, language: 'Korean', status: 'queued', done: 0, total: 0, reason: null } })).toBe(0);
    });
});

describe('activityDetail', () => {
    it('says the language a translation goes into', () => {
        expect(activityDetail(TRANSLATING, t)).toBe('Into Spanish');
    });

    it('says the step a subtitle made from the audio is in', () => {
        expect(activityDetail(MAKING, t)).toBe('Sending the audio and receiving the text');
        expect(activityDetail({ kind: 'generation', job: { ...MAKING.job, phase: 'translating' } as SubtitleActivity['job'] }, t)).toBe('Translating the text into Portuguese (Brazil)');
        expect(activityDetail({ kind: 'generation', job: { ...MAKING.job, phase: 'sending', plan: 'direct', language: 'English' } as SubtitleActivity['job'] }, t)).toBe(
            'Sending the audio and receiving the subtitle in English'
        );
    });

    it('says the language of a subtitle made from the audio before its first step', () => {
        expect(activityDetail({ kind: 'generation', job: { episodeId: 9, language: 'Korean', status: 'queued', done: 0, total: 0, reason: null } }, t)).toBe('Into Korean');
    });
});

describe('AnimeSubtitleJobs', () => {
    it('says when nothing is being translated or made', () => {
        render(<AnimeSubtitleJobs />);
        expect(screen.getByText('// NO SUBTITLE IS BEING TRANSLATED OR CREATED.')).toHaveClass('empty');
        expect(screen.queryByTestId('anime-subtitle-job')).not.toBeInTheDocument();
    });

    it('shows a card for each subtitle, in the order they came, with its kind, its state, its bar and what it does', () => {
        useAnimeStore.setState({ subtitleJobs: [TRANSLATING, WAITING, MAKING] });
        render(<AnimeSubtitleJobs />);

        expect(screen.getByRole('region', { name: 'TRANSLATING (3)' })).toBeInTheDocument();
        const cards = screen.getAllByTestId('anime-subtitle-job');
        expect(cards).toHaveLength(3);

        expect(within(cards[0] as HTMLElement).getByRole('heading', { level: 3 })).toHaveTextContent('Naruto · EP 7');
        expect(cards[0]).toHaveClass('job', 'job--running');
        expect(
            within(cards[0] as HTMLElement)
                .getAllByText(/./, { selector: '.badge' })
                .map((badge) => {
                    return badge.textContent;
                })
        ).toEqual(['TRANSLATION', 'IN PROGRESS']);
        const bar = within(cards[0] as HTMLElement).getByRole('progressbar', { name: 'Progress of the subtitle of Naruto · EP 7' });
        expect(bar).toHaveClass('progress');
        expect(bar).toHaveAttribute('aria-valuenow', '25');
        expect(bar).toHaveAttribute('aria-valuemin', '0');
        expect(bar).toHaveAttribute('aria-valuemax', '100');
        expect(bar.querySelector('.progress__bar')).toHaveStyle({ width: '25%' });
        expect(within(cards[0] as HTMLElement).getByText('25.0%')).toBeInTheDocument();
        expect(within(cards[0] as HTMLElement).getByText('Into Spanish')).toBeInTheDocument();

        expect(within(cards[1] as HTMLElement).getByRole('heading', { level: 3 })).toHaveTextContent('Naruto · EP 8');
        expect(cards[1]).toHaveClass('job--queued');
        expect(within(cards[1] as HTMLElement).getByText('WAITING')).toHaveClass('badge', 'badge--queued');
        expect(within(cards[1] as HTMLElement).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');

        expect(within(cards[2] as HTMLElement).getByRole('heading', { level: 3 })).toHaveTextContent('Bleach · EP 1');
        expect(within(cards[2] as HTMLElement).getByText('CREATION')).toHaveClass('badge');
        expect(within(cards[2] as HTMLElement).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '30');
        expect(within(cards[2] as HTMLElement).getByText('Sending the audio and receiving the text')).toBeInTheDocument();
    });

    it('names an episode that is not in the library any more', () => {
        useAnimeStore.setState({ subtitleJobs: [{ kind: 'translation', job: { ...TRANSLATING.job, episodeId: 99 } }] });
        render(<AnimeSubtitleJobs />);
        expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Episode no longer in the library');
    });

    it('stops every subtitle, the translations and the ones made from the audio, only after the user confirms', async () => {
        const user = userEvent.setup();
        useAnimeStore.setState({ subtitleJobs: [TRANSLATING, WAITING, MAKING] });
        render(<AnimeSubtitleJobs />);

        const stopAll = screen.getByRole('button', { name: 'STOP ALL' });
        expect(stopAll).toHaveClass('btn', 'btn--small', 'btn--hot');
        await user.click(stopAll);
        const dialog = screen.getByRole('dialog', { name: 'Stop all the subtitles?' });
        expect(dialog).toHaveTextContent('Every subtitle being translated or created, and the ones waiting, is cancelled and nothing of it is saved. What was already sent to the provider is still charged.');
        await user.click(within(dialog).getByRole('button', { name: 'BACK' }));
        expect(mock.api.cancelAnimeSubtitleTranslation).not.toHaveBeenCalled();
        expect(mock.api.cancelAnimeSubtitleGeneration).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: 'STOP ALL' }));
        await user.click(within(screen.getByRole('dialog', { name: 'Stop all the subtitles?' })).getByRole('button', { name: 'STOP ALL' }));
        expect(mock.api.cancelAnimeSubtitleTranslation).toHaveBeenCalledTimes(1);
        expect(mock.api.cancelAnimeSubtitleTranslation).toHaveBeenCalledWith(null);
        expect(mock.api.cancelAnimeSubtitleGeneration).toHaveBeenCalledTimes(1);
        expect(mock.api.cancelAnimeSubtitleGeneration).toHaveBeenCalledWith(9);
    });

    it('has no button to stop all when nothing goes on', () => {
        render(<AnimeSubtitleJobs />);
        expect(screen.queryByRole('button', { name: 'STOP ALL' })).not.toBeInTheDocument();
    });

    it('cancels a translation only after the user confirms', async () => {
        const user = userEvent.setup();
        useAnimeStore.setState({ subtitleJobs: [TRANSLATING, MAKING] });
        render(<AnimeSubtitleJobs />);

        await user.click(screen.getByRole('button', { name: 'Cancel the subtitle of Naruto · EP 7' }));
        const dialog = screen.getByRole('dialog', { name: 'Cancel this subtitle?' });
        expect(dialog).toHaveTextContent('The work stops and nothing is saved. What was already sent to the provider is still charged.');
        await user.click(within(dialog).getByRole('button', { name: 'BACK' }));
        expect(mock.api.cancelAnimeSubtitleTranslation).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: 'Cancel the subtitle of Naruto · EP 7' }));
        await user.click(within(screen.getByRole('dialog', { name: 'Cancel this subtitle?' })).getByRole('button', { name: 'CANCEL' }));
        expect(mock.api.cancelAnimeSubtitleTranslation).toHaveBeenCalledTimes(1);
        expect(mock.api.cancelAnimeSubtitleTranslation).toHaveBeenCalledWith(4);
        expect(mock.api.cancelAnimeSubtitleGeneration).not.toHaveBeenCalled();
    });

    it('cancels the making of a subtitle from the audio', async () => {
        const user = userEvent.setup();
        useAnimeStore.setState({ subtitleJobs: [MAKING] });
        render(<AnimeSubtitleJobs />);

        await user.click(screen.getByRole('button', { name: 'Cancel the subtitle of Bleach · EP 1' }));
        await user.click(within(screen.getByRole('dialog', { name: 'Cancel this subtitle?' })).getByRole('button', { name: 'CANCEL' }));

        expect(mock.api.cancelAnimeSubtitleGeneration).toHaveBeenCalledTimes(1);
        expect(mock.api.cancelAnimeSubtitleGeneration).toHaveBeenCalledWith(9);
        expect(mock.api.cancelAnimeSubtitleTranslation).not.toHaveBeenCalled();
    });
});
