// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnimeSubtitleTrack, SubtitleEstimateResponse, SubtitleTranslateResponse } from '@shared/anime';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { SubtitleTranslateDialog } from '@renderer/components/SubtitleTranslateDialog';
import { useAppStore } from '@renderer/store/appStore';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();

const ENGLISH: AnimeSubtitleTrack = { id: '', label: 'English', kind: 'default' };
const JAPANESE: AnimeSubtitleTrack = { id: 'subtitle-Japanese', label: 'Japanese', kind: 'source' };
const TRACKS = [ENGLISH, JAPANESE];
const ESTIMATE: SubtitleEstimateResponse = { ok: true, cues: 120, batches: 3, approxTokens: 5400 };
const TRANSLATED_TRACK: AnimeSubtitleTrack = { id: 'translated-Portuguese (Brazil)', label: 'Portuguese (Brazil)', kind: 'translated' };
const TRANSLATED: SubtitleTranslateResponse = { ok: true, tracks: [ENGLISH, JAPANESE, TRANSLATED_TRACK], translated: TRANSLATED_TRACK };

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: { ...DEFAULT_SETTINGS, translateProvider: 'anthropic', translateModel: 'my-model', translateLanguage: 'Spanish' } });
    mock.api.estimateAnimeSubtitleTranslation.mockResolvedValue(ESTIMATE);
});

function renderDialog() {
    const onTranslated = vi.fn();
    const onClose = vi.fn();
    render(<SubtitleTranslateDialog episodeId={7} tracks={TRACKS} onTranslated={onTranslated} onClose={onClose} />);
    return { onTranslated, onClose };
}

async function ready() {
    const result = renderDialog();
    await screen.findByText('120 lines, 3 requests, about 5400 tokens of your account.');
    return result;
}

describe('SubtitleTranslateDialog', () => {
    it('opens a dialog that says what it does, who is paid, and which provider and model are used', async () => {
        renderDialog();
        const dialog = screen.getByRole('dialog', { name: 'Translate a subtitle' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(screen.getByRole('heading', { name: 'Translate a subtitle' })).toBeInTheDocument();
        expect(screen.getByText('A language model translates the subtitle you choose and the result is saved next to the video. The text of the subtitle is sent to the provider you set up in the anime settings, and it is charged to your account.')).toBeInTheDocument();
        expect(screen.getByText('Provider: Claude (Anthropic) · Model: my-model')).toBeInTheDocument();
        await screen.findByText('120 lines, 3 requests, about 5400 tokens of your account.');
    });

    it('shows a dash when the settings have no model', async () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, translateModel: '' } });
        renderDialog();
        expect(screen.getByText('Provider: ChatGPT (OpenAI) · Model: —')).toBeInTheDocument();
        await screen.findByText('120 lines, 3 requests, about 5400 tokens of your account.');
    });

    it('starts with the language of the settings, the subtitle picked by the app and the options of the episode', async () => {
        await ready();
        expect(screen.getByLabelText('Translate into')).toHaveValue('Spanish');
        expect(screen.getByLabelText('Translate from')).toHaveValue('auto');
        expect(Array.from(screen.getByLabelText('Translate from').querySelectorAll('option')).map((option) => {
            return [option.value, option.textContent];
        })).toEqual([
            ['auto', 'Automatic (English when there is one)'],
            ['default', 'English'],
            ['subtitle-Japanese', 'Japanese']
        ]);
        expect(Array.from(screen.getByLabelText('Translate into').querySelectorAll('option')).map((option) => {
            return option.value;
        })).toEqual(['Portuguese (Brazil)', 'Portuguese', 'Spanish', 'English', 'French', 'German', 'Italian', 'Russian', 'Japanese', 'Chinese', 'Korean', 'Arabic', 'Turkish', 'Indonesian']);
    });

    it('moves the focus into the dialog and gives it back when it closes', async () => {
        const opener = document.createElement('button');
        document.body.append(opener);
        opener.focus();
        const { unmount } = render(<SubtitleTranslateDialog episodeId={7} tracks={TRACKS} onTranslated={vi.fn()} onClose={vi.fn()} />);
        expect(screen.getByLabelText('Translate from')).toHaveFocus();
        await screen.findByText('120 lines, 3 requests, about 5400 tokens of your account.');
        unmount();
        expect(opener).toHaveFocus();
        opener.remove();
    });

    describe('the estimate', () => {
        it('says it is counting, then shows the lines, the requests and about the tokens it takes', async () => {
            let answer: (value: SubtitleEstimateResponse) => void = () => {
                return undefined;
            };
            mock.api.estimateAnimeSubtitleTranslation.mockReturnValue(new Promise((resolve) => {
                answer = resolve;
            }));
            renderDialog();
            expect(screen.getByText('Counting the lines…')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'TRANSLATE' })).toBeDisabled();
            await act(async () => {
                answer(ESTIMATE);
            });
            expect(screen.getByText('120 lines, 3 requests, about 5400 tokens of your account.')).toBeInTheDocument();
            expect(screen.queryByText('Counting the lines…')).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'TRANSLATE' })).toBeEnabled();
        });

        it('asks for the subtitle that the app picks, and again for the one that is chosen', async () => {
            const user = userEvent.setup();
            await ready();
            expect(mock.api.estimateAnimeSubtitleTranslation).toHaveBeenCalledTimes(1);
            expect(mock.api.estimateAnimeSubtitleTranslation).toHaveBeenLastCalledWith({ episodeId: 7, trackId: null });
            mock.api.estimateAnimeSubtitleTranslation.mockResolvedValue({ ok: true, cues: 8, batches: 1, approxTokens: 310 });
            await user.selectOptions(screen.getByLabelText('Translate from'), 'subtitle-Japanese');
            expect(await screen.findByText('8 lines, 1 requests, about 310 tokens of your account.')).toBeInTheDocument();
            expect(mock.api.estimateAnimeSubtitleTranslation).toHaveBeenCalledTimes(2);
            expect(mock.api.estimateAnimeSubtitleTranslation).toHaveBeenLastCalledWith({ episodeId: 7, trackId: 'subtitle-Japanese' });
            await user.selectOptions(screen.getByLabelText('Translate from'), 'default');
            await vi.waitFor(() => {
                expect(mock.api.estimateAnimeSubtitleTranslation).toHaveBeenLastCalledWith({ episodeId: 7, trackId: '' });
            });
        });

        it('says counting again, with the button off, while the estimate of another subtitle comes', async () => {
            const user = userEvent.setup();
            await ready();
            mock.api.estimateAnimeSubtitleTranslation.mockReturnValue(new Promise(() => {
                return undefined;
            }));
            await user.selectOptions(screen.getByLabelText('Translate from'), 'subtitle-Japanese');
            expect(screen.getByText('Counting the lines…')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'TRANSLATE' })).toBeDisabled();
        });

        it.each([
            ['missing', 'The video of this episode is not on the disk, so its subtitle cannot be translated.'],
            ['no-source', 'This episode has no subtitle to translate.'],
            ['unreadable', 'The subtitle file could not be read or saved.'],
            ['too-large', 'This subtitle file is too large.'],
            ['empty', 'This subtitle has no lines to translate.']
        ] as const)('says why it could not be counted ("%s") and keeps TRANSLATE off', async (reason, text) => {
            mock.api.estimateAnimeSubtitleTranslation.mockResolvedValue({ ok: false, reason });
            renderDialog();
            expect(await screen.findByText(text)).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'TRANSLATE' })).toBeDisabled();
        });

        it('ignores an estimate that comes after another subtitle was chosen', async () => {
            const user = userEvent.setup();
            let first: (value: SubtitleEstimateResponse) => void = () => {
                return undefined;
            };
            mock.api.estimateAnimeSubtitleTranslation.mockReturnValueOnce(new Promise((resolve) => {
                first = resolve;
            }));
            renderDialog();
            mock.api.estimateAnimeSubtitleTranslation.mockResolvedValue({ ok: true, cues: 8, batches: 1, approxTokens: 310 });
            await user.selectOptions(screen.getByLabelText('Translate from'), 'subtitle-Japanese');
            await screen.findByText('8 lines, 1 requests, about 310 tokens of your account.');
            await act(async () => {
                first(ESTIMATE);
            });
            expect(screen.getByText('8 lines, 1 requests, about 310 tokens of your account.')).toBeInTheDocument();
            expect(screen.queryByText('120 lines, 3 requests, about 5400 tokens of your account.')).not.toBeInTheDocument();
        });
    });

    describe('translating', () => {
        it('asks for the translation with the subtitle and the language chosen and gives the new subtitles when it is done', async () => {
            const user = userEvent.setup();
            mock.api.translateAnimeSubtitle.mockResolvedValue(TRANSLATED);
            const { onTranslated, onClose } = await ready();
            await user.selectOptions(screen.getByLabelText('Translate into'), 'Portuguese (Brazil)');
            await user.click(screen.getByRole('button', { name: 'TRANSLATE' }));
            expect(mock.api.translateAnimeSubtitle).toHaveBeenCalledTimes(1);
            expect(mock.api.translateAnimeSubtitle).toHaveBeenCalledWith({ episodeId: 7, trackId: null, language: 'Portuguese (Brazil)' });
            await vi.waitFor(() => {
                expect(onTranslated).toHaveBeenCalledTimes(1);
            });
            expect(onTranslated).toHaveBeenCalledWith(TRANSLATED.ok ? TRANSLATED.tracks : [], TRANSLATED_TRACK);
            expect(onClose).not.toHaveBeenCalled();
        });

        it('starts from the subtitle chosen, the default one with an empty id', async () => {
            const user = userEvent.setup();
            mock.api.translateAnimeSubtitle.mockResolvedValue(TRANSLATED);
            await ready();
            await user.selectOptions(screen.getByLabelText('Translate from'), 'default');
            await vi.waitFor(() => {
                expect(mock.api.estimateAnimeSubtitleTranslation).toHaveBeenLastCalledWith({ episodeId: 7, trackId: '' });
                expect(screen.getByRole('button', { name: 'TRANSLATE' })).toBeEnabled();
            });
            await user.click(screen.getByRole('button', { name: 'TRANSLATE' }));
            expect(mock.api.translateAnimeSubtitle).toHaveBeenCalledWith({ episodeId: 7, trackId: '', language: 'Spanish' });
        });

        it('shows that it is waiting for its turn, then how many lines are done, and offers to cancel instead of translating', async () => {
            const user = userEvent.setup();
            let finish: (value: SubtitleTranslateResponse) => void = () => {
                return undefined;
            };
            mock.api.translateAnimeSubtitle.mockReturnValue(new Promise((resolve) => {
                finish = resolve;
            }));
            const { onTranslated } = await ready();
            await user.click(screen.getByRole('button', { name: 'TRANSLATE' }));
            expect(screen.getByText('Waiting for its turn…')).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'TRANSLATE' })).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'CANCEL TRANSLATION' })).toBeEnabled();
            expect(screen.getByRole('button', { name: 'CLOSE' })).toBeDisabled();

            act(() => {
                mock.emitSubtitleTranslation({ episodeId: 7, language: 'Spanish', status: 'queued', done: 0, total: 0, reason: null });
            });
            expect(screen.getByText('Waiting for its turn…')).toBeInTheDocument();
            act(() => {
                mock.emitSubtitleTranslation({ episodeId: 7, language: 'Spanish', status: 'running', done: 40, total: 120, reason: null });
            });
            expect(screen.getByText('Translated 40 of 120 lines…')).toBeInTheDocument();
            expect(screen.queryByText('Waiting for its turn…')).not.toBeInTheDocument();

            await act(async () => {
                finish(TRANSLATED);
            });
            expect(onTranslated).toHaveBeenCalledTimes(1);
            expect(screen.queryByText('Translated 40 of 120 lines…')).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'TRANSLATE' })).toBeEnabled();
        });

        it('ignores the progress of other episodes', async () => {
            const user = userEvent.setup();
            mock.api.translateAnimeSubtitle.mockReturnValue(new Promise(() => {
                return undefined;
            }));
            await ready();
            await user.click(screen.getByRole('button', { name: 'TRANSLATE' }));
            act(() => {
                mock.emitSubtitleTranslation({ episodeId: 8, language: 'Spanish', status: 'running', done: 5, total: 9, reason: null });
            });
            expect(screen.getByText('Waiting for its turn…')).toBeInTheDocument();
            expect(screen.queryByText('Translated 5 of 9 lines…')).not.toBeInTheDocument();
        });

        it('cancels the translation of this episode', async () => {
            const user = userEvent.setup();
            mock.api.translateAnimeSubtitle.mockReturnValue(new Promise(() => {
                return undefined;
            }));
            await ready();
            await user.click(screen.getByRole('button', { name: 'TRANSLATE' }));
            await user.click(screen.getByRole('button', { name: 'CANCEL TRANSLATION' }));
            expect(mock.api.cancelAnimeSubtitleTranslation).toHaveBeenCalledTimes(1);
            expect(mock.api.cancelAnimeSubtitleTranslation).toHaveBeenCalledWith(7);
        });

        it('says nothing when it was cancelled, and goes back to offering the translation', async () => {
            const user = userEvent.setup();
            mock.api.translateAnimeSubtitle.mockResolvedValue({ ok: false, reason: 'cancelled' });
            const { onTranslated } = await ready();
            await user.click(screen.getByRole('button', { name: 'TRANSLATE' }));
            await vi.waitFor(() => {
                expect(screen.getByRole('button', { name: 'TRANSLATE' })).toBeEnabled();
            });
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
            expect(onTranslated).not.toHaveBeenCalled();
        });

        it.each([
            [{ ok: false, reason: 'no-token' }, 'There is no token for this provider. Add one in the anime settings.'],
            [{ ok: false, reason: 'no-model' }, 'No model is set. Write the name of the model in the anime settings.'],
            [{ ok: false, reason: 'busy' }, 'This episode is being translated already.'],
            [{ ok: false, reason: 'failed', error: { code: 'QUOTA_EXCEEDED', raw: 'no credit' } }, 'The translation failed. The account has no credit or quota left.']
        ] as const)('says why when it did not work (%j), and lets the user try again', async (response, text) => {
            const user = userEvent.setup();
            mock.api.translateAnimeSubtitle.mockResolvedValue(response);
            const { onTranslated } = await ready();
            await user.click(screen.getByRole('button', { name: 'TRANSLATE' }));
            expect(await screen.findByRole('alert')).toHaveTextContent(text);
            expect(screen.getByRole('button', { name: 'TRANSLATE' })).toBeEnabled();
            expect(onTranslated).not.toHaveBeenCalled();
        });

        it('clears the message when it tries again', async () => {
            const user = userEvent.setup();
            mock.api.translateAnimeSubtitle.mockResolvedValueOnce({ ok: false, reason: 'no-token' });
            mock.api.translateAnimeSubtitle.mockReturnValueOnce(new Promise(() => {
                return undefined;
            }));
            await ready();
            await user.click(screen.getByRole('button', { name: 'TRANSLATE' }));
            await screen.findByRole('alert');
            await user.click(screen.getByRole('button', { name: 'TRANSLATE' }));
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });
    });

    describe('closing', () => {
        it('closes with the CLOSE button', async () => {
            const user = userEvent.setup();
            const { onClose } = await ready();
            await user.click(screen.getByRole('button', { name: 'CLOSE' }));
            expect(onClose).toHaveBeenCalledTimes(1);
        });

        it('closes with Esc, without the player behind hearing it', async () => {
            const { onClose } = await ready();
            const onWindowKey = vi.fn();
            window.addEventListener('keydown', onWindowKey);
            fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
            window.removeEventListener('keydown', onWindowKey);
            expect(onClose).toHaveBeenCalledTimes(1);
            expect(onWindowKey).not.toHaveBeenCalled();
        });

        it('does not close with Esc while it is translating: the way out is to cancel', async () => {
            const user = userEvent.setup();
            mock.api.translateAnimeSubtitle.mockReturnValue(new Promise(() => {
                return undefined;
            }));
            const { onClose } = await ready();
            await user.click(screen.getByRole('button', { name: 'TRANSLATE' }));
            fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
            expect(onClose).not.toHaveBeenCalled();
        });

        it('keeps Tab inside the dialog, from the last control to the first and back', async () => {
            await ready();
            const dialog = screen.getByRole('dialog');
            const first = screen.getByLabelText('Translate from');
            const last = screen.getByRole('button', { name: 'CLOSE' });
            last.focus();
            fireEvent.keyDown(dialog, { key: 'Tab' });
            expect(first).toHaveFocus();
            fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
            expect(last).toHaveFocus();
        });

        it('leaves Tab alone between the first and the last control, and ignores the other keys', async () => {
            await ready();
            const dialog = screen.getByRole('dialog');
            screen.getByLabelText('Translate into').focus();
            expect(fireEvent.keyDown(dialog, { key: 'Tab' })).toBe(true);
            expect(fireEvent.keyDown(dialog, { key: 'a' })).toBe(true);
            expect(screen.getByLabelText('Translate into')).toHaveFocus();
        });
    });

    it('stops listening for the progress when it closes', async () => {
        const { unmount } = render(<SubtitleTranslateDialog episodeId={7} tracks={TRACKS} onTranslated={vi.fn()} onClose={vi.fn()} />);
        await screen.findByText('120 lines, 3 requests, about 5400 tokens of your account.');
        expect(mock.api.onSubtitleTranslationUpdate).toHaveBeenCalledTimes(1);
        unmount();
        expect(mock.unsubscribers[0]).toHaveBeenCalledTimes(1);
    });
});
